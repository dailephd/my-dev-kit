import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const commands = ['index', 'view', 'lookup', 'source', 'slice', 'search']

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

describe('command registration', () => {
  it.each(commands)('%s command help works', (commandName) => {
    const result = runCli([commandName, '--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Usage: my-dev-kit ${commandName}`)
  })

  it('search normal invocation validates required query', () => {
    const result = runCli(['search', '--index', '.my-dev-kit-v1'])

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('requires --query')
  })
})
