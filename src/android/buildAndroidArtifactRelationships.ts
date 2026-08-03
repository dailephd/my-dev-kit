/**
 * Connects the six Android artifacts (v1.9.0 `android-project`/`android-components`
 * plus Batches 1-4's `android-gradle`/`android-manifest`/`android-resources`/
 * `android-navigation`) into the existing `code-graph.json` architecture
 * (v1.10.0 Batch 5).
 *
 * Pure builder: consumes already-built artifact models and `symbolIndex`
 * (never reparses Gradle/manifest/resource/navigation XML or Kotlin/Java
 * structure), and returns compact nodes + relationship edges to be merged
 * additively into the existing code graph. Every candidate relationship
 * (action targets, popUpTo, includes, resource references, deep-link
 * matches) enumerates every exact static match — it never selects a single
 * runtime winner, applies source-set/qualifier overlay precedence, or
 * claims runtime reachability.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import type { AndroidGradleArtifact } from './androidGradleTypes.js'
import type { AndroidManifestArtifact, AndroidManifestComponentEvidence } from './androidManifestTypes.js'
import type { AndroidResourcesArtifact } from './androidResourceTypes.js'
import type { AndroidNavigationArtifact } from './androidNavigationTypes.js'
import type { AndroidComposeSemanticArtifact } from './androidComposeTypes.js'
import { resolveViewModelClassCandidates } from './resolveViewModelClassCandidates.js'
import type { AndroidTestSemanticArtifact } from './androidTestTypes.js'
import type { AndroidComponentsArtifact } from './androidComponentTypes.js'

export interface BuildAndroidArtifactRelationshipsOptions {
  projectRoot: string
  androidProject: AndroidProjectArtifact
  androidGradle: AndroidGradleArtifact
  androidManifest: AndroidManifestArtifact
  androidResources: AndroidResourcesArtifact
  androidNavigation: AndroidNavigationArtifact
  /** `android-compose-semantic.json`'s already-built artifact (v1.11.0 Batch 4), used only to project compact composable/fact nodes and edges. Optional so pre-Batch-4 direct callers (and existing tests) keep working unchanged. */
  androidComposeSemantic?: AndroidComposeSemanticArtifact
  /** `android-test-semantic.json`'s already-built artifact (v1.11.0 Batch 5), used only to project compact test file/class/method/fact nodes and edges. Optional so pre-Batch-5 direct callers keep working unchanged. */
  androidTestSemantic?: AndroidTestSemanticArtifact
  /** `android-components.json`'s already-built artifact (v1.9.0 Batch 4, dependency facts added v1.12.0 Batch 3), used only to project the five fixed component-dependency edges onto existing symbol nodes. Optional so pre-existing direct callers keep working unchanged. */
  androidComponents?: AndroidComponentsArtifact
  symbolIndex: SymbolIndex
}

export interface BuildAndroidArtifactRelationshipsResult {
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  warnings: string[]
}

/** v1.12.0 Batch 1: stable ID of the single bounded Android project root node. */
export const ANDROID_PROJECT_ROOT_NODE_ID = 'android-project:root'

