/**
 * v1.10.1 Batch 3: shared, bounded classification helpers for evidence grouping
 * and test-infrastructure discovery.
 *
 * Reuses the existing owner-like/contract-like/test-like patterns from
 * `roleCandidates.ts` (Batch 2) rather than declaring a second classifier.
 * Only adds the additional patterns Batch 3 needs (fixtures, mocks, factories,
 * setup files) that Batch 2 had no reason to define.
 */
import {
  basename,
  FIXTURE_PATH_PATTERN,
  GENERATED_NAME_PATTERN,
  GENERATED_PATH_PATTERN,
  isFixtureLike,
  isGeneratedLike,
  isTestLike,
  isTestScoped,
  stripExt,
  TEST_LIKE_PATTERN,
  TEST_SCOPE_DIR_PATTERN,
} from '../classification/classificationHelpers.js'

export {
  basename,
  FIXTURE_PATH_PATTERN,
  GENERATED_NAME_PATTERN,
  GENERATED_PATH_PATTERN,
  isFixtureLike,
  isGeneratedLike,
  isTestLike,
  isTestScoped,
  stripExt,
  TEST_LIKE_PATTERN,
  TEST_SCOPE_DIR_PATTERN,
}

/** Paths under a mock-shaped directory. */
export const MOCK_PATH_PATTERN = /(^|[\\/])(__mocks__|mocks)([\\/]|$)/i

/** Filenames whose own name signals mock/stub/fake/spy intent. */
export const MOCK_NAME_PATTERN = /(mock|stub|fake|spy)/i

/** Filenames whose own name signals a test factory/builder/helper. Deliberately overlaps
 * with `OWNER_LIKE_PATTERN` ("builder") from `roleCandidates.ts`: `isFactoryLike` below
 * additionally requires the file to be test-scoped, so a production builder under `src/`
 * is never misclassified (TST-B3-013). */
export const FACTORY_NAME_PATTERN = /(factory|builder|createtest|maketest)/i

/** Filenames whose own name signals a test setup/bootstrap module. */
export const SETUP_NAME_PATTERN = /(setup|globalsetup|testsetup)/i

export function isMockLike(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return MOCK_PATH_PATTERN.test(filePath) || MOCK_NAME_PATTERN.test(stripExt(basename(filePath)))
}

export function isFactoryLike(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return FACTORY_NAME_PATTERN.test(stripExt(basename(filePath))) && isTestScoped(filePath)
}

export function isSetupLike(filePath: string | undefined): boolean {
  if (filePath === undefined) return false
  return SETUP_NAME_PATTERN.test(stripExt(basename(filePath))) && isTestScoped(filePath)
}
