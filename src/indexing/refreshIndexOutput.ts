import * as fs from 'node:fs'
import * as path from 'node:path'
import { isInsideRoot } from '../io/pathUtils.js'
import { MANAGED_INDEX_ARTIFACT_FILENAMES, type ManagedIndexArtifactFilename } from './managedArtifacts.js'

export interface RefreshIndexOutputResult {
  removed: ManagedIndexArtifactFilename[]
}

export function refreshIndexOutput(outputDir: string): RefreshIndexOutputResult {
  fs.mkdirSync(outputDir, { recursive: true })
  const removed: ManagedIndexArtifactFilename[] = []

  for (const filename of MANAGED_INDEX_ARTIFACT_FILENAMES) {
    const artifactPath = path.resolve(outputDir, filename)
    if (!isInsideRoot(outputDir, artifactPath)) {
      throw new Error(`Managed artifact path escapes the output directory: ${filename}`)
    }
    if (!fs.existsSync(artifactPath)) continue
    fs.rmSync(artifactPath, { force: true })
    removed.push(filename)
  }

  return { removed }
}
