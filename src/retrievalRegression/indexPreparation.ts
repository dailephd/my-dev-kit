import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import { runIndexCommand } from '../indexing/runIndexCommand.js'
import type { IndexManifest } from '../indexing/manifestTypes.js'

export interface PrepareTaskIndexResult {
  indexDir: string
  manifest: IndexManifest | null
}

export async function prepareTaskIndex(options: {
  fixtureRoot: string
  sourceRootNames: string[]
  taskOutputDir: string
}): Promise<PrepareTaskIndexResult> {
  const indexDir = path.join(options.taskOutputDir, 'index')

  let result
  try {
    result = await runIndexCommand({
      root: options.fixtureRoot,
      src: options.sourceRootNames,
      out: indexDir,
      json: false,
    })
  } catch (error) {
    throw new Error(`Index preparation failed for fixture ${options.fixtureRoot}: ${(error as Error).message}`)
  }

  return {
    indexDir: toForwardSlash(indexDir),
    manifest: result.mode === 'index' ? result.manifest : null,
  }
}
