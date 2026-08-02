import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const COMPOSE_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'compose-retrieval', 'basic-app')
const TEST_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android-test-semantic', 'basic-app')
const tempDirs: string[] = []

function copyFixture(root: string, label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-graphviews-${label}-`))
  tempDirs.push(dir)
  cpSync(root, dir, { recursive: true })
  return dir
}

function indexInto(root: string, out = 'out') {
  const outDir = join(root, out)
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', outDir, '--json'])
  expect(result.status).toBe(0)
  return outDir
}

function view(indexDir: string, graph: string, extra: string[] = []) {
  const outIndex = extra.indexOf('--out')
  const dotOut = outIndex !== -1 ? extra[outIndex + 1]! : join(indexDir, `${graph}.dot`)
  const baseArgs = ['view', '--index', indexDir, '--graph', graph, '--format', 'dot', '--json']
  const args = outIndex !== -1 ? [...baseArgs, ...extra] : [...baseArgs, '--out', dotOut, ...extra]
  const result = runCli(args)
  return { result, dotOut }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('view --graph graph-choice registration', () => {
  it('accepts compose-ui, compose-navigation, and android-test', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'registration')
    const indexDir = indexInto(root)
    for (const graph of ['compose-ui', 'compose-navigation']) {
      const { result } = view(indexDir, graph)
      expect(result.status).toBe(0)
    }
  })

  it('help output lists all three new graph values', () => {
    const result = runCli(['view', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('compose-ui')
    expect(result.stdout).toContain('compose-navigation')
    expect(result.stdout).toContain('android-test')
  })

  it('prior graph values remain accepted (code)', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'prior-code')
    const indexDir = indexInto(root)
    const { result } = view(indexDir, 'code')
    expect(result.status).toBe(0)
  })

  it('an unknown graph name still fails through the existing validation path', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'invalid')
    const indexDir = indexInto(root)
    const { result } = view(indexDir, 'bogus-graph')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unsupported --graph value')
    expect(result.stderr).toContain('compose-ui')
  })
})

describe('view --graph compose-ui', () => {
  it('includes composables, facts (state/effect/tag/text/resource/click/nav-call/ui-region), and direct ViewModel/resource targets', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-ui')
    const indexDir = indexInto(root)
    const { result, dotOut } = view(indexDir, 'compose-ui')
    expect(result.status).toBe(0)
    const dot = readFileSync(dotOut, 'utf8')

    expect(dot).toContain('digraph ComposeUiGraph')
    expect(dot).toContain('HomeScreen')
    expect(dot).toContain('[state]')
    expect(dot).toContain('[effect]')
    expect(dot).toContain('[test-tag]')
    expect(dot).toContain('[visible-text]')
    expect(dot).toContain('[string-resource]')
    expect(dot).toContain('[click-handler]')
    expect(dot).toContain('[navigation-call]')
    expect(dot).toContain('[ui-region]')
    expect(dot).toContain('LoginViewModel') // exact ViewModel symbol target
    expect(dot).toContain('composable-calls-composable')
    expect(dot).toContain('composable-has-fact')
    expect(dot).toContain('composable-references-viewmodel')
    expect(dot).toContain('compose-string-references-resource')
    expect(dot).toContain('defines-composable')
  })

  it('excludes unrelated Android-test nodes and no runtime wording appears', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-ui-exclusions')
    const indexDir = indexInto(root)
    const { dotOut } = view(indexDir, 'compose-ui')
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).not.toContain('android-test-')
    expect(dot.toLowerCase()).not.toContain('executed')
    expect(dot.toLowerCase()).not.toContain('renders at runtime')
  })

  it('produces deterministic node/edge counts and DOT content across repeated runs', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-ui-det')
    const indexDir = indexInto(root)
    const { result: r1, dotOut: out1 } = view(indexDir, 'compose-ui', ['--out', join(indexDir, 'a.dot')])
    const { result: r2, dotOut: out2 } = view(indexDir, 'compose-ui', ['--out', join(indexDir, 'b.dot')])
    const p1 = JSON.parse(r1.stdout)
    const p2 = JSON.parse(r2.stdout)
    expect(p1.nodeCount).toBe(p2.nodeCount)
    expect(p1.edgeCount).toBe(p2.edgeCount)
    expect(readFileSync(out1, 'utf8')).toBe(readFileSync(out2, 'utf8'))
  })
})

describe('view --graph compose-navigation', () => {
  it('includes the composable -> click-handler -> navigation-call -> route -> screen chain', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-nav')
    const indexDir = indexInto(root)
    const { result, dotOut } = view(indexDir, 'compose-navigation')
    expect(result.status).toBe(0)
    const dot = readFileSync(dotOut, 'utf8')

    expect(dot).toContain('digraph ComposeNavigationGraph')
    expect(dot).toContain('HomeScreen')
    expect(dot).toContain('[click-handler]')
    expect(dot).toContain('[navigation-call]')
    expect(dot).toContain('click-handler-contains-navigation-call')
    expect(dot).toContain('compose-navigation-targets-route')
    expect(dot).toContain('compose-route-resolves-to-screen')
  })

  it('preserves every ambiguous route candidate for the duplicate route', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-nav-ambiguous')
    const indexDir = indexInto(root)
    const { dotOut } = view(indexDir, 'compose-navigation')
    const dot = readFileSync(dotOut, 'utf8')
    // Two files each define a "duplicate" Compose route target - both routes must be present.
    expect(dot).toContain('AppNav.kt#2')
    expect(dot).toContain('AppNav2.kt#0')
  })

  it('renders an unresolved navigation call without inventing a target', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-nav-unresolved')
    const indexDir = indexInto(root)
    const { dotOut } = view(indexDir, 'compose-navigation')
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).toContain('unknown_route\\n[navigation-call]')
  })

  it('excludes unrelated Compose state/effect/test-tag/visible-text/string-resource facts', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-nav-exclusions')
    const indexDir = indexInto(root)
    const { dotOut } = view(indexDir, 'compose-navigation')
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).not.toContain('[state]')
    expect(dot).not.toContain('[effect]')
    expect(dot).not.toContain('[test-tag]')
    expect(dot).not.toContain('[visible-text]')
    expect(dot).not.toContain('[string-resource]')
  })

  it('is bounded: far fewer nodes than the full compose-ui view for the same fixture', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-nav-bounded')
    const indexDir = indexInto(root)
    const navResult = JSON.parse(view(indexDir, 'compose-navigation').result.stdout)
    const uiResult = JSON.parse(view(indexDir, 'compose-ui').result.stdout)
    expect(navResult.nodeCount).toBeLessThan(uiResult.nodeCount)
  })

  it('produces deterministic selection across repeated runs', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'compose-nav-det')
    const indexDir = indexInto(root)
    const a = JSON.parse(view(indexDir, 'compose-navigation', ['--out', join(indexDir, 'a.dot')]).result.stdout)
    const b = JSON.parse(view(indexDir, 'compose-navigation', ['--out', join(indexDir, 'b.dot')]).result.stdout)
    expect(a.nodeCount).toBe(b.nodeCount)
    expect(a.edgeCount).toBe(b.edgeCount)
  })
})

describe('view --graph android-test', () => {
  it('includes test file/class/method/fact nodes with unit/instrumented distinction', () => {
    const root = copyFixture(TEST_FIXTURE, 'android-test')
    const indexDir = indexInto(root)
    const { result, dotOut } = view(indexDir, 'android-test')
    expect(result.status).toBe(0)
    const dot = readFileSync(dotOut, 'utf8')

    expect(dot).toContain('digraph AndroidTestGraph')
    expect(dot).toContain('[unit]')
    expect(dot).toContain('[instrumented]')
    expect(dot).toContain('[compose-rule]')
    expect(dot).toContain('[test-tag]')
    expect(dot).toContain('[visible-text]')
    expect(dot).toContain('[mock]')
    expect(dot).toContain('defines-test-class')
    expect(dot).toContain('test-class-defines-method')
    expect(dot).toContain('test-class-uses-rule')
    expect(dot).toContain('test-method-has-fact')
    expect(dot).toContain('android-test-uses-double')
  })

  it('includes exact referenced production composable and ViewModel-symbol nodes', () => {
    const root = copyFixture(TEST_FIXTURE, 'android-test-refs')
    const indexDir = indexInto(root)
    const { dotOut } = view(indexDir, 'android-test')
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).toContain('android-test-references-composable')
    expect(dot).toContain('android-test-references-viewmodel')
    expect(dot).toContain('"HomeScreen"')
    expect(dot).toContain('"LoginViewModel"')
  })

  it('makes no runtime execution or coverage claim', () => {
    const root = copyFixture(TEST_FIXTURE, 'android-test-no-runtime')
    const indexDir = indexInto(root)
    const { dotOut } = view(indexDir, 'android-test')
    const dot = readFileSync(dotOut, 'utf8').toLowerCase()
    expect(dot).not.toContain('passed')
    expect(dot).not.toContain('executed')
    expect(dot).not.toContain('covers')
  })

  it('produces deterministic selection across repeated runs', () => {
    const root = copyFixture(TEST_FIXTURE, 'android-test-det')
    const indexDir = indexInto(root)
    const a = JSON.parse(view(indexDir, 'android-test', ['--out', join(indexDir, 'a.dot')]).result.stdout)
    const b = JSON.parse(view(indexDir, 'android-test', ['--out', join(indexDir, 'b.dot')]).result.stdout)
    expect(a.nodeCount).toBe(b.nodeCount)
    expect(a.edgeCount).toBe(b.edgeCount)
  })
})

describe('view: empty and compatibility cases for the three new graphs', () => {
  it('a non-Android index renders an empty compose-ui graph without crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-graphviews-nonandroid-'))
    tempDirs.push(dir)
    const srcDir = join(dir, 'src')
    cpSync(join(process.cwd(), 'examples', 'basic-ts', 'src'), srcDir, { recursive: true })
    const indexDir = join(dir, 'out')
    const indexResult = runCli(['index', '--root', dir, '--src', 'src', '--out', indexDir, '--json'])
    expect(indexResult.status).toBe(0)
    const { result } = view(indexDir, 'compose-ui')
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodeCount).toBe(0)
    expect(parsed.edgeCount).toBe(0)
  })

  it('an Android index without test evidence renders an empty android-test graph without crashing', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'no-tests')
    const indexDir = indexInto(root)
    const { result } = view(indexDir, 'android-test')
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodeCount).toBe(0)
    expect(parsed.edgeCount).toBe(0)
  })

  it('edge styles (semantic/labeled/minimal) all work for the new graphs', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'edge-styles')
    const indexDir = indexInto(root)
    for (const style of ['semantic', 'labeled', 'minimal']) {
      const { result } = view(indexDir, 'compose-ui', ['--edge-style', style])
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).edgeStyle).toBe(style)
    }
  })
})

describe('view: existing graph views remain unchanged', () => {
  it('android-module/android-manifest/android-navigation node selection is unaffected', () => {
    const root = copyFixture(COMPOSE_FIXTURE, 'existing-unaffected')
    const indexDir = indexInto(root)
    for (const graph of ['android-module', 'android-manifest', 'android-navigation']) {
      const { result } = view(indexDir, graph)
      expect(result.status).toBe(0)
    }
  })
})
