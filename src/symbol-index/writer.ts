/**
 * Symbol-index artifact writer.
 *
 * Writes the main symbol-index and optional call-graph artifacts to the
 * output directory. Also sets the `callGraphArtifact` pointer on the index
 * when the call-graph is present.
 *
 * Artifact paths:
 *   <outputDir>/symbol-index.json            — main artifact (always written)
 *   <outputDir>/symbol-index.call-graph.json — optional call-graph artifact
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  type SymbolIndex,
  type CallGraph,
  ARTIFACT_MAIN,
  ARTIFACT_CALL_GRAPH,
} from './types.js'
import { toForwardSlash } from '../io/pathUtils.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Writes the main symbol-index JSON to `<outputDir>/symbol-index.json`.
 *
 * If `callGraph` is provided, writes the call-graph JSON first, then sets
 * the `callGraphArtifact` pointer on the index before writing the main file.
 *
 * Creates `outputDir` if it does not exist.
 *
 * @returns The absolute path of the written main artifact.
 */
export function writeArtifacts(
  index: SymbolIndex,
  callGraph: CallGraph | null,
  outputDir: string
): { mainPath: string; callGraphPath: string | null } {
  ensureDir(outputDir)

  let callGraphPath: string | null = null

  if (callGraph) {
    callGraphPath = path.join(outputDir, ARTIFACT_CALL_GRAPH)
    writeJson(callGraphPath, callGraph)

    // Set pointer on the index (relative path from repo root)
    index.callGraphArtifact = toForwardSlash(
      path.join(path.relative(process.cwd(), outputDir), ARTIFACT_CALL_GRAPH)
    )
  }

  const mainPath = path.join(outputDir, ARTIFACT_MAIN)
  writeJson(mainPath, index)

  return { mainPath, callGraphPath }
}

/**
 * Writes a single JSON value to a file with two-space indentation.
 * Creates parent directories automatically.
 */
function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

