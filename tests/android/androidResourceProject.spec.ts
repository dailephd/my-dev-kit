import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidGradleProject } from '../../src/android/buildAndroidGradleProject.js'
import { buildAndroidResourceProject } from '../../src/android/buildAndroidResourceProject.js'
import { discoverAndroidResourceDirectories } from '../../src/android/discoverAndroidResourceDirectories.js'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-resources')
const GRADLE_FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-gradle')

function buildForFixture(root: string) {
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
  return buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle, createdAt: '2026-01-01T00:00:00.000Z' })
}

describe('discoverAndroidResourceDirectories', () => {
  it('discovers standard values/layout/drawable/mipmap/xml directories with qualifiers', () => {
    const root = join(FIXTURES_ROOT, 'basic-app')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
    const result = discoverAndroidResourceDirectories(root, androidProject, androidGradle)
    const names = result.directories.map((d) => d.rawDirectoryName).sort()
    expect(names).toEqual(['drawable', 'layout', 'mipmap-xxhdpi', 'values', 'values-es', 'values-night', 'xml'])
    const valuesEs = result.directories.find((d) => d.rawDirectoryName === 'values-es')!
    expect(valuesEs.qualifiers.locale).toBe('es')
    expect(valuesEs.discoverySource).toBe('default-convention')
  })

  it('discovers a custom Gradle-configured resource directory instead of the default convention path', () => {
    const root = join(FIXTURES_ROOT, 'custom-res-dir-app')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
    const result = discoverAndroidResourceDirectories(root, androidProject, androidGradle)
    expect(result.directories).toHaveLength(1)
    expect(result.directories[0]).toMatchObject({ path: 'app/custom/myres/values', discoverySource: 'gradle-override' })
  })
})

describe('buildAndroidResourceProject', () => {
  it('indexes value resources, preserving qualified/localized duplicates separately', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(artifact.detected).toBe(true)
    const appNameDefs = artifact.valueDefinitions.filter((d) => d.type === 'string' && d.name === 'app_name')
    expect(appNameDefs).toHaveLength(2)
    expect(appNameDefs.map((d) => d.qualifiers.locale).sort()).toEqual(['es', null])
    const colorDefs = artifact.valueDefinitions.filter((d) => d.type === 'color' && d.name === 'primary')
    expect(colorDefs).toHaveLength(2)
    expect(colorDefs.map((d) => d.qualifiers.nightMode).sort()).toEqual(['night', null])
  })

  it('indexes a layout with declared IDs, an ID reference, and an included layout', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(artifact.layouts).toHaveLength(1)
    const layout = artifact.layouts[0]!
    expect(layout.key).toEqual({ packageScope: null, type: 'layout', name: 'activity_main' })
    expect(layout.includedLayoutRefs).toEqual(['@layout/toolbar'])
    expect(artifact.idDefinitions.map((d) => d.key.name).sort()).toEqual(['submit', 'title'])
  })

  it('enumerates candidate targets for a resource reference without selecting a runtime winner', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    const greetingRef = artifact.references.find((r) => r.resourceType === 'string' && r.resourceName === 'app_name')
    expect(greetingRef).toBeTruthy()
    // Two `app_name` string definitions exist (default + values-es) — both are valid static candidates.
    expect(greetingRef!.candidateTargetIds.length).toBe(2)
  })

  it('indexes drawable and mipmap file-based resources without decoding binary content', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    const drawable = artifact.fileDefinitions.find((d) => d.type === 'drawable')!
    expect(drawable).toMatchObject({ name: 'ic_launcher', xmlRootElement: 'vector' })
    const mipmapFile = artifact.resourceFiles.find((f) => f.baseType === 'mipmap')!
    expect(mipmapFile.fileKind).toBe('bitmap')
    expect(mipmapFile.parsingStatus).toBe('not-applicable')
  })

  it('indexes FileProvider path configuration without resolving filesystem paths', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(artifact.fileProviderPaths.length).toBeGreaterThanOrEqual(2)
    expect(artifact.fileProviderPaths.find((p) => p.elementType === 'files-path')).toMatchObject({ name: 'my_files', path: 'files/' })
  })

  it('indexes network-security configuration without validating certificates or contacting domains', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(artifact.networkSecurityRecords.some((r) => r.kind === 'domain' && r.domainText === 'example.com')).toBe(true)
    expect(artifact.networkSecurityRecords.some((r) => r.kind === 'pin-set')).toBe(true)
  })

  it('discovers and indexes resources at a custom Gradle-configured directory', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'custom-res-dir-app'))
    expect(artifact.detected).toBe(true)
    expect(artifact.valueDefinitions.some((d) => d.name === 'from_custom_dir')).toBe(true)
    expect(artifact.resourceDirectories[0]?.discoverySource).toBe('gradle-override')
  })

  it('produces a bounded malformed-file warning without crashing and without inventing declarations', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'malformed-resource-app'))
    const malformedFile = artifact.resourceFiles.find((f) => f.filename === 'strings.xml')!
    expect(malformedFile.parsingStatus).toBe('malformed')
    expect(malformedFile.warnings.length).toBeGreaterThan(0)
    expect(artifact.valueDefinitions).toEqual([])
    expect(artifact.warnings.length).toBeGreaterThan(0)
  })

  it('reports detected: false for an Android module with zero resource directories', () => {
    const { artifact } = buildForFixture(join(FIXTURES_ROOT, 'no-resources-app'))
    expect(artifact.detected).toBe(false)
    expect(artifact.resourceFiles).toEqual([])
  })

  it('does not produce misleading resource evidence for a non-Android Gradle project', () => {
    const { artifact } = buildForFixture(join(GRADLE_FIXTURES_ROOT, 'non-android-gradle-project'))
    expect(artifact.detected).toBe(false)
    expect(artifact.resourceDirectories).toEqual([])
  })

  it('produces deterministic, byte-identical output across repeated runs against the same fixture', () => {
    const first = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    const second = buildForFixture(join(FIXTURES_ROOT, 'basic-app'))
    expect(first.artifact).toEqual(second.artifact)
    expect(first.evidenceFingerprint).toBe(second.evidenceFingerprint)
  })
})
