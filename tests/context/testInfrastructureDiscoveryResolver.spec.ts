import { describe, expect, it } from 'vitest'
import {
  findAppTestFileLiterals,
  isPythonTestFile,
  resolveAppFileLiteral,
  resolveRelativeSpecifier,
} from '../../src/context/testInfrastructureDiscovery.js'
import { resolveRelativeSpecifier as canonicalResolveRelativeSpecifier } from '../../src/languages/typescript/resolveRelativeSpecifier.js'

describe('resolveRelativeSpecifier (NodeNext regression)', () => {
  it('is the same pure canonical resolver exposed by the TypeScript language module', () => {
    expect(resolveRelativeSpecifier).toBe(canonicalResolveRelativeSpecifier)
  })

  it('maps a NodeNext .js specifier to .ts source when only .ts exists', () => {
    const knownPaths = new Set(['src/domain/completion.ts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain/completion.js', knownPaths)
    expect(resolved).toBe('src/domain/completion.ts')
  })

  it('maps a NodeNext .js specifier to .tsx when .tsx is the matching source', () => {
    const knownPaths = new Set(['src/components/Button.tsx'])
    const resolved = resolveRelativeSpecifier('tests/components/Button.test.ts', '../../src/components/Button.js', knownPaths)
    expect(resolved).toBe('src/components/Button.tsx')
  })

  it('maps a NodeNext .jsx specifier to .tsx source', () => {
    const knownPaths = new Set(['src/components/Modal.tsx'])
    const resolved = resolveRelativeSpecifier('tests/components/Modal.test.tsx', '../../src/components/Modal.jsx', knownPaths)
    expect(resolved).toBe('src/components/Modal.tsx')
  })

  it('prefers real .js file over .ts fallback when literal .js exists', () => {
    const knownPaths = new Set(['src/domain/completion.js', 'src/domain/completion.ts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain/completion.js', knownPaths)
    expect(resolved).toBe('src/domain/completion.js')
  })

  it('never resolves a bare package specifier as a local source path', () => {
    const knownPaths = new Set(['src/domain/completion.ts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', 'vitest', knownPaths)
    expect(resolved).toBeNull()
  })

  it('never resolves a scoped package specifier as a local source path', () => {
    const knownPaths = new Set(['src/domain/completion.ts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '@dailephd/my-dev-kit', knownPaths)
    expect(resolved).toBeNull()
  })

  it('returns null for a .js specifier with no corresponding source or real file anywhere', () => {
    const knownPaths = new Set(['src/domain/unrelated.ts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain/completion.js', knownPaths)
    expect(resolved).toBeNull()
  })

  it('preserves existing extensionless behavior', () => {
    const knownPaths = new Set(['src/domain/completion.ts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain/completion', knownPaths)
    expect(resolved).toBe('src/domain/completion.ts')
  })

  it('preserves index fallback behavior', () => {
    const knownPaths = new Set(['src/domain/index.ts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain', knownPaths)
    expect(resolved).toBe('src/domain/index.ts')
  })

  it('does not fabricate .mts for .mjs (unsupported)', () => {
    const knownPaths = new Set(['src/domain/completion.mts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain/completion.mjs', knownPaths)
    // Should only match if a real .mjs exists in knownPaths (literal), not auto-map
    expect(resolved).toBeNull()
  })

  it('does not fabricate .cts for .cjs (unsupported)', () => {
    const knownPaths = new Set(['src/domain/completion.cts'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain/completion.cjs', knownPaths)
    expect(resolved).toBeNull()
  })

  it('still supports real .mjs file when present', () => {
    const knownPaths = new Set(['src/domain/completion.mjs'])
    const resolved = resolveRelativeSpecifier('tests/unit/completion.test.ts', '../../src/domain/completion.mjs', knownPaths)
    expect(resolved).toBe('src/domain/completion.mjs')
  })
})


// ---------------------------------------------------------------------------------------------
// KIT-PYTEST-01 unit coverage of the pure Python helpers (PY-09 .. PY-12 at unit level).
// ---------------------------------------------------------------------------------------------
describe('isPythonTestFile (pytest default naming)', () => {
  it('recognizes test_*.py and *_test.py at any depth and nothing else', () => {
    for (const p of ['tests/test_a.py', 'test_a.py', 'src/pkg/tests/test_x_y.py', 'tests/a_test.py', 'a/b/c_test.py']) expect(isPythonTestFile(p), p).toBe(true)
    for (const p of ['tests/helpers.py', 'tests/conftest.py', 'src/testing.py', 'src/mytest.py', 'tests/test.py', 'tests/test_a.pyc', 'tests/test_a.ts', 'tests/test_a.py.txt']) expect(isPythonTestFile(p), p).toBe(false)
  })
})

describe('findAppTestFileLiterals (literal-only, comment/string aware)', () => {
  const R = new Set(['AppTest'])
  it('returns a complete plain string literal argument with its 1-based line (positional or script_path=, extra kwargs allowed)', () => {
    const text = 'x = 1\nAppTest.from_file("a/b.py")\nAppTest.from_file(script_path=\'c/d.py\', default_timeout=5)\nAppTest.from_file("e.py", default_timeout=5)\n'
    const { literals, dynamicCalls } = findAppTestFileLiterals(text, R)
    expect(literals).toEqual([
      { value: 'a/b.py', line: 2, call: 'AppTest.from_file' },
      { value: 'c/d.py', line: 3, call: 'AppTest.from_file' },
      { value: 'e.py', line: 4, call: 'AppTest.from_file' },
    ])
    expect(dynamicCalls).toBe(0)
  })

  it('ignores calls inside comments, docstrings and ordinary strings, and keeps line numbers correct after multi-line strings', () => {
    const text = '"""doc\nAppTest.from_file("in_docstring.py")\n"""\n# AppTest.from_file("in_comment.py")\nS = \'AppTest.from_file("in_string.py")\'\nAppTest.from_file("real.py")\n'
    const { literals } = findAppTestFileLiterals(text, R)
    expect(literals).toEqual([{ value: 'real.py', line: 6, call: 'AppTest.from_file' }])
  })

  it('counts dynamic arguments (variable, call, f-string, bytes, escape, concatenation) as dynamic and never returns them', () => {
    const text = [
      'AppTest.from_file(APP)',
      'AppTest.from_file(str(ROOT / "x.py"))',
      'AppTest.from_file(f"src/{n}.py")',
      'AppTest.from_file(b"x.py")',
      'AppTest.from_file("a\\\\b.py")',
      'AppTest.from_file("src/" + "x.py")',
      'AppTest.from_file("src/" "x.py")',
    ].join('\n')
    const { literals, dynamicCalls } = findAppTestFileLiterals(text, R)
    expect(literals).toEqual([])
    expect(dynamicCalls).toBe(7)
  })

  it('only recognizes the bound receiver names and not attribute chains', () => {
    const text = 'AT.from_file("a.py")\nmod.AppTest.from_file("b.py")\nOther.from_file("c.py")\n'
    expect(findAppTestFileLiterals(text, new Set(['AT'])).literals.map((l) => l.value)).toEqual(['a.py'])
    expect(findAppTestFileLiterals(text, new Set(['AppTest'])).literals).toEqual([])
    expect(findAppTestFileLiterals(text, new Set(['AppTest'])).dynamicCalls).toBe(0)
  })
})

describe('resolveAppFileLiteral (existing indexed paths only)', () => {
  const known = new Set(['src/ui/app.py', 'tests/src/ui/app.py', 'tests/local_app.py'])
  it('resolves a repository-root literal and a caller-directory literal to exactly the indexed file', () => {
    expect(resolveAppFileLiteral('src/ui/app.py', 'tests/test_x.py', new Set(['src/ui/app.py']))).toEqual([{ path: 'src/ui/app.py', base: 'repository-root' }])
    expect(resolveAppFileLiteral('local_app.py', 'tests/test_x.py', known)).toEqual([{ path: 'tests/local_app.py', base: 'caller-directory' }])
    expect(resolveAppFileLiteral('./src/ui/app.py', 'tests/test_y.py', new Set(['src/ui/app.py']))).toEqual([{ path: 'src/ui/app.py', base: 'repository-root' }])
  })

  it('reports BOTH candidates when the literal exists under both bases (ambiguous, never chosen)', () => {
    expect(resolveAppFileLiteral('src/ui/app.py', 'tests/test_x.py', known).map((c) => c.path)).toEqual(['src/ui/app.py', 'tests/src/ui/app.py'])
  })

  it('rejects traversal, absolute, scheme, backslash, NUL and missing literals', () => {
    for (const bad of ['../src/ui/app.py', 'src/../src/ui/app.py', '/src/ui/app.py', 'C:/x/app.py', 'file:///src/ui/app.py', 'src\\ui\\app.py', 'src/ui/app.py\0', '', 'src/ui/missing.py']) {
      expect(resolveAppFileLiteral(bad, 'tests/test_x.py', known), JSON.stringify(bad)).toEqual([])
    }
  })
})
