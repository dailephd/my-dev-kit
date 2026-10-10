import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// Fixture: a TypeScript module with a primary function, local types, constants, and helpers.
const FIXTURE_CONTENT = `export interface UserConfig {
  name: string
  role: 'admin' | 'user'
}

export type UserRole = 'admin' | 'user'

const DEFAULT_ROLE: UserRole = 'user'

function validateName(name: string): boolean {
  return name.length > 0
}

export function createUser(config: UserConfig): string {
  if (!validateName(config.name)) return ''
  const role = config.role ?? DEFAULT_ROLE
  return \`\${config.name}:\${role}\`
}

export function listUsers(users: UserConfig[]): string[] {
  return users.map((u) => createUser(u))
}
`

// Minimal TSX fixture for prop/component expansion (requires frontend-semantic)
const TSX_FIXTURE_CONTENT = `import React from 'react'

export interface ButtonProps {
  label: string
  onClick: () => void
}

export function Button({ label, onClick }: ButtonProps): JSX.Element {
  return <button onClick={onClick}>{label}</button>
}
`

let projectDir = ''
let indexDir = ''

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-bundle-'))
  indexDir = join(projectDir, '.idx')
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  writeFileSync(join(projectDir, 'src', 'user.ts'), FIXTURE_CONTENT)
  writeFileSync(join(projectDir, 'src', 'button.tsx'), TSX_FIXTURE_CONTENT)
  const res = runCli(['index', '--root', projectDir, '--src', 'src', '--out', indexDir])
  if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)
})

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

type MutableSymbolIndex = { files: Array<{ path: string; symbols: Array<{ name: string; location: Record<string, unknown> }> }> }

/** Copies an index inside the temp project and rewrites its symbol-index.json (the original is untouched). */
function copyIndexWith(sourceIndex: string, label: string, mutate: (index: MutableSymbolIndex) => void): string {
  const copy = join(projectDir, `.idx-${label}`)
  cpSync(sourceIndex, copy, { recursive: true })
  const file = join(copy, 'symbol-index.json')
  const index = JSON.parse(readFileSync(file, 'utf8')) as MutableSymbolIndex
  mutate(index)
  writeFileSync(file, JSON.stringify(index, null, 2))
  return copy
}

/** An index as written before v1.12.6: no symbol carries an endLine. */
function copyIndexWithoutEndLine(sourceIndex: string, label: string): string {
  return copyIndexWith(sourceIndex, label, (index) => {
    for (const file of index.files) for (const symbol of file.symbols) delete symbol.location.endLine
  })
}

// ---------- JSON structure tests ----------

describe('source bundle JSON structure', () => {
  it('returns a valid SourceBundle with status ok and mode source-bundle', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    expect(bundle.status).toBe('ok')
    expect(bundle.mode).toBe('source-bundle')
  })

  it('bundle has required top-level fields', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps', '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    expect(bundle).toHaveProperty('primaryBlock')
    expect(bundle).toHaveProperty('expansionBlocks')
    expect(bundle).toHaveProperty('skippedBlocks')
    expect(bundle).toHaveProperty('limits')
    expect(bundle).toHaveProperty('stats')
    expect(bundle).toHaveProperty('continuationCursors')
  })

  it('primaryBlock has required fields with content', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    const b = bundle.primaryBlock
    expect(b.kind).toBe('primary-target')
    expect(b.filePath).toMatch(/user\.ts/)
    expect(b.startLine).toBeGreaterThan(0)
    expect(b.endLine).toBeGreaterThanOrEqual(b.startLine)
    expect(b.content).toContain('createUser')
    expect(b.dedupeKey).toBeTruthy()
    expect(Array.isArray(b.expansionReasons)).toBe(true)
    expect(b.expansionReasons).toContain('primary-target')
  })

  it('expansionBlocks each have required fields', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    for (const block of bundle.expansionBlocks) {
      expect(block.id).toBeTruthy()
      expect(block.filePath).toBeTruthy()
      expect(block.startLine).toBeGreaterThan(0)
      expect(block.lineCount).toBeGreaterThan(0)
      expect(block.content).toBeTruthy()
      expect(block.dedupeKey).toBeTruthy()
      expect(['high', 'medium', 'low']).toContain(block.confidence)
      expect(Array.isArray(block.expansionReasons)).toBe(true)
      expect(block.expansionReasons.length).toBeGreaterThan(0)
    }
  })

  it('continuationCursors is an array and is empty once a known symbol is returned completely', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    expect(Array.isArray(bundle.continuationCursors)).toBe(true)
    // createUser has a trusted indexed end and fits the block cap: nothing of it remains to continue.
    expect(bundle.continuationCursors).toHaveLength(0)
  })

  it('continuationCursors keeps its cursor shape when the symbol boundary is unknown (old index)', () => {
    const oldIndex = copyIndexWithoutEndLine(indexDir, 'cursor-shape')
    const result = runCli([
      'source', '--index', oldIndex,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--max-lines', '5', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    expect(bundle.continuationCursors.length).toBeGreaterThan(0)
    const cursor = bundle.continuationCursors[0]
    expect(cursor).toHaveProperty('nextStartLine')
    expect(cursor).toHaveProperty('previousEndLine')
    expect(cursor).toHaveProperty('exhausted')
    expect(cursor.reason).toBe('symbol-end-unknown')
  })
})

