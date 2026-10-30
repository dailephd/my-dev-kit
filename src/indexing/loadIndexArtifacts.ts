import * as fs from 'node:fs'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { GraphArtifactSelection } from '../graph/adaptGraphArtifact.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import { readIndexManifest, type ResolvedIndexManifest } from './readIndexManifest.js'

export interface LookupArtifacts {
  resolved: ResolvedIndexManifest
  codeGraph: CodeGraph
}

export interface SourceArtifacts {
  resolved: ResolvedIndexManifest
  codeGraph?: CodeGraph
  symbolIndex?: SymbolIndex
}

export interface ViewGraphArtifact {
  resolved: ResolvedIndexManifest
  graph: GraphArtifactSelection
  artifactPath: string
  artifact: unknown
}

export function loadLookupArtifacts(indexDir: string): LookupArtifacts {
  const resolved = readIndexManifest(indexDir)
  return {
    resolved,
    codeGraph: readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph'),
  }
}

export function loadSourceArtifacts(options: {
  indexDir: string
  loadCodeGraph?: boolean
  loadSymbolIndex?: boolean
}): SourceArtifacts {
  const resolved = readIndexManifest(options.indexDir)
  return {
    resolved,
    codeGraph: options.loadCodeGraph
      ? readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph')
      : undefined,
    symbolIndex: options.loadSymbolIndex
      ? readRequiredJson<SymbolIndex>(resolved.artifactPaths.symbolIndex, 'symbol index')
      : undefined,
  }
}

export function loadViewGraphArtifact(indexDir: string, graph: GraphArtifactSelection): ViewGraphArtifact {
  const resolved = readIndexManifest(indexDir)
  const artifactPath = resolveViewGraphArtifactPath(resolved, graph)
  return {
    resolved,
    graph,
    artifactPath,
    artifact: readRequiredJson<unknown>(artifactPath, viewGraphLabel(graph)),
  }
}

export function readRequiredJson<T>(filePath: string, label: string): T {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required ${label} artifact: ${filePath}`)
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (label === 'code graph' || label === 'symbol index') validateStructuralArtifact(value, label)
    return value as T
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
    throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`)
  }
}

/** One version policy for the existing structural artifact readers. */
export function validateStructuralArtifact(value: unknown, artifact: 'symbol index' | 'code graph'): void {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
  const version = record?.schemaVersion
  const supported = artifact === 'symbol index' ? ['2', '3'] : ['1.0.0', '1.1.0']
  if (typeof version !== 'string' || !supported.includes(version)) {
    throw new Error(`Unsupported ${artifact} schema version: ${JSON.stringify(version) ?? 'missing'}. Supported: ${supported.join(', ')}.`)
  }
  if (artifact === 'symbol index' ? !Array.isArray(record?.files) : !Array.isArray(record?.nodes) || !Array.isArray(record?.edges)) {
    throw new Error(`Invalid ${artifact} artifact structure.`)
  }
}

function resolveViewGraphArtifactPath(resolved: ResolvedIndexManifest, graph: GraphArtifactSelection): string {
  if (
    graph === 'code' ||
    graph === 'android-module' ||
    graph === 'android-manifest' ||
    graph === 'android-navigation' ||
    graph === 'compose-ui' ||
    graph === 'compose-navigation' ||
    graph === 'android-test'
  ) {
    return resolved.artifactPaths.codeGraph
  }
  if (graph === 'data-model') {
    if (!resolved.semanticArtifactPaths.dataModelGraph) {
      throw new Error(
        'Missing dataModelGraph artifact in manifest. Run `data-model --index <dir> --out <dir>` or refresh the index before rendering --graph data-model.'
      )
    }
    return resolved.semanticArtifactPaths.dataModelGraph
  }
  if (graph === 'model-view-lineage') {
    if (!resolved.semanticArtifactPaths.modelViewLineage) {
      throw new Error(
        'Missing modelViewLineage artifact in manifest. Run `data-model --index <dir> --trace-view <entity>` before rendering --graph model-view-lineage.'
      )
    }
    return resolved.semanticArtifactPaths.modelViewLineage
  }
  if (graph === 'route' || graph === 'browser-storage' || graph === 'ui-reachability') {
    const reachabilityPath = resolved.semanticArtifactPaths.frontendReachability
    if (!reachabilityPath) {
      throw new Error(
        `Missing frontendReachability artifact in manifest for --graph ${graph}. ` +
          'Run `npx @dailephd/my-dev-kit index` on a project with TSX/JSX files to produce the frontend-reachability.json artifact.'
      )
    }
    return reachabilityPath
  }
  // react-component and react-flow: derived from frontendSemantic artifact
  if (!resolved.semanticArtifactPaths.frontendSemantic) {
    throw new Error(
      `Missing frontendSemantic artifact in manifest for --graph ${graph}. ` +
      'Run `npx @dailephd/my-dev-kit index` on a project with TSX/JSX files to produce the frontend-semantic.json artifact.'
    )
  }
  return resolved.semanticArtifactPaths.frontendSemantic
}

function viewGraphLabel(graph: GraphArtifactSelection): string {
  if (
    graph === 'code' ||
    graph === 'android-module' ||
    graph === 'android-manifest' ||
    graph === 'android-navigation' ||
    graph === 'compose-ui' ||
    graph === 'compose-navigation' ||
    graph === 'android-test'
  ) {
    return 'code graph'
  }
  if (graph === 'data-model') return 'data-model graph'
  if (graph === 'model-view-lineage') return 'model-view-lineage graph'
  if (graph === 'route' || graph === 'browser-storage' || graph === 'ui-reachability') {
    return 'frontend reachability'
  }
  return 'frontend semantic'
}
