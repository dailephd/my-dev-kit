import * as fs from 'node:fs'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { DataModelArtifact } from '../data-model/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { FrontendReachabilityArtifact } from '../frontend-reachability/types.js'
import { loadClassificationArtifact } from '../classification/resolveClassificationForCommands.js'
import type { ClassificationArtifact } from '../classification/classificationTypes.js'
import { readIndexManifest, type ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { readRequiredJson, validateStructuralArtifact } from '../indexing/loadIndexArtifacts.js'

/**
 * One side (`--before` or `--after`) of a graph-diff comparison.
 *
 * `manifest.json` and `code-graph.json` are required — missing or malformed
 * either throws (via `readIndexManifest`/`readRequiredJson`, the same
 * helpers `lookup`/`slice`/`view` already use for clear, consistent error
 * messages). Every other artifact is optional: absent or unreadable simply
 * yields `null`, never a thrown error, so graph-diff degrades gracefully
 * across indexes built with different flags/versions.
 */
export interface GraphDiffArtifacts {
  resolved: ResolvedIndexManifest
  codeGraph: CodeGraph
  symbolIndex: SymbolIndex | null
  classification: ClassificationArtifact | null
  dataModel: DataModelArtifact | null
  frontendSemantic: FrontendSemanticArtifact | null
  frontendReachability: FrontendReachabilityArtifact | null
}

export function loadGraphDiffArtifacts(indexDir: string): GraphDiffArtifacts {
  const resolved = readIndexManifest(indexDir)
  const codeGraph = readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph')
  const symbolIndex = readOptionalJson<SymbolIndex>(resolved.artifactPaths.symbolIndex, (value) => validateStructuralArtifact(value, 'symbol index'))

  return {
    resolved,
    codeGraph,
    symbolIndex,
    classification: loadClassificationArtifact(indexDir, resolved.manifest),
    dataModel: readOptionalJson<DataModelArtifact>(resolved.semanticArtifactPaths.dataModel),
    frontendSemantic: readOptionalJson<FrontendSemanticArtifact>(resolved.semanticArtifactPaths.frontendSemantic),
    frontendReachability: readOptionalJson<FrontendReachabilityArtifact>(
      resolved.semanticArtifactPaths.frontendReachability ?? null
    ),
  }
}

function readOptionalJson<T>(filePath: string | null | undefined, validate?: (value: unknown) => void): T | null {
  if (!filePath) return null
  let value: unknown
  try {
    if (!fs.existsSync(filePath)) return null
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
  validate?.(value)
  return value as T
}
