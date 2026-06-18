import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeProject(content: string, path = 'src/Tree.tsx'): { projectDir: string; indexDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-react-flow-src-'))
  const indexDir = join(projectDir, '.idx')
  tempDirs.push(projectDir)
  const fullPath = join(projectDir, path)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
  const result = runCli(['index', '--root', projectDir, '--src', 'src', '--out', indexDir])
  if (result.status !== 0) throw new Error(`Index failed: ${result.stderr || result.stdout}`)
  return { projectDir, indexDir }
}

function complexFixture(lineEnding = '\n'): string {
  return [
    "import React from 'react'",
    "import { ImportedChild } from './external'",
    '',
    'interface ParentProps {',
    '  initialLabel: string',
    '}',
    '',
    'type ChildProps = {',
    '  title: string',
    '  model: { id: string }',
    '  onSelect?: (id: string) => void',
    '}',
    '',
    'function Child({ title, model, onSelect = () => {}, ...rest }: ChildProps) {',
    '  const alias = onSelect',
    '  function GrandChild({ onSelect }: { onSelect: () => void }) {',
    '    return <button onClick={() => onSelect()}>{title}</button>',
    '  }',
    '  return <GrandChild onSelect={() => alias(model.id)} {...rest} />',
    '}',
    '',
    'function OtherChild({ title }: { title: string }) {',
    '  return <span>{title}</span>',
    '}',
    '',
    'export function Parent({ initialLabel }: ParentProps) {',
    "  const [selected, setSelected] = React.useState('')",
    '  const cards = [{ id: initialLabel }]',
    '  const makeTitle = () => selected || initialLabel',
    '  const handleSelect = (id: string) => {',
    '    if (selected) setSelected(id)',
    '  }',
    '  const handlerFactory = (id: string) => () => setSelected(id)',
    '  return (',
    '    <>',
    '      {selected && <Child title={makeTitle()} model={{ id: selected }} onSelect={handleSelect} />}',
    '      {cards.map(card => <Child key={card.id} title={card.id} model={{ id: card.id }} onSelect={() => setSelected(card.id)} />)}',
    '      <Child {...{ title: initialLabel, model: { id: initialLabel }, onSelect: handlerFactory(initialLabel) }} />',
    '      <ImportedChild title="ignored" />',
    '      <OtherChild title="sibling" />',
    '    </>',
    '  )',
    '}',
    '',
    'export function UnrelatedSibling() {',
    '  return <OtherChild title="unrelated" />',
    '}',
    '',
  ].join(lineEnding)
}

