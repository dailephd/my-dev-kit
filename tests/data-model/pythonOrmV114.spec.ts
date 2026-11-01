import { describe, it, expect } from 'vitest'
import { PythonAdapter } from '../../src/languages/python/adapter.js'
import { normalizePythonOrmEvidence } from '../../src/data-model/pythonOrmEvidence.js'
import { buildDataModelArtifact } from '../../src/data-model/buildDataModelArtifact.js'
import { buildDataModelGraph } from '../../src/data-model/buildDataModelGraph.js'
import { lookupDataModelEntity, lookupDataModelField } from '../../src/data-model/lookupDataModelNode.js'
import { buildSemanticRolesFromDataModel } from '../../src/semantics/buildSemanticRolesFromDataModel.js'
import { applySemanticRolesToSymbolIndex } from '../../src/semantics/applySemanticRolesToSymbolIndex.js'
import { buildModelViewLineage } from '../../src/lineage/buildModelViewLineage.js'
import type { FileSummary, SymbolIndex } from '../../src/symbol-index/types.js'

const adapter = new PythonAdapter()
function file(path: string, source: string): FileSummary {
  return { ...adapter.extractFromSource(path, source), path, hasCallGraphEntries: false }
}
function artifact(files: FileSummary[]) { return buildDataModelArtifact({ records: normalizePythonOrmEvidence(files) }) }
const django = `from django.db import models as m
class User(m.Model):
    name = m.CharField(max_length=80, null=True)
class Book(m.Model):
    author = m.ForeignKey(User, on_delete=m.CASCADE)
    spouse = m.OneToOneField('User', on_delete=m.CASCADE)
    readers = m.ManyToManyField('User')
    unknown = m.ForeignKey(runtime(), on_delete=m.CASCADE)
`
const key = (path: string, name: string) => `python:${encodeURIComponent(path)}#${encodeURIComponent(`symbol:${path}#${name}`)}`

