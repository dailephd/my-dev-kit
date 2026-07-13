import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidGradleProject } from '../../src/android/buildAndroidGradleProject.js'
import { buildAndroidResourceProject } from '../../src/android/buildAndroidResourceProject.js'
import { buildAndroidNavigationProject } from '../../src/android/buildAndroidNavigationProject.js'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-navigation')
const GRADLE_FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-gradle')

function buildForFixture(root: string, sourceRoots: string[] = ['app/src/main/kotlin']) {
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
  const { artifact: androidResources } = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle })
  const buildResult = buildIndex({ repoRoot: root, sourceRoots, buildCallGraph: false })
  return buildAndroidNavigationProject({
    projectRoot: root,
    androidProject,
    androidGradle,
    androidResources,
    symbolIndex: buildResult.index,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

describe('buildAndroidNavigationProject', () => {
  it('merges XML navigation evidence and Compose route evidence into one artifact with separated evidence kinds', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(artifact.detected).toBe(true)
    expect(artifact.navigationFiles).toHaveLength(1)
    expect(artifact.destinations).toHaveLength(2)
    expect(artifact.actions).toHaveLength(1)
    expect(artifact.composeRoutes.length).toBeGreaterThan(0)
    // XML and Compose evidence are kept in separate arrays with no inferred relationship.
    expect(artifact.composeRoutes.some((r) => r.resolvedRoute === 'home')).toBe(true)
    expect(artifact.destinations.some((d) => d.androidName === 'com.example.navapp.HomeFragment')).toBe(true)
  })

  it('reports accurate summary counts', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(artifact.summary).toMatchObject({
      xmlGraphCount: 1,
      destinationCount: 2,
      actionCount: 1,
    })
    expect(artifact.summary.composeRouteCount).toBe(artifact.composeRoutes.length)
  })

  it('produces a bounded malformed-file warning without crashing', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'malformed-nav-app'), ['app/src/main'])
    expect(artifact.navigationFiles[0]!.parsingStatus).toBe('malformed')
    expect(artifact.warnings.length).toBeGreaterThan(0)
    expect(artifact.graphs).toEqual([])
  })

  it('reports detected: false for an Android module with zero navigation evidence', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'no-navigation-app'), ['app/src/main'])
    expect(artifact.detected).toBe(false)
    expect(artifact.navigationFiles).toEqual([])
    expect(artifact.composeRoutes).toEqual([])
  })

  it('does not produce misleading navigation evidence for a non-Android Gradle project', () => {
    const { artifact } = buildForFixture(join(GRADLE_FIXTURES_ROOT, 'non-android-gradle-project'), ['lib'])
    expect(artifact.detected).toBe(false)
  })

  it('produces empty Compose evidence when no symbolIndex is supplied (early-fingerprint-only call)', () => {
    const root = join(FIXTURES_ROOT, 'basic-app')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
    const { artifact: androidResources } = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle })
    const { artifact } = buildAndroidNavigationProject({ projectRoot: root, androidProject, androidGradle, androidResources })
    expect(artifact.composeRoutes).toEqual([])
    expect(artifact.navigationFiles.length).toBeGreaterThan(0)
  })

  it('produces deterministic, byte-identical output across repeated runs against the same fixture', () => {
    const first = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    const second = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(first.artifact).toEqual(second.artifact)
    expect(first.evidenceFingerprint).toBe(second.evidenceFingerprint)
  })
})