describe('source --include-local-component-tree', () => {
  it('returns a bounded JSON edit bundle with components, props, callbacks, handlers, state, branches, helpers, and prop references', () => {
    const { indexDir } = makeProject(complexFixture())
    const result = runCli([
      'source',
      '--index', indexDir,
      '--symbol', 'Parent',
      '--include-local-component-tree',
      '--format', 'json',
      '--max-lines', '120',
    ])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.mode).toBe('local-component-tree')
    expect(parsed.requestedSymbol).toBe('Parent')
    expect(parsed.rootComponent.name).toBe('Parent')
    expect(parsed.maxLineCap).toBe(120)

    const kinds = parsed.includedBlocks.map((block: { kind: string }) => block.kind)
    expect(kinds).toContain('root-component')
    expect(kinds).toContain('root-props-type')
    expect(kinds).toContain('local-child-component')
    expect(kinds).toContain('child-props-type')
    expect(kinds).toContain('prop-assignment')
    expect(kinds).toContain('callback-invocation')
    expect(kinds).toContain('event-handler')
    expect(kinds).toContain('state-access')
    expect(kinds).toContain('jsx-branch')
    expect(kinds).toContain('helper-function')
    expect(kinds).toContain('prop-reference')

    const serialized = JSON.stringify(parsed)
    expect(serialized).toContain('react-passes-callback-prop')
    expect(serialized).toContain('react-callback-invoked-by-child')
    expect(serialized).toContain('react-handler-sets-state')
    expect(serialized).toContain('react-state-controls-jsx-branch')
    expect(serialized).toContain('onSelect')
    expect(serialized).not.toContain('UnrelatedSibling()')
  })

  it('renders grouped numbered output without silently dumping the full file', () => {
    const { indexDir } = makeProject(complexFixture('\r\n'))
    const result = runCli([
      'source',
      '--index', indexDir,
      '--symbol', 'Parent',
      '--include-local-component-tree',
      '--format', 'numbered',
      '--max-lines', '90',
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('### root-component: Parent')
    expect(result.stdout).toContain('# reason:')
    expect(result.stdout).toMatch(/\d+\s*\|/)
    expect(result.stdout).not.toContain('export function UnrelatedSibling')
  })

  it('supports removed-prop filtering with conservative candidate references', () => {
    const { indexDir } = makeProject(complexFixture())
    const result = runCli([
      'source',
      '--index', indexDir,
      '--symbol', 'Parent',
      '--include-local-component-tree',
      '--prop', 'onSelect',
      '--format', 'json',
      '--max-lines', '120',
    ])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const serialized = JSON.stringify(parsed)
    expect(serialized).toContain('onSelect')
    expect(parsed.includedBlocks.some((block: { kind: string }) => block.kind === 'prop-reference')).toBe(true)
    expect(parsed.includedBlocks.some((block: { kind: string; relationshipSummaries: string[] }) =>
      block.kind === 'prop-reference' && block.relationshipSummaries.some((summary) => summary.includes('prop=onSelect'))
    )).toBe(true)
  })

  it('reports skipped and truncated blocks when the max-line cap is reached', () => {
    const { indexDir } = makeProject(complexFixture())
    const result = runCli([
      'source',
      '--index', indexDir,
      '--symbol', 'Parent',
      '--include-local-component-tree',
      '--format', 'json',
      '--max-lines', '8',
    ])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.truncation.truncated).toBe(true)
    expect(parsed.skippedBlocks.length).toBeGreaterThan(0)
    expect(parsed.truncation.emittedLineCount).toBeLessThanOrEqual(8)
  })

  it('rejects unknown and ambiguous component symbols safely', () => {
    const { indexDir } = makeProject([
      'export function Duplicate() { return <div /> }',
      'export function Parent() { return <Duplicate /> }',
    ].join('\n'), 'src/A.tsx')
    const otherPath = join(indexDir, '..', 'src', 'B.tsx')
    writeFileSync(otherPath, 'export function Duplicate() { return <div /> }\n')
    const reindex = runCli(['index', '--root', join(indexDir, '..'), '--src', 'src', '--out', indexDir])
    expect(reindex.status).toBe(0)

    const missing = runCli(['source', '--index', indexDir, '--symbol', 'Missing', '--include-local-component-tree'])
    expect(missing.status).not.toBe(0)
    expect(missing.stderr + missing.stdout).toContain('not found')

    const ambiguous = runCli(['source', '--index', indexDir, '--symbol', 'Duplicate', '--include-local-component-tree'])
    expect(ambiguous.status).not.toBe(0)
    expect(ambiguous.stderr + ambiguous.stdout).toContain('Ambiguous')
  })

  it('handles missing or malformed frontend artifacts safely', () => {
    const { indexDir } = makeProject('export const value = 1\n', 'src/plain.ts')
    const missing = runCli(['source', '--index', indexDir, '--symbol', 'Parent', '--include-local-component-tree'])
    expect(missing.status).not.toBe(0)
    expect(missing.stderr + missing.stdout).toMatch(/frontend semantic|not found/i)
  })

  it('keeps existing exact-match and React-region retrieval behavior working', () => {
    const { indexDir } = makeProject(complexFixture())
    const exact = runCli(['source', '--index', indexDir, '--contains', 'handlerFactory', '--format', 'json'])
    expect(exact.status).toBe(0)
    expect(JSON.parse(exact.stdout).matchCount).toBeGreaterThan(0)

    const region = runCli(['source', '--index', indexDir, '--react-region', 'Parent', '--file', 'src/Tree.tsx'])
    expect(region.status).toBe(0)
    expect(region.stdout).toContain('Parent')
  })
})

describe('slice React flow flags', () => {
  it('includes prop-flow and event-handler relationships when requested without changing depth-zero defaults', () => {
    const { indexDir } = makeProject(complexFixture())
    const node = 'symbol:src/Tree.tsx#Parent'

    const base = runCli(['slice', '--index', indexDir, '--node', node, '--depth', '0', '--json'])
    expect(base.status).toBe(0)
    const baseParsed = JSON.parse(base.stdout)
    expect(baseParsed.edges).toHaveLength(0)

    const propFlow = runCli(['slice', '--index', indexDir, '--node', node, '--depth', '0', '--include-prop-flow', '--json'])
    expect(propFlow.status).toBe(0)
    const propParsed = JSON.parse(propFlow.stdout)
    expect(propParsed.edges.some((edge: { kind: string }) => edge.kind === 'react-passes-prop')).toBe(true)
    expect(propParsed.edges.some((edge: { kind: string }) => edge.kind === 'react-passes-callback-prop')).toBe(true)
    expect(JSON.stringify(propParsed)).toContain('frontendRelationshipId')

    const eventFlow = runCli(['slice', '--index', indexDir, '--node', node, '--depth', '0', '--include-event-handlers', '--json'])
    expect(eventFlow.status).toBe(0)
    const eventParsed = JSON.parse(eventFlow.stdout)
    expect(eventParsed.edges.some((edge: { kind: string }) => edge.kind === 'react-event-uses-handler')).toBe(true)
    expect(eventParsed.edges.some((edge: { kind: string }) => edge.kind === 'react-handler-sets-state')).toBe(true)
  })
})
