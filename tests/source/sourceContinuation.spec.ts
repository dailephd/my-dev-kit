import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// Fixture: 28-line TS file where longFunction spans lines 1-27 and shortFunction is line 28.
// Newly indexed TS symbols carry a trusted endLine, so retrieval is bounded by the exact symbol end.
// Old indexes (no endLine) keep the conservative min(maxLines, 20) preview; those are exercised
// against a copy of the index with endLine stripped.
const FIXTURE_CONTENT = `export function longFunction(): string {
  const l02 = 'v02'
  const l03 = 'v03'
  const l04 = 'v04'
  const l05 = 'v05'
  const l06 = 'v06'
  const l07 = 'v07'
  const l08 = 'v08'
  const l09 = 'v09'
  const l10 = 'v10'
  const l11 = 'v11'
  const l12 = 'v12'
  const l13 = 'v13'
  const l14 = 'v14'
  const l15 = 'v15'
  const l16 = 'v16'
  const l17 = 'v17'
  const l18 = 'v18'
  const l19 = 'v19'
  const l20 = 'v20'
  const l21 = 'v21'
  const l22 = 'v22'
  const l23 = 'v23'
  const l24 = 'v24'
  const l25 = 'v25'
  return l02 + l25
}
export function shortFunction(): string { return 'short' }
`

const JAVA_FIXTURE = `public class UnknownBoundary {
  public int a() { return 1; }
  public int b() { return 2; }
  public int c() { return 3; }
  public int d() { return 4; }
  public int e() { return 5; }
  public int f() { return 6; }
  public int g() { return 7; }
  public int h() { return 8; }
  public int i() { return 9; }
  public int j() { return 10; }
}
`

let projectDir = ''
let indexDir = ''
let oldIndexDir = ''
let invalidIndexDir = ''

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-cont-'))
  indexDir = join(projectDir, '.idx')
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  writeFileSync(join(projectDir, 'src', 'big-module.ts'), FIXTURE_CONTENT)
  writeFileSync(join(projectDir, 'src', 'UnknownBoundary.java'), JAVA_FIXTURE)
  const res = runCli(['index', '--root', projectDir, '--src', 'src', '--out', indexDir])
  if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)

  // Old index: same artifacts with every generic symbol endLine removed.
  oldIndexDir = join(projectDir, '.idx-old')
  cpSync(indexDir, oldIndexDir, { recursive: true })
  rewriteSymbolIndex(oldIndexDir, (loc) => { delete loc.endLine })
  // Invalid metadata: endLine beyond the indexed file line count.
  invalidIndexDir = join(projectDir, '.idx-invalid')
  cpSync(indexDir, invalidIndexDir, { recursive: true })
  rewriteSymbolIndex(invalidIndexDir, (loc) => { loc.endLine = 9999 })
})

function rewriteSymbolIndex(dir: string, mutate: (loc: { endLine?: number }) => void): void {
  const file = join(dir, 'symbol-index.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  for (const f of parsed.files) for (const sym of f.symbols) if (sym.location) mutate(sym.location)
  writeFileSync(file, JSON.stringify(parsed))
}

function sourceJson(index: string, args: string[]) {
  const result = runCli(['source', '--index', index, ...args, '--json'])
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

const SYMBOL = ['--file', 'src/big-module.ts', '--symbol', 'longFunction']
const NODE = ['--node', 'symbol:src/big-module.ts#longFunction']

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('continuation cursor on line-range result', () => {
  it('always includes continuationCursor in JSON output', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--start', '1', '--end', '5', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.continuationCursor).toBeDefined()
    expect(parsed.continuationCursor.nextStartLine).toBe(6)
    expect(parsed.continuationCursor.previousEndLine).toBe(5)
    expect(parsed.continuationCursor.eof).toBe(false)
    expect(parsed.continuationCursor.symbolBoundaryKnown).toBe(true)
    expect(parsed.continuationCursor.reason).toBe('window-capped')
  })

  it('eof cursor when result reaches end of file', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--start', '1', '--end', '28', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.continuationCursor.eof).toBe(true)
    expect(parsed.continuationCursor.reason).toBe('eof')
    expect(parsed.continuationCursor.previousEndLine).toBe(28)
  })

  it('numbered output includes [CONTINUE:] footer when not at EOF', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--start', '1', '--end', '5', '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[CONTINUE:')
    expect(result.stdout).toContain('from line 6')
  })

  it('numbered output includes [EOF:] footer when at end of file', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--start', '1', '--end', '28', '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[EOF:')
  })
})

