import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkDocumentationPreservation,
  type DocumentContents,
  type PreservationManifest,
} from '../../src/docsCheck/checkDocumentationPreservation.js'

const repoRoot = path.resolve(__dirname, '..', '..')

function loadManifest(): PreservationManifest {
  const manifestPath = path.join(repoRoot, 'docs', 'documentation-preservation-manifest.json')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PreservationManifest
}

function loadRealDocuments(manifest: PreservationManifest): DocumentContents {
  const paths = [
    manifest.roadmap.path,
    manifest.readme.path,
    manifest.projectOverview.path,
    ...manifest.architecture.paths,
    manifest.commands.path,
    manifest.workflows.path,
    manifest.release.path,
    manifest.changelog.path,
    manifest.security.path,
  ]
  const documents: DocumentContents = {}
  for (const docPath of paths) {
    documents[docPath] = fs.readFileSync(path.join(repoRoot, docPath), 'utf8')
  }
  return documents
}

describe('documentation preservation checker', () => {
  const manifest = loadManifest()
  const realDocuments = loadRealDocuments(manifest)

  it('passes against the actual current repository documentation', () => {
    const violations = checkDocumentationPreservation(manifest, realDocuments)
    expect(violations).toEqual([])
  })

  it('passes when a legitimate wording change preserves structure', () => {
    const mutated: DocumentContents = {
      ...realDocuments,
      [manifest.readme.path]: realDocuments[manifest.readme.path].replace(
        'Everything runs locally.',
        'Everything runs entirely on your machine, locally.',
      ),
    }
    const violations = checkDocumentationPreservation(manifest, mutated)
    expect(violations).toEqual([])
  })

  describe('roadmap preservation', () => {
    it('fails when a version heading is removed', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.roadmap.path]: realDocuments[manifest.roadmap.path].replace(
          '## Version 1.11.0',
          '## Version 1-point-11-point-0-removed-for-test',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'roadmap-version-present')).toBe(true)
    })

    it('fails when individual versions are replaced by a version range', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.roadmap.path]: realDocuments[manifest.roadmap.path]
          .replace('## Version 1.10.0', '## Version 1.10.0-1.13.0')
          .concat('\n\nv1.10.0-1.13.0'),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(
        violations.some(
          (v) => v.rule === 'roadmap-version-present' || v.rule === 'roadmap-no-version-ranges',
        ),
      ).toBe(true)
    })

    it('fails when versions are reordered before an established predecessor', () => {
      const content = realDocuments[manifest.roadmap.path]
      const v9Start = content.indexOf('## Version 1.9.0')
      const v10Start = content.indexOf('## Version 1.10.0')
      const v11Start = content.indexOf('## Version 1.11.0')
      const reordered =
        content.slice(0, v9Start) +
        content.slice(v10Start, v11Start) +
        content.slice(v9Start, v10Start) +
        content.slice(v11Start)
      const violations = checkDocumentationPreservation(manifest, {
        ...realDocuments,
        [manifest.roadmap.path]: reordered,
      })
      expect(violations.some((v) => v.rule === 'roadmap-version-order')).toBe(true)
    })

    it('fails when the product-direction / structural sections are deleted', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.roadmap.path]: realDocuments[manifest.roadmap.path].replace(
          '## Product principles',
          '## Removed for test',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'roadmap-structural-section')).toBe(true)
    })

    it('fails when Android scope bleeds from one version into an adjacent one', () => {
      const content = realDocuments[manifest.roadmap.path]
      const v10Start = content.indexOf('## Version 1.10.0')
      const v11Start = content.indexOf('## Version 1.11.0')
      const v10Section = content.slice(v10Start, v11Start)
      const strippedV10 = v10Section.replace(/Gradle/g, 'REDACTED').replace(/manifest/gi, 'REDACTED')
      const mutated = content.slice(0, v10Start) + strippedV10 + content.slice(v11Start)
      const violations = checkDocumentationPreservation(manifest, {
        ...realDocuments,
        [manifest.roadmap.path]: mutated,
      })
      expect(violations.some((v) => v.rule === 'roadmap-android-scope')).toBe(true)
    })
  })

  describe('cross-document preservation', () => {
    it('fails when a README pillar is deleted', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.readme.path]: realDocuments[manifest.readme.path].replace(
          '## Design boundaries',
          '## Removed for test',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'readme-pillar-present')).toBe(true)
    })

    it('fails when an architecture subsystem is deleted from all owning documents', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.architecture.paths[0]]: realDocuments[manifest.architecture.paths[0]].replace(
          /Android detection layer/g,
          'Removed for test',
        ),
      }
      // GRAPH_SCHEMA.md does not mention "Android detection layer" either, so this should fail.
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'architecture-domain-present')).toBe(true)
    })

    it('fails when an implemented command family is deleted', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.commands.path]: realDocuments[manifest.commands.path].replace(
          /`graph-diff`/g,
          '`removed-for-test`',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'command-family-present')).toBe(true)
    })

    it('fails when a workflow family is deleted', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.workflows.path]: realDocuments[manifest.workflows.path].replace(
          /graph-diff/g,
          'removed-for-test',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'workflow-family-present')).toBe(true)
    })

    it('fails when a published CHANGELOG entry is deleted', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.changelog.path]: realDocuments[manifest.changelog.path].replace(
          '## 1.7.0',
          '## v1-point-7-point-0-removed-for-test',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'changelog-version-present')).toBe(true)
    })

    it('fails when the release safety gate is removed', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.release.path]: realDocuments[manifest.release.path].replace(
          /explicitly authorized the publish step\.?/,
          '',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'release-safety-gate-present')).toBe(true)
    })

    it('fails when a security boundary note is removed', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.security.path]: realDocuments[manifest.security.path].replace(
          'Android, Kotlin, and Java security notes',
          'Removed for test',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      expect(violations.some((v) => v.rule === 'security-boundary-present')).toBe(true)
    })

    it('fails with an actionable error identifying document, rule, expected, actual, and a fix', () => {
      const mutated: DocumentContents = {
        ...realDocuments,
        [manifest.readme.path]: realDocuments[manifest.readme.path].replace(
          '## Bug reports',
          '## Removed for test',
        ),
      }
      const violations = checkDocumentationPreservation(manifest, mutated)
      const violation = violations.find((v) => v.rule === 'readme-pillar-present')
      expect(violation).toBeDefined()
      expect(violation!.document).toBe(manifest.readme.path)
      expect(violation!.expected.length).toBeGreaterThan(0)
      expect(violation!.actual.length).toBeGreaterThan(0)
      expect(violation!.recommendation.length).toBeGreaterThan(0)
    })
  })

  describe('missing document handling', () => {
    it('fails clearly when a required document is entirely absent', () => {
      const withoutRoadmap: DocumentContents = { ...realDocuments }
      delete withoutRoadmap[manifest.roadmap.path]
      const violations = checkDocumentationPreservation(manifest, withoutRoadmap)
      const violation = violations.find(
        (v) => v.document === manifest.roadmap.path && v.actual === 'document not found',
      )
      expect(violation).toBeDefined()
    })
  })
})
