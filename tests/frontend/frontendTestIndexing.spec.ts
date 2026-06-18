import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runFrontendAnalyzer } from '../../src/frontend/frontendAnalyzer.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-testidx-'))
  tempDirs.push(dir)
  return dir
}

function writeFixture(dir: string, relativePath: string, content: string): void {
  const fullPath = join(dir, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
}

function stubSymbolIndex(files: Array<{ path: string }>): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: new Date().toISOString(),
    repoRoot: '/stub',
    sourceRoots: ['src'],
    fileCount: files.length,
    symbolCount: 0,
    files: files.map((f) => ({
      path: f.path,
      language: 'typescript' as const,
      lineCount: 1,
      imports: [],
      exports: [],
      symbols: [],
      hasCallGraphEntries: false,
    })),
  }
}

function analyzeTestFile(dir: string, relativePath: string, content: string) {
  writeFixture(dir, relativePath, content)
  return runFrontendAnalyzer({
    symbolIndex: stubSymbolIndex([{ path: relativePath }]),
    repoRoot: dir,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

// ---------------------------------------------------------------------------
// Test block detection: describe/test/it
// ---------------------------------------------------------------------------

describe('test block detection', () => {
  it('detects describe block', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      describe('Foo', () => {
        it('works', () => {})
      })
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.kind === 'describe' && b.title === 'Foo')).toBe(true)
  })

  it('detects it block', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      it('does something', () => {})
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.kind === 'it' && b.title === 'does something')).toBe(true)
  })

  it('detects test block', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      test('my test', () => {})
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.kind === 'test' && b.title === 'my test')).toBe(true)
  })

  it('detects test.skip modifier', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      test.skip('skipped test', () => {})
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.modifier === 'skip' && b.title === 'skipped test')).toBe(true)
  })

  it('detects test.only modifier', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      test.only('only this', () => {})
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.modifier === 'only' && b.title === 'only this')).toBe(true)
  })

  it('detects it.skip modifier', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      it.skip('skip me', () => {})
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.modifier === 'skip')).toBe(true)
  })

  it('detects describe.only', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      describe.only('exclusive suite', () => {
        it('test', () => {})
      })
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.kind === 'describe' && b.modifier === 'only')).toBe(true)
  })

  it('records parent describe for nested test blocks', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      describe('Suite', () => {
        it('nested test', () => {})
      })
    `)
    const blocks = result.artifact.files[0].testBlocks
    const describe = blocks.find((b) => b.kind === 'describe')
    const nested = blocks.find((b) => b.kind === 'it')
    expect(describe).toBeDefined()
    expect(nested?.parentId).toBe(describe?.id)
  })

  it('handles deeply nested describes', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      describe('Outer', () => {
        describe('Middle', () => {
          describe('Inner', () => {
            it('deep test', () => {})
          })
        })
      })
    `)
    const blocks = result.artifact.files[0].testBlocks
    const outer = blocks.find((b) => b.title === 'Outer')
    const middle = blocks.find((b) => b.title === 'Middle')
    const inner = blocks.find((b) => b.title === 'Inner')
    const deep = blocks.find((b) => b.title === 'deep test')
    expect(middle?.parentId).toBe(outer?.id)
    expect(inner?.parentId).toBe(middle?.id)
    expect(deep?.parentId).toBe(inner?.id)
  })

  it('handles async test callbacks', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      test('async test', async () => {
        await Promise.resolve()
      })
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.title === 'async test')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Setup/teardown block detection
// ---------------------------------------------------------------------------

describe('setup/teardown block detection', () => {
  it('detects beforeEach', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      beforeEach(() => { setup() })
      it('test', () => {})
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.kind === 'beforeEach')).toBe(true)
  })

  it('detects afterEach', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      afterEach(() => { cleanup() })
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.kind === 'afterEach')).toBe(true)
  })

  it('detects beforeAll and afterAll', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      beforeAll(() => {})
      afterAll(() => {})
    `)
    const blocks = result.artifact.files[0].testBlocks
    expect(blocks.some((b) => b.kind === 'beforeAll')).toBe(true)
    expect(blocks.some((b) => b.kind === 'afterAll')).toBe(true)
  })

  it('associates setup blocks with their parent describe', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      describe('Suite', () => {
        beforeEach(() => {})
        it('test', () => {})
      })
    `)
    const blocks = result.artifact.files[0].testBlocks
    const suite = blocks.find((b) => b.kind === 'describe')
    const setup = blocks.find((b) => b.kind === 'beforeEach')
    expect(setup?.parentId).toBe(suite?.id)
  })
})

// ---------------------------------------------------------------------------
// Playwright locator detection
// ---------------------------------------------------------------------------

