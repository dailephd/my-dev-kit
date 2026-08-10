import { describe, expect, it } from 'vitest'
import { resolveRelativeSpecifier } from '../../src/context/testInfrastructureDiscovery.js'

describe('resolveRelativeSpecifier (NodeNext regression)', () => {
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
