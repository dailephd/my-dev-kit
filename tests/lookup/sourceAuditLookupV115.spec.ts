import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import {
  getSourceAuditFilePage,
  getSourceAuditInventoryPage,
  readSourceAuditEvidence,
  SourceAuditEvidenceError,
} from '../../src/lookup/readSourceAuditEvidence.js'
import { AUDIT_FACT_PAGE_SIZE, AUDIT_INVENTORY_PAGE_SIZE } from '../../src/symbol-index/auditEvidenceTypes.js'
import { validateSourceAuditFilePage, validateSourceAuditInventoryPage } from '../../src/symbol-index/validateAuditEvidence.js'
import { runCli } from './testCli.js'

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-lookup-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(root, rel), content)
  return root
}
async function build(root: string): Promise<string> {
  const out = join(root, 'out')
  await runIndexCommand({ root, src: ['src'], out })
  return out
}
const constants = (count: number): string => Array.from({ length: count }, (_, i) => `export const c${String(i).padStart(3, '0')} = ${i}`).join('\n') + '\n'
const hashTree = (dir: string): Record<string, string> =>
  Object.fromEntries(readdirSync(dir).sort().map((name) => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]))
const error = (action: () => unknown): SourceAuditEvidenceError => {
  try {
    action()
  } catch (caught) {
    return caught as SourceAuditEvidenceError
  }
  throw new Error('expected an error')
}

describe('v1.15.0 Batch 4 inventory pagination', () => {
  let out = ''
  beforeAll(async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 65; i++) files[`src/f${String(i).padStart(3, '0')}.ts`] = `export const v${i} = ${i}\n`
    out = await build(makeProject(files))
  })

  it('splits 65 files into a 64-file page and a one-file terminal page under one snapshot', () => {
    const artifact = readSourceAuditEvidence(out)
    const first = getSourceAuditInventoryPage(artifact, 0)
    const second = getSourceAuditInventoryPage(artifact, 1)
    expect(AUDIT_INVENTORY_PAGE_SIZE).toBe(64)
    expect(first).toMatchObject({ mode: 'audit-files', pageIndex: 0, pageSize: 64, totalItems: 65, totalPages: 2, nextPageIndex: 1 })
    expect(first.files).toHaveLength(64)
    expect(second).toMatchObject({ pageIndex: 1, nextPageIndex: null })
    expect(second.files).toHaveLength(1)
    expect(second.snapshotId).toBe(first.snapshotId)
    expect(first.snapshotId).toBe(artifact.source.snapshotId)
    const paths = [...first.files, ...second.files].map((file) => file.path)
    expect(paths).toEqual([...paths].sort())
    expect(new Set(paths).size).toBe(65)
    expect(first.files[0]).not.toHaveProperty('facts')
    expect(first.files[0]).not.toHaveProperty('diagnostics')
    expect(first.files[0]).toMatchObject({ language: 'typescript', status: 'parsed' })
    expect(() => validateSourceAuditInventoryPage(first)).not.toThrow()
  })

  it('has exactly one page for exactly 64 files and rejects beyond-terminal and invalid pages', () => {
    const artifact = readSourceAuditEvidence(out)
    const sixtyFour = { ...artifact, files: artifact.files.slice(0, 64), coverage: { ...artifact.coverage, selectedFileCount: 64, recordedFileCount: 64 } }
    expect(getSourceAuditInventoryPage(sixtyFour, 0)).toMatchObject({ totalPages: 1, nextPageIndex: null })
    expect(error(() => getSourceAuditInventoryPage(artifact, 2)).code).toBe('INVALID_AUDIT_PAGE')
    expect(error(() => getSourceAuditInventoryPage(artifact, -1)).code).toBe('INVALID_AUDIT_PAGE')
    expect(error(() => getSourceAuditInventoryPage(artifact, 0.5)).code).toBe('INVALID_AUDIT_PAGE')
  })

  it('returns one terminal empty page for an empty inventory', () => {
    const artifact = readSourceAuditEvidence(out)
    const empty = { ...artifact, files: [], coverage: { ...artifact.coverage, selectedFileCount: 0, recordedFileCount: 0 } }
    expect(getSourceAuditInventoryPage(empty, 0)).toMatchObject({ pageIndex: 0, totalItems: 0, totalPages: 1, nextPageIndex: null, files: [] })
  })
})