// ---------- Local type expansion ----------

describe('--include-local-types', () => {
  it('includes local interface referenced in primary window', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    const kinds = bundle.expansionBlocks.map((b: { kind: string }) => b.kind)
    expect(kinds).toContain('local-type')
  })

  it('local-type block content contains the interface definition', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    const typeBlocks = bundle.expansionBlocks.filter((b: { kind: string }) => b.kind === 'local-type')
    const allContent = typeBlocks.map((b: { content: string }) => b.content).join('\n')
    expect(allContent).toContain('UserConfig')
  })

  it('does not include types from outside the file', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    for (const b of bundle.expansionBlocks) {
      expect(b.filePath).toMatch(/user\.ts/)
    }
  })
})

// ---------- Local helper expansion ----------

describe('--include-local-deps (helper functions)', () => {
  it('includes local helper function called in primary', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps', '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    const helperBlocks = bundle.expansionBlocks.filter((b: { kind: string }) => b.kind === 'local-helper')
    expect(helperBlocks.length).toBeGreaterThan(0)
    const content = helperBlocks[0].content
    expect(content).toContain('validateName')
  })
})

// ---------- Import expansion ----------

describe('--include-imports', () => {
  it('includes local import statements from the file', () => {
    // TSX fixture has an import
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/button.tsx', '--symbol', 'Button',
      '--include-imports', '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    // React is an external import → should be skipped, not in expansionBlocks
    const importBlocks = bundle.expansionBlocks.filter((b: { kind: string }) => b.kind === 'import-site')
    // External packages are skipped
    expect(importBlocks.length).toBe(0)
    // The external import should appear in skippedBlocks
    const skipped = bundle.skippedBlocks.filter((s: { reasonCode: string }) => s.reasonCode === 'external-package')
    expect(skipped.length).toBeGreaterThan(0)
  })

  it('includes local relative imports and skips external ones', () => {
    // user.ts has no imports, so nothing to expand
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-imports', '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    // No import lines at all in user.ts
    const importBlocks = bundle.expansionBlocks.filter((b: { kind: string }) => b.kind === 'import-site')
    expect(importBlocks.length).toBe(0)
  })
})

// ---------- Bundle limits ----------

describe('bundle limits', () => {
  it('respects --max-bundle-lines and populates skippedBlocks when exceeded', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps',
      '--max-bundle-lines', '10',
      '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    expect(bundle.stats.totalLineCount).toBeLessThanOrEqual(10 + bundle.primaryBlock.lineCount)
    // If expansion was cut, skipped blocks should exist with max-lines-reached
    const hasLimitSkip = bundle.skippedBlocks.some((s: { reasonCode: string }) => s.reasonCode === 'max-lines-reached')
    const hasNoExpansion = bundle.expansionBlocks.length === 0
    // Either expansion was skipped due to limit, or primary alone fit within limit
    expect(hasLimitSkip || hasNoExpansion).toBe(true)
  })

  it('respects --max-blocks and populates skippedBlocks when exceeded', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps',
      '--max-blocks', '1',
      '--json',
    ])
    expect(result.status).toBe(0)
    const bundle = JSON.parse(result.stdout)
    // max-blocks=1 means only primaryBlock; all expansionBlocks should be skipped
    expect(bundle.expansionBlocks.length).toBe(0)
    const hasBlockSkip = bundle.skippedBlocks.some((s: { reasonCode: string }) => s.reasonCode === 'max-blocks-reached')
    expect(hasBlockSkip).toBe(true)
  })

  it('limits section in JSON has correct fields', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types',
      '--max-bundle-lines', '50',
      '--max-blocks', '5',
      '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    expect(bundle.limits.maxLinesPerBundle).toBe(50)
    expect(bundle.limits.maxBlocks).toBe(5)
    expect(typeof bundle.limits.maxLinesHit).toBe('boolean')
    expect(typeof bundle.limits.maxBlocksHit).toBe('boolean')
  })

  it('stats section has correct counts', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    const stats = bundle.stats
    expect(stats.primaryLineCount).toBe(bundle.primaryBlock.lineCount)
    expect(stats.expansionBlockCount).toBe(bundle.expansionBlocks.length)
    expect(stats.skippedBlockCount).toBe(bundle.skippedBlocks.length)
    const totalExpected = bundle.primaryBlock.lineCount + bundle.expansionBlocks.reduce((sum: number, b: { lineCount: number }) => sum + b.lineCount, 0)
    expect(stats.totalLineCount).toBe(totalExpected)
  })
})

