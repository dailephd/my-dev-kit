import type { CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import { ANDROID_PROJECT_ROOT_NODE_ID } from '../android/buildAndroidArtifactRelationships.js'
import { buildWarning, dedupeRisks, validateEntry } from './classificationHelpers.js'
import type { ClassificationEntry, ClassificationRole, RiskLabel, Readiness, UncertaintyTier } from './classificationTypes.js'

const ANDROID_PROJECT_ARTIFACT_REF = {
  artifact: 'android-project.json',
  artifactKind: 'my-dev-kit-v1-android-project',
  id: ANDROID_PROJECT_ROOT_NODE_ID,
  path: 'android-project.json',
}

export interface BuildAndroidGraphNodeClassificationsOptions {
  /** The final Android relationship nodes and edges (all `android-*` kinds are consulted). */
  graphNodes: readonly CodeGraphNode[]
  edges?: readonly CodeGraphEdge[]
}

export interface BuildAndroidGraphNodeClassificationsResult {
  entries: ClassificationEntry[]
  warningCount: number
}

/**
 * v1.12.0 Batch 1/2: classifies existing artifact-backed Android graph nodes
 * (project root, modules, manifest, navigation, resources, Compose,
 * Android tests, generated build paths). Never invents a target - it only
 * classifies graph nodes that already exist in `graphNodes`, and only from
 * their own typed fields and edges - never by rescanning source/XML/Gradle.
 */
export function buildAndroidGraphNodeClassifications(
  options: BuildAndroidGraphNodeClassificationsOptions
): BuildAndroidGraphNodeClassificationsResult {
  const edges = options.edges ?? []
  const ctx = buildGraphContext(options.graphNodes, edges)
  const entries: ClassificationEntry[] = []

  for (const node of options.graphNodes) {
    const entry = classifyNode(node, ctx)
    if (entry) entries.push(entry)
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const warningCount = entries.reduce((sum, entry) => sum + entry.warnings.length, 0)
  return { entries, warningCount }
}

// ---------------------------------------------------------------------------
// Shared graph context (edge/node lookups built once per call)
// ---------------------------------------------------------------------------

interface GraphContext {
  nodesById: Map<string, CodeGraphNode>
  outEdgesBySource: Map<string, CodeGraphEdge[]>
  inEdgesByTarget: Map<string, CodeGraphEdge[]>
  resourceDefinitionGroups: Map<string, CodeGraphNode[]>
}

function buildGraphContext(nodes: readonly CodeGraphNode[], edges: readonly CodeGraphEdge[]): GraphContext {
  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const outEdgesBySource = new Map<string, CodeGraphEdge[]>()
  const inEdgesByTarget = new Map<string, CodeGraphEdge[]>()
  for (const edge of edges) {
    pushTo(outEdgesBySource, edge.source, edge)
    pushTo(inEdgesByTarget, edge.target, edge)
  }
  const resourceDefinitionGroups = new Map<string, CodeGraphNode[]>()
  for (const node of nodes) {
    if (node.kind !== 'android-resource-definition') continue
    const key = `${node.androidMetadata?.type}/${node.androidMetadata?.name}`
    pushTo(resourceDefinitionGroups, key, node)
  }
  return { nodesById, outEdgesBySource, inEdgesByTarget, resourceDefinitionGroups }
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

function outEdges(ctx: GraphContext, nodeId: string, kind?: string): CodeGraphEdge[] {
  const edges = ctx.outEdgesBySource.get(nodeId) ?? []
  return kind ? edges.filter((e) => e.kind === kind) : edges
}

function inEdges(ctx: GraphContext, nodeId: string, kind?: string): CodeGraphEdge[] {
  const edges = ctx.inEdgesByTarget.get(nodeId) ?? []
  return kind ? edges.filter((e) => e.kind === kind) : edges
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function classifyNode(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry | null {
  switch (node.kind) {
    case 'android-project':
      return buildProjectRootEntry(node)
    case 'android-module':
      return buildModuleEntry(node)
    case 'android-manifest-file':
      return buildManifestFileEntry(node, ctx)
    case 'android-manifest-component':
      return buildManifestComponentEntry(node, ctx)
    case 'android-navigation-graph':
    case 'android-navigation-destination':
    case 'android-navigation-deep-link':
    case 'android-compose-route':
      return buildNavigationRouteEntry(node, ctx)
    case 'android-resource-file':
      return buildResourceFileEntry(node)
    case 'android-resource-definition':
      return buildResourceDefinitionEntry(node, ctx)
    case 'android-composable':
      return buildComposableEntry(node, ctx)
    case 'android-compose-fact':
      return buildComposeFactEntry(node, ctx)
    case 'android-test-file':
      return buildTestFileEntry(node)
    case 'android-test-class':
      return buildTestClassEntry(node, ctx)
    case 'android-test-method':
      return buildTestMethodEntry(node)
    case 'android-generated-build-path':
      return buildGeneratedBuildPathEntry(node)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Shared entry builder
// ---------------------------------------------------------------------------

function makeEntry(params: {
  targetId: string
  filePath: string | null
  roles: ClassificationRole[]
  editGuidance: ClassificationEntry['editGuidance']
  readiness: Readiness
  uncertainty: UncertaintyTier
  risks: RiskLabel[]
  reason: string
  evidence: ClassificationEntry['evidence']
  artifactRefs: ClassificationEntry['artifactRefs']
  warnings?: ClassificationEntry['warnings']
}): ClassificationEntry {
  const entry: ClassificationEntry = {
    id: `classification:graph-node:${params.targetId}`,
    targetId: params.targetId,
    targetKind: 'graph-node',
    filePath: params.filePath,
    symbolName: null,
    nodeId: params.targetId,
    classifications: params.roles,
    editGuidance: params.editGuidance,
    readiness: params.readiness,
    risks: dedupeRisks(params.risks),
    evidence: params.evidence,
    uncertainty: params.uncertainty,
    reason: params.reason,
    sourceRefs: params.filePath ? [{ filePath: params.filePath }] : [],
    artifactRefs: params.artifactRefs,
    warnings: params.warnings ?? [],
  }
  validateEntry(entry)
  return entry
}

function artifactRef(artifact: string, artifactKind: string, id: string): { artifact: string; artifactKind: string; id: string; path: string } {
  return { artifact, artifactKind, id, path: artifact }
}

// ---------------------------------------------------------------------------
// v1.12.0 Batch 1: project root and modules (unchanged)
// ---------------------------------------------------------------------------

function buildProjectRootEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  return makeEntry({
    targetId,
    filePath: null,
    roles: [{ role: 'android-project', subtype: null, confidence: 'certain' }],
    editGuidance: 'read-only-reference',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: [],
    reason: 'Android project root detected from static android-project.json evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-project.json',
        artifactSource: ANDROID_PROJECT_ARTIFACT_REF,
        reason: `detected Android project backed by android-project.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ANDROID_PROJECT_ARTIFACT_REF],
  })
}

function buildModuleEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const moduleType = node.androidMetadata?.moduleType
  const modulePath = node.path ?? targetId
  const ref = artifactRef('android-project.json', 'my-dev-kit-v1-android-project', targetId)

  if (moduleType === 'app' || moduleType === 'library') {
    const subtypeRole = moduleType === 'app' ? 'android-app-module' : 'android-library-module'
    return makeEntry({
      targetId,
      filePath: modulePath,
      roles: [
        { role: 'gradle-module', subtype: null, confidence: 'certain' },
        { role: subtypeRole, subtype: null, confidence: 'certain' },
      ],
      editGuidance: 'inspect-before-edit',
      readiness: 'ready',
      uncertainty: 'certain',
      risks: [],
      reason: `Android ${moduleType} module detected from static Gradle plugin evidence.`,
      evidence: [
        {
          kind: 'artifact-cross-reference',
          source: 'android-project.json',
          artifactSource: ref,
          reason: `module type '${moduleType}' statically determined from android-project.json Gradle plugin evidence`,
        },
      ],
      artifactRefs: [ref],
    })
  }

  return makeEntry({
    targetId,
    filePath: modulePath,
    roles: [{ role: 'gradle-module', subtype: null, confidence: 'possible' }],
    editGuidance: 'inspect-before-edit',
    readiness: 'needs-more-context',
    uncertainty: 'possible',
    risks: [],
    reason: 'Gradle module type is unknown; no app/library plugin evidence was statically found.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-project.json',
        artifactSource: ref,
        reason: "module is a Gradle module but its type could not be statically resolved to 'app' or 'library'",
      },
    ],
    artifactRefs: [ref],
    warnings: [buildWarning('no-static-evidence', "module type could not be statically determined as 'app' or 'library'")],
  })
}

// ---------------------------------------------------------------------------
// v1.12.0 Batch 2: manifest and platform
// ---------------------------------------------------------------------------

function componentHasSecurityEvidence(componentNode: CodeGraphNode, ctx: GraphContext): boolean {
  const meta = componentNode.androidMetadata ?? {}
  if (meta.exported === true || meta.exportedExplicit === true) return true
  if (meta.componentKind === 'provider') return true
  if (outEdges(ctx, componentNode.id, 'component-has-intent-filter').length > 0) return true
  if (outEdges(ctx, componentNode.id, 'component-uses-permission').length > 0) return true
  return false
}

function buildManifestFileEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-manifest.json', 'my-dev-kit-v1-android-manifest', targetId)
  const componentIds = outEdges(ctx, targetId, 'manifest-declares-component').map((e) => e.target)
  const components = componentIds.map((id) => ctx.nodesById.get(id)).filter((n): n is CodeGraphNode => !!n)
  const hasFilePermissionEdge = outEdges(ctx, targetId, 'manifest-uses-permission').length > 0
  const hasSecurityEvidence = hasFilePermissionEdge || components.some((c) => componentHasSecurityEvidence(c, ctx))

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [
      { role: 'android-manifest', subtype: null, confidence: 'certain' },
      { role: 'configuration-file', subtype: null, confidence: 'certain' },
    ],
    editGuidance: 'inspect-before-edit',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: hasSecurityEvidence ? ['manifest-security-risk'] : [],
    reason: 'AndroidManifest.xml file detected from static android-manifest.json evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-manifest.json',
        artifactSource: ref,
        reason: `manifest file backed by android-manifest.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}

function buildManifestComponentEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-manifest.json', 'my-dev-kit-v1-android-manifest', targetId)
  const meta = node.androidMetadata ?? {}
  const hasExactIdentity = !!meta.componentKind && (meta.resolvedName !== null && meta.resolvedName !== undefined)
  const readiness: Readiness = hasExactIdentity ? 'ready' : 'needs-more-context'
  const uncertainty: UncertaintyTier = hasExactIdentity ? 'certain' : 'possible'
  const risks: RiskLabel[] = ['emulator-validation-required', 'instrumented-test-required']
  if (componentHasSecurityEvidence(node, ctx)) risks.push('manifest-security-risk')

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [{ role: 'manifest-component', subtype: (meta.componentKind as string) ?? null, confidence: uncertainty }],
    editGuidance: 'inspect-before-edit',
    readiness,
    uncertainty,
    risks,
    reason: hasExactIdentity
      ? `Manifest component '${meta.componentKind}' detected from exact static android-manifest.json evidence.`
      : 'Manifest component detected but its resolved class identity is incomplete.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-manifest.json',
        artifactSource: ref,
        reason: `manifest component backed by android-manifest.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
    warnings: hasExactIdentity ? [] : [buildWarning('ambiguous-evidence', 'manifest component resolved class identity is incomplete')],
  })
}

// ---------------------------------------------------------------------------
// v1.12.0 Batch 2: navigation routes
// ---------------------------------------------------------------------------

function buildNavigationRouteEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-navigation.json', 'my-dev-kit-v1-android-navigation', targetId)
  let readiness: Readiness = 'ready'
  let uncertainty: UncertaintyTier = 'certain'
  const risks: RiskLabel[] = ['emulator-validation-required', 'instrumented-test-required']
  let reason = 'Navigation route evidence detected from static android-navigation.json evidence.'

  if (node.kind === 'android-navigation-destination') {
    const meta = node.androidMetadata ?? {}
    if (meta.destinationKind !== 'custom') {
      const resolves = outEdges(ctx, targetId, 'navigation-destination-resolves-to-screen')
      if (resolves.length === 0) {
        readiness = 'needs-more-context'
        uncertainty = 'possible'
        reason = 'Navigation destination has no exact static screen resolution.'
      } else if (resolves.length > 1) {
        readiness = 'needs-more-context'
        uncertainty = 'possible'
        risks.push('navigation-contract-risk')
        reason = 'Navigation destination has more than one static screen candidate.'
      }
    }
  } else if (node.kind === 'android-compose-route') {
    const resolves = outEdges(ctx, targetId, 'compose-route-resolves-to-screen')
    if (resolves.length === 0) {
      readiness = 'needs-more-context'
      uncertainty = 'possible'
      reason = 'Compose route has no exact static screen resolution.'
    } else if (resolves.length > 1) {
      readiness = 'needs-more-context'
      uncertainty = 'possible'
      risks.push('navigation-contract-risk')
      reason = 'Compose route has more than one static screen candidate.'
    }
  } else if (node.kind === 'android-navigation-deep-link') {
    const matches = inEdges(ctx, targetId, 'manifest-deep-link-matches-navigation-deep-link')
    if (matches.length > 1) {
      readiness = 'needs-more-context'
      uncertainty = 'possible'
      risks.push('navigation-contract-risk')
      reason = 'Navigation deep link matches more than one manifest deep-link candidate.'
    }
  }

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [{ role: 'navigation-route', subtype: node.kind, confidence: uncertainty }],
    editGuidance: 'inspect-before-edit',
    readiness,
    uncertainty,
    risks,
    reason,
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-navigation.json',
        artifactSource: ref,
        reason: `navigation route backed by android-navigation.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
    warnings: uncertainty === 'possible' ? [buildWarning('ambiguous-evidence', reason)] : [],
  })
}

// ---------------------------------------------------------------------------
// v1.12.0 Batch 2: resources
// ---------------------------------------------------------------------------

const PLATFORM_SENSITIVE_RESOURCE_BASE_TYPES = new Set(['xml'])

function buildResourceFileEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-resources.json', 'my-dev-kit-v1-android-resources', targetId)
  const baseType = node.androidMetadata?.baseType as string | undefined
  const isPlatformSensitive = !!baseType && PLATFORM_SENSITIVE_RESOURCE_BASE_TYPES.has(baseType)
  const isLayout = baseType === 'layout'
  const risks: RiskLabel[] = ['emulator-validation-required']
  if (isPlatformSensitive) risks.push('resource-contract-risk')
  if (isLayout) risks.push('instrumented-test-required')

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [{ role: 'resource-file', subtype: baseType ?? null, confidence: 'certain' }],
    editGuidance: isPlatformSensitive ? 'inspect-before-edit' : 'safe-primary-edit-target',
    readiness: 'ready',
    uncertainty: 'certain',
    risks,
    reason: 'Android resource file detected from static android-resources.json evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-resources.json',
        artifactSource: ref,
        reason: `resource file backed by android-resources.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}

function buildResourceDefinitionEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-resources.json', 'my-dev-kit-v1-android-resources', targetId)
  const meta = node.androidMetadata ?? {}
  const type = meta.type as string | undefined
  const isLayout = type === 'layout'
  const key = `${type}/${meta.name}`
  const group = ctx.resourceDefinitionGroups.get(key) ?? [node]
  const isAmbiguous = group.length > 1

  const roles: ClassificationRole[] = [{ role: 'resource-file', subtype: type ?? null, confidence: isAmbiguous ? 'possible' : 'certain' }]
  if (isLayout) roles.push({ role: 'xml-layout', subtype: null, confidence: isAmbiguous ? 'possible' : 'certain' })

  const risks: RiskLabel[] = []
  if (isAmbiguous) risks.push('resource-contract-risk')
  if (isLayout) risks.push('resource-contract-risk', 'emulator-validation-required', 'instrumented-test-required')

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles,
    editGuidance: 'safe-primary-edit-target',
    readiness: isAmbiguous ? 'needs-more-context' : 'ready',
    uncertainty: isAmbiguous ? 'possible' : 'certain',
    risks,
    reason: isAmbiguous
      ? `Resource definition '${key}' has more than one static candidate across source sets/qualifiers.`
      : 'Android resource definition detected from static android-resources.json evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-resources.json',
        artifactSource: ref,
        reason: `resource definition backed by android-resources.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
    warnings: isAmbiguous ? [buildWarning('ambiguous-evidence', `multiple resource definitions share the key '${key}'`)] : [],
  })
}

// ---------------------------------------------------------------------------
// v1.12.0 Batch 2: Compose
// ---------------------------------------------------------------------------

function buildComposableEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-compose-semantic.json', 'my-dev-kit-v1-android-compose-semantic', targetId)
  const meta = node.androidMetadata ?? {}
  const isPreview = meta.isPreview === true
  const screenEdges = [
    ...inEdges(ctx, targetId, 'compose-route-resolves-to-screen'),
    ...inEdges(ctx, targetId, 'navigation-destination-resolves-to-screen'),
  ]

  if (!isPreview && screenEdges.length > 0) {
    const isAmbiguous = screenEdges.length > 1
    return makeEntry({
      targetId,
      filePath: node.path ?? null,
      roles: [{ role: 'compose-screen', subtype: null, confidence: isAmbiguous ? 'possible' : 'certain' }],
      editGuidance: 'safe-primary-edit-target',
      readiness: isAmbiguous ? 'needs-more-context' : 'ready',
      uncertainty: isAmbiguous ? 'possible' : 'certain',
      risks: isAmbiguous
        ? ['navigation-contract-risk', 'emulator-validation-required', 'instrumented-test-required']
        : ['emulator-validation-required', 'instrumented-test-required'],
      reason: isAmbiguous
        ? 'Composable has more than one static route/destination target.'
        : 'Composable is the exact static target of a route/destination.',
      evidence: [
        {
          kind: 'artifact-cross-reference',
          source: 'android-compose-semantic.json',
          artifactSource: ref,
          reason: `composable backed by android-compose-semantic.json, projected onto graph node '${targetId}'`,
        },
      ],
      artifactRefs: [ref],
      warnings: isAmbiguous ? [buildWarning('ambiguous-evidence', 'composable has more than one route/destination target')] : [],
    })
  }

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [{ role: 'compose-ui-component', subtype: null, confidence: 'certain' }],
    editGuidance: isPreview ? 'read-only-reference' : 'safe-primary-edit-target',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: ['emulator-validation-required'],
    reason: isPreview
      ? 'Composable is a @Preview declaration, not a production screen or component target.'
      : 'Composable declaration detected from static android-compose-semantic.json evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-compose-semantic.json',
        artifactSource: ref,
        reason: `composable backed by android-compose-semantic.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}

function buildComposeFactEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry | null {
  const factKind = node.androidMetadata?.factKind
  if (factKind === 'state') return buildComposeStateFactEntry(node)
  if (factKind === 'click-handler') return buildComposeClickHandlerFactEntry(node, ctx)
  return null
}

/**
 * v1.12.0 Batch 4: `remember`/`rememberSaveable` keep the original Batch 2
 * default (no ownership is ever attempted for local state). `collectAsState`/
 * `collectAsStateWithLifecycle` are refined by `candidateMatchStatus`
 * (computed by `android-compose-semantic.json`'s state-ownership matching):
 * an `exact-one` ViewModel owner marks the fact as a UI-side projection
 * (`avoid-primary-edit-target`) of that ViewModel's state, never the
 * composable's own locally-owned state; ambiguous/unresolved ownership stays
 * conservative with `wrong-layer-risk`. The linked ViewModel's own
 * classification is never touched here.
 */
function buildComposeStateFactEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-compose-semantic.json', 'my-dev-kit-v1-android-compose-semantic', targetId)
  const meta = node.androidMetadata ?? {}
  const isCollectedState = meta.callName === 'collectAsState' || meta.callName === 'collectAsStateWithLifecycle'
  const matchStatus = meta.candidateMatchStatus as string | undefined

  if (isCollectedState && matchStatus === 'exact-one') {
    return makeEntry({
      targetId,
      filePath: node.path ?? null,
      roles: [{ role: 'ui-only-state', subtype: null, confidence: 'certain' }],
      editGuidance: 'avoid-primary-edit-target',
      readiness: 'ready',
      uncertainty: 'certain',
      risks: ['wrong-layer-risk'],
      reason:
        'This is a UI-side collected-state usage/projection; its statically supported owner is the linked ViewModel - editing here does not relocate or own that state.',
      evidence: [
        {
          kind: 'artifact-cross-reference',
          source: 'android-compose-semantic.json',
          artifactSource: ref,
          reason: `Compose collected-state fact with an exact same-composable ViewModel owner, backed by android-compose-semantic.json, projected onto graph node '${targetId}'`,
        },
      ],
      artifactRefs: [ref],
    })
  }

  if (isCollectedState && matchStatus === 'ambiguous') {
    return makeEntry({
      targetId,
      filePath: node.path ?? null,
      roles: [{ role: 'ui-only-state', subtype: null, confidence: 'possible' }],
      editGuidance: 'inspect-before-edit',
      readiness: 'needs-more-context',
      uncertainty: 'possible',
      risks: ['wrong-layer-risk'],
      reason: 'Compose collected-state fact has more than one statically possible ViewModel owner; ownership is ambiguous.',
      evidence: [
        {
          kind: 'artifact-cross-reference',
          source: 'android-compose-semantic.json',
          artifactSource: ref,
          reason: `ambiguous ViewModel ownership, backed by android-compose-semantic.json, projected onto graph node '${targetId}'`,
        },
      ],
      artifactRefs: [ref],
      warnings: [buildWarning('ambiguous-evidence', 'more than one statically possible ViewModel owner for this collected-state fact')],
    })
  }

  if (isCollectedState && (matchStatus === 'no-match' || matchStatus === 'not-attempted')) {
    return makeEntry({
      targetId,
      filePath: node.path ?? null,
      roles: [{ role: 'ui-only-state', subtype: null, confidence: 'possible' }],
      editGuidance: 'inspect-before-edit',
      readiness: 'needs-more-context',
      uncertainty: 'possible',
      risks: ['wrong-layer-risk'],
      reason: 'Compose collected-state fact has no statically resolved ViewModel owner; ownership was not guessed.',
      evidence: [
        {
          kind: 'artifact-cross-reference',
          source: 'android-compose-semantic.json',
          artifactSource: ref,
          reason: `unresolved ViewModel ownership, backed by android-compose-semantic.json, projected onto graph node '${targetId}'`,
        },
      ],
      artifactRefs: [ref],
      warnings: [buildWarning('no-static-evidence', 'no statically resolved ViewModel owner for this collected-state fact')],
    })
  }

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [{ role: 'ui-only-state', subtype: null, confidence: 'certain' }],
    editGuidance: 'safe-primary-edit-target',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: [],
    reason: 'Compose local-state declaration detected from static android-compose-semantic.json evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-compose-semantic.json',
        artifactSource: ref,
        reason: `Compose state fact backed by android-compose-semantic.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}

function buildComposeClickHandlerFactEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-compose-semantic.json', 'my-dev-kit-v1-android-compose-semantic', targetId)
  const status = node.androidMetadata?.status
  const isResolved = status === 'resolved'
  const hasNavigation = outEdges(ctx, targetId, 'click-handler-contains-navigation-call').length > 0
  const risks: RiskLabel[] = ['wrong-layer-risk', 'emulator-validation-required', 'instrumented-test-required']
  if (hasNavigation) risks.push('navigation-contract-risk')

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [{ role: 'ui-event', subtype: null, confidence: isResolved ? 'certain' : 'possible' }],
    editGuidance: 'inspect-before-edit',
    readiness: isResolved ? 'ready' : 'needs-more-context',
    uncertainty: isResolved ? 'certain' : 'possible',
    risks,
    reason: isResolved
      ? 'Compose click-handler fact detected from static android-compose-semantic.json evidence.'
      : 'Compose click-handler fact has unresolved/dynamic callback evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-compose-semantic.json',
        artifactSource: ref,
        reason: `Compose click-handler fact backed by android-compose-semantic.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
    warnings: isResolved ? [] : [buildWarning('ambiguous-evidence', 'click-handler callback is unresolved/dynamic')],
  })
}

// ---------------------------------------------------------------------------
// v1.12.0 Batch 2: Android tests
// ---------------------------------------------------------------------------

function testCategoryRoles(category: string | undefined, frameworks: string | undefined): ClassificationRole[] {
  const roles: ClassificationRole[] = []
  if (category === 'unit') roles.push({ role: 'android-unit-test', subtype: null, confidence: 'certain' })
  else if (category === 'instrumented') roles.push({ role: 'instrumented-test', subtype: null, confidence: 'certain' })
  roles.push({ role: 'test-block', subtype: null, confidence: 'certain' })
  roles.push({ role: 'test-fixture', subtype: null, confidence: 'certain' })
  if (frameworks?.split(',').includes('compose-ui')) {
    roles.push({ role: 'compose-ui-test', subtype: null, confidence: 'certain' })
  }
  return roles
}

function buildTestFileEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-test-semantic.json', 'my-dev-kit-v1-android-test-semantic', targetId)
  const category = node.androidMetadata?.category as string | undefined
  const frameworks = node.androidMetadata?.frameworks as string | undefined
  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: testCategoryRoles(category, frameworks),
    editGuidance: 'test-only',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: [],
    reason: `Android ${category ?? 'test'} file detected from static android-test-semantic.json evidence.`,
    evidence: [
      {
        kind: 'test-directory-convention',
        source: 'android-test-semantic.json',
        artifactSource: ref,
        reason: `test file backed by android-test-semantic.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}