export function buildAndroidArtifactRelationships(options: BuildAndroidArtifactRelationshipsOptions): BuildAndroidArtifactRelationshipsResult {
  const { projectRoot, androidProject, androidManifest, androidResources, androidNavigation, androidComposeSemantic, androidTestSemantic, androidComponents, symbolIndex } = options
  const nodes: CodeGraphNode[] = []
  const edges: CodeGraphEdge[] = []
  const warnings: string[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  const addNode = (node: CodeGraphNode): void => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (edge: CodeGraphEdge): void => {
    if (edgeIds.has(edge.id)) return
    edgeIds.add(edge.id)
    edges.push(edge)
  }

  // `androidProject.detected` alone is too weak a guard: it's `true` for any
  // Gradle project (even a plain Java library with zero Android plugin
  // evidence), matching v1.9.0's "detected: true at low confidence" design.
  // Relationship enrichment requires actual Android evidence — a confirmed
  // app/library module, or at least one of the other three artifacts having
  // found something — otherwise a non-Android Gradle project would still get
  // a spurious `android-module`/`android-source-set` node pair.
  const hasConfirmedAndroidModule = androidProject.modules.some((m) => m.type === 'app' || m.type === 'library')
  const hasRealAndroidEvidence =
    hasConfirmedAndroidModule ||
    androidManifest.detected ||
    androidResources.detected ||
    androidNavigation.detected ||
    (androidComposeSemantic?.detected ?? false) ||
    (androidTestSemantic?.detected ?? false)
  if (!androidProject.detected || !hasRealAndroidEvidence) {
    return { nodes: [], edges: [], warnings: [] }
  }

  // -- 1. Project root, modules, and source sets -------------------------------
  const sourceSetNodeId = (moduleId: string, sourceSet: string): string => `android-source-set:${moduleId}#${sourceSet}`

  // v1.12.0 Batch 1: exactly one bounded project root, backed by
  // android-project.json, deterministic and free of any absolute path.
  addNode({
    id: ANDROID_PROJECT_ROOT_NODE_ID,
    kind: 'android-project',
    label: 'Android project',
    androidArtifactId: 'android-project',
    androidEntityId: ANDROID_PROJECT_ROOT_NODE_ID,
  })

  for (const module of androidProject.modules) {
    addNode({
      id: module.id,
      kind: 'android-module',
      label: module.name,
      path: module.path,
      androidArtifactId: 'android-project',
      androidEntityId: module.id,
      androidModuleId: module.id,
      androidMetadata: { moduleType: module.type },
    })
    addEdge({
      id: edgeId(ANDROID_PROJECT_ROOT_NODE_ID, 'android-project-contains-module', module.id),
      source: ANDROID_PROJECT_ROOT_NODE_ID,
      target: module.id,
      kind: 'android-project-contains-module',
      metadata: { evidenceArtifact: 'android-project', moduleId: module.id },
    })

    const sourceSetNames = new Set<string>(module.sourceSets.map((s) => s.name))
    for (const m of androidManifest.manifests) if (m.moduleId === module.id) sourceSetNames.add(m.sourceSet)
    for (const d of androidResources.resourceDirectories) if (d.moduleId === module.id) sourceSetNames.add(d.sourceSet)
    for (const f of androidNavigation.navigationFiles) if (f.moduleId === module.id) sourceSetNames.add(f.sourceSet)

    for (const sourceSetName of [...sourceSetNames].sort()) {
      const ssId = sourceSetNodeId(module.id, sourceSetName)
      addNode({
        id: ssId,
        kind: 'android-source-set',
        label: sourceSetName,
        androidArtifactId: 'android-project',
        androidEntityId: ssId,
        androidModuleId: module.id,
        androidSourceSetId: ssId,
      })
      addEdge({
        id: edgeId(module.id, 'module-contains-source-set', ssId),
        source: module.id,
        target: ssId,
        kind: 'module-contains-source-set',
        metadata: { evidenceArtifact: 'android-project', moduleId: module.id, sourceSet: sourceSetName },
      })
    }
  }

  // v1.12.0 Batch 2: bounded generated/build path evidence, reusing
  // `android-project.json`'s already-detected `ignoredGeneratedDirectories`
  // (a fixed, small `build`/`.gradle` existence check under the project root
  // and each declared module - never a repository-wide scan). One node per
  // detected path; no file enumeration beneath it, no content read.
  for (const generatedPath of androidProject.ignoredGeneratedDirectories) {
    const generatedNodeId = `android-generated-build-path:${generatedPath}`
    addNode({
      id: generatedNodeId,
      kind: 'android-generated-build-path',
      label: generatedPath,
      path: generatedPath,
      androidArtifactId: 'android-project',
      androidEntityId: generatedNodeId,
    })
  }

  // -- 2. Manifest files and components ---------------------------------------
  const manifestFilePathById = new Map(androidManifest.manifests.map((m) => [m.id, m.path]))
  for (const manifestFile of androidManifest.manifests) {
    addNode({
      id: manifestFile.id,
      kind: 'android-manifest-file',
      label: basename(manifestFile.path),
      path: manifestFile.path,
      line: manifestFile.source.line,
      androidArtifactId: 'android-manifest',
      androidEntityId: manifestFile.id,
      androidModuleId: manifestFile.moduleId,
      androidSourceSetId: sourceSetNodeId(manifestFile.moduleId, manifestFile.sourceSet),
    })
  }

  const componentById = new Map(androidManifest.components.map((c) => [c.id, c]))
  for (const component of androidManifest.components) {
    addNode({
      id: component.id,
      kind: 'android-manifest-component',
      label: component.rawName ?? component.kind,
      path: manifestFilePathById.get(component.manifestFileId),
      line: component.source.line,
      androidArtifactId: 'android-manifest',
      androidEntityId: component.id,
      androidModuleId: component.moduleId,
      androidSourceSetId: sourceSetNodeId(component.moduleId, component.sourceSet),
      androidMetadata: {
        componentKind: component.kind,
        exported: component.exported,
        exportedExplicit: component.exportedExplicit,
        rawName: component.rawName,
        resolvedName: component.resolvedName?.resolved ?? null,
      },
    })
    addEdge({
      id: edgeId(component.manifestFileId, 'manifest-declares-component', component.id),
      source: component.manifestFileId,
      target: component.id,
      kind: 'manifest-declares-component',
      metadata: { evidenceArtifact: 'android-manifest', evidenceEntityId: component.id, componentKind: component.kind },
    })
  }

  // -- 3. Manifest component -> exact source class -----------------------------
  const classIndex = buildClassIndex(symbolIndex)
  for (const component of androidManifest.components) {
    const targetName =
      component.kind === 'activity-alias' ? component.targetActivity?.resolved ?? null : component.resolvedName?.resolved ?? null
    if (!targetName) continue
    const candidates = resolveExactClassCandidates(targetName, classIndex)
    for (const candidateId of candidates) {
      addEdge({
        id: `${edgeId(component.id, 'manifest-component-resolves-to-source', candidateId)}`,
        source: component.id,
        target: candidateId,
        kind: 'manifest-component-resolves-to-source',
        metadata: {
          evidenceArtifact: 'android-manifest',
          matchBasis: 'exact-fully-qualified-class-name',
          resolvedClassName: targetName,
          viaTargetActivity: component.kind === 'activity-alias',
          candidate: candidates.length > 1,
        },
      })
    }
  }

  // -- 4. Intent filters --------------------------------------------------------
  for (const filter of androidManifest.intentFilters) {
    addNode({
      id: filter.id,
      kind: 'android-intent-filter',
      label: 'intent-filter',
      line: filter.source.line,
      androidArtifactId: 'android-manifest',
      androidEntityId: filter.id,
      androidMetadata: {
        actionCount: filter.actions.length,
        categoryCount: filter.categories.length,
        dataCount: filter.data.length,
        autoVerify: filter.autoVerify,
      },
    })
    addEdge({
      id: edgeId(filter.parentComponentId, 'component-has-intent-filter', filter.id),
      source: filter.parentComponentId,
      target: filter.id,
      kind: 'component-has-intent-filter',
      metadata: { evidenceArtifact: 'android-manifest', evidenceEntityId: filter.id },
    })
  }

  // -- 5. Permissions -------------------------------------------------------------
  const permissionNodeIdsByName = new Map<string, string[]>()
  for (const declared of androidManifest.declaredPermissions) {
    if (!declared.name) continue
    addNode({
      id: declared.id,
      kind: 'android-permission',
      label: declared.name,
      line: declared.source.line,
      androidArtifactId: 'android-manifest',
      androidEntityId: declared.id,
      androidModuleId: declared.moduleId,
      androidMetadata: { name: declared.name, protectionLevel: declared.protectionLevel, local: true },
    })
    const list = permissionNodeIdsByName.get(declared.name) ?? []
    list.push(declared.id)
    permissionNodeIdsByName.set(declared.name, list)
  }

  const externalPermissionRefId = (name: string): string => `android-permission-ref:${name}`
  const permissionTargets = (name: string): string[] => {
    const local = permissionNodeIdsByName.get(name)
    if (local && local.length > 0) return local
    const refId = externalPermissionRefId(name)
    addNode({
      id: refId,
      kind: 'android-permission',
      label: name,
      androidArtifactId: 'android-manifest',
      androidEntityId: refId,
      androidMetadata: { name, local: false },
    })
    return [refId]
  }

  const PERMISSION_ATTRS: Array<keyof AndroidManifestComponentEvidence> = ['permission', 'readPermission', 'writePermission']
  for (const component of androidManifest.components) {
    for (const attr of PERMISSION_ATTRS) {
      const value = component[attr] as { kind: string; value?: string }
      if (value.kind !== 'literal' || !value.value) continue
      for (const targetId of permissionTargets(value.value)) {
        addEdge({
          id: `${edgeId(component.id, 'component-uses-permission', targetId)}@${attr}`,
          source: component.id,
          target: targetId,
          kind: 'component-uses-permission',
          metadata: { evidenceArtifact: 'android-manifest', attribute: attr, permission: value.value, local: permissionNodeIdsByName.has(value.value) },
        })
      }
    }
  }
  for (const perm of androidManifest.permissions) {
    if (!perm.resolvedName) continue
    for (const targetId of permissionTargets(perm.resolvedName)) {
      addEdge({
        id: `${edgeId(perm.manifestFileId, 'manifest-uses-permission', targetId)}@${perm.id}`,
        source: perm.manifestFileId,
        target: targetId,
        kind: 'manifest-uses-permission',
        metadata: { evidenceArtifact: 'android-manifest', evidenceEntityId: perm.id, permission: perm.resolvedName, local: permissionNodeIdsByName.has(perm.resolvedName) },
      })
    }
  }

  // -- 6. Resource files and definitions -----------------------------------------
  for (const file of androidResources.resourceFiles) {
    addNode({
      id: file.id,
      kind: 'android-resource-file',
      label: file.filename,
      path: file.path,
      androidArtifactId: 'android-resources',
      androidEntityId: file.id,
      androidModuleId: file.moduleId,
      androidSourceSetId: sourceSetNodeId(file.moduleId, file.sourceSet),
      androidMetadata: { baseType: file.baseType, qualifiers: file.qualifiers.raw.join('-') || null },
    })
  }

  const resourceCandidateIndex = new Map<string, string[]>()
  const addResourceDefinitionNode = (
    id: string,
    type: string,
    name: string,
    moduleId: string,
    sourceSet: string,
    file: string,
    fileId: string,
    line: number
  ): void => {
    addNode({
      id,
      kind: 'android-resource-definition',
      label: `${type}/${name}`,
      path: file,
      line,
      androidArtifactId: 'android-resources',
      androidEntityId: id,
      androidModuleId: moduleId,
      androidSourceSetId: sourceSetNodeId(moduleId, sourceSet),
      androidMetadata: { type, name },
    })
    addEdge({
      id: edgeId(id, 'resource-defined-in-file', fileId),
      source: id,
      target: fileId,
      kind: 'resource-defined-in-file',
      metadata: { evidenceArtifact: 'android-resources', evidenceEntityId: id },
    })
    const key = `${type}/${name}`
    const list = resourceCandidateIndex.get(key) ?? []
    list.push(id)
    resourceCandidateIndex.set(key, list)
  }

  for (const def of androidResources.valueDefinitions) {
    addResourceDefinitionNode(def.id, def.key.type, def.key.name, def.moduleId, def.sourceSet, def.file, def.fileId, def.source.line)
  }
  for (const def of androidResources.fileDefinitions) {
    addResourceDefinitionNode(def.id, def.key.type, def.key.name, def.moduleId, def.sourceSet, def.file, def.fileId, def.source.line)
  }
  for (const layout of androidResources.layouts) {
    addResourceDefinitionNode(layout.id, layout.key.type, layout.key.name, layout.moduleId, layout.sourceSet, layout.file, layout.fileId, layout.source.line)
  }
  for (const idDef of androidResources.idDefinitions) {
    addResourceDefinitionNode(idDef.id, idDef.key.type, idDef.key.name, idDef.moduleId, idDef.sourceSet, idDef.file, idDef.fileId, idDef.source.line)
  }

  // -- 7. Kotlin/Java source -> resource (bounded static `R.type.name` scan) -----
  const rReferenceWarnings = extractSourceResourceReferences({ projectRoot, symbolIndex, resourceCandidateIndex, addEdge })
  warnings.push(...rReferenceWarnings)

  // -- 8. Navigation graphs, destinations, actions, deep links, includes ---------
  for (const graph of androidNavigation.graphs) {
    addNode({
      id: graph.id,
      kind: 'android-navigation-graph',
      label: graph.rawId ?? graph.id,
      path: graph.file,
      line: graph.source.line,
      androidArtifactId: 'android-navigation',
      androidEntityId: graph.id,
      androidModuleId: graph.moduleId,
      androidSourceSetId: sourceSetNodeId(graph.moduleId, graph.sourceSet),
      androidMetadata: { graphKind: graph.kind, route: graph.route },
    })
  }
  for (const destination of androidNavigation.destinations) {
    addNode({
      id: destination.id,
      kind: 'android-navigation-destination',
      label: destination.androidName ?? destination.rawId ?? destination.id,
      path: destination.file,
      line: destination.source.line,
      androidArtifactId: 'android-navigation',
      androidEntityId: destination.id,
      androidModuleId: destination.moduleId,
      androidSourceSetId: sourceSetNodeId(destination.moduleId, destination.sourceSet),
      androidMetadata: { destinationKind: destination.kind, route: destination.route, androidName: destination.androidName },
    })
    addEdge({
      id: edgeId(destination.parentGraphId, 'navigation-graph-contains-destination', destination.id),
      source: destination.parentGraphId,
      target: destination.id,
      kind: 'navigation-graph-contains-destination',
      metadata: { evidenceArtifact: 'android-navigation', evidenceEntityId: destination.id },
    })

    if (destination.kind !== 'custom' && destination.resolvedClassName) {
      const candidates = resolveExactClassCandidates(destination.resolvedClassName, classIndex)
      for (const candidateId of candidates) {
        addEdge({
          id: edgeId(destination.id, 'navigation-destination-resolves-to-screen', candidateId),
          source: destination.id,
          target: candidateId,
          kind: 'navigation-destination-resolves-to-screen',
          metadata: { evidenceArtifact: 'android-navigation', matchBasis: 'exact-fully-qualified-class-name', candidate: candidates.length > 1 },
        })
      }
    }
  }
  for (const action of androidNavigation.actions) {
    addNode({
      id: action.id,
      kind: 'android-navigation-action',
      label: action.rawId ?? action.id,
      path: action.file,
      line: action.source.line,
      androidArtifactId: 'android-navigation',
      androidEntityId: action.id,
      androidModuleId: action.moduleId,
      androidSourceSetId: sourceSetNodeId(action.moduleId, action.sourceSet),
    })
    addEdge({
      id: edgeId(action.parentId, 'navigation-destination-has-action', action.id),
      source: action.parentId,
      target: action.id,
      kind: 'navigation-destination-has-action',
      metadata: { evidenceArtifact: 'android-navigation', evidenceEntityId: action.id },
    })
    for (const candidateId of action.candidateDestinationIds) {
      addEdge({
        id: edgeId(action.id, 'navigation-action-targets-destination', candidateId),
        source: action.id,
        target: candidateId,
        kind: 'navigation-action-targets-destination',
        metadata: { evidenceArtifact: 'android-navigation', candidate: action.candidateDestinationIds.length > 1, unresolved: action.candidateDestinationIds.length === 0 },
      })
    }
    for (const candidateId of action.candidatePopUpToIds) {
      addEdge({
        id: edgeId(action.id, 'navigation-action-pop-up-to-destination', candidateId),
        source: action.id,
        target: candidateId,
        kind: 'navigation-action-pop-up-to-destination',
        metadata: { evidenceArtifact: 'android-navigation', candidate: action.candidatePopUpToIds.length > 1 },
      })
    }
  }
  for (const include of androidNavigation.includes) {
    for (const candidateId of include.candidateTargetGraphIds) {
      addEdge({
        id: `${edgeId(include.parentGraphId, 'navigation-graph-includes-graph', candidateId)}@${include.id}`,
        source: include.parentGraphId,
        target: candidateId,
        kind: 'navigation-graph-includes-graph',
        metadata: { evidenceArtifact: 'android-navigation', evidenceEntityId: include.id, candidate: include.candidateTargetGraphIds.length > 1 },
      })
    }
  }
  for (const deepLink of androidNavigation.xmlDeepLinks) {
    addNode({
      id: deepLink.id,
      kind: 'android-navigation-deep-link',
      label: deepLink.uriPattern ?? deepLink.id,
      path: deepLink.file,
      line: deepLink.source.line,
      androidArtifactId: 'android-navigation',
      androidEntityId: deepLink.id,
      androidModuleId: deepLink.moduleId,
      androidSourceSetId: sourceSetNodeId(deepLink.moduleId, deepLink.sourceSet),
      androidMetadata: {
        uriPattern: deepLink.uriPattern,
        scheme: deepLink.scheme,
        host: deepLink.host,
        port: deepLink.port,
        mimeType: deepLink.mimeType,
        hasPlaceholder: deepLink.hasPlaceholder,
      },
    })
    addEdge({
      id: edgeId(deepLink.parentId, 'navigation-destination-has-deep-link', deepLink.id),
      source: deepLink.parentId,
      target: deepLink.id,
      kind: 'navigation-destination-has-deep-link',
      metadata: { evidenceArtifact: 'android-navigation', evidenceEntityId: deepLink.id },
    })
  }

  // -- 9. Manifest deep link <-> navigation deep link (exact, conservative) ------
  for (const manifestDeepLink of androidManifest.deepLinkCandidates) {
    if (!componentById.has(manifestDeepLink.componentId)) continue
    for (const navDeepLink of androidNavigation.xmlDeepLinks) {
      if (!isExactDeepLinkMatch(manifestDeepLink, navDeepLink)) continue
      addEdge({
        id: `${edgeId(manifestDeepLink.componentId, 'manifest-deep-link-matches-navigation-deep-link', navDeepLink.id)}@${manifestDeepLink.id}`,
        source: manifestDeepLink.componentId,
        target: navDeepLink.id,
        kind: 'manifest-deep-link-matches-navigation-deep-link',
        metadata: {
          evidenceArtifact: 'android-manifest',
          evidenceEntityId: manifestDeepLink.id,
          matchBasis: 'exact-scheme-host-port-path',
          scheme: manifestDeepLink.scheme,
          host: manifestDeepLink.host,
          path: manifestDeepLink.path,
          candidate: true,
        },
      })
    }
  }

  // -- 10. Compose routes ---------------------------------------------------------
  const screenCandidateById = new Map(androidNavigation.screenCandidates.map((c) => [c.id, c]))
  for (const route of androidNavigation.composeRoutes) {
    addNode({
      id: route.id,
      kind: 'android-compose-route',
      label: route.resolvedRoute ?? route.typeRouteName ?? route.rawRouteExpression ?? route.builder,
      path: route.file,
      line: route.source.line,
      androidArtifactId: 'android-navigation',
      androidEntityId: route.id,
      androidModuleId: route.moduleId ?? undefined,
      androidSourceSetId: route.moduleId && route.sourceSet ? sourceSetNodeId(route.moduleId, route.sourceSet) : undefined,
      androidMetadata: {
        builder: route.builder,
        evidenceKind: route.evidenceKind,
        resolvedRoute: route.resolvedRoute,
        typeRouteName: route.typeRouteName,
      },
    })

    for (const screenCandidateId of route.screenCandidateIds) {
      const screenCandidate = screenCandidateById.get(screenCandidateId)
      if (!screenCandidate) continue
      const candidates = resolveScreenSymbolCandidates(screenCandidate.calledScreenName, symbolIndex)
      for (const candidateId of candidates) {
        addEdge({
          id: edgeId(route.id, 'compose-route-resolves-to-screen', candidateId),
          source: route.id,
          target: candidateId,
          kind: 'compose-route-resolves-to-screen',
          metadata: {
            evidenceArtifact: 'android-navigation',
            evidenceEntityId: screenCandidateId,
            matchBasis: 'direct-top-level-call-in-route-content-lambda',
            candidate: candidates.length > 1,
          },
        })
      }
    }
  }

  // -- 11. Compose declarations and facts (v1.11.0 Batch 4) -----------------------
  //
  // Reuses `android-compose-semantic.json`'s own stable IDs for every node
  // (never re-minted). Two node kinds only, per the batch contract: one
  // compact `android-composable` per declaration, and one generic
  // `android-compose-fact` per Batch 2/3 fact record plus each Batch 1
  // structural UI-region call — distinguished by `androidMetadata.factKind`
  // rather than one top-level node kind per fact subtype. Never duplicates a
  // Kotlin `file`/`symbol` node; a function-local composable (no structural
  // symbol) always defines from its `file:` node instead.
  if (androidComposeSemantic?.detected) {
    const declarationById = new Map(androidComposeSemantic.declarations.map((d) => [d.id, d]))

    for (const decl of androidComposeSemantic.declarations) {
      addNode({
        id: decl.id,
        kind: 'android-composable',
        label: decl.name,
        path: decl.sourceRange.file,
        line: decl.sourceRange.startLine,
        androidArtifactId: 'android-compose-semantic',
        androidEntityId: decl.id,
        androidModuleId: decl.moduleId ?? undefined,
        androidSourceSetId: decl.moduleId && decl.sourceSet ? sourceSetNodeId(decl.moduleId, decl.sourceSet) : undefined,
        androidMetadata: {
          factKind: 'composable',
          scope: decl.scope,
          visibility: decl.visibility,
          isPreview: decl.isPreview,
          endLine: decl.sourceRange.endLine,
          childCallCount: decl.childCalls.length,
        },
      })

      const definingNode = resolveComposableDefiningNodeId(decl, symbolIndex)
      addEdge({
        id: edgeId(definingNode.nodeId, 'defines-composable', decl.id),
        source: definingNode.nodeId,
        target: decl.id,
        kind: 'defines-composable',
        metadata: { evidenceArtifact: 'android-compose-semantic', matchBasis: definingNode.matchBasis },
      })

      for (const child of decl.childCalls) {
        if (!declarationById.has(child.calleeDeclarationId)) continue
        addEdge({
          id: edgeId(decl.id, 'composable-calls-composable', child.calleeDeclarationId),
          source: decl.id,
          target: child.calleeDeclarationId,
          kind: 'composable-calls-composable',
          metadata: { evidenceArtifact: 'android-compose-semantic', calleeName: child.calleeName, line: child.line },
        })
      }

      for (const region of decl.structuralRegions) {
        const factId = `${decl.id}::ui-region:${region.kind}@L${region.line}`
        addNode({
          id: factId,
          kind: 'android-compose-fact',
          label: region.kind,
          path: decl.sourceRange.file,
          line: region.line,
          androidArtifactId: 'android-compose-semantic',
          androidEntityId: factId,
          androidModuleId: decl.moduleId ?? undefined,
          androidSourceSetId: decl.moduleId && decl.sourceSet ? sourceSetNodeId(decl.moduleId, decl.sourceSet) : undefined,
          androidMetadata: { factKind: 'ui-region', composableId: decl.id, regionKind: region.kind },
        })
        addEdge({
          id: edgeId(decl.id, 'composable-has-fact', factId),
          source: decl.id,
          target: factId,
          kind: 'composable-has-fact',
          metadata: { evidenceArtifact: 'android-compose-semantic', factKind: 'ui-region' },
        })
      }
    }

    const addComposeFact = (
      id: string,
      composableId: string,
      label: string,
      sourceRange: { file: string; startLine: number; endLine: number },
      factKind: string,
      metadata: Record<string, string | number | boolean | null>
    ): void => {
      const decl = declarationById.get(composableId)
      addNode({
        id,
        kind: 'android-compose-fact',
        label,
        path: sourceRange.file,
        line: sourceRange.startLine,
        androidArtifactId: 'android-compose-semantic',
        androidEntityId: id,
        androidModuleId: decl?.moduleId ?? undefined,
        androidSourceSetId: decl?.moduleId && decl?.sourceSet ? sourceSetNodeId(decl.moduleId, decl.sourceSet) : undefined,
        androidMetadata: { factKind, composableId, endLine: sourceRange.endLine, ...metadata },
      })
      addEdge({
        id: edgeId(composableId, 'composable-has-fact', id),
        source: composableId,
        target: id,
        kind: 'composable-has-fact',
        metadata: { evidenceArtifact: 'android-compose-semantic', factKind },
      })
    }

    for (const fact of androidComposeSemantic.stateFacts) {
      addComposeFact(fact.id, fact.composableId, fact.callName, fact.sourceRange, 'state', {
        callName: fact.callName,
        variableName: fact.variableName,
        bindingForm: fact.bindingForm,
        status: fact.status,
        receiverRootName: fact.receiverRootName,
        candidateMatchStatus: fact.candidateMatchStatus,
      })
      // v1.12.0 Batch 4: projects state ownership onto the existing
      // `android-compose-fact` node - one edge per exact same-composable
      // ViewModel candidate (resolved: one; ambiguous: every candidate, no
      // winner; no-match/not-attempted: no edge).
      for (const candidateId of fact.candidateViewModelSymbolIds) {
        addEdge({
          id: edgeId(fact.id, 'compose-state-reads-viewmodel', candidateId),
          source: fact.id,
          target: candidateId,
          kind: 'compose-state-reads-viewmodel',
          metadata: {
            evidenceArtifact: 'android-compose-semantic',
            evidenceEntityId: fact.id,
            matchBasis: 'exact-same-composable-receiver-root',
            candidate: fact.candidateViewModelSymbolIds.length > 1,
          },
        })
      }
    }
    for (const fact of androidComposeSemantic.effectFacts) {
      addComposeFact(fact.id, fact.composableId, fact.kind, fact.sourceRange, 'effect', {
        effectKind: fact.kind,
        status: fact.status,
        hasOnDispose: fact.hasOnDispose,
      })
    }
    for (const fact of androidComposeSemantic.testTagFacts) {
      addComposeFact(fact.id, fact.composableId, fact.resolvedValue ?? fact.rawExpression, fact.sourceRange, 'test-tag', {
        resolvedValue: fact.resolvedValue,
        rawExpression: fact.rawExpression,
        status: fact.status,
      })
    }
    for (const fact of androidComposeSemantic.visibleTextFacts) {
      addComposeFact(fact.id, fact.composableId, fact.text, fact.sourceRange, 'visible-text', {
        callName: fact.callName,
        text: fact.text,
      })
    }
    for (const fact of androidComposeSemantic.stringResourceFacts) {
      addComposeFact(fact.id, fact.composableId, fact.resourceIdentifierText, fact.sourceRange, 'string-resource', {
        resourceName: fact.resourceName,
        resourceIdentifierText: fact.resourceIdentifierText,
      })
      const candidates = resourceCandidateIndex.get(`string/${fact.resourceName}`) ?? []
      for (const candidateId of candidates) {
        addEdge({
          id: edgeId(fact.id, 'compose-string-references-resource', candidateId),
          source: fact.id,
          target: candidateId,
          kind: 'compose-string-references-resource',
          metadata: { evidenceArtifact: 'android-compose-semantic', matchBasis: 'exact-resource-name', candidate: candidates.length > 1 },
        })
      }
    }
    for (const fact of androidComposeSemantic.viewModelReferences) {
      addComposeFact(fact.id, fact.composableId, fact.variableOrParameterName ?? fact.typeText ?? fact.kind, fact.sourceRange, 'viewmodel', {
        kind: fact.kind,
        variableOrParameterName: fact.variableOrParameterName,
        typeText: fact.typeText,
        status: fact.status,
      })
      if (fact.typeText) {
        const candidates = resolveViewModelClassCandidates(fact.typeText, symbolIndex)
        for (const candidateId of candidates) {
          addEdge({
            id: edgeId(fact.composableId, 'composable-references-viewmodel', candidateId),
            source: fact.composableId,
            target: candidateId,
            kind: 'composable-references-viewmodel',
            metadata: {
              evidenceArtifact: 'android-compose-semantic',
              evidenceEntityId: fact.id,
              matchBasis: 'exact-simple-class-name',
              candidate: candidates.length > 1,
            },
          })
        }
      }
    }
    for (const fact of androidComposeSemantic.clickHandlerFacts) {
      addComposeFact(fact.id, fact.composableId, fact.handlerName ?? fact.apiForm, fact.sourceRange, 'click-handler', {
        apiForm: fact.apiForm,
        callbackForm: fact.callbackForm,
        handlerName: fact.handlerName,
        status: fact.status,
      })
      for (const navigationCallId of fact.navigationCallIds) {
        addEdge({
          id: edgeId(fact.id, 'click-handler-contains-navigation-call', navigationCallId),
          source: fact.id,
          target: navigationCallId,
          kind: 'click-handler-contains-navigation-call',
          metadata: { evidenceArtifact: 'android-compose-semantic' },
        })
      }
    }
    for (const fact of androidComposeSemantic.navigationCallFacts) {
      addComposeFact(fact.id, fact.composableId, fact.resolvedRoute ?? fact.typeRouteName ?? fact.rawRouteExpression ?? fact.callName, fact.sourceRange, 'navigation-call', {
        callName: fact.callName,
        receiverText: fact.receiverText,
        routeClassification: fact.routeClassification,
        resolvedRoute: fact.resolvedRoute,
        typeRouteName: fact.typeRouteName,
        status: fact.status,
        candidateMatchStatus: fact.candidateMatchStatus,
      })
      for (const candidateId of fact.candidateIds) {
        if (!nodeIds.has(candidateId)) {
          warnings.push(
            `${fact.sourceRange.file}:${fact.sourceRange.startLine}: navigation-call fact "${fact.id}" references candidate "${candidateId}" not found in the projected graph; skipped rather than inventing a target.`
          )
          continue
        }
        addEdge({
          id: edgeId(fact.id, 'compose-navigation-targets-route', candidateId),
          source: fact.id,
          target: candidateId,
          kind: 'compose-navigation-targets-route',
          metadata: { evidenceArtifact: 'android-compose-semantic', candidate: fact.candidateIds.length > 1 },
        })
      }
    }
  }

  // -- 11a. Activity-to-Compose direct hosting (v1.12.0 Batch 4) -------------------
  //
  // Connects an existing Activity `symbol` node (from `android-components.json`,
  // never re-derived here) to an existing `android-composable` node (added
  // above, when Compose evidence exists) - never a new node for either side.
  // A resolved host fact with no candidates would be a contradiction (never
  // happens by construction); only `resolved` facts ever carry candidates.
  if (androidComposeSemantic?.activityHostFacts) {
    const validSymbolIds = new Set<string>()
    for (const file of symbolIndex.files) {
      for (const symbol of file.symbols) validSymbolIds.add(`symbol:${file.path}#${symbol.name}`)
    }
    for (const fact of androidComposeSemantic.activityHostFacts) {
      if (fact.status !== 'resolved') continue
      if (!validSymbolIds.has(fact.activitySymbolId)) {
        warnings.push(`Activity host fact '${fact.id}' references symbol '${fact.activitySymbolId}', which is not a known indexed symbol; skipped.`)
        continue
      }
      for (const candidateId of fact.candidateComposableIds) {
        if (!nodeIds.has(candidateId)) {
          warnings.push(`Activity host fact '${fact.id}' references composable '${candidateId}', which is not a known graph node; skipped.`)
          continue
        }
        addEdge({
          id: edgeId(fact.activitySymbolId, 'activity-hosts-composable', candidateId),
          source: fact.activitySymbolId,
          target: candidateId,
          kind: 'activity-hosts-composable',
          metadata: {
            evidenceArtifact: 'android-compose-semantic',
            evidenceEntityId: fact.id,
            apiForm: fact.apiForm,
            candidate: fact.candidateComposableIds.length > 1,
          },
        })
      }
    }
  }

  // -- 12. Android test-source semantic evidence (v1.11.0 Batch 5) ----------------
  //
  // Reuses `android-test-semantic.json`'s own stable IDs for every node
  // (never re-minted). Four compact node kinds only: `android-test-file`,
  // `android-test-class`, `android-test-method`, and a single generic
  // `android-test-fact` covering every rule/assertion/route/test-double
  // record (distinguished by `androidMetadata.factKind`), mirroring the same
  // compactness discipline Batch 4 already established for Compose facts.
  // Test files are never added to `symbol-index.json` (a separate, narrower
  // discovery boundary than the core `--src` structural indexer), so there
  // is no existing `file:`/`symbol:` node to reuse for them — every test
  // node here is genuinely new.
  if (androidTestSemantic?.detected) {
    const classById = new Map(androidTestSemantic.testClasses.map((c) => [c.id, c]))

    for (const file of androidTestSemantic.testFiles) {
      addNode({
        id: file.id,
        kind: 'android-test-file',
        label: basename(file.path),
        path: file.path,
        line: file.source.line,
        androidArtifactId: 'android-test-semantic',
        androidEntityId: file.id,
        androidModuleId: file.moduleId ?? undefined,
        androidMetadata: {
          factKind: 'test-file',
          sourceSet: file.sourceSet,
          category: file.category,
          language: file.language,
          frameworks: file.frameworks.join(','),
        },
      })
    }

    for (const cls of androidTestSemantic.testClasses) {
      addNode({
        id: cls.id,
        kind: 'android-test-class',
        label: cls.name,
        path: cls.sourceRange.file,
        line: cls.sourceRange.startLine,
        androidArtifactId: 'android-test-semantic',
        androidEntityId: cls.id,
        androidMetadata: {
          factKind: 'test-class',
          endLine: cls.sourceRange.endLine,
          superclassOrRunner: cls.superclassOrRunner,
          frameworks: cls.frameworks.join(','),
        },
      })
      addEdge({
        id: edgeId(cls.fileId, 'defines-test-class', cls.id),
        source: cls.fileId,
        target: cls.id,
        kind: 'defines-test-class',
        metadata: { evidenceArtifact: 'android-test-semantic' },
      })
    }

    for (const rule of androidTestSemantic.testRules) {
      addNode({
        id: rule.id,
        kind: 'android-test-fact',
        label: rule.variableName ?? rule.ruleKind,
        path: rule.sourceRange.file,
        line: rule.sourceRange.startLine,
        androidArtifactId: 'android-test-semantic',
        androidEntityId: rule.id,
        androidMetadata: {
          factKind: 'compose-rule',
          ruleKind: rule.ruleKind,
          variableName: rule.variableName,
          activityType: rule.activityType,
          status: rule.status,
          endLine: rule.sourceRange.endLine,
        },
      })
      addEdge({
        id: edgeId(rule.classId, 'test-class-uses-rule', rule.id),
        source: rule.classId,
        target: rule.id,
        kind: 'test-class-uses-rule',
        metadata: { evidenceArtifact: 'android-test-semantic' },
      })
    }

    for (const method of androidTestSemantic.testMethods) {
      addNode({
        id: method.id,
        kind: 'android-test-method',
        label: method.name,
        path: method.sourceRange.file,
        line: method.sourceRange.startLine,
        androidArtifactId: 'android-test-semantic',
        androidEntityId: method.id,
        androidMetadata: {
          factKind: 'test-method',
          endLine: method.sourceRange.endLine,
          category: method.category,
          frameworks: method.frameworks.join(','),
        },
      })
      addEdge({
        id: edgeId(method.classId, 'test-class-defines-method', method.id),
        source: method.classId,
        target: method.id,
        kind: 'test-class-defines-method',
        metadata: { evidenceArtifact: 'android-test-semantic', evidenceEntityId: classById.get(method.classId)?.id ?? null },
      })
    }

    const addTestFactNode = (
      id: string,
      ownerId: string,
      label: string,
      sourceRange: { file: string; startLine: number; endLine: number },
      factKind: string,
      metadata: Record<string, string | number | boolean | null>
    ): void => {
      addNode({
        id,
        kind: 'android-test-fact',
        label,
        path: sourceRange.file,
        line: sourceRange.startLine,
        androidArtifactId: 'android-test-semantic',
        androidEntityId: id,
        androidMetadata: { factKind, endLine: sourceRange.endLine, ownerId, ...metadata },
      })
      addEdge({
        id: edgeId(ownerId, 'test-method-has-fact', id),
        source: ownerId,
        target: id,
        kind: 'test-method-has-fact',
        metadata: { evidenceArtifact: 'android-test-semantic', factKind },
      })
    }

    for (const fact of androidTestSemantic.assertionFacts) {
      addTestFactNode(fact.id, fact.methodId, fact.resolvedValue ?? fact.rawExpression, fact.sourceRange, fact.kind, {
        api: fact.api,
        resolvedValue: fact.resolvedValue,
        status: fact.status,
      })
      for (const candidateId of fact.candidateComposableIds) {
        if (!nodeIds.has(candidateId)) continue
        addEdge({
          id: edgeId(fact.id, 'android-test-references-composable', candidateId),
          source: fact.id,
          target: candidateId,
          kind: 'android-test-references-composable',
          metadata: { evidenceArtifact: 'android-test-semantic', candidate: fact.candidateComposableIds.length > 1 },
        })
      }
    }

    for (const fact of androidTestSemantic.routeFacts) {
      addTestFactNode(fact.id, fact.methodId, fact.resolvedRoute ?? fact.rawExpression ?? 'route', fact.sourceRange, 'route-reference', {
        routeType: fact.routeType,
        resolvedRoute: fact.resolvedRoute,
        status: fact.status,
      })
      for (const candidateId of fact.candidateNavigationIds) {
        if (!nodeIds.has(candidateId)) continue
        addEdge({
          id: edgeId(fact.id, 'android-test-references-route', candidateId),
          source: fact.id,
          target: candidateId,
          kind: 'android-test-references-route',
          metadata: { evidenceArtifact: 'android-test-semantic', candidate: fact.candidateNavigationIds.length > 1 },
        })
      }
      for (const candidateId of fact.candidateComposableIds) {
        if (!nodeIds.has(candidateId)) continue
        addEdge({
          id: edgeId(fact.id, 'android-test-references-composable', candidateId),
          source: fact.id,
          target: candidateId,
          kind: 'android-test-references-composable',
          metadata: { evidenceArtifact: 'android-test-semantic', candidate: fact.candidateComposableIds.length > 1 },
        })
      }
    }

    for (const fact of androidTestSemantic.testDoubleFacts) {
      addTestFactNode(fact.id, fact.ownerId, fact.variableName ?? fact.referencedType ?? fact.kind, fact.sourceRange, fact.kind, {
        variableName: fact.variableName,
        referencedType: fact.referencedType,
        confidence: fact.confidence,
      })
      addEdge({
        id: edgeId(fact.ownerId, 'android-test-uses-double', fact.id),
        source: fact.ownerId,
        target: fact.id,
        kind: 'android-test-uses-double',
        metadata: { evidenceArtifact: 'android-test-semantic', doubleKind: fact.kind },
      })
      for (const candidateId of fact.candidateSymbolIds) {
        addEdge({
          id: edgeId(fact.id, 'android-test-references-viewmodel', candidateId),
          source: fact.id,
          target: candidateId,
          kind: 'android-test-references-viewmodel',
          metadata: {
            evidenceArtifact: 'android-test-semantic',
            matchBasis: 'exact-simple-class-name',
            candidate: fact.candidateSymbolIds.length > 1,
          },
        })
      }
    }
  }

  // -- 12. Component dependency facts (v1.12.0 Batch 3) -----------------------
  //
  // Projects the five fixed static component-dependency relationships onto
  // the existing symbol nodes already produced by structural indexing - never
  // a new component node. A resolved fact becomes one edge; an ambiguous fact
  // becomes one edge per candidate (every candidate preserved, no winner
  // selected); an unresolved fact never becomes an edge.
  if (androidComponents?.dependencyFacts) {
    for (const fact of androidComponents.dependencyFacts) {
      if (fact.matchStatus === 'unresolved') continue
      for (const candidateSymbolId of fact.candidateSymbolIds) {
        addEdge({
          id: edgeId(fact.sourceSymbolId, fact.relationshipKind, candidateSymbolId),
          source: fact.sourceSymbolId,
          target: candidateSymbolId,
          kind: fact.relationshipKind,
          metadata: {
            evidenceArtifact: 'android-components',
            evidenceEntityId: fact.id,
            evidenceKind: fact.evidenceKind,
            declaredTypeName: fact.declaredTypeName,
            candidate: fact.candidateSymbolIds.length > 1,
          },
        })
      }
    }
  }

  sortNodes(nodes)
  sortEdges(edges)

  return { nodes, edges, warnings: [...new Set(warnings)].sort() }
}

// ---------------------------------------------------------------------------
// Exact class resolution
// ---------------------------------------------------------------------------

interface ClassIndexEntry {
  filePath: string
  symbolName: string
  packageName: string
}

function buildClassIndex(symbolIndex: SymbolIndex): ClassIndexEntry[] {
  const entries: ClassIndexEntry[] = []
  for (const file of symbolIndex.files) {
    if (file.language !== 'kotlin' && file.language !== 'java') continue
    const packageName = derivePackageFromFilePath(file.path)
    if (packageName === null) continue
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' && symbol.kind !== 'interface') continue
      entries.push({ filePath: file.path, symbolName: symbol.name, packageName })
    }
  }
  return entries
}