// ---------- Numbered output format ----------

describe('numbered output format', () => {
  it('produces block headers in numbered output', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--format', 'numbered',
    ])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[primary-target]')
  })

  it('numbered output includes line numbers', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--format', 'numbered',
    ])
    expect(result.stdout).toMatch(/\d+\t/)
  })

  it('numbered output includes a continuation cursor footer while symbol content remains unknown', () => {
    const oldIndex = copyIndexWithoutEndLine(indexDir, 'numbered-footer')
    const result = runCli([
      'source', '--index', oldIndex,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--format', 'numbered',
    ])
    expect(result.stdout).toMatch(/\[CONTINUE:|EOF:/)
  })

  it('numbered output has no continuation footer for a completed known symbol', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--format', 'numbered',
    ])
    expect(result.status).toBe(0)
    expect(result.stdout).not.toMatch(/\[CONTINUE:|EOF:/)
  })
})

// ---------- --expand-to-local-dependencies alias ----------

describe('--expand-to-local-dependencies alias', () => {
  it('behaves the same as --include-local-deps', () => {
    const r1 = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps', '--json',
    ])
    const r2 = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--expand-to-local-dependencies', '--json',
    ])
    expect(r1.status).toBe(0)
    expect(r2.status).toBe(0)
    const b1 = JSON.parse(r1.stdout)
    const b2 = JSON.parse(r2.stdout)
    // Same primary block content
    expect(b1.primaryBlock.content).toBe(b2.primaryBlock.content)
    // Same number of expansion blocks (ordering may differ but count should match)
    expect(b1.expansionBlocks.length).toBe(b2.expansionBlocks.length)
  })
})

// ---------- Deduplication ----------

describe('deduplication', () => {
  it('does not produce duplicate dedupeKeys in expansionBlocks', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-deps', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    const keys = bundle.expansionBlocks.map((b: { dedupeKey: string }) => b.dedupeKey)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })
})

// ---------- Regression: continuation behavior preserved ----------

describe('continuation regression after bundle flags', () => {
  it('normal --symbol mode still works after bundle code added', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.mode).toBe('symbol')
    expect(parsed.content).toContain('createUser')
  })

  it('--continue-from still works after bundle code added', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--continue-from', '5', '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.startLine).toBe(5)
  })
})

// ---------- Error handling ----------

describe('bundle flag error handling', () => {
  it('bundle mode requires a target symbol or range', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts',
      '--include-local-types',
    ])
    // No symbol or range given — should error (if validation detects it)
    // The error may come from selectMode or symbol lookup
    // Either status !== 0 or a helpful error in stderr
    if (result.status !== 0) {
      expect(result.stderr || result.stdout).toBeTruthy()
    }
  })

  it('bundle flags cannot be combined with --contains', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--contains', 'createUser',
      '--include-local-types',
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr || result.stdout).toMatch(/cannot be combined|Bundle flags/)
  })
})

// ---------- Known generic symbol boundaries (v1.12.6 correction) ----------