function buildTestClassEntry(node: CodeGraphNode, ctx: GraphContext): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-test-semantic.json', 'my-dev-kit-v1-android-test-semantic', targetId)
  const fileEdge = inEdges(ctx, targetId, 'defines-test-class')[0]
  const fileNode = fileEdge ? ctx.nodesById.get(fileEdge.source) : undefined
  const category = fileNode?.androidMetadata?.category as string | undefined
  const frameworks = (node.androidMetadata?.frameworks as string | undefined) ?? (fileNode?.androidMetadata?.frameworks as string | undefined)

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: testCategoryRoles(category, frameworks),
    editGuidance: 'test-only',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: [],
    reason: `Android ${category ?? 'test'} class detected from static android-test-semantic.json evidence.`,
    evidence: [
      {
        kind: 'test-directory-convention',
        source: 'android-test-semantic.json',
        artifactSource: ref,
        reason: `test class backed by android-test-semantic.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}

function buildTestMethodEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-test-semantic.json', 'my-dev-kit-v1-android-test-semantic', targetId)
  const category = node.androidMetadata?.category as string | undefined
  const frameworks = node.androidMetadata?.frameworks as string | undefined

  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: testCategoryRoles(category, frameworks),
    editGuidance: 'test-only',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: [],
    reason: `Android ${category ?? 'test'} method detected from static android-test-semantic.json evidence.`,
    evidence: [
      {
        kind: 'test-directory-convention',
        source: 'android-test-semantic.json',
        artifactSource: ref,
        reason: `test method backed by android-test-semantic.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}

// ---------------------------------------------------------------------------
// v1.12.0 Batch 2: generated build paths
// ---------------------------------------------------------------------------

function buildGeneratedBuildPathEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const ref = artifactRef('android-project.json', 'my-dev-kit-v1-android-project', targetId)
  return makeEntry({
    targetId,
    filePath: node.path ?? null,
    roles: [{ role: 'generated-file', subtype: null, confidence: 'certain' }],
    editGuidance: 'generated-do-not-edit',
    readiness: 'ready',
    uncertainty: 'certain',
    risks: ['generated-build-file-risk'],
    reason: 'Generated/build directory detected from static android-project.json evidence.',
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-project.json',
        artifactSource: ref,
        reason: `generated build path backed by android-project.json, projected onto graph node '${targetId}'`,
      },
    ],
    artifactRefs: [ref],
  })
}
