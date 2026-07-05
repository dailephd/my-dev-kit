import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildOutputPath, toForwardSlash } from '../io/pathUtils.js'
import type { RetrievalRegressionTask } from './types.js'

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const DEFAULT_SOURCE_ROOTS = ['src']

export interface ResolvedFixture {
  fixtureRoot: string
  sourceRoots: string[]
  sourceRootNames: string[]
  taskOutputDir: string
}

export function resolveFixture(options: {
  configPath: string
  outputDir: string
  task: RetrievalRegressionTask
}): ResolvedFixture {
  const { configPath, outputDir, task } = options

  if (!task.fixtureRoot) {
    throw new Error(`Task "${task.id}" has no fixtureRoot configured.`)
  }

  const fixtureRoot = path.isAbsolute(task.fixtureRoot)
    ? path.resolve(task.fixtureRoot)
    : path.resolve(path.dirname(path.resolve(configPath)), task.fixtureRoot)

  if (!fs.existsSync(fixtureRoot)) {
    throw new Error(`Fixture root not found: ${fixtureRoot} (task ${task.id})`)
  }
  if (!fs.statSync(fixtureRoot).isDirectory()) {
    throw new Error(`Fixture root is not a directory: ${fixtureRoot} (task ${task.id})`)
  }

  const sourceRootNames = task.sourceRoots && task.sourceRoots.length > 0 ? task.sourceRoots : DEFAULT_SOURCE_ROOTS

  const sourceRoots = sourceRootNames.map((name) => {
    const resolved = path.resolve(fixtureRoot, name)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Source root not found: ${resolved} (task ${task.id})`)
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Source root is not a directory: ${resolved} (task ${task.id})`)
    }
    return toForwardSlash(resolved)
  })

  if (!SAFE_ID_PATTERN.test(task.id)) {
    throw new Error(`Unsafe task id for filesystem use: "${task.id}" (task IDs must be letters, digits, hyphen, or underscore only).`)
  }

  const taskOutputDir = buildOutputPath(path.resolve(outputDir, 'tasks'), task.id)

  return {
    fixtureRoot: toForwardSlash(fixtureRoot),
    sourceRoots,
    sourceRootNames,
    taskOutputDir: toForwardSlash(taskOutputDir),
  }
}