describe('v1.15.0 Batch 4 exact-file pagination', () => {
  let out = ''
  beforeAll(async () => {
    out = await build(makeProject({ 'src/exact128.ts': constants(64), 'src/over128.ts': constants(65) }))
  })

  it('returns exactly 128 facts in one page and 129+ facts in two stable pages', () => {
    const artifact = readSourceAuditEvidence(out)
    expect(AUDIT_FACT_PAGE_SIZE).toBe(128)
    const exact = artifact.files.find((file) => file.path === 'src/exact128.ts')!
    const over = artifact.files.find((file) => file.path === 'src/over128.ts')!
    expect(exact.facts.length).toBe(128)
    expect(over.facts.length).toBeGreaterThan(128)
    const onlyPage = getSourceAuditFilePage(artifact, 'src/exact128.ts', 0)
    expect(onlyPage).toMatchObject({ status: 'found', totalPages: 1, nextPageIndex: null })
    expect(onlyPage.facts).toHaveLength(128)
    const first = getSourceAuditFilePage(artifact, 'src/over128.ts', 0)
    const second = getSourceAuditFilePage(artifact, 'src/over128.ts', 1)
    expect(first).toMatchObject({ totalPages: 2, nextPageIndex: 1, pageSize: 128 })
    expect(first.facts).toHaveLength(128)
    expect(second.nextPageIndex).toBeNull()
    expect([...first.facts, ...second.facts].map((fact) => fact.id)).toEqual(over.facts.map((fact) => fact.id))
    expect(second.snapshotId).toBe(first.snapshotId)
    expect(first.file).not.toHaveProperty('facts')
    expect(first.file!.capabilities).toEqual(over.capabilities)
    expect(() => validateSourceAuditFilePage(first)).not.toThrow()
    expect(error(() => getSourceAuditFilePage(artifact, 'src/over128.ts', 2)).code).toBe('INVALID_AUDIT_PAGE')
  })

  it('reports a not-selected path explicitly without claiming it does not exist', () => {
    const artifact = readSourceAuditEvidence(out)
    const page = getSourceAuditFilePage(artifact, 'src/absent.ts', 0)
    expect(page).toMatchObject({ status: 'not-selected', file: null, facts: [], totalItems: 0, totalPages: 1, pageIndex: 0, nextPageIndex: null })
    expect(error(() => getSourceAuditFilePage(artifact, 'src/absent.ts', 1)).code).toBe('INVALID_AUDIT_PAGE')
  })
})

