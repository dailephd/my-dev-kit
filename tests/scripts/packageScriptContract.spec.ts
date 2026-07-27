import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

describe('package script contract: test vs verify', () => {
  it('defines a canonical full test script', () => {
    expect(pkg.scripts.test).toBe('vitest run')
  })

  it('defines a verify script', () => {
    expect(pkg.scripts.verify).toBeDefined()
  })

  it('does not invoke npm run test from verify', () => {
    expect(pkg.scripts.verify).not.toMatch(/npm run test(\s|$)/)
  })

  it('does not invoke bare npm test from verify', () => {
    expect(pkg.scripts.verify).not.toMatch(/(^|\s)npm test(\s|$)/)
  })

  it('does not invoke the bare vitest runner from verify', () => {
    expect(pkg.scripts.verify).not.toMatch(/vitest run(?!\s)/)
  })

  it('retains the non-test verification gates in verify', () => {
    expect(pkg.scripts.verify).toMatch(/npm run typecheck/)
    expect(pkg.scripts.verify).toMatch(/npm run build/)
    expect(pkg.scripts.verify).toMatch(/npm run docs:check/)
  })
})
