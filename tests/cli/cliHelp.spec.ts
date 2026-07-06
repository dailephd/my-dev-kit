import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

describe('CLI help', () => {
  it('package CLI source exists', () => {
    expect(existsSync('src/cli.ts')).toBe(true)
  })

  it('--version reports package.json version', () => {
    const result = runCli(['--version'])

    expect(result.status).toBe(0)
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    expect(result.stdout.trim()).toBe(version)
  })

  it('top-level help lists registered commands', () => {
    const result = runCli(['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('my-dev-kit')
    expect(result.stdout).toContain('index')
    expect(result.stdout).toContain('view')
    expect(result.stdout).toContain('lookup')
    expect(result.stdout).toContain('source')
    expect(result.stdout).toContain('slice')
    expect(result.stdout).toContain('search')
    expect(result.stdout).toContain('context')
    expect(result.stdout).toContain('graph-diff')
  })

  it('index help lists the implemented v1.8.0 flags', () => {
    const result = runCli(['index', '--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--dry-run')
    expect(result.stdout).toContain('--progress')
    expect(result.stdout).toContain('--call-graph')
    expect(result.stdout).toContain('--incremental')
    expect(result.stdout).toContain('--reset-cache')
    expect(result.stdout).toContain('--json')
  })

  it('graph-diff help lists its required comparison flags', () => {
    const result = runCli(['graph-diff', '--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--before <index-dir>')
    expect(result.stdout).toContain('--after <index-dir>')
    expect(result.stdout).toContain('--json')
  })
})