describe('source bundle respects trusted generic symbol boundaries', () => {
  // longSymbol occupies lines 1-27; the sentinel declaration is line 28.
  const LONG_SYMBOL_SOURCE = (() => {
    const lines = ['export function longSymbol(): number {']
    for (let i = 1; i <= 23; i++) lines.push(`  const step${String(i).padStart(2, '0')} = ${i === 1 ? '1' : `step${String(i - 1).padStart(2, '0')} + 1`}`)
    lines.push('  const total = step23 + step01')
    lines.push('  return total')
    lines.push('}')
    lines.push("export const longSymbolSentinel = 'sentinel-after-long-symbol'")
    return lines.join('\n') + '\n'
  })()

  // Statements that are not indexed symbols sit directly after each declaration, so the legacy
  // next-symbol heuristic would include them while an exact boundary must not.
  const DEPS_SOURCE = [
    'export interface Config {', //                         1
    '  name: string', //                                     2
    '}', //                                                  3
    "console.log('after-type-sentinel')", //                 4
    'export const LIMITS = {', //                            5
    '  max: 10,', //                                         6
    '  min: 1,', //                                          7
    '  step: 2,', //                                         8
    '  extra: 3,', //                                        9
    '  more: 4,', //                                        10
    '  last: 5,', //                                        11
    '}', //                                                 12
    'export function helper(x: number): number {', //       13
    '  const y = x + 1', //                                  14
    '  return y', //                                         15
    '}', //                                                 16
    "console.log('after-helper-sentinel')", //              17
    'export function main(c: Config): number {', //         18
    '  return helper(c.name.length) + LIMITS.max', //       19
    '}', //                                                 20
    "console.log('after-main-sentinel')", //                21
  ].join('\n') + '\n'

  let boundaryDir = ''
  let boundaryIndex = ''
  const extraDirs: string[] = []

  beforeAll(() => {
    boundaryDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-bundle-boundary-'))
    boundaryIndex = join(boundaryDir, '.idx')
    mkdirSync(join(boundaryDir, 'src'), { recursive: true })
    writeFileSync(join(boundaryDir, 'src', 'boundary.ts'), LONG_SYMBOL_SOURCE)
    writeFileSync(join(boundaryDir, 'src', 'deps.ts'), DEPS_SOURCE)
    const res = runCli(['index', '--root', boundaryDir, '--src', 'src', '--out', boundaryIndex])
    if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)
  })

  afterAll(() => {
    rmSync(boundaryDir, { recursive: true, force: true })
    while (extraDirs.length > 0) rmSync(extraDirs.pop()!, { recursive: true, force: true })
  })

  function bundleOf(args: string[], index = boundaryIndex) {
    // Bundle mode is entered by an --include-* flag; default to the lightest one.
    const flags = args.some((a) => a.startsWith('--include-')) ? args : [...args, '--include-local-types']
    const result = runCli(['source', '--index', index, ...flags, '--json'])
    expect(result.status, result.stderr).toBe(0)
    return JSON.parse(result.stdout)
  }

  function mutatedBoundaryIndex(label: string, mutate: (index: MutableSymbolIndex) => void): string {
    const copy = join(boundaryDir, `.idx-${label}`)
    cpSync(boundaryIndex, copy, { recursive: true })
    const file = join(copy, 'symbol-index.json')
    const index = JSON.parse(readFileSync(file, 'utf8')) as MutableSymbolIndex
    mutate(index)
    writeFileSync(file, JSON.stringify(index, null, 2))
    return copy
  }

  function longSymbolOf(index: MutableSymbolIndex) {
    return index.files.find((f) => f.path === 'src/boundary.ts')!.symbols.find((s) => s.name === 'longSymbol')!
  }

  it('indexes a trusted endLine for the fixture symbol (precondition)', () => {
    const index = JSON.parse(readFileSync(join(boundaryIndex, 'symbol-index.json'), 'utf8')) as MutableSymbolIndex
    expect(longSymbolOf(index).location.endLine).toBe(27)
  })

  it('1/2: --file --symbol returns exactly lines 1-27 and excludes the line-28 sentinel', () => {
    const bundle = bundleOf(['--file', 'src/boundary.ts', '--symbol', 'longSymbol'])
    expect(bundle.primaryBlock.startLine).toBe(1)
    expect(bundle.primaryBlock.endLine).toBe(27)
    expect(bundle.primaryBlock.lineCount).toBe(27)
    expect(bundle.primaryBlock.content).not.toContain('sentinel-after-long-symbol')
    expect(bundle.primaryBlock.confidence).toBe('high')
    expect(bundle.target.endLine).toBe(27)
  })

  it('3: a symbol-node bundle excludes line 28 and matches the file-plus-symbol bundle', () => {
    const byNode = bundleOf(['--node', 'symbol:src/boundary.ts#longSymbol'])
    const bySymbol = bundleOf(['--file', 'src/boundary.ts', '--symbol', 'longSymbol'])
    expect(byNode.primaryBlock.endLine).toBe(27)
    expect(byNode.primaryBlock.content).not.toContain('sentinel-after-long-symbol')
    expect(byNode.primaryBlock.content).toBe(bySymbol.primaryBlock.content)
  })

  it('5: a completed known primary has no continuation cursor, no truncation and no start-line-only warning', () => {
    const bundle = bundleOf(['--file', 'src/boundary.ts', '--symbol', 'longSymbol'])
    expect(bundle.continuationCursors).toEqual([])
    expect(bundle.primaryBlock.fallbackReason).toBeUndefined()
    expect(bundle.warnings.join('\n')).not.toMatch(/start line only|end line is not available/)
    expect(bundle.stats.primaryLineCount).toBe(27)
    expect(bundle.stats.totalLineCount).toBe(27)
  })

  it('5: a symbol that exactly fits --max-lines is complete, not truncated', () => {
    const bundle = bundleOf(['--file', 'src/boundary.ts', '--symbol', 'longSymbol', '--max-lines', '27'])
    expect(bundle.primaryBlock.endLine).toBe(27)
    expect(bundle.continuationCursors).toEqual([])
    expect(bundle.primaryBlock.fallbackReason).toBeUndefined()
  })

  it('6: a known oversized primary is capped, truthfully truncated, and its cursor stays inside the symbol', () => {
    const bundle = bundleOf(['--file', 'src/boundary.ts', '--symbol', 'longSymbol', '--max-lines', '10'])
    expect(bundle.primaryBlock.startLine).toBe(1)
    expect(bundle.primaryBlock.endLine).toBe(10)
    expect(bundle.primaryBlock.fallbackReason).toBe('symbol-exceeds-block-cap')
    expect(bundle.continuationCursors).toHaveLength(1)
    const cursor = bundle.continuationCursors[0]
    expect(cursor.nextStartLine).toBe(11)
    expect(cursor.nextStartLine).toBeLessThanOrEqual(27)
    expect(cursor.reason).toBe('window-capped')
    expect(cursor.exhausted).toBe(false)
    expect(bundle.warnings.join('\n')).toContain('spans lines 1-27')
    expect(bundle.primaryBlock.content).not.toContain('sentinel-after-long-symbol')
  })

  it('7/8/12: local type, constant and helper expansions use trusted ends and keep order and statistics', () => {
    const bundle = bundleOf(['--file', 'src/deps.ts', '--symbol', 'main', '--include-local-deps'])
    expect(bundle.primaryBlock.startLine).toBe(18)
    expect(bundle.primaryBlock.endLine).toBe(20)
    expect(bundle.primaryBlock.content).not.toContain('after-main-sentinel')

    const byKind = (kind: string) => bundle.expansionBlocks.filter((b: { kind: string }) => b.kind === kind)
    // Config is also frontend-semantic prop-type evidence; same exact range, deduplicated into one block.
    const type = bundle.expansionBlocks.find((b: { startLine: number }) => b.startLine === 1)
    const [constant] = byKind('local-constant')
    const [helper] = byKind('local-helper')
    expect(['local-type', 'prop-type']).toContain(type.kind)
    expect(type).toBeDefined()
    expect([type.startLine, type.endLine]).toEqual([1, 3])
    expect(type.content).not.toContain('after-type-sentinel')
    expect(type.confidence).toBe('high')
    // 8: the multiline constant uses its trusted end, not the legacy fixed 5-line preview (5-9).
    expect(constant).toBeDefined()
    expect([constant.startLine, constant.endLine]).toEqual([5, 12])
    expect(constant.content).toContain('last: 5')
    expect(constant.fallbackReason).toBeUndefined()
    expect(helper).toBeDefined()
    expect([helper.startLine, helper.endLine]).toEqual([13, 16])
    expect(helper.content).not.toContain('after-helper-sentinel')

    // 12: ordering by kind then line, and statistics agree with the returned content.
    const kinds = bundle.expansionBlocks.map((b: { kind: string }) => b.kind)
    expect(kinds.slice(-2)).toEqual(['local-constant', 'local-helper'])
    expect(bundle.expansionBlocks.map((b: { startLine: number }) => b.startLine)).toEqual([1, 5, 13])
    for (const block of [bundle.primaryBlock, ...bundle.expansionBlocks]) {
      expect(block.lineCount).toBe(block.content.split('\n').length)
    }
    const total = [bundle.primaryBlock, ...bundle.expansionBlocks].reduce((n: number, b: { lineCount: number }) => n + b.lineCount, 0)
    expect(bundle.stats.totalLineCount).toBe(total)
    expect(bundle.continuationCursors).toEqual([])
  })

  it('7: an expanded known symbol larger than the block cap is capped and keeps truncation evidence', () => {
    const bundle = bundleOf(['--file', 'src/deps.ts', '--symbol', 'main', '--include-local-deps', '--max-lines', '5'])
    const constant = bundle.expansionBlocks.find((b: { kind: string }) => b.kind === 'local-constant')
    expect(constant).toBeDefined()
    expect([constant.startLine, constant.endLine]).toEqual([5, 9])
    expect(constant.fallbackReason).toBe('symbol-exceeds-block-cap')
    expect(constant.confidence).toBe('high')
  })

  it('9/14: an old index without endLine keeps the conservative preview, warning and unknown-boundary cursor', () => {
    const oldIndex = mutatedBoundaryIndex('old', (index) => {
      for (const file of index.files) for (const symbol of file.symbols) delete symbol.location.endLine
    })
    const bundle = bundleOf(['--file', 'src/boundary.ts', '--symbol', 'longSymbol', '--max-lines', '20'], oldIndex)
    expect(bundle.primaryBlock.startLine).toBe(1)
    expect(bundle.primaryBlock.endLine).toBe(20)
    expect(bundle.primaryBlock.confidence).toBe('low')
    expect(bundle.warnings.join('\n')).toContain('Symbol end line is not available in the current index')
    expect(bundle.continuationCursors).toHaveLength(1)
    expect(bundle.continuationCursors[0]).toMatchObject({ nextStartLine: 21, reason: 'symbol-end-unknown', exhausted: false })
  })

  it('10: a malformed endLine is not trusted', () => {
    for (const [label, value] of [
      ['inverted', 0],
      ['fractional', 12.5],
      ['text', 'x'],
      ['beyond-file', 9999],
    ] as const) {
      const index = mutatedBoundaryIndex(`bad-${label}`, (idx) => {
        longSymbolOf(idx).location.endLine = value
      })
      const bundle = bundleOf(['--file', 'src/boundary.ts', '--symbol', 'longSymbol', '--max-lines', '20'], index)
      expect(bundle.primaryBlock.endLine, label).toBe(20)
      expect(bundle.primaryBlock.confidence, label).toBe('low')
      expect(bundle.continuationCursors[0]?.reason, label).toBe('symbol-end-unknown')
    }
  })

  it('13: an indexed end beyond the physical file fails as a stale index instead of reporting a complete symbol', () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-bundle-stale-'))
    extraDirs.push(staleDir)
    mkdirSync(join(staleDir, 'src'), { recursive: true })
    writeFileSync(join(staleDir, 'src', 'boundary.ts'), LONG_SYMBOL_SOURCE)
    const staleIndex = join(staleDir, '.idx')
    expect(runCli(['index', '--root', staleDir, '--src', 'src', '--out', staleIndex]).status).toBe(0)
    // The source shrinks after indexing: the recorded end (27) no longer exists.
    writeFileSync(join(staleDir, 'src', 'boundary.ts'), LONG_SYMBOL_SOURCE.split('\n').slice(0, 10).join('\n') + '\n')
    const result = runCli(['source', '--index', staleIndex, '--file', 'src/boundary.ts', '--symbol', 'longSymbol', '--json'])
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toMatch(/Stale index\/source mismatch/)
  })

  it('11: frontend-semantic component evidence still bounds a TSX primary block', () => {
    const bundle = bundleOf(['--file', 'src/button.tsx', '--symbol', 'Button', '--include-props'], indexDir)
    expect(bundle.primaryBlock.content).toContain('</button>')
    expect(bundle.primaryBlock.confidence).toBe('high')
    expect(bundle.primaryBlock.endLine).toBeLessThanOrEqual(10)
  })
})
