import { spawnSync } from 'node:child_process'
import { isAbsolute, join } from 'node:path'

// Verification builds the exact checkout before running the suite. Allow it to
// reuse that bundle instead of loading and transforming the CLI on every spawn.
export function cliArgs(args: string[]): string[] {
  const builtCli = process.env.MY_DEV_KIT_TEST_BUILT_CLI
  if (builtCli === undefined) return [tsxCliPath(), 'src/cli.ts', ...args]
  if (!isAbsolute(builtCli)) throw new Error('MY_DEV_KIT_TEST_BUILT_CLI must be absolute')
  return [builtCli, ...args]
}

export function runCli(args: string[], cwd = process.cwd()) {
  return spawnSync(process.execPath, cliArgs(args), {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
}

export function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}
