import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const V114_OUTPUT_ROOT_ENV = 'MY_DEV_KIT_TEST_OUTPUT_ROOT'
export const V114_DEFAULT_OUTPUT_ROOT = '.my-dev-kit-workflow/tmp/test-runs/v114'

const SUITE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
// Task roots owned by earlier v1.14.0 batches (B01-B15 and the configured-import correction).
const HISTORICAL_TASK_ROOT = /(^|[\\/])v1\.14\.0-(b(0[1-9]|1[0-5])|configured-imports)-\d{8}([\\/]|$)/

type PathApi = Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'>

export interface V114OutputOptions {
  env?: NodeJS.ProcessEnv
  projectRoot?: string
}

const defaultProjectRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** True when child is parent or lies beneath it, using the given path flavour. */
export function isPathWithin(parent: string, child: string, api: PathApi = path): boolean {
  const rel = api.relative(parent, child)
  if (rel === '') return true
  return !api.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + api.sep)
}

/** realpath of the deepest existing ancestor, re-joined with the not-yet-created remainder. */
function resolveThroughSymlinks(target: string): string {
  const missing: string[] = []
  let current = target
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    missing.unshift(path.basename(current))
    current = parent
  }
  return path.join(realpathSync(current), ...missing)
}

function assertContained(projectRoot: string, candidate: string, label: string): void {
  if (!isPathWithin(projectRoot, candidate)) throw new Error(`${label} escapes the project root`)
  if (!isPathWithin(realpathSync(projectRoot), resolveThroughSymlinks(candidate))) {
    throw new Error(`${label} escapes the project root through a symbolic link`)
  }
}

export function resolveV114OutputRoot(options: V114OutputOptions = {}): string {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot())
  const configured = (options.env ?? process.env)[V114_OUTPUT_ROOT_ENV]
  if (configured === undefined) {
    const root = path.resolve(projectRoot, V114_DEFAULT_OUTPUT_ROOT)
    assertContained(projectRoot, root, 'default test output root')
    return root
  }
  if (!path.isAbsolute(configured)) throw new Error(`${V114_OUTPUT_ROOT_ENV} must be an absolute path`)
  const root = path.resolve(configured)
  if (HISTORICAL_TASK_ROOT.test(root)) throw new Error(`${V114_OUTPUT_ROOT_ENV} must not select a historical task root`)
  assertContained(projectRoot, root, V114_OUTPUT_ROOT_ENV)
  return root
}

/** Creates and returns a new, uniquely named, absolute directory for one suite; never reuses an existing one. */
export function allocateV114OutputDir(suite: string, options: V114OutputOptions = {}): string {
  if (!SUITE_PATTERN.test(suite)) throw new Error(`invalid test suite identifier: ${JSON.stringify(suite)}`)
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot())
  const root = resolveV114OutputRoot({ ...options, projectRoot })
  assertContained(projectRoot, root, 'test output root')
  mkdirSync(root, { recursive: true })
  const allocated = mkdtempSync(path.join(root, suite + '-'))
  assertContained(projectRoot, allocated, 'allocated test directory')
  return allocated
}
