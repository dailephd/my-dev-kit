import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidGradleProject } from '../../src/android/buildAndroidGradleProject.js'
import { buildAndroidManifestProject } from '../../src/android/buildAndroidManifestProject.js'
import { discoverAndroidManifests } from '../../src/android/discoverAndroidManifests.js'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-manifest')
const GRADLE_FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-gradle')

function buildForFixture(root: string) {
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
  return buildAndroidManifestProject({ projectRoot: root, androidProject, androidGradle, createdAt: '2026-01-01T00:00:00.000Z' })
}

describe('discoverAndroidManifests', () => {
  it('discovers the default src/main/AndroidManifest.xml for a detected module', () => {
    const root = join(FIXTURES_ROOT, 'basic-app')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
    const result = discoverAndroidManifests(root, androidProject, androidGradle)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ path: 'app/src/main/AndroidManifest.xml', sourceSet: 'main', discoverySource: 'default-convention' })
  })

  it('discovers a custom Gradle-configured manifest path instead of the default convention path', () => {
    const root = join(FIXTURES_ROOT, 'custom-manifest-path-app')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
    const result = discoverAndroidManifests(root, androidProject, androidGradle)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ path: 'app/custom/CustomManifest.xml', discoverySource: 'gradle-override' })
  })

  it('discovers multiple source-set manifests (main + debug) separately', () => {
    const root = join(FIXTURES_ROOT, 'multi-source-set-app')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
    const result = discoverAndroidManifests(root, androidProject, androidGradle)
    expect(result.candidates.map((c) => c.sourceSet).sort()).toEqual(['debug', 'main'])
  })
})

describe('buildAndroidManifestProject', () => {
  it('builds a basic-app artifact with application, activity, launcher candidate, and metadata evidence', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(artifact.detected).toBe(true)
    expect(artifact.manifests).toHaveLength(1)
    expect(artifact.manifests[0]?.parsingStatus).toBe('parsed')
    expect(artifact.manifests[0]?.gradleNamespace).toBe('com.example.basicapp')
    expect(artifact.applications).toHaveLength(1)
    expect(artifact.components).toHaveLength(1)
    expect(artifact.components[0]?.resolvedName?.resolved).toBe('com.example.basicapp.MainActivity')
    expect(artifact.launcherCandidates).toHaveLength(1)
    expect(artifact.summary).toMatchObject({ moduleCount: 1, manifestFileCount: 1, applicationCount: 1, componentCount: 1 })
  })

  it('represents all component kinds with provenance and process/authorities evidence for the component-complete fixture', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'component-complete-app'))
    const kinds = artifact.components.map((c) => c.kind).sort()
    expect(kinds).toEqual(['activity', 'activity-alias', 'provider', 'receiver', 'service'])
    for (const component of artifact.components) {
      expect(component.moduleId).toBe('android-module:app')
      expect(component.sourceSet).toBe('main')
    }
    const alias = artifact.components.find((c) => c.kind === 'activity-alias')!
    expect(alias.targetActivity?.resolved).toBe('com.example.componentapp.MainActivity')
    const provider = artifact.components.find((c) => c.kind === 'provider')!
    expect(provider.authorities).toEqual(['com.example.componentapp.provider'])
    expect(provider.metadataIds).toHaveLength(1)
  })

  it('keeps multiple source-set manifests separate with no merged/effective record', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'multi-source-set-app'))
    expect(artifact.manifests).toHaveLength(2)
    expect(artifact.manifests.map((m) => m.sourceSet).sort()).toEqual(['debug', 'main'])
    const debugActivities = artifact.components.filter((c) => c.sourceSet === 'debug')
    const mainActivities = artifact.components.filter((c) => c.sourceSet === 'main')
    expect(debugActivities).toHaveLength(2)
    expect(mainActivities).toHaveLength(1)
    // The debug MainActivity duplicate is preserved as its own record, not merged with main's.
    const debugMain = debugActivities.find((c) => c.rawName === '.MainActivity')!
    expect(debugMain.label).toEqual({ kind: 'literal', value: 'Debug MainActivity' })
  })

  it('discovers and parses a manifest at a custom Gradle-configured path', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'custom-manifest-path-app'))
    expect(artifact.manifests).toHaveLength(1)
    expect(artifact.manifests[0]?.discoverySource).toBe('gradle-override')
    expect(artifact.manifests[0]?.path).toBe('app/custom/CustomManifest.xml')
    expect(artifact.components[0]?.resolvedName?.resolved).toBe('com.example.custompath.MainActivity')
  })

  it('produces a bounded malformed-manifest record without crashing and without misleading declarations', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'malformed-manifest-app'))
    expect(artifact.manifests).toHaveLength(1)
    expect(artifact.manifests[0]?.parsingStatus).toBe('malformed')
    expect(artifact.components).toEqual([])
    expect(artifact.warnings.length).toBeGreaterThan(0)
  })

  it('reports detected: false for an Android module with zero manifest files', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'no-manifest-app'))
    expect(artifact.detected).toBe(false)
    expect(artifact.manifests).toEqual([])
  })

  it('does not produce misleading manifest evidence for a non-Android Gradle project', () => {
    const { artifact } = buildForFixture(join(GRADLE_FIXTURES_ROOT, 'non-android-gradle-project'))
    expect(artifact.detected).toBe(false)
    expect(artifact.manifests).toEqual([])
  })

  it('produces deterministic, byte-identical output across repeated runs against the same fixture', () => {
    const first = buildForFixture(join(FIXTURES_ROOT, 'component-complete-app'))
    const second = buildForFixture(join(FIXTURES_ROOT, 'component-complete-app'))
    expect(first.artifact).toEqual(second.artifact)
    expect(first.evidenceFingerprint).toBe(second.evidenceFingerprint)
  })
})
