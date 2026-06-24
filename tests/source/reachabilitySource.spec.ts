import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReachabilitySourceResult } from '../../src/frontend-reachability/index.js'
import { buildConsumerFixture } from '../frontend-reachability/consumerFixture.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-reach-src-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  // 40 numbered lines so line 5, 17, 38 referenced by the fixture all exist.
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
  writeFileSync(join(root, 'src/DashboardNav.tsx'), lines.join('\n'), 'utf8')
  return root
}

describe('source reachability consumer', () => {
  it('returns a bounded source block for a route fact', () => {
    const root = makeProjectRoot()
    const result = buildReachabilitySourceResult({
      artifact: buildConsumerFixture(),
      mode: 'route',
      query: '/dashboard',
      indexDir: join(root, '.my-dev-kit'),
      projectRoot: root,
      contextLines: 2,
      maxLines: 160,
    })
    expect(result.status).toBe('ok')
    expect(result.blocks).toHaveLength(1)
    const block = result.blocks[0]
    expect(block.factKind).toBe('route')
    expect(block.startLine).toBe(3) // 5 - 2
    expect(block.endLine).toBe(7) // 5 + 2
    expect(block.content).toContain('line 5')
  })

  it('returns source for a storage key fact with a context window', () => {
    const root = makeProjectRoot()
    const result = buildReachabilitySourceResult({
      artifact: buildConsumerFixture(),
      mode: 'storage-key',
      query: 'auth_token',
      indexDir: join(root, '.my-dev-kit'),
      projectRoot: root,
      contextLines: 1,
      maxLines: 160,
    })
    expect(result.status).toBe('ok')
    expect(result.blocks[0].content).toContain('line 17')
  })

  it('returns source for a UI marker fact', () => {
    const root = makeProjectRoot()
    const result = buildReachabilitySourceResult({
      artifact: buildConsumerFixture(),
      mode: 'ui',
      query: 'dashboard-panel',
      indexDir: join(root, '.my-dev-kit'),
      projectRoot: root,
      contextLines: 0,
      maxLines: 160,
    })
    expect(result.status).toBe('ok')
    expect(result.blocks[0].content).toBe('line 38')
  })

  it('returns not-found for an unknown fact', () => {
    const root = makeProjectRoot()
    const result = buildReachabilitySourceResult({
      artifact: buildConsumerFixture(),
      mode: 'route',
      query: '/nope',
      indexDir: join(root, '.my-dev-kit'),
      projectRoot: root,
      contextLines: 2,
      maxLines: 160,
    })
    expect(result.status).toBe('not-found')
  })

  it('returns missing-artifact when artifact is null', () => {
    const result = buildReachabilitySourceResult({
      artifact: null,
      mode: 'route',
      query: '/dashboard',
      indexDir: '/x/.my-dev-kit',
      projectRoot: '/x',
      contextLines: 2,
      maxLines: 160,
    })
    expect(result.status).toBe('missing-artifact')
  })

  it('reports no-source-range when a fact has no usable source ref', () => {
    const root = makeProjectRoot()
    const artifact = buildConsumerFixture()
    // Strip the route fact's source refs to simulate a dynamic/computed route.
    artifact.routes[0].sourceRefs = []
    const result = buildReachabilitySourceResult({
      artifact,
      mode: 'route',
      query: '/dashboard',
      indexDir: join(root, '.my-dev-kit'),
      projectRoot: root,
      contextLines: 2,
      maxLines: 160,
    })
    expect(result.status).toBe('no-source-range')
    expect(result.warnings[0]).toContain('--contains')
  })
})
