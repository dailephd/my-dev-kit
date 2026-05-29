import { existsSync } from 'node:fs'
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
  })
})
