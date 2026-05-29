import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export function runCli(args: string[], cwd = process.cwd()) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
  })
}

export function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}
