/**
 * Parses Android XML navigation-graph resources (`res/navigation/*.xml`)
 * into graphs, destinations, actions, arguments, deep links, and includes.
 *
 * Computed early (before the full/incremental build decision), independent
 * of Kotlin/Java indexing, consuming Batch 3's already-discovered
 * `android-resources.json` navigation file records rather than re-scanning
 * resource directories. Never simulates runtime graph composition: every
 * candidate action/start-destination/include target is enumerated, never
 * narrowed to one winner.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import {
  parseXml,
  findAndroidNamespacePrefix,
  findNamespacePrefixForUri,
  getAndroidAttr,
  APP_NAMESPACE_URI,
  TOOLS_NAMESPACE_URI,
  type XmlElement,
} from './xml/parseXml.js'
import { classifyResourceReference } from './xml/collectResourceReferences.js'
import type { AndroidResourcesArtifact, AndroidResourceFile } from './androidResourceTypes.js'
import type {
  AndroidNavigationAction,
  AndroidNavigationArgument,
  AndroidNavigationDeepLink,
  AndroidNavigationDestination,
  AndroidNavigationDestinationKind,
  AndroidNavigationFile,
  AndroidNavigationGraph,
  AndroidNavigationInclude,
  AndroidNavigationQualifiers,
  AndroidNavigationResourceReference,
  AndroidNavigationSourceRef,
} from './androidNavigationTypes.js'

export interface BuildAndroidNavigationXmlModelOptions {
  projectRoot: string
  androidResources: AndroidResourcesArtifact
}

export interface AndroidNavigationXmlModel {
  filesExamined: string[]
  navigationFiles: AndroidNavigationFile[]
  graphs: AndroidNavigationGraph[]
  destinations: AndroidNavigationDestination[]
  actions: AndroidNavigationAction[]
  arguments: AndroidNavigationArgument[]
  xmlDeepLinks: AndroidNavigationDeepLink[]
  includes: AndroidNavigationInclude[]
  warnings: string[]
}

export interface BuildAndroidNavigationXmlModelResult {
  model: AndroidNavigationXmlModel
  evidenceFingerprint: string
}

const DESTINATION_TAGS: Record<string, AndroidNavigationDestinationKind> = {
  fragment: 'fragment',
  activity: 'activity',
  dialog: 'dialog',
}
const STRUCTURAL_CHILD_TAGS = new Set(['navigation', 'include', 'action', 'argument', 'deepLink'])

export function buildAndroidNavigationXmlModel(options: BuildAndroidNavigationXmlModelOptions): BuildAndroidNavigationXmlModelResult {
  const { projectRoot, androidResources } = options
  const navigationResourceFiles = androidResources.resourceFiles.filter((f) => f.baseType === 'navigation')

  const filesExamined = new Set<string>()
  const navigationFiles: AndroidNavigationFile[] = []
  const graphs: AndroidNavigationGraph[] = []
  const destinations: AndroidNavigationDestination[] = []
  const actions: AndroidNavigationAction[] = []
  const argumentsOut: AndroidNavigationArgument[] = []
  const xmlDeepLinks: AndroidNavigationDeepLink[] = []
  const includes: AndroidNavigationInclude[] = []
  const warnings: string[] = []

  for (const resourceFile of navigationResourceFiles) {
    filesExamined.add(resourceFile.path)
    const navFileId = `android-navigation-file:${resourceFile.path}`
    const logicalKey = `navigation/${resourceFile.resourceName ?? ''}`
    const qualifiers = resourceFile.qualifiers as unknown as AndroidNavigationQualifiers

    const xmlText = readFile(projectRoot, resourceFile.path)
    if (xmlText === null) {
      navigationFiles.push(
        buildEmptyFileRecord(navFileId, resourceFile, logicalKey, qualifiers, `Navigation file "${resourceFile.path}" could not be read.`)
      )
      continue
    }

    const { root, error } = parseXml(xmlText)
    if (!root || error) {
      const message = error ?? 'Malformed XML: no root element found.'
      navigationFiles.push(buildEmptyFileRecord(navFileId, resourceFile, logicalKey, qualifiers, message))
      warnings.push(`${resourceFile.path}: ${message}`)
      continue
    }

    const ctx: FileParseContext = {
      navFileId,
      filePath: resourceFile.path,
      moduleId: resourceFile.moduleId,
      gradlePath: resourceFile.gradlePath,
      sourceSet: resourceFile.sourceSet,
      qualifiers,
      androidPrefix: findAndroidNamespacePrefix(root),
      appPrefix: findNamespacePrefixForUri(root, APP_NAMESPACE_URI),
      toolsPrefix: findNamespacePrefixForUri(root, TOOLS_NAMESPACE_URI),
      graphs,
      destinations,
      actions,
      arguments: argumentsOut,
      xmlDeepLinks,
      includes,
    }

    const rootGraphId = `${navFileId}#graph:root`
    const graph = buildGraphRecord(root, 'root', rootGraphId, null, ctx)
    graphs.push(graph)

    navigationFiles.push({
      id: navFileId,
      resourceFileId: resourceFile.id,
      logicalKey,
      path: resourceFile.path,
      moduleId: resourceFile.moduleId,
      gradlePath: resourceFile.gradlePath,
      sourceSet: resourceFile.sourceSet,
      qualifiers,
      xmlRootElement: root.name,
      rootGraphId,
      destinationIds: graph.destinationIds,
      actionIds: graph.actionIds,
      argumentIds: graph.argumentIds,
      deepLinkIds: graph.deepLinkIds,
      includeIds: graph.includeIds,
      parsingStatus: 'parsed',
      source: { file: resourceFile.path, line: root.line, column: root.column },
      warnings: [],
    })
  }

  // Candidate-target resolution pass: build a logical-key index across all
  // destinations and (nested/root) graphs, then resolve start-destination,
  // action-destination, action-popUpTo, and include references against it.
  // Every match is preserved — never a single selected winner.
  const destinationOrGraphIndex = buildLogicalKeyIndex(destinations, graphs)
  const navigationFileIndex = buildNavigationFileIndex(navigationFiles)

  for (const graph of graphs) {
    resolveStartDestination(graph.startDestination, destinationOrGraphIndex)
  }
  for (const action of actions) {
    if (action.destinationRaw) {
      const classified = classifyResourceReference(action.destinationRaw)
      if (classified.resourceName) {
        action.candidateDestinationIds = [...(destinationOrGraphIndex.get(`id/${classified.resourceName}`) ?? [])].sort()
      }
    }
    if (action.popUpToRaw) {
      const classified = classifyResourceReference(action.popUpToRaw)
      if (classified.resourceName) {
        action.candidatePopUpToIds = [...(destinationOrGraphIndex.get(`id/${classified.resourceName}`) ?? [])].sort()
      }
    }
  }
  for (const include of includes) {
    if (include.logicalKey) include.candidateTargetGraphIds = [...(navigationFileIndex.get(include.logicalKey) ?? [])].sort()
  }

  warnings.push(...destinations.flatMap((d) => d.warnings.map((w) => `${d.file}: ${w}`)))
  warnings.push(...actions.flatMap((a) => a.warnings.map((w) => `${a.file}: ${w}`)))
  warnings.push(...argumentsOut.flatMap((a) => a.warnings.map((w) => `${a.file}: ${w}`)))
  warnings.push(...xmlDeepLinks.flatMap((d) => d.warnings.map((w) => `${d.file}: ${w}`)))
  warnings.push(...includes.flatMap((i) => i.warnings.map((w) => `${i.file}: ${w}`)))
  warnings.push(...graphs.flatMap((g) => g.warnings.map((w) => `${g.file}: ${w}`)))

  const model: AndroidNavigationXmlModel = {
    filesExamined: [...filesExamined].sort(),
    navigationFiles: sortById(navigationFiles),
    graphs: sortById(graphs),
    destinations: sortById(destinations),
    actions: sortById(actions),
    arguments: sortById(argumentsOut),
    xmlDeepLinks: sortById(xmlDeepLinks),
    includes: sortById(includes),
    warnings: [...new Set(warnings)].sort(),
  }

  return { model, evidenceFingerprint: computeFingerprint(model) }
}

interface FileParseContext {
  navFileId: string
  filePath: string
  moduleId: string
  gradlePath: string | null
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  androidPrefix: string | null
  appPrefix: string | null
  toolsPrefix: string | null
  graphs: AndroidNavigationGraph[]
  destinations: AndroidNavigationDestination[]
  actions: AndroidNavigationAction[]
  arguments: AndroidNavigationArgument[]
  xmlDeepLinks: AndroidNavigationDeepLink[]
  includes: AndroidNavigationInclude[]
}

function sourceRefOf(ctx: FileParseContext, el: XmlElement): AndroidNavigationSourceRef {
  return { file: ctx.filePath, line: el.line, column: el.column }
}

function buildLabelValue(
  raw: string | undefined,
  ctx: FileParseContext,
  el: XmlElement,
  refIndexRef: { n: number },
  ownerId: string
): AndroidNavigationResourceReference | { kind: 'literal'; value: string } | null {
  if (raw === undefined) return null
  if (raw.startsWith('@') || raw.startsWith('?')) return buildReference(raw, ctx, el, refIndexRef, ownerId)
  return { kind: 'literal', value: raw }
}

function buildReference(
  raw: string,
  ctx: FileParseContext,
  el: XmlElement,
  refIndexRef: { n: number },
  ownerId: string
): AndroidNavigationResourceReference {
  const classified = classifyResourceReference(raw)
  const id = `${ownerId}#reference:${refIndexRef.n}`
  refIndexRef.n++
  return {
    id,
    raw,
    kind: classified.kind,
    packagePrefix: classified.packagePrefix,
    resourceType: classified.resourceType,
    resourceName: classified.resourceName,
    source: sourceRefOf(ctx, el),
    candidateTargetIds: [],
    warnings: classified.warning ? [classified.warning] : [],
  }
}

function buildGraphRecord(
  el: XmlElement,
  kind: 'root' | 'nested',
  graphId: string,
  parentGraphId: string | null,
  ctx: FileParseContext
): AndroidNavigationGraph {
  const rawId = getAndroidAttr(el, 'id', ctx.androidPrefix) ?? null
  const refIndexRef = { n: 0 }
  const rawIdRef = rawId ? buildReference(rawId, ctx, el, refIndexRef, graphId) : null
  const logicalKey = rawIdRef?.resourceName ? `id/${rawIdRef.resourceName}` : null
  const startDestinationRaw = getAndroidAttr(el, 'startDestination', ctx.appPrefix) ?? null

  const graph: AndroidNavigationGraph = {
    id: graphId,
    kind,
    rawId,
    logicalKey,
    route: el.attributes['route'] ?? null,
    startDestination: {
      raw: startDestinationRaw,
      candidateDestinationIds: [],
      candidateGraphIds: [],
      unresolved: startDestinationRaw === null,
      warnings: startDestinationRaw === null ? ['No app:startDestination declared for this graph.'] : [],
    },
    parentGraphId,
    destinationIds: [],
    actionIds: [],
    argumentIds: [],
    deepLinkIds: [],
    includeIds: [],
    label: buildLabelValue(getAndroidAttr(el, 'label', ctx.androidPrefix), ctx, el, refIndexRef, graphId),
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    navigationFileId: ctx.navFileId,
    file: ctx.filePath,
    source: sourceRefOf(ctx, el),
    warnings: rawId === null ? ['Graph has no android:id.'] : [],
  }

  let nestedIndex = 0
  let includeIndex = 0
  let actionIndex = 0
  let argumentIndex = 0
  let deepLinkIndex = 0
  let unknownIndex = 0

  for (const child of el.children) {
    if (child.name === 'navigation') {
      const nestedRawId = getAndroidAttr(child, 'id', ctx.androidPrefix)
      const nestedId = `${graphId}#nested:${nestedRawId ?? nestedIndex}`
      nestedIndex++
      const nestedGraph = buildGraphRecord(child, 'nested', nestedId, graphId, ctx)
      ctx.graphs.push(nestedGraph)
      continue
    }
    if (child.name === 'include') {
      includes_push(child, graphId, ctx, includeIndex, graph)
      includeIndex++
      continue
    }
    if (child.name === 'action') {
      const action = buildActionRecord(child, graphId, ctx, actionIndex)
      actionIndex++
      ctx.actions.push(action)
      graph.actionIds.push(action.id)
      continue
    }
    if (child.name === 'argument') {
      const argument = buildArgumentRecord(child, graphId, ctx, argumentIndex)
      argumentIndex++
      ctx.arguments.push(argument)
      graph.argumentIds.push(argument.id)
      continue
    }
    if (child.name === 'deepLink') {
      const deepLink = buildDeepLinkRecord(child, graphId, ctx, deepLinkIndex)
      deepLinkIndex++
      ctx.xmlDeepLinks.push(deepLink)
      graph.deepLinkIds.push(deepLink.id)
      continue
    }
    // fragment / activity / dialog / any unrecognized element name: a destination.
    const destKind: AndroidNavigationDestinationKind = DESTINATION_TAGS[child.name] ?? 'custom'
    const destination = buildDestinationRecord(child, destKind, graphId, ctx, unknownIndex)
    if (destKind === 'custom') unknownIndex++
    ctx.destinations.push(destination)
    graph.destinationIds.push(destination.id)
  }

  return graph
}

function includes_push(el: XmlElement, graphId: string, ctx: FileParseContext, index: number, graph: AndroidNavigationGraph): void {
  const rawGraphRef = getAndroidAttr(el, 'graph', ctx.appPrefix) ?? null
  const includeId = `${graphId}#include:${index}`
  const classified = rawGraphRef ? classifyResourceReference(rawGraphRef) : null
  const logicalKey = classified?.resourceType && classified.resourceName ? `${classified.resourceType}/${classified.resourceName}` : null

  const include: AndroidNavigationInclude = {
    id: includeId,
    parentGraphId: graphId,
    rawGraphRef,
    logicalKey,
    candidateTargetGraphIds: [],
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    file: ctx.filePath,
    source: sourceRefOf(ctx, el),
    warnings: rawGraphRef === null ? ['<include> element has no app:graph reference.'] : [],
  }
  ctx.includes.push(include)
  graph.includeIds.push(includeId)
}

function buildDestinationRecord(
  el: XmlElement,
  kind: AndroidNavigationDestinationKind,
  parentGraphId: string,
  ctx: FileParseContext,
  unknownIndex: number
): AndroidNavigationDestination {
  const rawId = getAndroidAttr(el, 'id', ctx.androidPrefix) ?? null
  const refIndexRef = { n: 0 }
  const destinationId = `${parentGraphId}#destination:${kind}:${rawId ?? unknownIndex}`
  const rawIdRef = rawId ? buildReference(rawId, ctx, el, refIndexRef, destinationId) : null
  const logicalKey = rawIdRef?.resourceName ? `id/${rawIdRef.resourceName}` : null
  const androidName = getAndroidAttr(el, 'name', ctx.androidPrefix) ?? null
  const toolsLayoutRaw = getAndroidAttr(el, 'layout', ctx.toolsPrefix)

  const destinationWarnings: string[] = []
  if (rawId === null) destinationWarnings.push(`<${el.name}> destination has no android:id.`)
  if (kind === 'custom') destinationWarnings.push(`<${el.name}> is not a recognized destination element; preserved conservatively as a custom destination.`)

  const destination: AndroidNavigationDestination = {
    id: destinationId,
    kind,
    rawElementName: el.name,
    rawId,
    logicalKey,
    androidName,
    resolvedClassName: androidName && androidName.includes('.') && !androidName.startsWith('.') ? androidName : null,
    route: el.attributes['route'] ?? null,
    label: buildLabelValue(getAndroidAttr(el, 'label', ctx.androidPrefix), ctx, el, refIndexRef, destinationId),
    toolsLayout: toolsLayoutRaw ? buildReference(toolsLayoutRaw, ctx, el, refIndexRef, destinationId) : null,
    parentGraphId,
    argumentIds: [],
    actionIds: [],
    deepLinkIds: [],
    nestedGraphId: null,
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    file: ctx.filePath,
    source: sourceRefOf(ctx, el),
    warnings: destinationWarnings,
  }

  let actionIndex = 0
  let argumentIndex = 0
  let deepLinkIndex = 0
  for (const child of el.children) {
    if (!STRUCTURAL_CHILD_TAGS.has(child.name)) continue
    if (child.name === 'action') {
      const action = buildActionRecord(child, destinationId, ctx, actionIndex)
      actionIndex++
      ctx.actions.push(action)
      destination.actionIds.push(action.id)
    } else if (child.name === 'argument') {
      const argument = buildArgumentRecord(child, destinationId, ctx, argumentIndex)
      argumentIndex++
      ctx.arguments.push(argument)
      destination.argumentIds.push(argument.id)
    } else if (child.name === 'deepLink') {
      const deepLink = buildDeepLinkRecord(child, destinationId, ctx, deepLinkIndex)
      deepLinkIndex++
      ctx.xmlDeepLinks.push(deepLink)
      destination.deepLinkIds.push(deepLink.id)
    }
  }

  return destination
}

function buildActionRecord(el: XmlElement, parentId: string, ctx: FileParseContext, index: number): AndroidNavigationAction {
  const rawId = getAndroidAttr(el, 'id', ctx.androidPrefix) ?? null
  const actionId = `${parentId}#action:${rawId ?? index}`
  const classifiedId = rawId ? classifyResourceReference(rawId) : null
  const logicalKey = classifiedId?.resourceName ? `id/${classifiedId.resourceName}` : null

  const destinationRaw = getAndroidAttr(el, 'destination', ctx.appPrefix) ?? null
  const popUpToRaw = getAndroidAttr(el, 'popUpTo', ctx.appPrefix) ?? null

  const boolAttr = (name: string): boolean | null => {
    const value = getAndroidAttr(el, name, ctx.appPrefix)
    return value === 'true' ? true : value === 'false' ? false : null
  }
  const refIndexRef = { n: 0 }
  const animRef = (name: string) => {
    const raw = getAndroidAttr(el, name, ctx.appPrefix)
    return raw ? buildReference(raw, ctx, el, refIndexRef, actionId) : null
  }

  return {
    id: actionId,
    parentId,
    rawId,
    logicalKey,
    destinationRaw,
    candidateDestinationIds: [],
    popUpToRaw,
    candidatePopUpToIds: [],
    popUpToInclusive: boolAttr('popUpToInclusive'),
    popUpToSaveState: boolAttr('popUpToSaveState'),
    launchSingleTop: boolAttr('launchSingleTop'),
    restoreState: boolAttr('restoreState'),
    anim: {
      enterAnim: animRef('enterAnim'),
      exitAnim: animRef('exitAnim'),
      popEnterAnim: animRef('popEnterAnim'),
      popExitAnim: animRef('popExitAnim'),
    },
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    file: ctx.filePath,
    source: sourceRefOf(ctx, el),
    warnings: destinationRaw === null ? ['<action> element has no app:destination.'] : [],
  }
}

function buildArgumentRecord(el: XmlElement, parentId: string, ctx: FileParseContext, index: number): AndroidNavigationArgument {
  const name = getAndroidAttr(el, 'name', ctx.androidPrefix) ?? null
  const argumentId = `${parentId}#argument:${name ?? index}`
  const argType = getAndroidAttr(el, 'argType', ctx.appPrefix) ?? null
  const nullableRaw = getAndroidAttr(el, 'nullable', ctx.appPrefix)
  const nullable = nullableRaw === 'true' ? true : nullableRaw === 'false' ? false : null
  const defaultRaw = getAndroidAttr(el, 'defaultValue', ctx.androidPrefix)

  let defaultValue: AndroidNavigationArgument['defaultValue'] = null
  if (defaultRaw !== undefined) {
    const refIndexRef = { n: 0 }
    if (defaultRaw === '@null') {
      defaultValue = { raw: defaultRaw, classification: 'null', reference: null }
    } else if (defaultRaw.startsWith('@') || defaultRaw.startsWith('?')) {
      defaultValue = { raw: defaultRaw, classification: 'resource-reference', reference: buildReference(defaultRaw, ctx, el, refIndexRef, argumentId) }
    } else {
      defaultValue = { raw: defaultRaw, classification: 'literal', reference: null }
    }
  }

  return {
    id: argumentId,
    parentId,
    name,
    argType,
    nullable,
    defaultValue,
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    file: ctx.filePath,
    source: sourceRefOf(ctx, el),
    warnings: name === null ? ['<argument> element has no name.'] : [],
  }
}

function buildDeepLinkRecord(el: XmlElement, parentId: string, ctx: FileParseContext, index: number): AndroidNavigationDeepLink {
  const uriPattern = getAndroidAttr(el, 'uri', ctx.appPrefix) ?? null
  const action = getAndroidAttr(el, 'action', ctx.appPrefix) ?? null
  const mimeType = getAndroidAttr(el, 'mimeType', ctx.appPrefix) ?? null
  const autoVerifyRaw = getAndroidAttr(el, 'autoVerify', ctx.appPrefix)
  const autoVerify = autoVerifyRaw === 'true' ? true : autoVerifyRaw === 'false' ? false : null

  const warnings: string[] = []
  let scheme: string | null = null
  let host: string | null = null
  let port: string | null = null
  let hasPlaceholder = false
  if (uriPattern) {
    hasPlaceholder = /\{[^}]+\}/.test(uriPattern)
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(uriPattern)
    if (schemeMatch) {
      scheme = schemeMatch[1] ?? null
      const rest = uriPattern.slice(schemeMatch[0].length)
      const hostMatch = /^([^/:]+)(?::(\d+))?/.exec(rest)
      if (hostMatch) {
        host = hostMatch[1] ?? null
        port = hostMatch[2] ?? null
      }
    }
  } else {
    warnings.push('<deepLink> element has no app:uri.')
  }

  return {
    id: `${parentId}#deep-link:${index}`,
    parentId,
    uriPattern,
    action,
    mimeType,
    autoVerify,
    scheme,
    host,
    port,
    hasPlaceholder,
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    file: ctx.filePath,
    source: sourceRefOf(ctx, el),
    warnings,
  }
}

function buildEmptyFileRecord(
  navFileId: string,
  resourceFile: AndroidResourceFile,
  logicalKey: string,
  qualifiers: AndroidNavigationQualifiers,
  warning: string
): AndroidNavigationFile {
  return {
    id: navFileId,
    resourceFileId: resourceFile.id,
    logicalKey,
    path: resourceFile.path,
    moduleId: resourceFile.moduleId,
    gradlePath: resourceFile.gradlePath,
    sourceSet: resourceFile.sourceSet,
    qualifiers,
    xmlRootElement: null,
    rootGraphId: null,
    destinationIds: [],
    actionIds: [],
    argumentIds: [],
    deepLinkIds: [],
    includeIds: [],
    parsingStatus: 'malformed',
    source: { file: resourceFile.path, line: 1, column: 1 },
    warnings: [warning],
  }
}

function resolveStartDestination(
  evidence: AndroidNavigationGraph['startDestination'],
  index: Map<string, string[]>
): void {
  if (!evidence.raw) return
  const classified = classifyResourceReference(evidence.raw)
  if (!classified.resourceName) return
  const key = `id/${classified.resourceName}`
  const matches = index.get(key) ?? []
  evidence.candidateDestinationIds = matches.filter((id) => id.includes('#destination:')).sort()
  evidence.candidateGraphIds = matches.filter((id) => !id.includes('#destination:')).sort()
  evidence.unresolved = matches.length === 0
  if (matches.length === 0) evidence.warnings = [...evidence.warnings, `No local destination or graph found for startDestination "${evidence.raw}".`]
}

function buildLogicalKeyIndex(destinations: AndroidNavigationDestination[], graphs: AndroidNavigationGraph[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  const add = (key: string | null, id: string) => {
    if (!key) return
    const list = index.get(key) ?? []
    list.push(id)
    index.set(key, list)
  }
  for (const destination of destinations) add(destination.logicalKey, destination.id)
  for (const graph of graphs) add(graph.logicalKey, graph.id)
  return index
}

function buildNavigationFileIndex(navigationFiles: AndroidNavigationFile[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const file of navigationFiles) {
    if (!file.logicalKey || !file.rootGraphId) continue
    const list = index.get(file.logicalKey) ?? []
    list.push(file.rootGraphId)
    index.set(file.logicalKey, list)
  }
  return index
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function computeFingerprint(model: AndroidNavigationXmlModel): string {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex')
}

function readFile(projectRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(projectRoot, ...relPath.split('/')), 'utf8')
  } catch {
    return null
  }
}
