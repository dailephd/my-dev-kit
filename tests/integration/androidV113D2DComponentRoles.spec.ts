/**
 * v1.13.0 D2-D: component-role evidence is tied to individual declarations.
 * A file-level `androidx.lifecycle.ViewModel` import must not give `MainActivity`
 * or a UI-state data class a `view-model` role, and a ViewModel declared with a
 * multiline primary constructor must still get grounded superclass evidence.
 * Verified end to end over the public example and the combined Android fixture
 * with real `index`, `search` and `context` runs.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const EXAMPLE_ROOT = join(process.cwd(), 'examples', 'basic-android-kotlin')
const COMBINED_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-retrieval', 'combined-app')
const KP = 'app/src/main/kotlin/com/example/kitdemo/'

const tempDirs: string[] = []
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

let publicIndex: string
let combinedIndex: string
let scratch: string

function readJson(index: string, name: string): any {
  return JSON.parse(readFileSync(join(index, name), 'utf8'))
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'my-dev-kit-v113-d2d-'))
  tempDirs.push(scratch)
  publicIndex = join(scratch, 'public')
  const pub = runCli([
    'index', '--root', EXAMPLE_ROOT,
    '--src', 'app/src/main', '--src', 'app/src/test', '--src', 'app/src/androidTest',
    '--out', publicIndex, '--json',
  ])
  expect(pub.status).toBe(0)
  combinedIndex = join(scratch, 'combined')
  const combined = runCli([
    'index', '--root', COMBINED_ROOT,
    '--src', 'app/src/main', '--src', 'app/src/debug', '--src', 'app/src/test', '--src', 'app/src/androidTest', '--src', 'core/src/main',
    '--out', combinedIndex, '--json',
  ])
  expect(combined.status).toBe(0)
}, 240_000)

function components(index: string, file: string, name: string): any[] {
  return readJson(index, 'android-components.json').components.filter((c: any) => c.filePath.endsWith(file) && c.symbolName === name)
}

describe('public example component roles (D2-D)', () => {
  it('keeps MainActivity an Activity only, gives UserUiState no role, and grounds UserViewModel in its multiline superclass', () => {
    expect(components(publicIndex, 'MainActivity.kt', 'MainActivity').map((c) => [c.role, c.confidence])).toEqual([['activity', 'high']])
    expect(components(publicIndex, 'UserViewModel.kt', 'UserUiState')).toEqual([])
    const [viewModel] = components(publicIndex, 'UserViewModel.kt', 'UserViewModel')
    expect(viewModel).toMatchObject({ role: 'view-model', confidence: 'high' })
    expect(viewModel.evidence[0]).toMatchObject({ kind: 'superclass', value: 'ViewModel', confidence: 'high' })
    expect(viewModel.evidence[0].source).toMatch(/UserViewModel\.kt:18-\d+$/)
    expect(readJson(publicIndex, 'android-components.json').components.filter((c: any) => c.role === 'view-model')).toHaveLength(1)
  })

  it('projects the same roles into the graph and the classification artifact', () => {
    const graph = readJson(publicIndex, 'code-graph.json')
    const classification = readJson(publicIndex, 'classification.json')
    const componentRoles = new Map<string, string[]>()
    for (const c of readJson(publicIndex, 'android-components.json').components) {
      componentRoles.set(c.symbolId, [...(componentRoles.get(c.symbolId) ?? []), c.role])
    }
    for (const node of graph.nodes.filter((n: any) => n.id.startsWith('symbol:') && n.androidComponentRoles)) {
      expect(node.androidComponentRoles.map((r: any) => r.role).sort()).toEqual([...(componentRoles.get(node.id) ?? [])].sort())
    }
    const node = (name: string) => graph.nodes.find((n: any) => n.id === `symbol:${KP}${name === 'UserUiState' || name === 'UserViewModel' ? 'UserViewModel' : name}.kt#${name}`)
    expect(node('MainActivity').androidComponentRoles.map((r: any) => r.role)).toEqual(['activity'])
    expect(node('UserUiState').androidComponentRoles).toBeUndefined()
    expect(node('UserViewModel').androidComponentRoles).toEqual([{ role: 'view-model', confidence: 'high' }])

    const entry = (name: string) => classification.entries.find((e: any) => e.targetKind === 'symbol' && e.symbolName === name && e.filePath.startsWith(KP.slice(0, -1)))
    expect(entry('MainActivity').classifications.map((c: any) => c.role)).toEqual(['activity'])
    expect(entry('UserUiState').classifications).toEqual([])
    expect(entry('UserViewModel').classifications.map((c: any) => c.role)).toEqual(['view-model'])
  })

  it('returns only the real ViewModel from search --android-role view-model and keeps the Activity searchable', () => {
    const viewModels = runCli(['search', '--index', publicIndex, '--android-role', 'view-model', '--json'])
    expect(viewModels.status).toBe(0)
    expect(JSON.parse(viewModels.stdout).results.map((r: any) => r.id)).toEqual([`symbol:${KP}UserViewModel.kt#UserViewModel`])
    const activities = runCli(['search', '--index', publicIndex, '--android-role', 'activity', '--json'])
    expect(JSON.parse(activities.stdout).results.map((r: any) => r.id)).toEqual([`symbol:${KP}MainActivity.kt#MainActivity`])
  })

  it('removes the false view-model ambiguity from a repository request without suppressing real ambiguity', () => {
    const run = (query: string): any => {
      const out = join(scratch, `${Math.random().toString(36).slice(2)}.json`)
      const result = runCli(['context', '--index', publicIndex, '--role', 'implementation', '--query', query, '--out', out, '--audit-out', `${out}.audit.json`, '--json'])
      expect(result.status).toBe(0)
      return JSON.parse(readFileSync(out, 'utf8'))
    }
    const repository = run('Change UserRepository data-loading behavior without modifying UserApiService.')
    expect(repository.focus.focusFilePath).toBe(`${KP}data/UserRepository.kt`)
    const refs = JSON.stringify(repository.conflicts.conflicts)
    expect(refs).not.toContain('MainActivity')
    expect(refs).not.toContain('UserUiState')
    // two genuinely supported layers named in one request still report ambiguity
    const multi = run('Change the UserHomeScreen layout and update the UserViewModel state handling.')
    expect(multi.conflicts.conflicts.some((c: any) => c.kind === 'android-ambiguous-owner')).toBe(true)
    // earlier D2-A/D2-B behavior still holds
    expect(run('Change the UserHomeScreen layout without changing the ViewModel.').focus.focusFilePath).toBe(`${KP}UserHomeScreen.kt`)
    expect(run('Update UserViewModel state handling.').focus.focusFilePath).toBe(`${KP}UserViewModel.kt`)
  })
})

describe('combined Android fixture roles (D2-D compatibility)', () => {
  it('keeps the existing component roles and grounds the ViewModel in its superclass', () => {
    const rows = readJson(combinedIndex, 'android-components.json').components.map((c: any) => `${c.symbolName}:${c.role}:${c.confidence}`)
    expect(rows).toEqual(
      expect.arrayContaining([
        'AppDatabase:room-database:high',
        'UserApiService:retrofit-service:high',
        'UserDao:room-dao:high',
        'UserEntity:room-entity:high',
        'UserRepository:repository:medium',
        'UserViewModel:view-model:high',
        'SyncService:service:low',
        'SyncReceiver:broadcast-receiver:low',
        'MainActivity:activity:low',
      ])
    )
    expect(rows.filter((r: string) => r.endsWith(':view-model:high'))).toEqual(['UserViewModel:view-model:high'])
    expect(rows.filter((r: string) => r.includes(':view-model:')).length).toBe(1)
  })

  it('keeps the data-flow dependency facts and Compose ownership', () => {
    const kinds = readJson(combinedIndex, 'android-components.json').dependencyFacts.map((f: any) => `${f.relationshipKind}:${f.matchStatus}`)
    for (const expected of ['viewmodel-uses-repository:resolved', 'repository-uses-dao:resolved', 'repository-uses-service:resolved', 'dao-uses-entity:resolved', 'room-database-exposes-dao:resolved']) {
      expect(kinds).toContain(expected)
    }
    const graph = readJson(combinedIndex, 'code-graph.json')
    const edgeKinds = new Set(graph.edges.map((e: any) => e.kind))
    for (const kind of ['composable-references-viewmodel', 'viewmodel-uses-repository', 'android-test-references-composable']) {
      expect(edgeKinds.has(kind)).toBe(true)
    }
    const out = join(scratch, 'combined-context.json')
    const result = runCli(['context', '--index', combinedIndex, '--role', 'implementation', '--query', 'Change the loading state behavior shown by HomeScreen.', '--out', out, '--audit-out', `${out}.audit.json`, '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8')).focus.focusNodeId).toContain('UserViewModel')
  })
})
