import * as fs from 'node:fs'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
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

function readRequiredJson<T>(filePath: string, label: string): T {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required ${label} artifact: ${filePath}`)
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
    throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`)
  }
}
