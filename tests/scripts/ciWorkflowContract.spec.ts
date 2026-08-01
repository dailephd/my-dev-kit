import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..', '..')
const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')

describe('cross-platform CI workflow contract', () => {
  it('runs Linux, macOS, and Windows on the supported Node 24 matrix', () => {
    expect(workflow).toContain('os: [ubuntu-latest, macos-latest, windows-latest]')
    expect(workflow).toContain('node-version: [24.x]')
    expect(workflow).not.toMatch(/\b22\.x\b/)
    expect(workflow).not.toMatch(/\b20\.x\b/)
    expect(workflow).toContain('fail-fast: false')
  })

  it('uses verify as the sole owner of typecheck and build', () => {
    expect(workflow).toContain('run: npm run verify')
    expect(workflow).toContain('run: npm run test')
    expect(workflow).not.toContain('run: npm run typecheck')
    expect(workflow).not.toContain('run: npm run build')
  })

  it('keeps packaging and representative CLI smoke coverage cross-platform', () => {
    expect(workflow).toContain('run: npm pack --dry-run --json')
    expect(workflow).toContain('node dist/cli.js --version')
    expect(workflow).toContain('node dist/cli.js index ')
    expect(workflow).toContain('node dist/cli.js search ')
    expect(workflow).toContain('node dist/cli.js source ')
    expect(workflow).toContain('node dist/cli.js context ')
    expect(workflow).toContain('node dist/cli.js view ')
  })
})
