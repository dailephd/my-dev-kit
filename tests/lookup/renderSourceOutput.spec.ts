import { describe, expect, it } from 'vitest'
import { parseSourceOutputFormat, renderNumberedSource, renderSourceOutput } from '../../src/source/renderSourceOutput.js'
import type { SourceSlice } from '../../src/lookup/sourceSliceTypes.js'

function makeSlice(content: string, startLine = 1): SourceSlice {
  const lines = content.split('\n').filter(l => l !== '' || content === '')
  return {
    status: 'ok',
    mode: 'line-range',
    indexDir: '.my-dev-kit-v1',
    filePath: 'src/foo.ts',
    absolutePath: '/project/src/foo.ts',
    symbolName: null,
    startLine,
    endLine: startLine + Math.max(0, lines.length - 1),
    lineCount: lines.length,
    content,
    warnings: [],
  }
}

describe('parseSourceOutputFormat', () => {
  it('accepts json', () => expect(parseSourceOutputFormat('json')).toBe('json'))
  it('accepts plain', () => expect(parseSourceOutputFormat('plain')).toBe('plain'))
  it('accepts numbered', () => expect(parseSourceOutputFormat('numbered')).toBe('numbered'))
  it('rejects unknown values', () => {
    expect(() => parseSourceOutputFormat('fancy')).toThrow('Unsupported --format value')
  })
})

describe('renderSourceOutput - json', () => {
  it('returns valid JSON with metadata', () => {
    const slice = makeSlice('const x = 1\n')
    const out = renderSourceOutput(slice, 'json')
    const parsed = JSON.parse(out)
    expect(parsed.status).toBe('ok')
    expect(parsed.content).toContain('const x = 1')
    expect(parsed.filePath).toBe('src/foo.ts')
  })

  it('ends with a newline', () => {
    const out = renderSourceOutput(makeSlice('line\n'), 'json')
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('renderSourceOutput - plain', () => {
  it('returns only source content', () => {
    const content = 'const x = 1\nconst y = 2\n'
    const out = renderSourceOutput(makeSlice(content), 'plain')
    expect(out).toBe(content)
    expect(out).not.toContain('"status"')
  })

  it('adds trailing newline if missing', () => {
    const out = renderSourceOutput(makeSlice('no newline'), 'plain')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('does not alter indentation', () => {
    const content = '  function foo() {\n    return 1\n  }\n'
    expect(renderSourceOutput(makeSlice(content), 'plain')).toBe(content)
  })
})

describe('renderSourceOutput - numbered', () => {
  it('prefixes lines with correct line numbers from startLine', () => {
    const content = 'line one\nline two\nline three\n'
    const out = renderNumberedSource(content, 5)
    expect(out).toContain('5 | line one')
    expect(out).toContain('6 | line two')
    expect(out).toContain('7 | line three')
  })

  it('pads single-digit line numbers when last line is multi-digit', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    const out = renderNumberedSource(lines, 1)
    expect(out).toContain(' 1 | line 1')
    expect(out).toContain('12 | line 12')
  })

  it('does not alter source text other than adding prefix', () => {
    const content = '  const x = 1\n'
    const out = renderNumberedSource(content, 1)
    expect(out).toContain('  const x = 1')
  })

  it('ends with a newline', () => {
    const out = renderSourceOutput(makeSlice('a\nb\n'), 'numbered')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('handles a single line', () => {
    const out = renderNumberedSource('only line\n', 10)
    expect(out).toContain('10 | only line')
  })
})
