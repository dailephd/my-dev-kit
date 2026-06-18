import * as fs from 'node:fs'
import * as path from 'node:path'
import { isInsideRoot } from '../io/pathUtils.js'
import type { IndexManifest } from './manifestTypes.js'

export interface ResolvedIndexManifest {
  indexDir: string
  manifestPath: string
  manifest: IndexManifest
  artifactPaths: {
    symbolIndex: string
    codeGraph: string
    callGraph: string | null
  }
  semanticArtifactPaths: {
    dataModel: string | null
    dataModelGraph: string | null
    modelViewLineage: string | null
    frontendSemantic: string | null
  }
}

export function readIndexManifest(indexDirInput: string): ResolvedIndexManifest {
  const indexDir = path.resolve(indexDirInput)
  const manifestPath = path.join(indexDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing index manifest: ${manifestPath}`)
  }

  const manifest = readJson<IndexManifest>(manifestPath)
  validateManifest(manifest)

  return {
    indexDir,
    manifestPath,
    manifest,
    artifactPaths: {
      symbolIndex: resolveArtifactPath(indexDir, manifest.artifacts.symbolIndex, 'symbolIndex'),
      codeGraph: resolveArtifactPath(indexDir, manifest.artifacts.codeGraph, 'codeGraph'),
      callGraph: manifest.artifacts.callGraph
        ? resolveArtifactPath(indexDir, manifest.artifacts.callGraph, 'callGraph')
        : null,
    },
    semanticArtifactPaths: {
      dataModel: resolveOptionalArtifactPath(indexDir, manifest.semanticArtifacts?.dataModel, 'dataModel'),
      dataModelGraph: resolveOptionalArtifactPath(
        indexDir,
        manifest.semanticArtifacts?.dataModelGraph,
        'dataModelGraph'
      ),
      modelViewLineage: resolveOptionalArtifactPath(
        indexDir,
        manifest.semanticArtifacts?.modelViewLineage,
        'modelViewLineage'
      ),
      frontendSemantic: resolveOptionalArtifactPath(
        indexDir,
        manifest.semanticArtifacts?.frontendSemantic,
        'frontendSemantic'
      ),
    },
  }
}

function readJson<T>(filePath: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
    }
    throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`)
  }
}

function validateManifest(value: IndexManifest): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid manifest shape: expected an object.')
  if (value.artifactKind !== 'my-dev-kit-v1-manifest') {
    throw new Error('Invalid manifest shape: artifactKind must be my-dev-kit-v1-manifest.')
  }
  if (!value.version) throw new Error('Invalid manifest shape: version is required.')
  if (!value.projectRoot) throw new Error('Invalid manifest shape: projectRoot is required.')
  if (!Array.isArray(value.sourceRoots)) throw new Error('Invalid manifest shape: sourceRoots must be an array.')
  if (!value.artifacts || typeof value.artifacts !== 'object') {
    throw new Error('Invalid manifest shape: artifacts is required.')
  }
  if (!value.artifacts.symbolIndex) throw new Error('Invalid manifest shape: artifacts.symbolIndex is required.')
  if (!value.artifacts.codeGraph) throw new Error('Invalid manifest shape: artifacts.codeGraph is required.')
}

function resolveArtifactPath(indexDir: string, artifactPath: string, name: string): string {
  if (!artifactPath) throw new Error(`Missing required artifact path: ${name}`)
  const resolved = path.resolve(indexDir, artifactPath)
  if (!isInsideRoot(indexDir, resolved)) {
    throw new Error(`Artifact path for "${name}" escapes the index directory: ${artifactPath}`)
  }
  return resolved
}

function resolveOptionalArtifactPath(indexDir: string, artifactPath: string | null | undefined, name: string): string | null {
  if (!artifactPath) return null
  return resolveArtifactPath(indexDir, artifactPath, name)
}
