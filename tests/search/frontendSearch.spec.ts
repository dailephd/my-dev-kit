import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []
let sharedProjectDir = ''
let sharedIndexDir = ''

function makeTempProject(): { projectDir: string; indexDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-frontsearch-'))
  const indexDir = join(projectDir, '.idx')
  tempDirs.push(projectDir)
  return { projectDir, indexDir }
}

function writeFixture(projectDir: string, relativePath: string, content: string): void {
  const full = join(projectDir, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function buildIndex(projectDir: string, indexDir: string): void {
  const res = runCli(['index', '--root', projectDir, '--src', 'src', '--out', indexDir])
  if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)
}

function searchJson(indexDir: string, query: string, limit = 10): ReturnType<typeof JSON.parse> {
  const res = runCli(['search', '--index', indexDir, '--query', query, '--limit', String(limit), '--json'])
  if (res.status !== 0) throw new Error(`Search failed: ${res.stderr}`)
  return JSON.parse(res.stdout)
}

beforeAll(() => {
  const { projectDir, indexDir } = makeTempProject()
  sharedProjectDir = projectDir
  sharedIndexDir = indexDir

  // React component with data-testid, aria-label, and UI strings
  writeFixture(projectDir, 'src/LoginForm.tsx', `
import React from 'react'

export function LoginForm() {
  return (
    <form>
      <input
        data-testid="username-field"
        aria-label="Enter your username"
        placeholder="Username"
      />
      <button data-testid="login-submit-btn" type="submit">
        Sign in
      </button>
    </form>
  )
}
`)

  // Another component with unique strings
  writeFixture(projectDir, 'src/Dashboard.tsx', `
import React from 'react'

export function Dashboard() {
  return (
    <div>
      <h1 aria-label="Dashboard header">Welcome</h1>
      <section data-testid="metrics-panel" />
    </div>
  )
}
`)

  // Source file with only symbol names (no frontend facts)
  writeFixture(projectDir, 'src/utils.ts', `
export function formatDate(date: Date): string {
  return date.toISOString()
}
export const VERSION = '1.0.0'
`)

  buildIndex(projectDir, indexDir)
})

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Frontend value enrichment in search
// ---------------------------------------------------------------------------

describe('search finds files via frontend values', () => {
  it('finds LoginForm by data-testid value', () => {
    const result = searchJson(sharedIndexDir, 'username-field')
    expect(result.results.length).toBeGreaterThan(0)
    const top = result.results[0]
    expect(top.path).toContain('LoginForm')
  })

  it('finds LoginForm by aria-label value', () => {
    const result = searchJson(sharedIndexDir, 'Enter your username')
    expect(result.results.length).toBeGreaterThan(0)
    const paths = result.results.map((r: { path?: string }) => r.path ?? '')
    expect(paths.some((p: string) => p.includes('LoginForm'))).toBe(true)
  })

  it('finds Dashboard by data-testid', () => {
    const result = searchJson(sharedIndexDir, 'metrics-panel')
    expect(result.results.length).toBeGreaterThan(0)
    const paths = result.results.map((r: { path?: string }) => r.path ?? '')
    expect(paths.some((p: string) => p.includes('Dashboard'))).toBe(true)
  })

  it('finds file by aria-label partial term', () => {
    const result = searchJson(sharedIndexDir, 'Dashboard header')
    expect(result.results.length).toBeGreaterThan(0)
    const paths = result.results.map((r: { path?: string }) => r.path ?? '')
    expect(paths.some((p: string) => p.includes('Dashboard'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// frontendValue match reason is surfaced
// ---------------------------------------------------------------------------

describe('search match reasons include frontendValue', () => {
  it('includes frontendValue in match reasons for data-testid match', () => {
    const result = searchJson(sharedIndexDir, 'login-submit-btn')
    const loginResult = result.results.find((r: { path?: string }) => r.path?.includes('LoginForm'))
    expect(loginResult).toBeDefined()
    const reasons = loginResult.matchReasons.map((r: { field: string }) => r.field)
    expect(reasons).toContain('frontendValue')
  })

  it('frontendValue reason has correct term', () => {
    const result = searchJson(sharedIndexDir, 'login-submit-btn')
    const loginResult = result.results.find((r: { path?: string }) => r.path?.includes('LoginForm'))
    const fvReason = loginResult?.matchReasons.find((r: { field: string; term: string }) => r.field === 'frontendValue')
    expect(fvReason?.term).toContain('login-submit-btn')
  })
})

// ---------------------------------------------------------------------------
// frontendValue weight produces higher scores than weak matches
// ---------------------------------------------------------------------------

describe('frontendValue ranking', () => {
  it('file with exact frontend match ranks above file with weak path match', () => {
    const { projectDir, indexDir } = makeTempProject()

    // File A has the exact testId as a frontend value
    writeFixture(projectDir, 'src/ComponentA.tsx', `
export function ComponentA() {
  return <button data-testid="super-unique-id-xyz">Click</button>
}
`)
    // File B happens to have "super" in a comment but no testId
    writeFixture(projectDir, 'src/ComponentB.ts', `
// This is super important
export function someHelper() { return 1 }
`)
    buildIndex(projectDir, indexDir)

    const result = searchJson(indexDir, 'super-unique-id-xyz')
    const positions = result.results.map((r: { path?: string }) => r.path ?? '')
    const aIdx = positions.findIndex((p: string) => p.includes('ComponentA'))
    const bIdx = positions.findIndex((p: string) => p.includes('ComponentB'))
    expect(aIdx).toBeGreaterThanOrEqual(0)
    // ComponentA should rank above ComponentB (or ComponentB may not appear at all)
    if (bIdx !== -1) {
      expect(aIdx).toBeLessThan(bIdx)
    }
  })
})

// ---------------------------------------------------------------------------
// No frontend artifact: search still works
// ---------------------------------------------------------------------------

describe('search without frontend artifact', () => {
  it('search works when no frontend artifact exists', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/plain.ts', `export function hello() { return 'world' }`)
    buildIndex(projectDir, indexDir)

    const result = searchJson(indexDir, 'hello')
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('utils.ts found by symbol name without frontend enrichment', () => {
    const result = searchJson(sharedIndexDir, 'formatDate')
    const paths = result.results.map((r: { path?: string }) => r.path ?? '')
    expect(paths.some((p: string) => p.includes('utils'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Deduplication: frontend candidate merges with existing symbol candidate
// ---------------------------------------------------------------------------

describe('deduplication of merged candidates', () => {
  it('LoginForm appears once in results even with both symbol and frontend matches', () => {
    const result = searchJson(sharedIndexDir, 'LoginForm username-field')
    const loginPaths = result.results.filter((r: { path?: string }) => r.path?.includes('LoginForm'))
    // Each unique path/id should appear only once
    const ids = loginPaths.map((r: { id: string }) => r.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('search determinism', () => {
  it('repeated calls return identical JSON', () => {
    const res1 = runCli(['search', '--index', sharedIndexDir, '--query', 'username-field', '--json'])
    const res2 = runCli(['search', '--index', sharedIndexDir, '--query', 'username-field', '--json'])
    // Compare results array (createdAt may differ, so compare structurally)
    const r1 = JSON.parse(res1.stdout)
    const r2 = JSON.parse(res2.stdout)
    expect(r1.results.length).toBe(r2.results.length)
    for (let i = 0; i < r1.results.length; i++) {
      expect(r1.results[i].id).toBe(r2.results[i].id)
      expect(r1.results[i].score).toBe(r2.results[i].score)
    }
  })
})