describe('v1.15.0 Batch 4 public lookup command', () => {
  let root = ''
  let out = ''
  beforeAll(async () => {
    root = makeProject({
      'src/a.ts': "export const A_ID = 'alpha'\n",
      'src/marker.ts': `require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'my-dev-kit-v115-must-not-exist'))}, 'x')\n`,
    })
    out = await build(root)
  })

  it('prints the first inventory page and an exact-file page as JSON, and stays read-only', () => {
    const before = hashTree(out)
    const inventory = runCli(['lookup', '--index', out, '--audit-files', '--json'])
    expect(inventory.status).toBe(0)
    const page = JSON.parse(inventory.stdout)
    expect(page).toMatchObject({ mode: 'audit-files', pageIndex: 0, pageSize: 64, totalItems: 2, nextPageIndex: null })
    const file = runCli(['lookup', '--index', out, '--audit-file', 'src/a.ts', '--page', '0', '--json'])
    expect(file.status).toBe(0)
    const filePage = JSON.parse(file.stdout)
    expect(filePage).toMatchObject({ mode: 'audit-file', status: 'found', snapshotId: page.snapshotId })
    expect(filePage.facts.some((fact: { value?: string }) => fact.value === 'alpha')).toBe(true)
    expect(hashTree(out)).toEqual(before)
    expect(existsSync(join(tmpdir(), 'my-dev-kit-v115-must-not-exist'))).toBe(false)
  })

  it('returns not-selected for an unselected path and exit 2 beyond the terminal page', () => {
    const missing = runCli(['lookup', '--index', out, '--audit-file', 'src/none.ts', '--json'])
    expect(missing.status).toBe(0)
    expect(JSON.parse(missing.stdout)).toMatchObject({ status: 'not-selected', file: null })
    const beyond = runCli(['lookup', '--index', out, '--audit-files', '--page', '1', '--json'])
    expect(beyond.status).toBe(2)
    expect(beyond.stderr).toContain('INVALID_AUDIT_PAGE')
  })

  it.each([
    [['--audit-files', '--audit-file', 'src/a.ts', '--json'], 'mutually exclusive'],
    [['--audit-files', '--node', 'x', '--json'], 'cannot be combined'],
    [['--audit-file', 'src/a.ts', '--route', '/x', '--json'], 'cannot be combined'],
    [['--audit-files', '--storage-key', 'k', '--json'], 'cannot be combined'],
    [['--audit-files', '--ui', 'u', '--json'], 'cannot be combined'],
    [['--audit-files', '--android-component', 'C', '--json'], 'cannot be combined'],
    [['--audit-files', '--resolve-classification', '--json'], 'cannot be combined'],
    [['--audit-files'], 'require --json'],
    [['--audit-file', 'src/a.ts'], 'require --json'],
    [['--page', '0', '--json', '--node', 'x'], '--page is valid only'],
    [['--audit-files', '--page', '-1', '--json'], 'nonnegative'],
    [['--audit-files', '--page', 'abc', '--json'], 'integer'],
  ])('rejects invalid selector combination %j with exit code 2', (args, message) => {
    const result = runCli(['lookup', '--index', out, ...args])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(message)
    expect(result.stdout).toBe('')
  })

  it('returns STALE_SOURCE_EVIDENCE for a changed or deleted selected file, never an empty page', () => {
    const changedRoot = makeProject({ 'src/a.ts': "export const A_ID = 'alpha'\n" })
    return build(changedRoot).then((changedOut) => {
      writeFileSync(join(changedRoot, 'src/a.ts'), "export const A_ID = 'beta'\n")
      const changed = runCli(['lookup', '--index', changedOut, '--audit-file', 'src/a.ts', '--json'])
      expect(changed.status).toBe(2)
      expect(changed.stderr).toContain('STALE_SOURCE_EVIDENCE')
      expect(changed.stdout).toBe('')
      rmSync(join(changedRoot, 'src/a.ts'))
      const deleted = runCli(['lookup', '--index', changedOut, '--audit-file', 'src/a.ts', '--json'])
      expect(deleted.status).toBe(2)
      expect(deleted.stderr).toContain('STALE_SOURCE_EVIDENCE')
      // Inventory lookup reports the recorded snapshot; it makes no live-freshness claim.
      expect(runCli(['lookup', '--index', changedOut, '--audit-files', '--json']).status).toBe(0)
    })
  })

  it('reports AUDIT_EVIDENCE_UNAVAILABLE for a legacy index while --node lookup keeps working', () => {
    const manifestPath = join(out, 'manifest.json')
    const original = readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(original)
    const graph = JSON.parse(readFileSync(join(out, 'code-graph.json'), 'utf8'))
    delete manifest.sourceAuditEvidence
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    try {
      const unavailable = runCli(['lookup', '--index', out, '--audit-files', '--json'])
      expect(unavailable.status).toBe(2)
      expect(unavailable.stderr).toContain('AUDIT_EVIDENCE_UNAVAILABLE')
      const node = runCli(['lookup', '--index', out, '--node', graph.nodes[0].id, '--json'])
      expect(node.status).toBe(0)
      expect(JSON.parse(node.stdout).node.id).toBe(graph.nodes[0].id)
    } finally {
      writeFileSync(manifestPath, original)
    }
    expect(statSync(manifestPath).isFile()).toBe(true)
  })

  it('exposes the new selectors in help', () => {
    const help = runCli(['lookup', '--help'])
    expect(help.stdout).toContain('--audit-files')
    expect(help.stdout).toContain('--audit-file <path>')
    expect(help.stdout).toContain('--page <n>')
  })
})
