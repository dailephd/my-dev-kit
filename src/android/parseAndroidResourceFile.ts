/**
 * Parses a single file-based Android resource (layout, drawable, mipmap,
 * generic xml, menu, anim, animator, color-state-list, font, raw,
 * navigation) plus the two specialized XML configurations
 * (`<paths>` FileProvider path config, `<network-security-config>`).
 * Built on the shared bounded XML parser and reference walker — never a
 * second parser, never resource compilation, never navigation semantics
 * (a `res/navigation/*.xml` file is recorded only as a generic file
 * resource with bounded reference evidence, per the Batch 3 contract).
 */

import { parseXml, type XmlElement } from './xml/parseXml.js'
import { collectResourceEvidence } from './xml/collectResourceReferences.js'
import type {
  AndroidNetworkSecurityRecord,
  AndroidResourceBaseType,
  AndroidResourceFileDefinition,
  AndroidResourceFileProviderPathEntry,
  AndroidResourceIdDefinition,
  AndroidResourceKey,
  AndroidResourceLayout,
  AndroidResourceLayoutViewSummary,
  AndroidResourceQualifiers,
  AndroidResourceReference,
  AndroidResourceSourceRef,
  AndroidResourceType,
  NetworkSecurityRecordKind,
} from './androidResourceTypes.js'

export interface ParseResourceXmlContext {
  fileId: string
  filePath: string
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  baseType: AndroidResourceBaseType
  resourceName: string
}

export interface ParseResourceXmlResult {
  parsingStatus: 'parsed' | 'malformed'
  xmlRootElement: string | null
  references: AndroidResourceReference[]
  idDefinitions: AndroidResourceIdDefinition[]
  layout: AndroidResourceLayout | null
  fileDefinition: AndroidResourceFileDefinition | null
  fileProviderPaths: AndroidResourceFileProviderPathEntry[]
  networkSecurityRecords: AndroidNetworkSecurityRecord[]
  warnings: string[]
}

const BASE_TYPE_TO_RESOURCE_TYPE: Partial<Record<AndroidResourceBaseType, AndroidResourceType>> = {
  drawable: 'drawable',
  mipmap: 'mipmap',
  xml: 'xml',
  raw: 'raw',
  menu: 'menu',
  anim: 'anim',
  animator: 'animator',
  color: 'color',
  font: 'font',
  navigation: 'navigation',
}

export function parseAndroidResourceXmlFile(xmlText: string, ctx: ParseResourceXmlContext): ParseResourceXmlResult {
  const { root, error } = parseXml(xmlText)

  if (!root || error) {
    return {
      parsingStatus: 'malformed',
      xmlRootElement: null,
      references: [],
      idDefinitions: [],
      layout: null,
      fileDefinition: null,
      fileProviderPaths: [],
      networkSecurityRecords: [],
      warnings: [error ?? 'Malformed XML: no root element found.'],
    }
  }

  if (root.name === 'paths') {
    const fileProviderPaths = parseFileProviderPaths(root, ctx)
    return {
      parsingStatus: 'parsed',
      xmlRootElement: root.name,
      references: [],
      idDefinitions: [],
      layout: null,
      fileDefinition: null,
      fileProviderPaths,
      networkSecurityRecords: [],
      warnings: [],
    }
  }

  if (root.name === 'network-security-config') {
    const networkSecurityRecords = parseNetworkSecurityConfig(root, ctx)
    return {
      parsingStatus: 'parsed',
      xmlRootElement: root.name,
      references: [],
      idDefinitions: [],
      layout: null,
      fileDefinition: null,
      fileProviderPaths: [],
      networkSecurityRecords,
      warnings: [],
    }
  }

  if (ctx.baseType === 'layout') {
    const { references, idDefinitions } = collectResourceEvidence(root, {
      fileId: ctx.fileId,
      filePath: ctx.filePath,
      moduleId: ctx.moduleId,
      sourceSet: ctx.sourceSet,
      qualifiers: ctx.qualifiers,
      ownerRecordId: `${ctx.fileId}#layout`,
    })
    const layout = buildLayoutRecord(root, ctx, idDefinitions)
    return {
      parsingStatus: 'parsed',
      xmlRootElement: root.name,
      references,
      idDefinitions,
      layout,
      fileDefinition: null,
      fileProviderPaths: [],
      networkSecurityRecords: [],
      warnings: [],
    }
  }

  // Generic XML resource (drawable/mipmap/xml/menu/anim/animator/color/font/navigation).
  const { references, idDefinitions } = collectResourceEvidence(root, {
    fileId: ctx.fileId,
    filePath: ctx.filePath,
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    ownerRecordId: ctx.fileId,
  })
  const type = BASE_TYPE_TO_RESOURCE_TYPE[ctx.baseType] ?? 'unknown'
  const key: AndroidResourceKey = { packageScope: null, type, name: ctx.resourceName }
  const fileDefinition: AndroidResourceFileDefinition = {
    id: `${ctx.fileId}#file-definition`,
    key,
    type,
    name: ctx.resourceName,
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    fileId: ctx.fileId,
    file: ctx.filePath,
    extension: '',
    xmlRootElement: root.name,
    referenceIds: references.map((r) => r.id),
    declaredIdIds: idDefinitions.map((d) => d.id),
    source: { file: ctx.filePath, line: root.line, column: root.column },
    warnings: [],
  }

  return {
    parsingStatus: 'parsed',
    xmlRootElement: root.name,
    references,
    idDefinitions,
    layout: null,
    fileDefinition,
    fileProviderPaths: [],
    networkSecurityRecords: [],
    warnings: [],
  }
}

