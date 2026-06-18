import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []
let sharedProjectDir = ''
let sharedIndexDir = ''

function makeTempProject(): { projectDir: string; indexDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-reactreg-'))
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

beforeAll(() => {
  const { projectDir, indexDir } = makeTempProject()
  sharedProjectDir = projectDir
  sharedIndexDir = indexDir

  writeFixture(projectDir, 'src/LoginForm.tsx', `import React from 'react'
import { useState } from 'react'

export interface LoginProps {
  onSuccess: () => void
}

export function LoginForm({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState('')

  return (
    <form data-testid="login-form">
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
      />
      <button type="submit">Sign in</button>
    </form>
  )
}
`)

  writeFixture(projectDir, 'src/Dashboard.tsx', `import React from 'react'

const MetricsWidget = () => <div>metrics</div>

export function Dashboard() {
  return (
    <main>
      <MetricsWidget />
    </main>
  )
}
`)

  buildIndex(projectDir, indexDir)
})

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Happy path: component retrieval
// ---------------------------------------------------------------------------

describe('source --react-region: component lookup', () => {
  it('retrieves source for a named component', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('LoginForm')
  })

  it('returned content spans the component function body', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx'])
    expect(res.stdout).toContain('return')
    expect(res.stdout).toContain('form')
  })

  it('retrieves a local component by name', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'MetricsWidget', '--file', 'src/Dashboard.tsx'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('MetricsWidget')
  })

  it('retrieves exported component from Dashboard.tsx', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'Dashboard', '--file', 'src/Dashboard.tsx'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Dashboard')
  })
})

// ---------------------------------------------------------------------------
// Case-insensitive matching
// ---------------------------------------------------------------------------

describe('source --react-region: case-insensitive matching', () => {
  it('matches component by lowercase name', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'loginform', '--file', 'src/LoginForm.tsx'])
    expect(res.status).toBe(0)
  })

  it('matches component by uppercase name', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LOGINFORM', '--file', 'src/LoginForm.tsx'])
    expect(res.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

describe('source --react-region: JSON output', () => {
  it('produces valid JSON with --format json', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx', '--format', 'json'])
    expect(res.status).toBe(0)
    expect(() => JSON.parse(res.stdout)).not.toThrow()
  })

  it('JSON output includes reactRegion metadata', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.reactRegion).toBeDefined()
    expect(parsed.reactRegion.region).toBe('LoginForm')
    expect(parsed.reactRegion.matchedKind).toBe('component')
    expect(parsed.reactRegion.matchedName).toBe('LoginForm')
  })

  it('JSON output includes filePath, startLine, endLine, content', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.filePath).toContain('LoginForm')
    expect(typeof parsed.startLine).toBe('number')
    expect(typeof parsed.endLine).toBe('number')
    expect(parsed.endLine).toBeGreaterThanOrEqual(parsed.startLine)
    expect(typeof parsed.content).toBe('string')
    expect(parsed.content.length).toBeGreaterThan(0)
  })

  it('--json flag also produces JSON with reactRegion', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx', '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.reactRegion).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Numbered output (default)
// ---------------------------------------------------------------------------

describe('source --react-region: numbered output (default)', () => {
  it('default output has line numbers', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx'])
    // Numbered format: "  8 | export function LoginForm..."
    expect(res.stdout).toMatch(/\d+\s*\|/)
  })
})

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('source --react-region: error cases', () => {
  it('fails when --file is missing', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toMatch(/--file/)
  })

  it('fails when region is not found', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'NonExistent', '--file', 'src/LoginForm.tsx'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toMatch(/NonExistent/)
  })

  it('error for not-found shows available regions', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'GhostComponent', '--file', 'src/LoginForm.tsx'])
    expect(res.status).not.toBe(0)
    // Should list available component names or "No named regions"
    const out = res.stderr + res.stdout
    expect(out.toLowerCase()).toMatch(/available|no named regions/i)
  })

  it('fails when file is not in the frontend artifact', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/nonexistent.tsx'])
    expect(res.status).not.toBe(0)
  })

  it('fails when file has no named React regions', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/plain.ts', `export function helper() { return 1 }`)
    buildIndex(projectDir, indexDir)

    const res = runCli(['source', '--index', indexDir, '--react-region', 'helper', '--file', 'src/plain.ts'])
    expect(res.status).not.toBe(0)
    // helper is a plain function, not a React component — should report not found
    expect(res.stderr + res.stdout).toMatch(/helper|not found|no named regions/i)
  })

  it('fails when combined with --contains', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--contains', 'form', '--file', 'src/LoginForm.tsx'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toMatch(/--react-region|--contains/)
  })

  it('fails when combined with --symbol', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx', '--symbol', 'LoginForm'])
    expect(res.status).not.toBe(0)
  })

  it('fails when combined with --node', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--node', 'file:src/LoginForm.tsx'])
    expect(res.status).not.toBe(0)
  })

  it('fails when combined with --start/--end', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--react-region', 'LoginForm', '--file', 'src/LoginForm.tsx', '--start', '1', '--end', '5'])
    expect(res.status).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Regression: existing modes still work after adding --react-region
// ---------------------------------------------------------------------------

describe('regression: existing source modes', () => {
  it('line-range mode still works', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--file', 'src/LoginForm.tsx', '--start', '1', '--end', '3'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('import')
  })

  it('symbol mode still works', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--file', 'src/LoginForm.tsx', '--symbol', 'LoginForm'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('LoginForm')
  })

  it('--contains mode still works', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'LoginForm', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.matchCount).toBeGreaterThan(0)
  })
})