/** Only resolves fully-qualified names (`pkg.ClassName`) against the file's package, derived from the conventional `.../kotlin/<pkg/path>/Name.kt` or `.../java/<pkg/path>/Name.java` directory layout. Never a simple-name/fuzzy match. */
function resolveExactClassCandidates(fullyQualifiedName: string, index: ClassIndexEntry[]): string[] {
  const lastDot = fullyQualifiedName.lastIndexOf('.')
  if (lastDot === -1) return []
  const pkg = fullyQualifiedName.slice(0, lastDot)
  const className = fullyQualifiedName.slice(lastDot + 1)
  const results: string[] = []
  for (const entry of index) {
    if (entry.packageName === pkg && entry.symbolName === className) {
      results.push(`symbol:${entry.filePath}#${entry.symbolName}`)
    }
  }
  return [...new Set(results)].sort()
}

function resolveScreenSymbolCandidates(name: string, symbolIndex: SymbolIndex): string[] {
  const results: string[] = []
  for (const file of symbolIndex.files) {
    if (file.language !== 'kotlin' && file.language !== 'java') continue
    for (const symbol of file.symbols) {
      if (symbol.name === name && (symbol.kind === 'function' || symbol.kind === 'class')) {
        results.push(`symbol:${file.path}#${symbol.name}`)
      }
    }
  }
  return [...new Set(results)].sort()
}