function buildLayoutRecord(
  root: XmlElement,
  ctx: ParseResourceXmlContext,
  idDefinitions: AndroidResourceIdDefinition[]
): AndroidResourceLayout {
  const includedLayoutRefs: string[] = []
  const fragmentClassNames: string[] = []
  const views: AndroidResourceLayoutViewSummary[] = []
  const warnings: string[] = []

  const idRefForElement = (el: XmlElement): string | null => {
    for (const [attrName, value] of Object.entries(el.attributes)) {
      if (attrName.endsWith(':id') || attrName === 'id') return value
    }
    return null
  }

  const visit = (el: XmlElement): void => {
    if (el.name === 'include') {
      const layoutRef = el.attributes['layout']
      if (layoutRef) includedLayoutRefs.push(layoutRef)
      else warnings.push('<include> element has no layout attribute.')
    }
    if (el.name === 'fragment') {
      const cls = el.attributes['android:name'] ?? el.attributes['class'] ?? el.attributes['name']
      if (cls) fragmentClassNames.push(cls)
    }
    const classAttr = el.attributes['class']
    if (classAttr && el.name !== 'fragment') fragmentClassNames.push(classAttr)

    views.push({ elementName: el.name, idRef: idRefForElement(el), source: { file: ctx.filePath, line: el.line, column: el.column } })

    for (const child of el.children) visit(child)
  }
  for (const child of root.children) visit(child)
  if (root.name !== 'merge' && root.name !== 'include') {
    views.unshift({ elementName: root.name, idRef: idRefForElement(root), source: { file: ctx.filePath, line: root.line, column: root.column } })
  }

  const key: AndroidResourceKey = { packageScope: null, type: 'layout', name: ctx.resourceName }

  return {
    id: `${ctx.fileId}#layout`,
    key,
    rootElement: root.name,
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    fileId: ctx.fileId,
    file: ctx.filePath,
    source: { file: ctx.filePath, line: root.line, column: root.column },
    declaredIdIds: idDefinitions.map((d) => d.id),
    includedLayoutRefs: [...new Set(includedLayoutRefs)].sort(),
    fragmentClassNames: [...new Set(fragmentClassNames)].sort(),
    referenceIds: [],
    views,
    warnings,
  }
}

const FILE_PROVIDER_PATH_ELEMENTS = new Set([
  'files-path',
  'cache-path',
  'external-path',
  'external-files-path',
  'external-cache-path',
  'external-media-path',
  'root-path',
])

function parseFileProviderPaths(root: XmlElement, ctx: ParseResourceXmlContext): AndroidResourceFileProviderPathEntry[] {
  const entries: AndroidResourceFileProviderPathEntry[] = []
  let index = 0
  for (const el of root.children) {
    if (!FILE_PROVIDER_PATH_ELEMENTS.has(el.name)) continue
    entries.push({
      id: `${ctx.fileId}#file-provider-path:${index}`,
      elementType: el.name as AndroidResourceFileProviderPathEntry['elementType'],
      name: el.attributes['name'] ?? null,
      path: el.attributes['path'] ?? null,
      moduleId: ctx.moduleId,
      sourceSet: ctx.sourceSet,
      qualifiers: ctx.qualifiers,
      fileId: ctx.fileId,
      file: ctx.filePath,
      source: { file: ctx.filePath, line: el.line, column: el.column },
      warnings: el.attributes['name'] && el.attributes['path'] ? [] : [`<${el.name}> element is missing name or path.`],
    })
    index++
  }
  return entries
}

const NETWORK_SECURITY_TAGS: Record<string, NetworkSecurityRecordKind> = {
  'network-security-config': 'network-security-config',
  'base-config': 'base-config',
  'domain-config': 'domain-config',
  'debug-overrides': 'debug-overrides',
  domain: 'domain',
  'trust-anchors': 'trust-anchors',
  certificates: 'certificates',
  'pin-set': 'pin-set',
  pin: 'pin',
}

function parseNetworkSecurityConfig(root: XmlElement, ctx: ParseResourceXmlContext): AndroidNetworkSecurityRecord[] {
  const records: AndroidNetworkSecurityRecord[] = []
  let index = 0

  const visit = (el: XmlElement, parentId: string | null): void => {
    const kind = NETWORK_SECURITY_TAGS[el.name]
    let currentId = parentId
    if (kind) {
      const id = `${ctx.fileId}#network-security:${index}`
      index++
      records.push({
        id,
        kind,
        parentId,
        attributes: { ...el.attributes },
        domainText: el.name === 'domain' ? el.text.trim() || null : null,
        moduleId: ctx.moduleId,
        sourceSet: ctx.sourceSet,
        qualifiers: ctx.qualifiers,
        fileId: ctx.fileId,
        file: ctx.filePath,
        source: { file: ctx.filePath, line: el.line, column: el.column },
        warnings: [],
      })
      currentId = id
    }
    for (const child of el.children) visit(child, currentId)
  }

  visit(root, null)
  return records
}
