/**
 * v1.10.1 Batch 3: shared, bounded classification helpers for evidence grouping
 * and test-infrastructure discovery.
 *
 * Reuses the existing owner-like/contract-like/test-like patterns from
 * `roleCandidates.ts` (Batch 2) rather than declaring a second classifier.
 * Only adds the additional patterns Batch 3 needs (fixtures, mocks, factories,
 * setup files) that Batch 2 had no reason to define.
 */
import { basename, isTestLike, stripExt, TEST_LIKE_PATTERN } from './roleCandidates.js'

export { basename, isTestLike, stripExt, TEST_LIKE_PATTERN }

/** Paths under a fixture/sample/snapshot-shaped directory. */
export const FIXTURE_PATH_PATTERN = /(^|[\\/])(__fixtures__|fixtures|test-data|testdata|samples|snapshots)([\\/]|$)/i

/** Paths under a mock-shaped directory. */
export const MOCK_PATH_PATTERN = /(^|[\\/])(__mocks__|mocks)([\\/]|$)/i

/** Paths under a generated-output directory, or a `.generated.` infix, or a
 * `generated`-prefixed/suffixed basename. v1.10.3 Batch 1: used only to keep
 * codegen output out of implementation-owner eligibility (F-002); never a
 * ranking signal. */
export const GENERATED_PATH_PATTERN = /(^|[\\/])(generated|__generated__|codegen)([\\/]|$)|\.generated\.[jt]sx?$/i
export const GENERATED_NAME_PATTERN = /(^|[^a-z])generated([^a-z]|$)/i

/** Filenames whose own name signals mock/stub/fake/spy intent. */
export const MOCK_NAME_PATTERN = /(mock|stub|fake|spy)/i

/** Filenames whose own name signals a test factory/builder/helper. Deliberately overlaps
 * with `OWNER_LIKE_PATTERN` ("builder") from `roleCandidates.ts`: `isFactoryLike` below
 * additionally requires the file to be test-scoped, so a production builder under `src/`
 * is never misclassified (TST-B3-013). */
export const FACTORY_NAME_PATTERN = /(factory|builder|createtest|maketest)/i

/** Filenames whose own name signals a test setup/bootstrap module. */
export const SETUP_NAME_PATTERN = /(setup|globalsetup|testsetup)/i

/** Directories conventionally reserved for test-scoped code: test files themselves,
 * `__tests__`, `tests/`, fixture/mock directories, and common test-utility directory names. */
export const TEST_SCOPE_DIR_PATTERN =
  /(^|[\\/])(tests?|__tests__|test-utils|testutils|test-helpers|testhelpers|fixtures|__fixtures__|mocks|__mocks__)([\\/])/i

export function isFixtureLike(filePath: string | undefined): boolean {
  return filePath !== undefined && FIXTURE_PATH_PATTERN.test(filePath)
}

export function isMockLike(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return MOCK_PATH_PATTERN.test(filePath) || MOCK_NAME_PATTERN.test(stripExt(basename(filePath)))
}

export function isGeneratedLike(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return GENERATED_PATH_PATTERN.test(filePath) || GENERATED_NAME_PATTERN.test(stripExt(basename(filePath)))
}

/** True when a file lives inside a test-scoped area of the tree: itself a `*.spec`/`*.test`
 * file, or under `tests/`, `__tests__/`, a fixture/mock directory, or a test-utility directory.
 * This is the boundary that keeps `isFactoryLike`/`isSetupLike` from ever matching a
 * production file purely by name (TST-B3-013). */
export function isTestScoped(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return isTestLike(filePath) || TEST_SCOPE_DIR_PATTERN.test(filePath)
}

export function isFactoryLike(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return FACTORY_NAME_PATTERN.test(stripExt(basename(filePath))) && isTestScoped(filePath)
}

export function isSetupLike(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return SETUP_NAME_PATTERN.test(stripExt(basename(filePath))) && isTestScoped(filePath)
}