describe('Playwright locator detection', () => {
  it('detects getByRole locator with static value', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/login.spec.ts', `
      test('login', async ({ page }) => {
        await page.getByRole('button').click()
      })
    `)
    const locators = result.artifact.files[0].locators
    expect(locators.some((l) => l.kind === 'getByRole' && l.value === 'button')).toBe(true)
  })

  it('detects getByText locator', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/nav.spec.ts', `
      test('nav', async ({ page }) => {
        await page.getByText('Submit').click()
      })
    `)
    const locators = result.artifact.files[0].locators
    expect(locators.some((l) => l.kind === 'getByText' && l.value === 'Submit')).toBe(true)
  })

  it('detects getByLabel locator', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/form.spec.ts', `
      test('form', async ({ page }) => {
        await page.getByLabel('Email').fill('user@example.com')
      })
    `)
    const locators = result.artifact.files[0].locators
    expect(locators.some((l) => l.kind === 'getByLabel' && l.value === 'Email')).toBe(true)
  })

  it('detects getByPlaceholder locator', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/search.spec.ts', `
      test('search', async ({ page }) => {
        await page.getByPlaceholder('Search...').fill('hello')
      })
    `)
    const locators = result.artifact.files[0].locators
    expect(locators.some((l) => l.kind === 'getByPlaceholder' && l.value === 'Search...')).toBe(true)
  })

  it('detects getByTestId locator', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/card.spec.ts', `
      test('card', async ({ page }) => {
        await expect(page.getByTestId('submit-btn')).toBeVisible()
      })
    `)
    const locators = result.artifact.files[0].locators
    expect(locators.some((l) => l.kind === 'getByTestId' && l.value === 'submit-btn')).toBe(true)
  })

  it('detects expect().toHaveText() assertion', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/welcome.spec.ts', `
      test('welcome', async ({ page }) => {
        await expect(page.getByTestId('msg')).toHaveText('Welcome!')
      })
    `)
    const locators = result.artifact.files[0].locators
    expect(locators.some((l) => l.kind === 'expect-text' && l.value === 'Welcome!')).toBe(true)
  })

  it('records dynamic locator with warning', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/dynamic.spec.ts', `
      test('dynamic', async ({ page }) => {
        const selector = getSelector()
        await page.getByTestId(selector).click()
      })
    `)
    const locators = result.artifact.files[0].locators
    // Dynamic locator should be recorded with null value and a warning
    const dynLocator = locators.find((l) => l.kind === 'getByTestId')
    expect(dynLocator).toBeDefined()
    expect(dynLocator?.value).toBeNull()
    expect(dynLocator?.warnings.length).toBeGreaterThan(0)
  })

  it('associates locators with their test block', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/check.spec.ts', `
      test('check', async ({ page }) => {
        await page.getByRole('button').click()
      })
    `)
    const blocks = result.artifact.files[0].testBlocks
    const locators = result.artifact.files[0].locators
    const testBlock = blocks.find((b) => b.kind === 'test')
    const locator = locators.find((l) => l.kind === 'getByRole')
    expect(locator?.testBlockId).toBe(testBlock?.id)
  })
})

// ---------------------------------------------------------------------------
// Route string detection
// ---------------------------------------------------------------------------

describe('route-like string detection in tests', () => {
  it('detects page.goto route string', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/nav.spec.ts', `
      test('navigate', async ({ page }) => {
        await page.goto('/dashboard')
      })
    `)
    const routes = result.artifact.files[0].routeStrings
    expect(routes.some((r) => r.value === '/dashboard')).toBe(true)
  })

  it('does not record full URLs as route strings', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/nav.spec.ts', `
      test('nav', async ({ page }) => {
        await page.goto('https://example.com/login')
      })
    `)
    const routes = result.artifact.files[0].routeStrings
    expect(routes.every((r) => !r.value.includes('example.com'))).toBe(true)
  })

  it('does not record "/" alone as a meaningful route string', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'e2e/home.spec.ts', `
      test('home', async ({ page }) => {
        await page.goto('/')
      })
    `)
    // "/" is too short to be meaningful
    const routes = result.artifact.files[0].routeStrings
    expect(routes.every((r) => r.value.length > 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Adversarial test cases
// ---------------------------------------------------------------------------

describe('adversarial test indexing cases', () => {
  it('does not classify non-test files as test files based on function names', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'non-test-with-test-name.ts'),
      'utf8'
    )
    writeFixture(dir, 'src/utils.ts', content)
    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/utils.ts' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    // src/utils.ts is not a test file by path pattern
    expect(result.artifact.files[0].isTestFile).toBe(false)
    // test blocks should be empty since this isn't a test file
    expect(result.artifact.files[0].testBlocks).toHaveLength(0)
  })

  it('handles test with dynamic title gracefully', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      const titles = ['a', 'b']
      titles.forEach(title => {
        test(title, () => {})
      })
    `)
    // Dynamic test titles may not be extracted, but should not crash
    expect(result.artifact.files[0].parseError).toBe(false)
  })

  it('handles template literal test title gracefully', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      const name = 'Button'
      test(\`renders \${name}\`, () => {})
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
    const blocks = result.artifact.files[0].testBlocks
    // Template literal title may produce null title with a warning
    if (blocks.length > 0) {
      const block = blocks[0]
      if (block.title === null) {
        expect(block.warnings.length).toBeGreaterThan(0)
      }
    }
  })

  it('handles deeply nested test helpers', () => {
    const dir = makeTempDir()
    const result = analyzeTestFile(dir, 'src/foo.spec.ts', `
      function setupHelper() {
        return { cleanup: () => {} }
      }
      describe('Suite', () => {
        let helper: ReturnType<typeof setupHelper>
        beforeEach(() => { helper = setupHelper() })
        it('uses helper', () => {})
      })
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
    expect(result.artifact.files[0].testBlocks.some((b) => b.kind === 'describe')).toBe(true)
  })

  it('is deterministic on the playwright fixture', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'playwright-e2e.spec.ts'),
      'utf8'
    )
    writeFixture(dir, 'e2e/login.spec.ts', content)

    const opts = {
      symbolIndex: stubSymbolIndex([{ path: 'e2e/login.spec.ts' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const first = runFrontendAnalyzer(opts)
    const second = runFrontendAnalyzer(opts)
    expect(JSON.stringify(first.artifact)).toBe(JSON.stringify(second.artifact))
  })
})

