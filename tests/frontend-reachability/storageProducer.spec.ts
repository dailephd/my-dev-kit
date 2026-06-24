import { afterEach, describe, expect, it } from 'vitest'
import { extractStorageKeyFacts } from '../../src/frontend-reachability/index.js'
import { buildFrontendFixture, cleanupReachabilityTempDirs } from './reachabilityTestHelpers.js'

afterEach(() => cleanupReachabilityTempDirs())

describe('extractStorageKeyFacts', () => {
  it('extracts a localStorage key with high confidence', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Auth.tsx',
        content: `export function Auth() {
  const token = localStorage.getItem('auth_token')
  return <div>{token}</div>
}
`,
      },
    ])
    const keys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    const auth = keys.find((k) => k.key === 'auth_token')
    expect(auth).toBeDefined()
    expect(auth?.storageKind).toBe('localStorage')
    expect(auth?.confidence).toBe('high')
    expect(auth?.componentIds.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts a sessionStorage key', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Cart.tsx',
        content: `export function Cart() {
  sessionStorage.setItem('cart_id', 'x')
  return <div />
}
`,
      },
    ])
    const keys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    const cart = keys.find((k) => k.key === 'cart_id')
    expect(cart?.storageKind).toBe('sessionStorage')
    expect(cart?.confidence).toBe('high')
  })

  it('handles window.localStorage prefix', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/W.tsx',
        content: `export function W() {
  window.localStorage.removeItem('flag')
  return <div />
}
`,
      },
    ])
    const keys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    expect(keys.find((k) => k.key === 'flag')?.storageKind).toBe('localStorage')
  })

  it('flags a computed/template-literal key as low confidence with a warning', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Dyn.tsx',
        content: `export function Dyn() {
  const userId = '7'
  return <div>{localStorage.getItem(\`user_\${userId}_token\`)}</div>
}
`,
      },
    ])
    const keys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    expect(keys.length).toBeGreaterThanOrEqual(1)
    const low = keys.find((k) => k.confidence === 'low')
    expect(low).toBeDefined()
    expect(low?.warnings.some((w) => w.kind === 'dynamic-storage-key')).toBe(true)
  })

  it('links a useState var name in the same component scope', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Gate.tsx',
        content: `import { useState } from 'react'
export function Gate() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const token = localStorage.getItem('auth_token')
  return <div>{isLoggedIn ? token : null}</div>
}
`,
      },
    ])
    const keys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    const auth = keys.find((k) => k.key === 'auth_token')
    expect(auth?.stateVarNames).toContain('isLoggedIn')
  })

  it('merges the same key used across two components', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/A.tsx',
        content: `export function A() { return <div>{localStorage.getItem('shared_key')}</div> }
`,
      },
      {
        path: 'src/B.tsx',
        content: `export function B() { return <div>{localStorage.getItem('shared_key')}</div> }
`,
      },
    ])
    const keys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    const shared = keys.filter((k) => k.key === 'shared_key')
    expect(shared).toHaveLength(1)
    expect(shared[0].componentIds.length).toBeGreaterThanOrEqual(2)
  })

  it('sorts keys by storageKind then key', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/M.tsx',
        content: `export function M() {
  sessionStorage.getItem('zzz')
  localStorage.getItem('bbb')
  localStorage.getItem('aaa')
  return <div />
}
`,
      },
    ])
    const keys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    expect(keys.map((k) => k.id)).toEqual([
      'storage:localStorage:aaa',
      'storage:localStorage:bbb',
      'storage:sessionStorage:zzz',
    ])
  })
})
