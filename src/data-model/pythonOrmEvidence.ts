import type { FileSummary, PythonOrmFact } from '../symbol-index/types.js'
import { PythonAdapter } from '../languages/python/adapter.js'
import { normalizeDeclarationFile, parseDeclarationNodeId } from '../symbol-index/declarationIdentity.js'
import type { NormalizedDataModelRecordSet, NormalizedDataModelSourceRef } from './normalizedTypes.js'

/** Physical declaration identity uses validated inherited symbol IDs only. */
export function normalizePythonOrmEvidence(files: readonly FileSummary[]): NormalizedDataModelRecordSet {
  const records: NormalizedDataModelRecordSet = { entities: [], fields: [], relationships: [], warnings: [] }
  const models: Array<{ file: FileSummary; fact: PythonOrmFact; key: string }> = []
  for (const file of files) {
    if (file.language !== 'python') continue
    try { if (normalizeDeclarationFile(file.path) !== file.path) continue } catch { continue }
    for (const fact of file.pythonOrmFacts ?? []) {
      const declarations = file.symbols.filter(s => s.kind === 'class' && s.name === fact.name && s.location.file === file.path && s.location.line === fact.line && s.nodeId === fact.nodeId)
      if (!fact.nodeId || declarations.length !== 1) continue
      try {
        const identity = parseDeclarationNodeId(fact.nodeId)
        if (identity?.filePath !== file.path || identity.symbolName !== fact.name) continue
      } catch { continue }
      models.push({ file, fact, key: `python:${encodeURIComponent(file.path)}#${encodeURIComponent(fact.nodeId)}` })
    }
  }
  models.sort((a, b) => a.key.localeCompare(b.key))
  const adapter = new PythonAdapter()
  const paths = files.filter(f => f.language === 'python').map(f => f.path)
  const importedDeclaration = (file: FileSummary, reference: string) => {
    const parts = reference.split('.')
    const imports = (file.frameworkRouteFacts ?? []).filter(f => f.kind === 'import' && f.name === parts[0])
    if (imports.length !== 1) return undefined
    const binding = imports[0]
    if (!binding.module) return undefined
    const targetName = binding.importedName && parts.length === 1 ? binding.importedName : !binding.importedName && parts.slice(0, -1).join('.') === binding.qualifier ? parts.at(-1) : undefined
    if (!targetName) return undefined
    const targetFile = adapter.resolveImportToFile('.'.repeat(binding.relativeLevel ?? 0) + binding.module.replace(/^\.+/, ''), file.path, paths)
    return { filePath: targetFile, name: targetName }
  }
  const baseIdentity = (model: typeof models[number]): string | undefined => {
    if (!model.fact.baseReference) return undefined
    if (model.fact.ownership !== 'unresolved') return `${model.file.path}#${model.fact.baseReference}`
    const imported = importedDeclaration(model.file, model.fact.baseReference)
    const bases = models.filter(m => m.fact.declarativeBase && m.file.path === imported?.filePath && m.fact.name === imported?.name && !m.fact.ownerKey)
    return bases.length === 1 ? `${bases[0].file.path}#${bases[0].fact.name}` : undefined
  }
  const grounded = models.filter(m => !m.fact.declarativeBase && (m.fact.ownership !== 'unresolved' || baseIdentity(m) !== undefined))
  const columnName = (field: PythonOrmFact['fields'][number]): string => typeof field.options.name === 'string' ? field.options.name : typeof field.options.arg0 === 'string' ? field.options.arg0 : field.name
  const ref = (m: typeof models[number], line: number): NormalizedDataModelSourceRef[] => [{ filePath: m.file.path, symbolId: m.fact.nodeId, nodeId: m.fact.nodeId, line, evidenceKind: 'source' }]
  for (const model of grounded) {
    const { file, fact, key } = model
    records.entities.push({ name: fact.name, entityKey: key, sourceLanguage: 'python', ormFamily: fact.family, kind: 'schema-model', sourceRefs: ref(model, fact.line), warnings: [] })
    for (const [ordinal, field] of fact.fields.entries()) {
      const sourceRefs = ref(model, field.line)
      const warnings: NormalizedDataModelRecordSet['warnings'] = []
      const candidates = () => {
        if (!field.target || field.unresolved || field.targetKind === 'dynamic') return []
        if (field.target === 'self' && field.targetKind === 'string') return [model]
        if (field.targetKind === 'foreign-key') {
          const parts = field.target.split('.')
          if (parts.length !== 2) return []
          return grounded.filter(m => m.fact.family === 'sqlalchemy' && baseIdentity(m) === baseIdentity(model) && baseIdentity(model) !== undefined && m.fact.table === parts[0] && m.fact.fields.filter(f => columnName(f) === parts[1]).length === 1)
        }
        if (field.targetKind === 'string') return grounded.filter(m => m.fact.family === fact.family && m.fact.name === field.target && (fact.family === 'django' || baseIdentity(m) === baseIdentity(model)))
        const local = grounded.filter(m => m.file.path === file.path && m.fact.family === fact.family && m.fact.name === field.target && m.fact.ownerKey === fact.ownerKey)
        if (local.length) return local
        // Strings name a runtime ORM registry; no global simple-name guessing.
        if (field.targetKind !== 'name') return []
        const imported = importedDeclaration(file, field.target)
        return grounded.filter(m => m.file.path === imported?.filePath && m.fact.family === fact.family && m.fact.name === imported?.name && !m.fact.ownerKey)
      }
      if (field.relationship) {
        const targets = candidates()
        if (targets.length === 1) {
          const targetField = field.targetKind === 'foreign-key' ? targets[0].fact.fields.find(f => columnName(f) === field.target?.split('.')[1]) : undefined
          records.relationships.push({ fromEntityName: fact.name, fromEntityKey: key, toEntityName: targets[0].fact.name, toEntityKey: targets[0].key, fromFieldName: field.name, ...(targetField ? { toFieldName: targetField.name } : {}), kind: field.relationship, confidence: 'explicit', sourceRefs, warnings: [], occurrence: `${file.path}:${field.line}:${ordinal}` })
        } else {
          warnings.push({ kind: targets.length > 1 ? 'ambiguous-relationship' : 'skipped-dynamic-pattern', message: `Unresolved ${fact.family} relationship ${fact.name}.${field.name}: ${field.target ?? 'dynamic'}`, sourceRefs })
        }
      }
      records.fields.push({ entityName: fact.name, entityKey: key, fieldName: field.name, typeText: field.type, options: field.options, optional: field.options.blank === true || field.options.default !== undefined, nullable: field.options.null === true || field.options.nullable === true, cardinality: field.relationship === 'many-to-many' ? 'many' : 'one', sourceRefs, warnings })
    }
  }
  return records
}