/** `defines-composable` source resolution (v1.11.0 Batch 4): a top-level composable's exact same-file, same-name function symbol when the base structural indexer captured one; otherwise (including always for a `function-local` composable, which has no structural symbol node) the existing `file:` node — never an invented symbol. */
function resolveComposableDefiningNodeId(
  decl: { name: string; scope: 'top-level' | 'function-local'; sourceRange: { file: string } },
  symbolIndex: SymbolIndex
): { nodeId: string; matchBasis: 'exact-symbol' | 'file' } {
  if (decl.scope === 'top-level') {
    for (const file of symbolIndex.files) {
      if (file.path !== decl.sourceRange.file) continue
      for (const symbol of file.symbols) {
        if (symbol.name === decl.name && symbol.kind === 'function') {
          return { nodeId: `symbol:${file.path}#${symbol.name}`, matchBasis: 'exact-symbol' }
        }
      }
    }
  }
  return { nodeId: `file:${decl.sourceRange.file}`, matchBasis: 'file' }
}

function derivePackageFromFilePath(filePath: string): string | null {
  const match = /\/(?:kotlin|java)\/(.+)$/.exec(filePath)
  if (!match) return null
  const rel = match[1]!
  const lastSlash = rel.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return rel.slice(0, lastSlash).replace(/\//g, '.')
}

// ---------------------------------------------------------------------------
// Bounded Kotlin/Java `R.type.name` scan (source-references-resource)
// ---------------------------------------------------------------------------

const R_REFERENCE_PATTERN = /\b(?:([\w.]+)\.)?R\.(\w+)\.(\w+)\b/g

interface ExtractSourceResourceReferencesOptions {
  projectRoot: string
  symbolIndex: SymbolIndex
  resourceCandidateIndex: Map<string, string[]>
  addEdge: (edge: CodeGraphEdge) => void
}

function extractSourceResourceReferences(options: ExtractSourceResourceReferencesOptions): string[] {
  const { projectRoot, symbolIndex, resourceCandidateIndex, addEdge } = options
  const warnings: string[] = []

  for (const file of symbolIndex.files) {
    if (file.language !== 'kotlin' && file.language !== 'java') continue
    const text = readSourceFile(projectRoot, file.path)
    if (text === null) continue
    const stripped = stripCommentsAndStrings(text)

    for (const match of stripped.matchAll(R_REFERENCE_PATTERN)) {
      const pkgPrefix = match[1]
      const type = match[2]!
      const name = match[3]!
      if (pkgPrefix === 'android') continue // framework reference: no local candidate, no edge, by design.

      const key = `${type}/${name}`
      const candidates = resourceCandidateIndex.get(key)
      if (!candidates || candidates.length === 0) continue

      const line = lineNumberAt(stripped, match.index!)
      const containingSymbolName = findEnclosingTopLevelSymbol(file, line)
      const sourceNodeId = containingSymbolName ? `symbol:${file.path}#${containingSymbolName}` : `file:${file.path}`

      for (const candidateId of candidates) {
        addEdge({
          id: `${edgeId(sourceNodeId, 'source-references-resource', candidateId)}@${line}`,
          source: sourceNodeId,
          target: candidateId,
          kind: 'source-references-resource',
          metadata: {
            evidenceArtifact: 'android-resources',
            raw: match[0],
            resourceType: type,
            resourceName: name,
            sourceFile: file.path,
            line,
            candidate: candidates.length > 1,
          },
        })
      }
    }
  }

  return warnings
}

/** Best-effort re-read of an already-indexed source file, resolved against the actual project root (not `process.cwd()`, which may differ under `--root`). */
function readSourceFile(projectRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(projectRoot, ...relPath.split('/')), 'utf8')
  } catch {
    return null
  }
}

