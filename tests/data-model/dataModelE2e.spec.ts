import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdk-data-model-e2e-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

function write(root: string, relativePath: string, contents: string): void {
  const fullPath = join(root, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, contents, 'utf8')
}

describe('data-model end-to-end flow', () => {
  it('runs index plus data-model generation, lookup, and trace-view without changing code-graph semantics', () => {
    const root = makeTempRepo()
    write(
      root,
      'src/models.tsx',
      `export interface User {
  id: string
  email: string
  displayName: string
}

export type UserViewModel = {
  email: string
  displayName: string
}

export class UserRecord {
  id!: string
  email!: string
}

export function buildUserViewModel(user: User): UserViewModel {
  return {
    email: user.email,
    displayName: user.displayName,
  }
}

type UserCardProps = {
  email: string
}

export function UserCard(props: UserCardProps) {
  return <span>{props.email}</span>
}

const sampleUser: User = {
  id: '1',
  email: 'user@example.com',
  displayName: 'Ada',
}

const userViewModel = buildUserViewModel(sampleUser)

export function UserScreen() {
  return (
    <section>
      <UserCard email={userViewModel.email} />
      <p>{userViewModel.displayName}</p>
    </section>
  )
}

export type WrappedUser = Partial<User>
`
    )

    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(indexResult.status).toBe(0)

    const indexDir = join(root, '.my-dev-kit')
    const codeGraphPath = join(indexDir, 'code-graph.json')
    expect(existsSync(codeGraphPath)).toBe(true)
    const beforeCodeGraph = readFileSync(codeGraphPath, 'utf8')

    const generateResult = runCli(['data-model', '--index', indexDir, '--out', indexDir, '--json'])
    expect(generateResult.status).toBe(0)
    const generated = JSON.parse(generateResult.stdout)
    expect(generated.mode).toBe('generate')
    expect(generated.entityCount).toBeGreaterThanOrEqual(3)
    expect(generated.warningCount).toBeGreaterThan(0)
    expect(existsSync(join(indexDir, 'data-model.json'))).toBe(true)
    expect(existsSync(join(indexDir, 'data-model-graph.json'))).toBe(true)
    expect(readFileSync(codeGraphPath, 'utf8')).toBe(beforeCodeGraph)

    const dataModel = JSON.parse(readFileSync(join(indexDir, 'data-model.json'), 'utf8'))
    expect(dataModel.entities.some((entity: { name: string }) => entity.name === 'User')).toBe(true)
    expect(dataModel.entities.some((entity: { name: string }) => entity.name === 'UserViewModel')).toBe(true)

    const entityLookup = runCli(['data-model', '--index', indexDir, '--entity', 'User', '--json'])
    expect(entityLookup.status).toBe(0)
    expect(JSON.parse(entityLookup.stdout)).toMatchObject({
      status: 'ok',
      mode: 'entity',
      entity: { name: 'User' },
    })

    const fieldLookup = runCli(['data-model', '--index', indexDir, '--field', 'User.email', '--json'])
    expect(fieldLookup.status).toBe(0)
    expect(JSON.parse(fieldLookup.stdout)).toMatchObject({
      status: 'ok',
      mode: 'field',
      entity: { name: 'User' },
      field: { name: 'email' },
    })

    const traceEntity = runCli(['data-model', '--index', indexDir, '--trace-view', 'User', '--json'])
    expect(traceEntity.status).toBe(0)
    const tracedEntity = JSON.parse(traceEntity.stdout)
    expect(tracedEntity.mode).toBe('trace-entity')
    expect(tracedEntity.lineageNodeCount).toBeGreaterThan(0)
    expect(tracedEntity.lineageEdgeCount).toBeGreaterThan(0)
    expect(existsSync(join(indexDir, 'model-view-lineage.json'))).toBe(true)

    const traceField = runCli(['data-model', '--index', indexDir, '--field', 'User.email', '--trace-view', '--json'])
    expect(traceField.status).toBe(0)
    expect(JSON.parse(traceField.stdout)).toMatchObject({
      status: 'ok',
      mode: 'trace-field',
      entity: { name: 'User' },
      field: { name: 'email' },
    })

    const lineage = JSON.parse(readFileSync(join(indexDir, 'model-view-lineage.json'), 'utf8'))
    expect(Array.isArray(lineage.nodes)).toBe(true)
    expect(Array.isArray(lineage.edges)).toBe(true)
    expect(readFileSync(codeGraphPath, 'utf8')).toBe(beforeCodeGraph)
  })
})
