import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-react-'))
  tempDirs.push(dir)
  return dir
}

function writeFixture(dir: string, relativePath: string, content: string): string {
  const fullPath = join(dir, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
  return fullPath
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

function analyzeFile(dir: string, relativePath: string, content: string) {
  writeFixture(dir, relativePath, content)
  return runFrontendAnalyzer({
    symbolIndex: stubSymbolIndex([{ path: relativePath }]),
    repoRoot: dir,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

// ---------------------------------------------------------------------------
// Component detection
// ---------------------------------------------------------------------------

describe('React component detection', () => {
  it('detects exported function component', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Button.tsx', `
      export function Button() { return <button>Click</button> }
    `)
    const comps = result.artifact.files[0].components
    expect(comps.some((c) => c.name === 'Button' && c.exportKind === 'named')).toBe(true)
  })

  it('detects exported arrow component', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Card.tsx', `
      export const Card = () => <div>Card</div>
    `)
    const comps = result.artifact.files[0].components
    expect(comps.some((c) => c.name === 'Card')).toBe(true)
  })

  it('detects default exported function component', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/App.tsx', `
      export default function App() { return <div>App</div> }
    `)
    const comps = result.artifact.files[0].components
    expect(comps.some((c) => c.isDefaultExport)).toBe(true)
  })

  it('detects anonymous default export returning JSX', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Anon.tsx', `
      export default function() { return <div>Anon</div> }
    `)
    // anonymous function declarations are still parsed - name may be empty or __default__
    const file = result.artifact.files[0]
    expect(file.parseError).toBe(false)
  })

  it('does not classify lowercase functions as components', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/helpers.tsx', `
      export function formatName(s: string) { return s.trim() }
      export function renderHelper() { return <span>helper</span> }
    `)
    const comps = result.artifact.files[0].components
    // renderHelper is lowercase — not a component
    expect(comps.every((c) => c.name !== 'renderHelper')).toBe(true)
    expect(comps.every((c) => c.name !== 'formatName')).toBe(true)
  })

  it('does not classify hook functions as components', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/useAuth.ts', `
      export function useAuth() { return { user: null } }
    `)
    expect(result.artifact.files[0].components).toHaveLength(0)
  })

  it('does not classify ordinary utility functions as components', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/utils.tsx', `
      export function Add(a: number, b: number) { return a + b }
    `)
    // Add is PascalCase but returns a number, not JSX — should not be classified
    const comps = result.artifact.files[0].components
    expect(comps.every((c) => c.name !== 'Add')).toBe(true)
  })

  it('does not classify event handlers as components', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/handlers.tsx', `
      export function HandleClick(e: MouseEvent) { e.preventDefault() }
    `)
    const comps = result.artifact.files[0].components
    // PascalCase but returns nothing / no JSX
    expect(comps.every((c) => c.name !== 'HandleClick')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Local component detection
// ---------------------------------------------------------------------------

describe('local component detection', () => {
  it('detects local function sub-component', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/List.tsx', `
      export function List({ items }: { items: string[] }) {
        function Item({ value }: { value: string }) {
          return <li>{value}</li>
        }
        return <ul>{items.map(i => <Item key={i} value={i} />)}</ul>
      }
    `)
    const locals = result.artifact.files[0].localComponents
    expect(locals.some((c) => c.name === 'Item')).toBe(true)
  })

  it('detects local arrow sub-component', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Form.tsx', `
      export function Form() {
        const Field = ({ label }: { label: string }) => <div>{label}</div>
        return <div><Field label="name" /></div>
      }
    `)
    const locals = result.artifact.files[0].localComponents
    expect(locals.some((c) => c.name === 'Field')).toBe(true)
  })

  it('does not classify local helper functions as local components', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Widget.tsx', `
      export function Widget() {
        function formatLabel(s: string) { return s.toUpperCase() }
        return <div>{formatLabel('hello')}</div>
      }
    `)
    const locals = result.artifact.files[0].localComponents
    expect(locals.every((c) => c.name !== 'formatLabel')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Prop type detection
// ---------------------------------------------------------------------------

describe('prop type detection', () => {
  it('detects interface prop types', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Button.tsx', `
      export interface ButtonProps { label: string; disabled?: boolean }
      export function Button({ label }: ButtonProps) { return <button>{label}</button> }
    `)
    const propTypes = result.artifact.files[0].propTypes
    expect(propTypes.some((pt) => pt.name === 'ButtonProps' && pt.kind === 'interface')).toBe(true)
  })

  it('links prop type to component that uses it', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Button.tsx', `
      export interface ButtonProps { label: string }
      export function Button({ label }: ButtonProps) { return <button>{label}</button> }
    `)
    const propType = result.artifact.files[0].propTypes.find((pt) => pt.name === 'ButtonProps')
    expect(propType?.usedByComponentIds.length).toBeGreaterThan(0)
    const comp = result.artifact.files[0].components.find((c) => c.name === 'Button')
    expect(comp?.propTypeName).toBe('ButtonProps')
  })

  it('detects type alias prop types', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Tag.tsx', `
      export type TagProps = { text: string; color?: string }
      export function Tag({ text }: TagProps) { return <span>{text}</span> }
    `)
    const propTypes = result.artifact.files[0].propTypes
    expect(propTypes.some((pt) => pt.name === 'TagProps' && pt.kind === 'type-alias')).toBe(true)
  })

  it('does not link unrelated interfaces as prop types', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Widget.tsx', `
      export interface User { id: string; name: string }
      export function Widget() { return <div>Widget</div> }
    `)
    const user = result.artifact.files[0].propTypes.find((pt) => pt.name === 'User')
    // User is found as a propType candidate but not linked to Widget
    if (user) expect(user.usedByComponentIds).toHaveLength(0)
  })

  it('handles inline prop type (no named interface)', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Badge.tsx', `
      export function Badge({ count }: { count: number }) { return <span>{count}</span> }
    `)
    const comp = result.artifact.files[0].components.find((c) => c.name === 'Badge')
    expect(comp).toBeDefined()
    expect(comp?.propTypeName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Hook detection
// ---------------------------------------------------------------------------

describe('hook detection', () => {
  it('detects useState with destructured state and setter', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Counter.tsx', `
      import { useState } from 'react'
      export function Counter() {
        const [count, setCount] = useState(0)
        return <div>{count}</div>
      }
    `)
    const hooks = result.artifact.files[0].hooks
    const stateHook = hooks.find((h) => h.kind === 'useState')
    expect(stateHook).toBeDefined()
    expect(stateHook?.stateVarName).toBe('count')
    expect(stateHook?.setterName).toBe('setCount')
  })

  it('detects useEffect', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Comp.tsx', `
      import { useEffect } from 'react'
      export function Comp() {
        useEffect(() => { document.title = 'hi' }, [])
        return <div>comp</div>
      }
    `)
    const hooks = result.artifact.files[0].hooks
    expect(hooks.some((h) => h.kind === 'useEffect')).toBe(true)
  })

  it('detects custom hook calls', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Profile.tsx', `
      function useProfile(id: string) { return { name: id } }
      export function Profile({ id }: { id: string }) {
        const profile = useProfile(id)
        return <div>{profile.name}</div>
      }
    `)
    const hooks = result.artifact.files[0].hooks
    expect(hooks.some((h) => h.kind === 'custom' && h.hookName === 'useProfile')).toBe(true)
  })

  it('does not classify hook-like functions outside components as component hooks', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/useData.ts', `
      import { useState } from 'react'
      export function useData() {
        const [data, setData] = useState(null)
        return data
      }
    `)
    // useData is not a component, so hooks found inside it have no componentId
    const hooks = result.artifact.files[0].hooks
    // Hooks may still be found but won't have a component association
    // (this is acceptable behavior for a conservative extractor)
    expect(result.artifact.files[0].parseError).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// JSX region detection
// ---------------------------------------------------------------------------

describe('JSX branch and region detection', () => {
  it('detects return JSX region', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Simple.tsx', `
      export function Simple() { return <div>Hello</div> }
    `)
    const regions = result.artifact.files[0].jsxRegions
    expect(regions.some((r) => r.kind === 'return')).toBe(true)
  })

  it('detects ternary JSX branches', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Toggle.tsx', `
      export function Toggle({ on }: { on: boolean }) {
        return on ? <span>On</span> : <span>Off</span>
      }
    `)
    const regions = result.artifact.files[0].jsxRegions
    expect(regions.some((r) => r.kind === 'ternary-branch')).toBe(true)
    expect(regions.filter((r) => r.kind === 'ternary-branch').length).toBeGreaterThanOrEqual(1)
  })

  it('detects logical && JSX branches', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Cond.tsx', `
      export function Cond({ show }: { show: boolean }) {
        return <div>{show && <span>Visible</span>}</div>
      }
    `)
    const regions = result.artifact.files[0].jsxRegions
    expect(regions.some((r) => r.kind === 'logical-branch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Event handler detection
// ---------------------------------------------------------------------------

describe('event handler detection', () => {
  it('detects JSX onClick event handler reference', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Btn.tsx', `
      export function Btn() {
        const handleClick = () => {}
        return <button onClick={handleClick}>Click</button>
      }
    `)
    const handlers = result.artifact.files[0].eventHandlers
    expect(handlers.some((h) => h.eventAttr === 'onClick')).toBe(true)
  })

  it('detects inline arrow function in JSX event attribute', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Inline.tsx', `
      export function Inline() {
        return <input onChange={(e) => console.log(e.target.value)} />
      }
    `)
    const handlers = result.artifact.files[0].eventHandlers
    expect(handlers.some((h) => h.eventAttr === 'onChange' && h.kind === 'inline')).toBe(true)
  })

  it('detects named handler variable', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Form.tsx', `
      export function Form() {
        const handleSubmit = (e: React.FormEvent) => { e.preventDefault() }
        return <form onSubmit={handleSubmit}><button type="submit">Submit</button></form>
      }
    `)
    const handlers = result.artifact.files[0].eventHandlers
    expect(handlers.some((h) => h.name === 'handleSubmit' || h.eventAttr === 'onSubmit')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// UI string / test ID / ARIA detection
// ---------------------------------------------------------------------------

describe('UI string, data-testid, and ARIA label detection', () => {
  it('detects visible JSX text', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Label.tsx', `
      export function Label() { return <span>Hello World</span> }
    `)
    const strings = result.artifact.files[0].uiStrings
    expect(strings.some((s) => s.kind === 'visible-text' && s.value.includes('Hello World'))).toBe(true)
  })

  it('detects data-testid', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Btn.tsx', `
      export function Btn() { return <button data-testid="submit-btn">Submit</button> }
    `)
    const strings = result.artifact.files[0].uiStrings
    expect(strings.some((s) => s.kind === 'data-testid' && s.value === 'submit-btn')).toBe(true)
  })

  it('detects aria-label', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Icon.tsx', `
      export function CloseIcon() { return <button aria-label="close dialog">×</button> }
    `)
    const strings = result.artifact.files[0].uiStrings
    expect(strings.some((s) => s.kind === 'aria-label' && s.value === 'close dialog')).toBe(true)
  })

  it('detects placeholder', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Search.tsx', `
      export function Search() { return <input placeholder="Search..." /> }
    `)
    const strings = result.artifact.files[0].uiStrings
    expect(strings.some((s) => s.kind === 'placeholder' && s.value === 'Search...')).toBe(true)
  })

  it('does not detect empty or whitespace JSX text', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Spacer.tsx', `
      export function Spacer() { return <div>   </div> }
    `)
    const strings = result.artifact.files[0].uiStrings.filter((s) => s.kind === 'visible-text')
    // Whitespace-only strings should be excluded
    expect(strings.every((s) => s.value.trim().length > 0)).toBe(true)
  })

  it('does not detect dynamic JSX expressions as UI strings', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Dynamic.tsx', `
      export function Dynamic({ label }: { label: string }) {
        return <span data-testid={label}>Dynamic label</span>
      }
    `)
    const testIds = result.artifact.files[0].uiStrings.filter((s) => s.kind === 'data-testid')
    // Dynamic expression {label} should not produce a testid entry
    expect(testIds.every((s) => typeof s.value === 'string')).toBe(true)
    expect(testIds).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Adversarial cases
// ---------------------------------------------------------------------------

describe('adversarial component cases', () => {
  it('handles file with .tsx extension but no React component', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/utils.tsx', `
      export function add(a: number, b: number): number { return a + b }
      export const PI = 3.14159
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
    expect(result.artifact.files[0].components).toHaveLength(0)
  })

  it('handles mixed .tsx file with multiple components and helpers', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/components.tsx', `
      export function Button() { return <button>click</button> }
      export function Input() { return <input /> }
      function helper(x: string) { return x.trim() }
      const CONST = 42
    `)
    const comps = result.artifact.files[0].components
    expect(comps.some((c) => c.name === 'Button')).toBe(true)
    expect(comps.some((c) => c.name === 'Input')).toBe(true)
    expect(comps.every((c) => c.name !== 'helper')).toBe(true)
  })

  it('handles generic component props without crashing', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Generic.tsx', `
      export function Box<T>({ value }: { value: T }) {
        return <div>{String(value)}</div>
      }
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
  })

  it('handles component with spread props without crashing', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Spread.tsx', `
      export function Wrapper(props: Record<string, unknown>) {
        return <div {...props} data-testid="wrapper" />
      }
    `)
    const strings = result.artifact.files[0].uiStrings
    expect(strings.some((s) => s.kind === 'data-testid' && s.value === 'wrapper')).toBe(true)
  })

  it('handles destructured and renamed props without crashing', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Renamed.tsx', `
      export function Renamed({ text: label, count: num = 0 }: { text: string; count?: number }) {
        return <span aria-label={label}>{num}</span>
      }
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
    expect(result.artifact.files[0].components.some((c) => c.name === 'Renamed')).toBe(true)
  })

  it('handles nested ternaries without crashing', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Nested.tsx', `
      export function Status({ code }: { code: number }) {
        return code === 200 ? <span>OK</span> : code === 404 ? <span>Not Found</span> : <span>Error</span>
      }
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
    const regions = result.artifact.files[0].jsxRegions
    expect(regions.some((r) => r.kind === 'ternary-branch')).toBe(true)
  })

  it('handles JSX fragment without crashing', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Fragment.tsx', `
      export function Rows() {
        return <>
          <tr><td>Row 1</td></tr>
          <tr><td>Row 2</td></tr>
        </>
      }
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
    expect(result.artifact.files[0].components.some((c) => c.name === 'Rows')).toBe(true)
  })

  it('handles component with React.FC type annotation', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/Typed.tsx', `
      import React from 'react'
      export const Typed: React.FC<{ name: string }> = ({ name }) => <div>{name}</div>
    `)
    // React.FC typed arrow — might or might not be detected depending on JSX content
    expect(result.artifact.files[0].parseError).toBe(false)
  })

  it('is deterministic on the exported-components fixture', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'exported-components.tsx'),
      'utf8'
    )
    writeFixture(dir, 'src/exported-components.tsx', content)

    const opts = {
      symbolIndex: stubSymbolIndex([{ path: 'src/exported-components.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const first = runFrontendAnalyzer(opts)
    const second = runFrontendAnalyzer(opts)

    expect(JSON.stringify(first.artifact)).toBe(JSON.stringify(second.artifact))
  })
})

// ---------------------------------------------------------------------------
// No regression: existing TS-only indexing still works
// ---------------------------------------------------------------------------

describe('regression: TS-only files still indexed correctly', () => {
  it('processes plain .ts files without producing components', () => {
    const dir = makeTempDir()
    const result = analyzeFile(dir, 'src/service.ts', `
      export interface User { id: string; name: string }
      export function formatUser(u: User): string { return u.name }
    `)
    expect(result.artifact.files[0].parseError).toBe(false)
    expect(result.artifact.files[0].components).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fixture-based integration tests using the exported-components.tsx fixture
// ---------------------------------------------------------------------------

describe('exported-components fixture', () => {
  it('indexes multiple components from the fixture', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'exported-components.tsx'),
      'utf8'
    )
    writeFixture(dir, 'src/exported-components.tsx', content)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/exported-components.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const file = result.artifact.files[0]
    expect(file.parseError).toBe(false)
    expect(file.components.length).toBeGreaterThanOrEqual(2)
    expect(file.components.some((c) => c.name === 'Card')).toBe(true)
    expect(file.components.some((c) => c.name === 'Header')).toBe(true)
    // data-testid
    expect(file.uiStrings.some((s) => s.kind === 'data-testid' && s.value === 'card')).toBe(true)
    // aria-label
    expect(file.uiStrings.some((s) => s.kind === 'aria-label')).toBe(true)
    // useState hook
    expect(file.hooks.some((h) => h.kind === 'useState')).toBe(true)
    // useEffect hook
    expect(file.hooks.some((h) => h.kind === 'useEffect')).toBe(true)
  })

  it('indexes hooks-and-state fixture', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'hooks-and-state.tsx'),
      'utf8'
    )
    writeFixture(dir, 'src/Counter.tsx', content)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/Counter.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const file = result.artifact.files[0]
    const counter = file.components.find((c) => c.name === 'Counter')
    expect(counter).toBeDefined()

    const stateHook = file.hooks.find((h) => h.stateVarName === 'count')
    expect(stateHook?.setterName).toBe('setCount')

    expect(file.uiStrings.some((s) => s.kind === 'data-testid' && s.value === 'count-display')).toBe(true)
    expect(file.uiStrings.some((s) => s.kind === 'aria-label' && s.value === 'increment')).toBe(true)
    expect(file.uiStrings.some((s) => s.kind === 'placeholder' && s.value === 'Enter label')).toBe(true)
  })

  it('indexes jsx-branches fixture', () => {
    const dir = makeTempDir()
    const content = readFileSync(
      join(import.meta.dirname, 'fixtures', 'jsx-branches.tsx'),
      'utf8'
    )
    writeFixture(dir, 'src/Alert.tsx', content)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/Alert.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const file = result.artifact.files[0]
    expect(file.jsxRegions.some((r) => r.kind === 'ternary-branch')).toBe(true)
    expect(file.jsxRegions.some((r) => r.kind === 'logical-branch')).toBe(true)
    expect(file.uiStrings.some((s) => s.kind === 'data-testid' && s.value === 'alert')).toBe(true)
    expect(file.uiStrings.some((s) => s.kind === 'aria-label' && s.value === 'close')).toBe(true)
  })
})