/** Strips line and block comments and string/char literals (single-, double-, and triple-quoted), replacing them with spaces of equal length (preserving offsets/line numbers) so `R.type.name`-shaped text inside them is never mistaken for a real reference. */
function stripCommentsAndStrings(text: string): string {
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      result += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      result += blankPreservingNewlines(text.slice(i, stop))
      i = stop
      continue
    }
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3)
      const stop = end === -1 ? text.length : end + 3
      result += blankPreservingNewlines(text.slice(i, stop))
      i = stop
      continue
    }
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i]
      let j = i + 1
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j++
        j++
      }
      const stop = Math.min(j + 1, text.length)
      result += blankPreservingNewlines(text.slice(i, stop))
      i = stop
      continue
    }
    result += text[i]
    i++
  }
  return result
}

function blankPreservingNewlines(segment: string): string {
  return segment.replace(/[^\n]/g, ' ')
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

function findEnclosingTopLevelSymbol(file: SymbolIndex['files'][number], line: number): string | null {
  let best: string | null = null
  let bestLine = -1
  for (const symbol of file.symbols) {
    if (symbol.location.line <= line && symbol.location.line > bestLine) {
      best = symbol.name
      bestLine = symbol.location.line
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Deep-link matching
// ---------------------------------------------------------------------------

interface DeepLinkLike {
  scheme: string | null
  host: string | null
  port: string | null
}

function isExactDeepLinkMatch(
  manifest: { scheme: string | null; host: string | null; port: string | null; path: string | null; pathPrefix: string | null; pathPattern: string | null },
  nav: DeepLinkLike & { uriPattern: string | null; hasPlaceholder: boolean }
): boolean {
  if (!manifest.scheme || !nav.scheme || manifest.scheme !== nav.scheme) return false
  if (!manifest.host || !nav.host || manifest.host !== nav.host) return false
  const portsMatch = (!manifest.port && !nav.port) || (!!manifest.port && !!nav.port && manifest.port === nav.port)
  if (!portsMatch) return false

  // Only an exact literal path counts. pathPrefix/pathPattern (manifest side) or
  // a `{placeholder}` (navigation side) are pattern-based and always conservative non-matches.
  if (manifest.pathPrefix || manifest.pathPattern) return false
  if (nav.hasPlaceholder) return false
  if (!manifest.path) return false

  const navPath = extractPathFromUri(nav.uriPattern)
  if (navPath === null) return false
  return normalizePath(manifest.path) === normalizePath(navPath)
}

function extractPathFromUri(uriPattern: string | null): string | null {
  if (!uriPattern) return null
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(uriPattern)
  if (!schemeMatch) return null
  const rest = uriPattern.slice(schemeMatch[0].length)
  const slashIndex = rest.indexOf('/')
  return slashIndex === -1 ? '' : rest.slice(slashIndex)
}

function normalizePath(value: string): string {
  return value.endsWith('/') && value.length > 1 ? value.slice(0, -1) : value
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function edgeId(source: string, kind: string, target: string): string {
  return `${source}--${kind}-->${target}`
}

function basename(filePath: string): string {
  return filePath.split('/').at(-1) ?? filePath
}

function sortNodes(nodes: CodeGraphNode[]): void {
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function sortEdges(edges: CodeGraphEdge[]): void {
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
