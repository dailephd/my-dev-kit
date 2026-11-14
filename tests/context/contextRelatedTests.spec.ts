import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 3: bounded related-test discovery via import-specifier evidence.
// Responsibility IDs: TST-B3-007, 008, 009.

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

describe('related-test discovery', () => {
  it('TST-B3-007: a test importing a selected production symbol by name is discovered', () => {
    const root = createTempRoot('my-dev-kit-v1-relatedtest-symbol-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, 'widgetRegistry.ts'),
      "export function registerWidget(name: string): void { /* entry point */ }\nexport function otherThing(): void {}\n"
    )
    writeFileSync(join(src, 'widgetRegistry.spec.ts'), "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n")
    writeFileSync(join(src, 'unrelatedThing.spec.ts'), 'export const unrelated = 1\n')

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const match = capsule.testInfrastructure.relatedTests.find((t: { path: string }) => t.path === 'src/widgetRegistry.spec.ts')
    expect(match).toBeDefined()
    expect(match.relationship).toBe('references-selected-production-symbol')
  })

  it('TST-B3-008: a test related through file import (no symbol match) is discovered', () => {
    const root = createTempRoot('my-dev-kit-v1-relatedtest-file-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void {}\n')
    writeFileSync(
      join(src, 'widgetRegistry.spec.ts'),
      "import * as registry from './widgetRegistry'\nexport const check = registry\n"
    )
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      changedFiles: ['src/widgetRegistry.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const match = capsule.testInfrastructure.relatedTests.find((t: { path: string }) => t.path === 'src/widgetRegistry.spec.ts')
    expect(match).toBeDefined()
    expect(match.relationship).toBe('imports-selected-production-file')
  })

  it('TST-B3-009: an unrelated test under a test-shaped path is never included solely for being test-shaped', () => {
    const root = createTempRoot('my-dev-kit-v1-relatedtest-unrelated-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void {}\n')
    writeFileSync(join(src, 'widgetRegistry.spec.ts'), "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n")
    writeFileSync(join(src, 'completelyUnrelated.spec.ts'), "export const noImportsHere = 42\n")
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      changedFiles: ['src/widgetRegistry.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const paths = capsule.testInfrastructure.relatedTests.map((t: { path: string }) => t.path)
    expect(paths).toContain('src/widgetRegistry.spec.ts')
    expect(paths).not.toContain('src/completelyUnrelated.spec.ts')
  })

  it('a NodeNext-style .js-specifier import (no real .js file, TypeScript source only) is discovered', () => {
    // Regression: an observer-project-shaped fixture (production .ts file, test file
    // one directory level deeper, importing via the emitted-JS extension required by
    // "module"/"moduleResolution": "NodeNext"). Before the fix, resolveRelativeSpecifier
    // could never resolve `../domain/completion.js` back to `domain/completion.ts`.
    const root = createTempRoot('my-dev-kit-v1-relatedtest-nodenext-')
    const src = join(root, 'src')
    const domain = join(src, 'domain')
    const testsUnit = join(src, 'tests', 'unit')
    mkdirSync(domain, { recursive: true })
    mkdirSync(testsUnit, { recursive: true })
    writeFileSync(
      join(domain, 'completion.ts'),
      'export function deriveCompletion(): string { return "complete" }\nexport function otherThing(): void {}\n'
    )
    writeFileSync(
      join(testsUnit, 'completion.test.ts'),
      "import { deriveCompletion } from '../../domain/completion.js'\nexport const check = deriveCompletion\n"
    )
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'completion',
      role: 'test-implementation',
      focusSymbols: ['symbol:src/domain/completion.ts#deriveCompletion'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const match = capsule.testInfrastructure.relatedTests.find((t: { path: string }) => t.path === 'src/tests/unit/completion.test.ts')
    expect(match).toBeDefined()
    expect(match.relationship).toBe('references-selected-production-symbol')
  })

  it('NodeNext .js import is associated even when test is deeper in directory tree', () => {
    const root = createTempRoot('my-dev-kit-v1-relatedtest-nodenext-deep-')
    const src = join(root, 'src')
    const domain = join(src, 'domain')
    const testsDeep = join(src, 'tests', 'unit', 'deep')
    mkdirSync(domain, { recursive: true })
    mkdirSync(testsDeep, { recursive: true })
    writeFileSync(join(domain, 'completion.ts'), 'export const x = 1\n')
    writeFileSync(
      join(testsDeep, 'completion.test.ts'),
      "import { x } from '../../../domain/completion.js'\nexport const check = x\n"
    )
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'completion',
      role: 'test-implementation',
      changedFiles: ['src/domain/completion.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const paths = capsule.testInfrastructure.relatedTests.map((t: { path: string }) => t.path)
    expect(paths).toContain('src/tests/unit/deep/completion.test.ts')
  })
})


// ---------------------------------------------------------------------------------------------
// KIT-PYTEST-01: Python related-test discovery from authenticated indexed import evidence.
// Scenarios PY-01 .. PY-12, PY-21, PY-22, PY-24 (PY-13 .. PY-19, PY-23 live in
// contextResponsibilityMapping.spec.ts; PY-16 also in contextTestCommands.spec.ts).
// ---------------------------------------------------------------------------------------------

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
}

interface RelatedItem {
  path: string
  relationship: string
  provenance: string
  basis: string
  sourceLocation?: { filePath: string; line?: number }
  metadata?: Record<string, unknown>
}

function pyContext(root: string, files: Record<string, string>, request: Record<string, unknown>, roots: string[] = ['src', 'tests']) {
  writeFiles(root, files)
  const indexOut = join(root, '.my-dev-kit')
  expect(runCli(['index', '--root', root, ...roots.filter((r) => existsSync(join(root, r))).flatMap((r) => ['--src', r]), '--out', indexOut]).status).toBe(0)
  const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'weather', role: 'test-implementation', ...request })
  const outPath = join(root, 'capsule.json')
  const auditPath = join(root, 'audit.json')
  const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--audit-out', auditPath])
  expect(result.status).toBe(0)
  const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
  return {
    capsule,
    audit: JSON.parse(readFileSync(auditPath, 'utf8')),
    related: capsule.testInfrastructure.relatedTests as RelatedItem[],
    warnings: capsule.testInfrastructure.warnings as string[],
  }
}

const PY_PROD = {
  'src/data/weather_query.py': 'def weather_history(location, start, end):\n    return []\n\n\ndef latest_weather(location):\n    return None\n',
  'src/ui/weather_dashboard_views.py': 'from src.data.weather_query import weather_history\n\n\ndef history_rows(loc):\n    return weather_history(loc, 0, 1)\n',
  'src/ui/weather_dashboard.py': 'from src.ui import weather_dashboard_views\n\n\ndef render_dashboard():\n    return weather_dashboard_views.history_rows("X")\n',
}
const PY_WH = 'symbol:src/data/weather_query.py#weather_history'

describe('Python related-test discovery (KIT-PYTEST-01)', () => {
  it('PY-01/PY-03: a test importing the exact production module (absolute src namespace, no __init__.py) is related with import provenance and a source line', () => {
    const root = createTempRoot('my-dev-kit-py01-')
    const { related, capsule } = pyContext(
      root,
      { ...PY_PROD, 'tests/test_module_import.py': '# header\nimport src.data.weather_query\n\n\ndef test_x():\n    assert src.data.weather_query.latest_weather("X") is None\n' },
      { changedFiles: ['src/data/weather_query.py'] }
    )
    const hit = related.find((t) => t.path === 'tests/test_module_import.py')
    expect(hit).toBeDefined()
    expect(hit?.relationship).toBe('imports-selected-production-file')
    expect(hit?.basis).toBe('src/data/weather_query.py')
    expect(hit?.provenance).toBe('python-indexed-import:import')
    expect(hit?.sourceLocation).toEqual({ filePath: 'tests/test_module_import.py', line: 2 })
    expect(hit?.metadata).toMatchObject({ language: 'python', evidenceType: 'python-import' })
    expect(capsule.testInfrastructure.unresolved.some((u: { evidenceKind: string }) => u.evidenceKind === 'related-tests')).toBe(false)
  })

  it('PY-02/PY-05: a from-import of the exact selected declaration is symbol-level evidence; an alias keeps the ORIGINAL declaration identity', () => {
    const root = createTempRoot('my-dev-kit-py02-')
    const { related } = pyContext(
      root,
      {
        ...PY_PROD,
        'tests/test_named.py': 'from src.data.weather_query import weather_history\n\n\ndef test_a():\n    assert weather_history("X", 0, 1) == []\n',
        'tests/test_aliased.py': 'from src.data.weather_query import weather_history as wh\n\n\ndef test_b():\n    assert wh("X", 0, 1) == []\n',
        // The alias spells the selected name, but the imported ORIGINAL is a different declaration.
        'tests/test_misleading_alias.py': 'from src.data.weather_query import latest_weather as weather_history\n\n\ndef test_c():\n    assert weather_history("X") is None\n',
      },
      { changedSymbols: [PY_WH] }
    )
    const byPath = Object.fromEntries(related.map((t) => [t.path, t]))
    expect(byPath['tests/test_named.py']?.relationship).toBe('references-selected-production-symbol')
    expect(byPath['tests/test_named.py']?.basis).toBe(PY_WH)
    expect(byPath['tests/test_named.py']?.provenance).toBe('python-indexed-import:named-import')
    expect(byPath['tests/test_aliased.py']?.relationship).toBe('references-selected-production-symbol')
    expect(byPath['tests/test_aliased.py']?.basis).toBe(PY_WH)
    // A different original declaration of the same selected FILE is only file-level evidence.
    expect(byPath['tests/test_misleading_alias.py']?.relationship).toBe('imports-selected-production-file')
  })

  it('PY-04: relative imports (. / ..) resolve inside real packages; imports outside any indexed file do not', () => {
    const root = createTempRoot('my-dev-kit-py04-')
    const { related } = pyContext(
      root,
      {
        'src/pkg/__init__.py': '',
        'src/pkg/mod.py': 'def func():\n    return 1\n',
        'src/pkg/tests/__init__.py': '',
        'src/pkg/tests/helpers.py': 'VALUE = 1\n',
        'src/pkg/tests/test_rel_symbol.py': 'from ..mod import func\n\n\ndef test_a():\n    assert func() == 1\n',
        'src/pkg/tests/test_rel_package.py': 'from .. import mod\n\n\ndef test_b():\n    assert mod.func() == 1\n',
        'src/pkg/tests/test_rel_sibling.py': 'from .helpers import VALUE\n\n\ndef test_c():\n    assert VALUE == 1\n',
        'src/pkg/tests/test_rel_missing.py': 'from ...nowhere import thing\n\n\ndef test_d():\n    assert thing\n',
      },
      { changedSymbols: ['symbol:src/pkg/mod.py#func'] }
    )
    const byPath = Object.fromEntries(related.map((t) => [t.path, t]))
    expect(byPath['src/pkg/tests/test_rel_symbol.py']?.relationship).toBe('references-selected-production-symbol')
    expect(byPath['src/pkg/tests/test_rel_package.py']?.relationship).toBe('imports-selected-production-file')
    expect(byPath['src/pkg/tests/test_rel_package.py']?.basis).toBe('src/pkg/mod.py')
    expect(byPath['src/pkg/tests/test_rel_sibling.py']).toBeUndefined()
    expect(byPath['src/pkg/tests/test_rel_missing.py']).toBeUndefined()
  })

  it('PY-06: package __init__ handling - a submodule from-import is the module, but a package attribute of the same name wins', () => {
    const rootA = createTempRoot('my-dev-kit-py06a-')
    const a = pyContext(
      rootA,
      {
        ...PY_PROD,
        'src/data/__init__.py': '',
        'tests/test_pkg_submodule.py': 'from src.data import weather_query\n\n\ndef test_a():\n    assert weather_query.latest_weather("X") is None\n',
        'tests/test_pkg_only.py': 'import src.data\n\n\ndef test_b():\n    assert src.data\n',
      },
      { changedFiles: ['src/data/weather_query.py'] }
    )
    const hit = a.related.find((t) => t.path === 'tests/test_pkg_submodule.py')
    expect(hit?.relationship).toBe('imports-selected-production-file')
    expect(hit?.basis).toBe('src/data/weather_query.py')
    expect(hit?.metadata).toMatchObject({ packageSubmoduleBasis: 'src/data/weather_query.py' })
    expect(a.related.find((t) => t.path === 'tests/test_pkg_only.py')).toBeUndefined()

    const rootB = createTempRoot('my-dev-kit-py06b-')
    const b = pyContext(
      rootB,
      {
        ...PY_PROD,
        // The package itself declares `weather_query`: the attribute wins, no submodule relationship is claimed.
        'src/data/__init__.py': 'def weather_query():\n    return None\n',
        'tests/test_pkg_attribute.py': 'from src.data import weather_query\n\n\ndef test_a():\n    assert weather_query() is None\n',
      },
      { changedFiles: ['src/data/weather_query.py'] }
    )
    expect(b.related.find((t) => t.path === 'tests/test_pkg_attribute.py')).toBeUndefined()
  })

  it('PY-07: an import that matches two indexed files stays unresolved (never chosen arbitrarily) and is reported as a warning', () => {
    const root = createTempRoot('my-dev-kit-py07-')
    const { related, warnings } = pyContext(
      root,
      {
        'src/pkg/util.py': 'def helper():\n    return 1\n',
        'lib/pkg/util.py': 'def helper():\n    return 2\n',
        'tests/test_ambiguous.py': 'import pkg.util\n\n\ndef test_a():\n    assert pkg.util.helper()\n',
      },
      { changedFiles: ['src/pkg/util.py'] },
      ['src', 'lib', 'tests']
    )
    expect(related.find((t) => t.path === 'tests/test_ambiguous.py')).toBeUndefined()
    expect(warnings.some((w) => w.includes('tests/test_ambiguous.py') && w.includes('ambiguous'))).toBe(true)
  })

  it('PY-08/PY-24: unrelated tests are never selected merely for being test-shaped; with only unrelated tests the related-test gap stays explicit', () => {
    const root = createTempRoot('my-dev-kit-py08-')
    const { related, capsule } = pyContext(
      root,
      {
        ...PY_PROD,
        'tests/test_unrelated_math.py': 'def test_math():\n    assert 1 + 1 == 2\n',
        'tests/test_other_module.py': 'from src.ui.weather_dashboard import render_dashboard\n\n\ndef test_other():\n    assert render_dashboard() == []\n',
        'tests/helpers_not_collected.py': 'from src.data.weather_query import weather_history\n',
      },
      { changedFiles: ['src/data/weather_query.py'], changedSymbols: [PY_WH] }
    )
    expect(related).toEqual([])
    expect(capsule.testInfrastructure.unresolved.some((u: { evidenceKind: string }) => u.evidenceKind === 'related-tests')).toBe(true)
  })

  it('PY-09: comments, docstrings and quoted import-like text never create related-test evidence', () => {
    const root = createTempRoot('my-dev-kit-py09-')
    const { related } = pyContext(
      root,
      {
        ...PY_PROD,
        'tests/test_text_only.py':
          '"""Docs: from src.data.weather_query import weather_history\nimport src.data.weather_query\nAppTest.from_file("src/ui/weather_dashboard.py")\n"""\n' +
          '# from src.data.weather_query import weather_history\n' +
          'TEXT = "import src.data.weather_query"\n' +
          "OTHER = 'from src.data.weather_query import weather_history'\n\n\ndef test_a():\n    assert TEXT and OTHER\n",
      },
      { changedFiles: ['src/data/weather_query.py', 'src/ui/weather_dashboard.py'], changedSymbols: [PY_WH] }
    )
    expect(related).toEqual([])
  })

  it('PY-10: dynamic imports (importlib, __import__, runpy, exec) never fabricate a static relationship', () => {
    const root = createTempRoot('my-dev-kit-py10-')
    const { related } = pyContext(
      root,
      {
        ...PY_PROD,
        'tests/test_dynamic.py':
          'import importlib\nimport runpy\n\nNAME = "src.data.weather_query"\n\n\ndef test_a():\n    importlib.import_module(NAME)\n    __import__("src.data.weather_query")\n    runpy.run_module("src.data.weather_query")\n    exec("import src.data.weather_query")\n',
      },
      { changedFiles: ['src/data/weather_query.py'], changedSymbols: [PY_WH] }
    )
    expect(related).toEqual([])
  })

  it('PY-11: a literal AppTest.from_file reference to an indexed application file is typed as a literal file reference, with its exact test location', () => {
    const root = createTempRoot('my-dev-kit-py11-')
    const { related } = pyContext(
      root,
      {
        ...PY_PROD,
        'tests/test_app_literal.py':
          'from streamlit.testing.v1 import AppTest\n\n\ndef test_app():\n    at = AppTest.from_file("src/ui/weather_dashboard.py")\n    assert at is not None\n',
        'tests/test_app_alias.py':
          'from streamlit.testing.v1 import AppTest as AT\n\n\ndef test_app():\n    at = AT.from_file(script_path="src/ui/weather_dashboard.py")\n    assert at\n',
      },
      { changedFiles: ['src/ui/weather_dashboard.py'] }
    )
    const byPath = Object.fromEntries(related.map((t) => [t.path, t]))
    for (const p of ['tests/test_app_literal.py', 'tests/test_app_alias.py']) {
      expect(byPath[p]?.relationship).toBe('references-selected-production-file-literal')
      expect(byPath[p]?.basis).toBe('src/ui/weather_dashboard.py')
      expect(byPath[p]?.provenance).toBe('python-literal-app-file:AppTest.from_file')
      expect(byPath[p]?.metadata).toMatchObject({ language: 'python', evidenceType: 'literal-application-file-reference' })
    }
    expect(byPath['tests/test_app_literal.py']?.sourceLocation?.line).toBe(5)
    expect(byPath['tests/test_app_literal.py']?.metadata?.literalReferences).toBe('src/ui/weather_dashboard.py:5')
    expect(byPath['tests/test_app_alias.py']?.sourceLocation?.line).toBe(5)
  })

  it('PY-12: dynamic, concatenated, f-string, escaped, traversal, missing-file and non-Streamlit AppTest references stay unresolved', () => {
    const root = createTempRoot('my-dev-kit-py12-')
    const { related, warnings } = pyContext(
      root,
      {
        ...PY_PROD,
        'tests/test_app_dynamic.py':
          'from pathlib import Path\nfrom streamlit.testing.v1 import AppTest\n\nAPP = "src/ui/weather_dashboard.py"\nROOT = Path(__file__).parent\n\n\ndef test_a():\n    AppTest.from_file(APP)\n    AppTest.from_file(str(ROOT / "src/ui/weather_dashboard.py"))\n    AppTest.from_file(f"src/ui/{APP}")\n    AppTest.from_file("src/ui/" + "weather_dashboard.py")\n    AppTest.from_file("../src/ui/weather_dashboard.py")\n    AppTest.from_file("src/ui/missing_app.py")\n    AppTest.from_file("/abs/src/ui/weather_dashboard.py")\n',
        // A local class named AppTest that is not Streamlit\'s: its literal call must not be scanned at all.
        'tests/test_app_not_streamlit.py':
          'class AppTest:\n    @staticmethod\n    def from_file(path):\n        return path\n\n\ndef test_b():\n    assert AppTest.from_file("src/ui/weather_dashboard.py")\n',
      },
      { changedFiles: ['src/ui/weather_dashboard.py'] }
    )
    expect(related).toEqual([])
    expect(warnings.some((w) => w.includes('tests/test_app_dynamic.py') && w.includes('static string literal'))).toBe(true)
  })

  it('PY-21: Python related-test selection is deterministic across runs and ranks symbol evidence before file evidence by path', () => {
    const files: Record<string, string> = { ...PY_PROD }
    for (const n of ['c', 'a', 'b']) files[`tests/test_${n}_file.py`] = 'import src.data.weather_query\n\n\ndef test_x():\n    assert True\n'
    files['tests/test_z_symbol.py'] = 'from src.data.weather_query import weather_history\n\n\ndef test_y():\n    assert weather_history("X", 0, 1) == []\n'
    const first = pyContext(createTempRoot('my-dev-kit-py21a-'), files, { changedSymbols: [PY_WH] })
    const second = pyContext(createTempRoot('my-dev-kit-py21b-'), files, { changedSymbols: [PY_WH] })
    expect(second.related).toEqual(first.related)
    expect(first.related.map((t) => t.path)).toEqual(['tests/test_z_symbol.py', 'tests/test_a_file.py', 'tests/test_b_file.py', 'tests/test_c_file.py'])
  })

  it('PY-22: discovery never executes or imports test code and never scans past the existing bounded read size', () => {
    const root = createTempRoot('my-dev-kit-py22-')
    const marker = join(root, 'EXECUTED.marker').replace(/\\/g, '/')
    const huge = 'from streamlit.testing.v1 import AppTest\n' + '# ' + 'x'.repeat(450_000) + '\n' + 'AppTest.from_file("src/ui/weather_dashboard.py")\n'
    const { related } = pyContext(
      root,
      {
        ...PY_PROD,
        'tests/test_side_effect.py': `open("${marker}", "w").write("ran")\nimport src.data.weather_query\n\n\ndef test_a():\n    assert True\n`,
        'tests/test_huge_literal.py': huge,
      },
      { changedFiles: ['src/data/weather_query.py', 'src/ui/weather_dashboard.py'] }
    )
    expect(existsSync(marker)).toBe(false)
    expect(related.some((t) => t.path === 'tests/test_side_effect.py')).toBe(true)
    // The literal sits after the bounded read limit (400 000 bytes): the file is skipped, not partially scanned.
    expect(related.some((t) => t.path === 'tests/test_huge_literal.py')).toBe(false)
  })
})