describe('B04 Python ORM evidence', () => {
  it('extracts aliased Django fields, exact relationships and source-qualified physical IDs', () => {
    const model = artifact([file('pkg/models.py', django)])
    const userId = `entity:${key('pkg/models.py', 'User')}`
    const book = model.entities.find(e => e.name === 'Book')!
    expect(book.id).toBe(`entity:${key('pkg/models.py', 'Book')}`)
    expect(model.relationships.map(r => [r.kind, r.toEntityId])).toEqual(expect.arrayContaining([['many-to-one', userId], ['one-to-one', userId], ['many-to-many', userId]]))
    expect(model.relationships).toHaveLength(3)
    expect(book.fields.find(f => f.name === 'unknown')?.warnings.length).toBeGreaterThan(0)
    const user = lookupDataModelEntity(model, userId).entity
    expect(user.fields[0]).toMatchObject({ id: `field:${key('pkg/models.py', 'User')}#name`, nullable: true, options: { max_length: 80, null: true } })
    expect(lookupDataModelField(model, user.fields[0].id).field.id).toBe(user.fields[0].id)
    expect(lookupDataModelField(model, 'User.name').field.id).toBe(user.fields[0].id)
    const graph = buildDataModelGraph({ artifact: model })
    expect(graph.nodes.find(n => n.id === user.id)?.entityId).toBe(user.id)
    expect(graph.nodes.find(n => n.id === user.fields[0].id)?.fieldId).toBe(user.fields[0].id)
    const ids = new Set(graph.nodes.map(n => n.id))
    expect(graph.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true)
    expect(new Set(graph.edges.map(e => e.id)).size).toBe(graph.edges.length)
  })

  it.each(['from django.db.models import Model as M, TextField as T\nclass User(M):\n    name = T()\n', 'import django.db.models as dm\nclass User(dm.Model):\n    name = dm.TextField()\n'])('supports verified Django import forms', source => {
    expect(artifact([file('m.py', source)]).entities[0]?.fields[0].typeText).toBe('TextField')
  })

  it('retains every supported Django scalar field and literal options', () => {
    const types = ['CharField', 'TextField', 'IntegerField', 'BooleanField', 'DateField', 'DateTimeField', 'DecimalField']
    const model = artifact([file('m.py', 'from django.db import models\nclass Values(models.Model):\n' + types.map((t, i) => `    f${i} = models.${t}(null=True, default=0)`).join('\n'))])
    expect(model.entities[0].fields.map(f => f.typeText)).toEqual(types)
  })

  it('preserves separate same-named models and rejects ambiguous name selectors and registry strings', () => {
    const files = [file('a.py', django), file('b.py', django), file('c.py', `from django.db import models\nclass Other(models.Model):\n    owner = models.ForeignKey('User', on_delete=models.CASCADE)\n`)]
    const model = artifact(files)
    expect(model.entities.filter(e => e.name === 'User')).toHaveLength(2)
    expect(() => lookupDataModelEntity(model, 'User')).toThrow(/Ambiguous/)
    expect(() => lookupDataModelField(model, 'User.name')).toThrow(/Ambiguous/)
    expect(model.relationships.filter(r => r.fromEntityId === `entity:${key('c.py', 'Other')}`)).toEqual([])
    expect(model.relationships.filter(r => r.fromFieldId?.endsWith('#spouse') || r.fromFieldId?.endsWith('#readers'))).toEqual([])
    expect(model.relationships.filter(r => r.fromEntityId === `entity:${key('a.py', 'Book')}`).every(r => r.toEntityId === `entity:${key('a.py', 'User')}`)).toBe(true)
    expect(() => lookupDataModelField(model, 'field:missing.py#x')).toThrow(/not found/)
    expect(() => lookupDataModelField(model, 'User.name.extra')).toThrow(/format/)
    expect(() => lookupDataModelEntity(model, '')).toThrow(/Invalid/)
  })

  it('grounds SQLAlchemy declarative bases, mapped fields, exact local and table relationships', () => {
    const source = `from sqlalchemy.orm import DeclarativeBase as DB, Mapped, mapped_column as col, relationship
from sqlalchemy import Column, Integer, ForeignKey
class Base(DB): pass
class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = col(Integer, primary_key=True)
class Book(Base):
    owner_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    owner: Mapped[User] = relationship(User)
    unknown = relationship(runtime())
`
    const model = artifact([file('sa.py', source)])
    expect(model.entities.map(e => e.name).sort()).toEqual(['Book', 'User'])
    expect(model.relationships).toHaveLength(2)
    expect(model.relationships.every(r => r.toEntityId === `entity:${key('sa.py', 'User')}`)).toBe(true)
    expect(model.entities.find(e => e.name === 'User')?.fields[0]).toMatchObject({ options: { primary_key: true, mappedType: 'int', columnType: 'sqlalchemy.Integer' } })
    expect(model.relationships.some(r => r.fromFieldId?.endsWith('#unknown'))).toBe(false)
  })

  it.each([
    'class Model: pass\nclass Fake(Model):\n    name = CharField()\n',
    'class Base: pass\nclass Fake(Base):\n    id = Column(Integer)\n',
    'from django.db import models\nmodels = other\nclass Fake(models.Model): pass\n',
    'if FLAG:\n    from django.db import models\nclass Fake(models.Model): pass\n',
    'from sqlalchemy.orm import DeclarativeBase\nclass Base(DeclarativeBase): pass\nclass Fake(Base, UnknownMixin): pass\n',
    'def broken(:\n',
  ])('does not invent ORM ownership for unsupported evidence', source => {
    expect(artifact([file('negative.py', source)]).entities).toEqual([])
    expect(artifact([file('negative.py', source)]).relationships).toEqual([])
  })

  it('uses exact semantic IDs/provenance and actual graph artifact references without replacing other roles', () => {
    const f = file('pkg/models.py', django)
    const model = artifact([f])
    const metadata = buildSemanticRolesFromDataModel({ dataModel: model })
    const user = f.symbols.find(s => s.name === 'User')!
    user.semanticRoles = [{ role: 'data-entity', subtype: 'unknown', confidence: 'explicit', source: 'unrelated' }]
    const index = { files: [f], graph: { symbols: [{ ...user, file: f.path, line: user.location.line }], fileDeps: [] } } as unknown as SymbolIndex
    const enriched = applySemanticRolesToSymbolIndex(index, metadata)
    expect(enriched.files[0].symbols.find(s => s.nodeId === user.nodeId)?.semanticRoles?.map(r => r.source)).toEqual(['unrelated', 'python-orm-analyzer'])
    expect(enriched.graph!.symbols[0].semanticRoles?.map(r => r.source)).toEqual(['unrelated', 'python-orm-analyzer'])
    const graphIds = new Set(buildDataModelGraph({ artifact: model }).nodes.map(n => n.id))
    for (const entry of metadata.values()) {
      expect(entry.semanticRoles[0].evidenceRefs?.every(r => r.analyzer === 'python-orm-analyzer')).toBe(true)
      expect(entry.artifactRefs.filter(r => r.artifactKind === 'data-model-graph').every(r => graphIds.has(r.id))).toBe(true)
    }
    const qualified = 'symbolq:pkg%2Fmodels.py#owner#User#0'
    const qualifiedModel = structuredClone(model)
    qualifiedModel.entities[0].sourceRefs[0].symbolId = qualified
    const projected = applySemanticRolesToSymbolIndex({ files: [{ ...f, symbols: [{ ...user, nodeId: qualified }] }] } as SymbolIndex, buildSemanticRolesFromDataModel({ dataModel: qualifiedModel }))
    expect(projected.files[0].symbols[0].semanticRoles?.some(r => r.source === 'python-orm-analyzer')).toBe(true)
  })

  it('keeps TypeScript lineage and legacy IDs stable when Python names collide', () => {
    const tsEntity = { id: 'entity:User', name: 'User', kind: 'canonical-model' as const, fields: [{ id: 'field:User.name', name: 'name', typeText: 'string', optional: false, nullable: false, cardinality: 'one' as const, sourceRefs: [{ filePath: 'models.ts' }], warnings: [] }], relationships: [], sourceRefs: [{ filePath: 'models.ts', symbolId: 'symbol:models.ts#User' }], warnings: [] }
    const sourceFiles = [{ filePath: 'view.tsx', sourceText: 'export function buildUserViewModel(user: User) { return { name: user.name } }' }]
    const python = artifact([file('m.py', django)])
    const baseline = { ...python, entities: [tsEntity], relationships: [] }
    const before = buildModelViewLineage({ dataModel: baseline, sourceFiles }).artifact
    expect(before.edges.find(e => e.kind === 'reads-field')).toMatchObject({ source: 'lineage:data-field:field:User.name', target: 'lineage:transformation:view.tsx#buildUserViewModel' })
    const after = buildModelViewLineage({ dataModel: { ...baseline, entities: [tsEntity, ...python.entities] }, sourceFiles }).artifact
    expect(after.edges).toEqual(before.edges)
    expect(after.nodes.filter(n => n.dataModelEntityId === tsEntity.id)).toEqual(before.nodes.filter(n => n.dataModelEntityId === tsEntity.id))
    expect(after.edges.every(e => !JSON.stringify(e).includes('entity:python:'))).toBe(true)
    const upper = { ...tsEntity, sourceRefs: [{ filePath: 'models.TS', symbolId: 'symbol:models.TS#User' }] }
    const upperLineage = buildModelViewLineage({ dataModel: { ...baseline, entities: [upper, ...python.entities] }, sourceFiles }).artifact
    expect(upperLineage.edges.find(e => e.kind === 'reads-field')).toMatchObject({ source: 'lineage:data-field:field:User.name', target: 'lineage:transformation:view.tsx#buildUserViewModel' })
  })

  it('retains nested Django declaration IDs and attaches roles to that exact B03 declaration', () => {
    const f = file('nested.py', 'from django.db import models\nclass Outer:\n    class User(models.Model):\n        name = models.TextField()\n')
    const model = artifact([f])
    const id = 'symbolq:nested.py#python%2Fclass%3AOuter#User#0'
    expect(model.entities[0].id).toBe(`entity:python:nested.py#${encodeURIComponent(id)}`)
    expect(model.entities[0].sourceRefs[0].symbolId).toBe(id)
    const metadata = buildSemanticRolesFromDataModel({ dataModel: model })
    expect([...metadata.keys()]).toEqual([id])
    expect(metadata.get(id)?.semanticRoles[0].source).toBe('python-orm-analyzer')
  })

  it('verifies imported declarative-base ownership and cross-file exact model references', () => {
    const base = file('pkg/base.py', 'from sqlalchemy.orm import DeclarativeBase\nclass Base(DeclarativeBase): pass\n')
    const user = file('pkg/users.py', "from .base import Base\nfrom sqlalchemy.orm import Mapped, mapped_column\nclass User(Base):\n    id: Mapped[int] = mapped_column(primary_key=True)\n")
    const book = file('pkg/books.py', 'from .base import Base\nfrom .users import User as Owner\nfrom sqlalchemy.orm import relationship\nclass Book(Base):\n    owner = relationship(Owner)\n')
    const model = artifact([base, user, book])
    expect(model.entities.map(e => e.name).sort()).toEqual(['Book', 'User'])
    expect(model.relationships.map(r => r.toEntityId)).toEqual([`entity:${key('pkg/users.py', 'User')}`])
    const unrelated = file('pkg/base.py', 'class Base: pass\n')
    expect(artifact([unrelated, user, book]).entities).toEqual([])
    expect(artifact([unrelated, user, book]).relationships).toEqual([])
  })

  it('rejects ambiguous table/registry strings and preserves literal type arguments', () => {
    const model = artifact([file('sa.py', `from sqlalchemy.orm import DeclarativeBase, mapped_column, relationship
from sqlalchemy import ForeignKey, String
class Base(DeclarativeBase): pass
class Left(Base):
    __tablename__ = 'users'
    id = mapped_column(String(80))
class Right(Base):
    __tablename__ = 'users'
    id = mapped_column(String(80))
class Book(Base):
    owner = mapped_column(ForeignKey('users.id'))
    unknown = relationship('User')
`)])
    expect(model.relationships).toEqual([])
    expect(model.entities.find(e => e.name === 'Left')?.fields[0].options).toMatchObject({ columnType: 'sqlalchemy.String', typeArg0: 80 })
  })

  it('preserves signed literal options and resolves an explicit database column name to its exact field', () => {
    const model = artifact([file('sa.py', `from sqlalchemy.orm import DeclarativeBase, mapped_column
from sqlalchemy import ForeignKey, Integer
class Base(DeclarativeBase): pass
class User(Base):
    __tablename__ = 'users'
    id = mapped_column('user_id', Integer, default=-1)
class Book(Base):
    owner_id = mapped_column(ForeignKey('users.user_id'))
`)])
    expect(model.entities.find(e => e.name === 'User')?.fields[0].options?.default).toBe(-1)
    expect(model.relationships.map(r => [r.toEntityId, r.toFieldId])).toEqual([[`entity:${key('sa.py', 'User')}`, `field:${key('sa.py', 'User')}#id`]])
  })
})
