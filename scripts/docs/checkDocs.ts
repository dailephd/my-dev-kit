import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkDocumentationPreservation,
  type DocumentContents,
  type PreservationManifest,
} from '../../src/docsCheck/checkDocumentationPreservation.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')

function readIfExists(relativePath: string): string | undefined {
  const absolute = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolute)) return undefined
  return fs.readFileSync(absolute, 'utf8')
}

function collectDocumentPaths(manifest: PreservationManifest): string[] {
  return [
    ...new Set([
      manifest.roadmap.path,
      manifest.readme.path,
      manifest.projectOverview.path,
      ...manifest.architecture.paths,
      ...manifest.artifacts.paths,
      manifest.commands.path,
      manifest.workflows.path,
      ...Object.keys(manifest.statusBoundaries.documentKeywords),
      ...manifest.statusBoundaries.boundaryPaths,
      manifest.release.path,
      manifest.changelog.path,
      manifest.security.path,
    ]),
  ]
}

function main(): void {
  const manifestPath = path.join(repoRoot, 'docs', 'documentation-preservation-manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PreservationManifest

  const documents: DocumentContents = {}
  for (const docPath of collectDocumentPaths(manifest)) {
    const content = readIfExists(docPath)
    if (content !== undefined) documents[docPath] = content
  }

  const violations = checkDocumentationPreservation(manifest, documents)

  if (violations.length === 0) {
    console.log('docs:check passed — no documentation-preservation violations found.')
    return
  }

  console.error(`docs:check found ${violations.length} documentation-preservation violation(s):\n`)
  for (const v of violations) {
    console.error(`[${v.rule}] ${v.document}`)
    console.error(`  expected: ${v.expected}`)
    console.error(`  actual:   ${v.actual}`)
    console.error(`  fix:      ${v.recommendation}\n`)
  }
  process.exitCode = 1
}

main()
