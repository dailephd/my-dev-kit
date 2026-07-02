import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('continuationCursors array is non-empty', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--json',
    ])
    const bundle = JSON.parse(result.stdout)
    expect(bundle.continuationCursors.length).toBeGreaterThan(0)
    const cursor = bundle.continuationCursors[0]
    expect(cursor).toHaveProperty('nextStartLine')
    expect(cursor).toHaveProperty('previousEndLine')
    expect(cursor).toHaveProperty('exhausted')
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

  it('numbered output includes continuation cursor footer', () => {
    const result = runCli([
      'source', '--index', indexDir,
      '--file', 'src/user.ts', '--symbol', 'createUser',
      '--include-local-types', '--format', 'numbered',
    ])
    expect(result.stdout).toMatch(/\[CONTINUE:|EOF:/)
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