describe('symbol result includes continuation cursor (unknown boundary / old index)', () => {
  it('cursor reason is symbol-end-unknown for --symbol mode when the index has no endLine', () => {
    const result = runCli(['source', '--index', oldIndexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.continuationCursor).toBeDefined()
    expect(parsed.continuationCursor.symbolBoundaryKnown).toBe(false)
    expect(parsed.continuationCursor.reason).toBe('symbol-end-unknown')
    expect(parsed.continuationCursor.nextStartLine).toBe(21)
    expect(parsed.continuationCursor.previousEndLine).toBe(20)
  })
})

describe('--continue-from (file line continuation)', () => {
  it('reads from the specified line', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--continue-from', '21', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.startLine).toBe(21)
    expect(parsed.content).toContain('l21')
    expect(parsed.continuationCursor.previousEndLine).toBe(28)
  })

  it('reads from the specified line with numbered output', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--continue-from', '21', '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/21 \|/)
    expect(result.stdout).toContain('[EOF:')
  })

  it('returns eof cursor when line is past end of file', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--continue-from', '100', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.content).toBe('')
    expect(parsed.lineCount).toBe(0)
    expect(parsed.continuationCursor.eof).toBe(true)
    expect(parsed.warnings.length).toBeGreaterThan(0)
    expect(parsed.warnings[0]).toContain('past the end of file')
  })

  it('attaches symbol metadata when --symbol given with --continue-from', () => {
    // --max-lines 10 keeps the window within the file so reason is window-capped, not eof
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--continue-from', '5', '--max-lines', '10', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.startLine).toBe(5)
    expect(parsed.symbolName).toBe('longFunction')
    expect(parsed.continuationCursor.symbolBoundaryKnown).toBe(true)
    expect(parsed.continuationCursor.reason).toBe('window-capped')
  })

  it('rejects --continue-from combined with --start', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--continue-from', '5', '--start', '1'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--continue-from cannot be combined with --start or --end')
  })

  it('rejects --continue-from combined with --node', () => {
    const result = runCli(['source', '--index', indexDir, '--node', 'file:src/big-module.ts', '--continue-from', '5'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--continue-from cannot be combined with --node')
  })

  it('rejects --continue-from without --file', () => {
    const result = runCli(['source', '--index', indexDir, '--continue-from', '5'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--continue-from requires --file')
  })
})

describe('--file --symbol --continue (symbol continuation)', () => {
  it('retrieves the next window after the symbol preview (old index, unknown boundary)', () => {
    const result = runCli(['source', '--index', oldIndexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--continue', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    // Symbol preview is lines 1-20 (min(160,20)), continuation starts at 21
    expect(parsed.startLine).toBe(21)
    expect(parsed.content).toContain('l21')
    expect(parsed.mode).toBe('symbol')
    expect(parsed.symbolName).toBe('longFunction')
  })

  it('continuation cursor is eof after reading the remainder (old index, unknown boundary)', () => {
    const result = runCli(['source', '--index', oldIndexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--continue', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.continuationCursor.eof).toBe(true)
    expect(parsed.continuationCursor.reason).toBe('eof')
  })

  it('returns eof result when symbol preview already reached file end (old index, unknown boundary)', () => {
    const result = runCli(['source', '--index', oldIndexDir, '--file', 'src/big-module.ts', '--symbol', 'shortFunction', '--continue', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.content).toBe('')
    expect(parsed.continuationCursor.eof).toBe(true)
    expect(parsed.warnings[0]).toContain('past the end of file')
  })

  it('rejects --continue combined with --start', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--continue', '--start', '1'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('cannot be combined with')
  })

  it('rejects --continue without --node or --symbol', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--continue'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--continue requires --node or --file --symbol')
  })

  it('rejects --continue combined with --continue-from', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--continue', '--continue-from', '5'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--continue and --continue-from cannot be used together')
  })
})

describe('--node --continue (node continuation)', () => {
  it('retrieves the next window after a file node preview', () => {
    // File node preview: 1..min(maxLines, fileLineCount). With 28 lines and default 160,
    // the first window is 1..28 (full file). Continuation is 29..28 → immediate EOF.
    const result = runCli(['source', '--index', indexDir, '--node', 'file:src/big-module.ts', '--continue', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.continuationCursor.eof).toBe(true)
    expect(parsed.warnings[0]).toContain('past the end of file')
  })
})

describe('regression: existing modes unaffected', () => {
  it('line-range mode content is unchanged after cursor addition', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--start', '1', '--end', '3', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.mode).toBe('line-range')
    expect(parsed.startLine).toBe(1)
    expect(parsed.endLine).toBe(3)
    expect(parsed.lineCount).toBe(3)
    expect(parsed.content).toContain('longFunction')
  })

  it('symbol mode still emits the start-line-only warning for unknown boundaries', () => {
    const result = runCli(['source', '--index', oldIndexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.warnings[0]).toContain('start line only')
  })
})

describe('known symbol boundary (trusted indexed endLine)', () => {
  it('returns a complete symbol within the cap with no cursor and excludes the next declaration', () => {
    const parsed = sourceJson(indexDir, SYMBOL)
    expect(parsed.startLine).toBe(1)
    expect(parsed.endLine).toBe(27)
    expect(parsed.lineCount).toBe(27)
    expect(parsed.content).toContain('return l02 + l25')
    expect(parsed.content).not.toContain('shortFunction')
    expect(parsed.continuationCursor).toBeUndefined()
    expect(parsed.warnings).toEqual([])
  })

  it('--node and --file --symbol are equivalent', () => {
    const byFile = sourceJson(indexDir, [...SYMBOL, '--max-lines', '8'])
    const byNode = sourceJson(indexDir, [...NODE, '--max-lines', '8'])
    expect(byNode.startLine).toBe(byFile.startLine)
    expect(byNode.endLine).toBe(byFile.endLine)
    expect(byNode.content).toBe(byFile.content)
    expect(byNode.continuationCursor.nextStartLine).toBe(byFile.continuationCursor.nextStartLine)
    expect(byNode.continuationCursor.symbolBoundaryKnown).toBe(true)
  })

  it('caps the first window and emits a known-boundary cursor', () => {
    const parsed = sourceJson(indexDir, [...SYMBOL, '--max-lines', '8'])
    expect(parsed.startLine).toBe(1)
    expect(parsed.endLine).toBe(8)
    expect(parsed.continuationCursor.symbolBoundaryKnown).toBe(true)
    expect(parsed.continuationCursor.nextStartLine).toBe(9)
    expect(parsed.continuationCursor.reason).toBe('window-capped')
    expect(parsed.continuationCursor.eof).toBe(false)
  })

  it('walks the symbol with --continue and --continue-from without gaps, overlap, or spill', () => {
    const first = sourceJson(indexDir, [...SYMBOL, '--max-lines', '8'])
    const second = sourceJson(indexDir, [...SYMBOL, '--max-lines', '8', '--continue'])
    expect([second.startLine, second.endLine]).toEqual([9, 16])
    expect(second.continuationCursor.nextStartLine).toBe(17)
    expect(second.continuationCursor.symbolBoundaryKnown).toBe(true)

    const third = sourceJson(indexDir, [...SYMBOL, '--max-lines', '8', '--continue-from', '17'])
    expect([third.startLine, third.endLine]).toEqual([17, 24])
    expect(third.continuationCursor.nextStartLine).toBe(25)

    const fourth = sourceJson(indexDir, [...SYMBOL, '--max-lines', '8', '--continue-from', '25'])
    expect([fourth.startLine, fourth.endLine]).toEqual([25, 27])
    expect(fourth.lineCount).toBe(3)
    expect(fourth.continuationCursor).toBeUndefined()
    expect(fourth.content).not.toContain('shortFunction')

    const joined = [first, second, third, fourth].map((w) => w.content).join('\n')
    expect(joined.split('\n')).toHaveLength(27)
    expect(joined.startsWith('export function longFunction')).toBe(true)
    expect(joined.endsWith('}')).toBe(true)
  })

  it('node --continue follows the same known-boundary windows', () => {
    const second = sourceJson(indexDir, [...NODE, '--max-lines', '8', '--continue'])
    expect([second.startLine, second.endLine]).toEqual([9, 16])
    expect(second.mode).toBe('node')
    expect(second.continuationCursor.nextStartLine).toBe(17)
  })

  it('--continue after a complete known symbol returns an empty completed result', () => {
    for (const target of [SYMBOL, NODE]) {
      const parsed = sourceJson(indexDir, [...target, '--continue'])
      expect(parsed.content).toBe('')
      expect(parsed.lineCount).toBe(0)
      expect(parsed.continuationCursor).toBeUndefined()
      expect(parsed.warnings[0]).toContain('complete')
      expect(JSON.stringify(parsed)).not.toContain('shortFunction')
    }
  })

  it('--continue-from past the symbol end is empty and completed; before the start is rejected', () => {
    const past = sourceJson(indexDir, [...SYMBOL, '--continue-from', '28'])
    expect(past.content).toBe('')
    expect(past.continuationCursor).toBeUndefined()

    const before = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'shortFunction', '--continue-from', '5'])
    expect(before.status).toBe(2)
    expect(before.stderr).toContain('before the start of symbol')
  })

  it('does not print a [CONTINUE:] footer for a completed known symbol', () => {
    for (const format of ['numbered', 'plain']) {
      const result = runCli(['source', '--index', indexDir, ...SYMBOL, '--format', format])
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('[CONTINUE:')
      expect(result.stdout).not.toContain('shortFunction')
    }
    const capped = runCli(['source', '--index', indexDir, ...SYMBOL, '--max-lines', '8', '--format', 'numbered'])
    expect(capped.stdout).toContain('[CONTINUE:')
    expect(capped.stdout).toContain('from line 9')
  })
})

describe('unknown symbol boundary', () => {
  it('old index without endLine keeps the 20-line preview and symbol-end-unknown cursor', () => {
    const parsed = sourceJson(oldIndexDir, SYMBOL)
    expect(parsed.endLine).toBe(20)
    expect(parsed.continuationCursor.reason).toBe('symbol-end-unknown')
    expect(parsed.continuationCursor.symbolBoundaryKnown).toBe(false)
  })

  it('invalid indexed endLine (beyond the file) is treated as unknown', () => {
    const parsed = sourceJson(invalidIndexDir, SYMBOL)
    expect(parsed.endLine).toBe(20)
    expect(parsed.continuationCursor.reason).toBe('symbol-end-unknown')
    expect(parsed.warnings[0]).toContain('start line only')
  })

  it('generic Java symbols keep the conservative fallback', () => {
    const parsed = sourceJson(indexDir, ['--file', 'src/UnknownBoundary.java', '--symbol', 'UnknownBoundary'])
    expect(parsed.continuationCursor.symbolBoundaryKnown).toBe(false)
    expect(parsed.warnings[0]).toContain('start line only')
  })

  it('unknown-boundary --node --continue keeps start-line-only continuation', () => {
    const parsed = sourceJson(oldIndexDir, [...NODE, '--continue'])
    expect(parsed.startLine).toBe(21)
    expect(parsed.continuationCursor.eof).toBe(true)
  })
})

describe('stale index versus source', () => {
  it('fails clearly instead of returning a false complete symbol', () => {
    const staleRoot = mkdtempSync(join(tmpdir(), 'my-dev-kit-cont-stale-'))
    try {
      mkdirSync(join(staleRoot, 'src'), { recursive: true })
      writeFileSync(join(staleRoot, 'src', 'big-module.ts'), FIXTURE_CONTENT)
      const staleIndex = join(staleRoot, '.idx')
      const res = runCli(['index', '--root', staleRoot, '--src', 'src', '--out', staleIndex])
      expect(res.status).toBe(0)
      // Truncate the source after indexing: the recorded exact end (27) is no longer present.
      writeFileSync(join(staleRoot, 'src', 'big-module.ts'), FIXTURE_CONTENT.split('\n').slice(0, 10).join('\n') + '\n')

      for (const args of [SYMBOL, NODE, [...SYMBOL, '--continue'], [...SYMBOL, '--continue-from', '5']]) {
        const result = runCli(['source', '--index', staleIndex, ...args, '--json'])
        expect(result.status).toBe(2)
        expect(result.stderr).toContain('Stale index/source mismatch')
      }
    } finally {
      rmSync(staleRoot, { recursive: true, force: true })
    }
  })
})