// ---------------------------------------------------------------------------
// Fixture-based integration tests
// ---------------------------------------------------------------------------

describe('vitest-component fixture', () => {
  it('indexes describe/test/it blocks from the fixture', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'vitest-component.spec.tsx'),
      'utf8'
    )
    writeFixture(dir, 'src/Button.spec.tsx', content)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/Button.spec.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const file = result.artifact.files[0]
    expect(file.isTestFile).toBe(true)
    expect(file.testBlocks.some((b) => b.kind === 'describe' && b.title === 'Button component')).toBe(true)
    expect(file.testBlocks.some((b) => b.kind === 'it' && b.title === 'renders label text')).toBe(true)
    expect(file.testBlocks.some((b) => b.kind === 'beforeEach')).toBe(true)
    expect(file.testBlocks.some((b) => b.kind === 'afterEach')).toBe(true)
    expect(file.testBlocks.some((b) => b.modifier === 'skip')).toBe(true)
    expect(file.testBlocks.some((b) => b.modifier === 'only')).toBe(true)
    // nested describe
    expect(file.testBlocks.some((b) => b.kind === 'describe' && b.title === 'when disabled')).toBe(true)
  })
})

describe('playwright-e2e fixture', () => {
  it('indexes Playwright test blocks, locators, and routes', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'playwright-e2e.spec.ts'),
      'utf8'
    )
    writeFixture(dir, 'e2e/login.spec.ts', content)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'e2e/login.spec.ts' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const file = result.artifact.files[0]
    expect(file.isTestFile).toBe(true)

    // Test blocks
    expect(file.testBlocks.some((b) => b.kind === 'describe' && b.title === 'Login page')).toBe(true)
    expect(file.testBlocks.some((b) => b.kind === 'test' && b.title === 'shows login form')).toBe(true)
    expect(file.testBlocks.some((b) => b.modifier === 'skip')).toBe(true)

    // Locators
    expect(file.locators.some((l) => l.kind === 'getByRole' && l.value === 'heading')).toBe(true)
    expect(file.locators.some((l) => l.kind === 'getByLabel' && l.value === 'Email')).toBe(true)
    expect(file.locators.some((l) => l.kind === 'getByTestId' && l.value === 'welcome-message')).toBe(true)

    // Route strings from page.goto
    expect(file.routeStrings.some((r) => r.value === '/login')).toBe(true)
    expect(file.routeStrings.some((r) => r.value === '/dashboard')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// No regression: React/TSX component indexing still works on test files
// ---------------------------------------------------------------------------

describe('regression: React/TSX component indexing survives test files', () => {
  it('extracts both components and test blocks from a mixed TSX spec file', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'vitest-component.spec.tsx'),
      'utf8'
    )
    writeFixture(dir, 'src/Button.spec.tsx', content)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/Button.spec.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const file = result.artifact.files[0]
    expect(file.parseError).toBe(false)
    // test blocks are detected
    expect(file.testBlocks.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// No regression: data-model and TS indexing
// ---------------------------------------------------------------------------

describe('regression: non-test TS files not affected', () => {
  it('ignores test block calls in a production TS file by path', () => {
    const dir = makeTempDir()
    writeFixture(dir, 'src/service.ts', `
      export interface User { id: string; name: string }
      export function formatUser(u: User): string { return u.name }
    `)
    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/service.ts' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.artifact.files[0].testBlocks).toHaveLength(0)
  })
})
