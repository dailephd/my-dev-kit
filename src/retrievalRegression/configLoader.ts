import * as fs from 'node:fs'
import type { RetrievalRegressionMode, RetrievalRegressionSuiteConfig, RetrievalRegressionTask } from './types.js'

const VALID_MODES: RetrievalRegressionMode[] = ['general', 'feature-add', 'subsystem']
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const CAP_KEYS = ['maxCandidateFiles', 'maxSourceSlices', 'maxGraphNodes', 'maxGraphEdges'] as const

export function loadRetrievalRegressionConfig(configPath: string): RetrievalRegressionSuiteConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Retrieval regression config not found: ${configPath}`)
  }

  const raw = fs.readFileSync(configPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in retrieval regression config ${configPath}: ${(error as Error).message}`)
  }

  validateRetrievalRegressionConfig(parsed, configPath)
  return parsed as RetrievalRegressionSuiteConfig
}

export function validateRetrievalRegressionConfig(value: unknown, configPath: string): asserts value is RetrievalRegressionSuiteConfig {
  const problems: string[] = []

  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid retrieval regression config ${configPath}: expected an object.`)
  }

  const config = value as Record<string, unknown>

  if (!config.schemaVersion || typeof config.schemaVersion !== 'string') {
    problems.push('schemaVersion is required and must be a string')
  }
  if (!config.suiteId || typeof config.suiteId !== 'string') {
    problems.push('suiteId is required and must be a string')
  }

  if (!Array.isArray(config.tasks)) {
    problems.push('tasks must be an array')
  } else {
    const seenIds = new Set<string>()
    config.tasks.forEach((rawTask, index) => {
      const label = `tasks[${index}]`
      const task = rawTask as Partial<RetrievalRegressionTask>

      if (!task || typeof task !== 'object') {
        problems.push(`${label} must be an object`)
        return
      }

      if (!task.id || typeof task.id !== 'string') {
        problems.push(`${label}.id is required and must be a string`)
      } else {
        if (!SAFE_ID_PATTERN.test(task.id)) {
          problems.push(`${label}.id "${task.id}" must be safe for file paths (letters, digits, hyphen, underscore only)`)
        }
        if (seenIds.has(task.id)) {
          problems.push(`Duplicate task id: "${task.id}"`)
        }
        seenIds.add(task.id)
      }

      const idLabel = task.id ? `id=${task.id}` : label

      if (task.skip) {
        if (!task.skipReason || typeof task.skipReason !== 'string') {
          problems.push(`${label} (${idLabel}) has skip:true and requires skipReason`)
        }
      } else if (!task.query || typeof task.query !== 'string') {
        problems.push(`${label} (${idLabel}) requires "query" unless skip is true`)
      }

      if (task.mode !== undefined && !VALID_MODES.includes(task.mode as RetrievalRegressionMode)) {
        problems.push(`${label}.mode "${String(task.mode)}" is invalid. Expected one of: ${VALID_MODES.join(', ')}.`)
      }

      if (task.caps !== undefined) {
        if (typeof task.caps !== 'object' || task.caps === null) {
          problems.push(`${label}.caps must be an object`)
        } else {
          for (const key of CAP_KEYS) {
            const capValue = (task.caps as Record<string, unknown>)[key]
            if (capValue === undefined) continue
            if (!Number.isInteger(capValue) || (capValue as number) <= 0) {
              problems.push(`${label}.caps.${key} must be a positive integer`)
            }
          }
        }
      }

      if (task.sourceRoots !== undefined && !Array.isArray(task.sourceRoots)) {
        problems.push(`${label}.sourceRoots must be an array`)
      }
    })
  }

  if (problems.length > 0) {
    throw new Error(`Invalid retrieval regression config ${configPath}:\n- ${problems.join('\n- ')}`)
  }
}
