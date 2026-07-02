import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// Fixture: 28-line TS file where longFunction starts at line 1.
// resolveSymbolTarget caps the first preview at min(maxLines, 20) = 20 lines.
// --continue / --symbol-continue should start from line 21.
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

let projectDir = ''
let indexDir = ''

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-cont-'))
  indexDir = join(projectDir, '.idx')
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  writeFileSync(join(projectDir, 'src', 'big-module.ts'), FIXTURE_CONTENT)
  const res = runCli(['index', '--root', projectDir, '--src', 'src', '--out', indexDir])
  if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)
})

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

describe('symbol result includes continuation cursor', () => {
  it('cursor reason is symbol-end-unknown for --symbol mode', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--json'])
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
  it('retrieves the next window after the symbol preview', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--continue', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    // Symbol preview is lines 1-20 (min(160,20)), continuation starts at 21
    expect(parsed.startLine).toBe(21)
    expect(parsed.content).toContain('l21')
    expect(parsed.mode).toBe('symbol')
    expect(parsed.symbolName).toBe('longFunction')
  })

  it('continuation cursor is eof after reading the remainder', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--continue', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.continuationCursor.eof).toBe(true)
    expect(parsed.continuationCursor.reason).toBe('eof')
  })

  it('returns eof result when symbol preview already reached EOF', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'shortFunction', '--continue', '--json'])
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

  it('symbol mode still emits the start-line-only warning', () => {
    const result = runCli(['source', '--index', indexDir, '--file', 'src/big-module.ts', '--symbol', 'longFunction', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.warnings[0]).toContain('start line only')
  })
})
