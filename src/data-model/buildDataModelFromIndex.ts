import * as fs from 'node:fs'
import * as path from 'node:path'
import { ensureInsideProjectRoot } from '../lookup/getSourceSlice.js'
import type { SourceArtifacts } from '../indexing/loadIndexArtifacts.js'
import { loadSourceArtifacts } from '../indexing/loadIndexArtifacts.js'
import type { FileSummary, SymbolIndex } from '../symbol-index/types.js'
import { buildDataModelArtifact } from './buildDataModelArtifact.js'
import { buildDataModelGraph } from './buildDataModelGraph.js'
import { extractTypeScriptDataModels } from './extractors/typescriptModelExtractor.js'
import type { DataModelGraphArtifact } from './dataModelGraphTypes.js'
import type {
  NormalizedDataModelEntityRecord,
  NormalizedDataModelFieldRecord,
  NormalizedDataModelRecordSet,
  NormalizedDataModelRelationshipRecord,
  NormalizedDataModelWarning,
} from './normalizedTypes.js'
import type { DataModelArtifact } from './types.js'

export interface BuildDataModelFromIndexInput {
  indexDir?: string
  artifacts?: SourceArtifacts
  createdAt?: string
}

export interface BuildDataModelFromIndexResult {
  dataModel: DataModelArtifact
  dataModelGraph: DataModelGraphArtifact
  records: NormalizedDataModelRecordSet
  warnings: NormalizedDataModelWarning[]
  candidateFiles: string[]
}

export function buildDataModelFromIndex(input: BuildDataModelFromIndexInput): BuildDataModelFromIndexResult {
  const artifacts = resolveArtifacts(input)
  const manifest = artifacts.resolved.manifest
  const symbolIndex = artifacts.symbolIndex
  if (!symbolIndex) {
    throw new Error('Loaded source artifacts must include symbolIndex.')
  }

  const candidateFiles = selectTypeScriptCandidateFiles(symbolIndex)
  const combinedRecords: NormalizedDataModelRecordSet = {
    entities: [],
    fields: [],
    relationships: [],
    warnings: [],
  }

  for (const filePath of candidateFiles) {
    const absolutePath = ensureInsideProjectRoot(manifest.projectRoot, filePath)
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      combinedRecords.warnings.push({
        kind: 'missing-source',
        message: `Indexed source file is missing: ${filePath}`,
        entityName: null,
        fieldName: null,
        toEntityName: null,
        sourceRefs: [{ filePath, evidenceKind: 'symbol-index', line: 1 }],
      })
      continue
    }

    const sourceText = fs.readFileSync(absolutePath, 'utf8')
    const extracted = extractTypeScriptDataModels({
      filePath,
      sourceText,
    })
    appendRecords(combinedRecords, extracted.records)
  }

  const dataModel = buildDataModelArtifact({
    records: combinedRecords,
    createdAt: input.createdAt ?? manifest.createdAt,
  })
  const dataModelGraph = buildDataModelGraph({
    artifact: dataModel,
    createdAt: input.createdAt ?? manifest.createdAt,
  })

  return {
    dataModel,
    dataModelGraph,
    records: normalizeCombinedRecords(combinedRecords),
    warnings: collectWarnings(combinedRecords),
    candidateFiles,
  }
}

function resolveArtifacts(input: BuildDataModelFromIndexInput): SourceArtifacts & { symbolIndex: SymbolIndex } {
  if (input.artifacts) {
    if (!input.artifacts.symbolIndex) {
      throw new Error('Loaded source artifacts must include symbolIndex.')
    }
    return input.artifacts as SourceArtifacts & { symbolIndex: SymbolIndex }
  }

  if (!input.indexDir) {
    throw new Error('buildDataModelFromIndex requires either indexDir or loaded artifacts.')
  }

  const loaded = loadSourceArtifacts({
    indexDir: input.indexDir,
    loadSymbolIndex: true,
  })
  if (!loaded.symbolIndex) {
    throw new Error('Missing required symbol index artifact.')
  }
  return loaded as SourceArtifacts & { symbolIndex: SymbolIndex }
}

function selectTypeScriptCandidateFiles(symbolIndex: SymbolIndex): string[] {
  return symbolIndex.files
    .filter((file) => isCandidateTypeScriptFile(file))
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right))
}

function isCandidateTypeScriptFile(file: FileSummary): boolean {
  const ext = path.extname(file.path).toLowerCase()
  if (ext !== '.ts' && ext !== '.tsx') return false
  return file.symbols.some((symbol) => symbol.exported && (symbol.kind === 'interface' || symbol.kind === 'type' || symbol.kind === 'class'))
}

function appendRecords(target: NormalizedDataModelRecordSet, incoming: NormalizedDataModelRecordSet): void {
  target.entities.push(...incoming.entities)
  target.fields.push(...incoming.fields)
  target.relationships.push(...incoming.relationships)
  target.warnings.push(...incoming.warnings)
}

function normalizeCombinedRecords(records: NormalizedDataModelRecordSet): NormalizedDataModelRecordSet {
  return {
    entities: [...records.entities].sort((left, right) => left.name.localeCompare(right.name)),
    fields: [...records.fields].sort((left, right) =>
      [left.entityName, left.fieldName].join('\0').localeCompare([right.entityName, right.fieldName].join('\0'))
    ),
    relationships: [...records.relationships].sort((left, right) =>
      [
        left.kind,
        left.fromEntityName,
        left.fromFieldName ?? '',
        left.toEntityName,
        left.toFieldName ?? '',
      ]
        .join('\0')
        .localeCompare(
          [
            right.kind,
            right.fromEntityName,
            right.fromFieldName ?? '',
            right.toEntityName,
            right.toFieldName ?? '',
          ].join('\0')
        )
    ),
    warnings: collectWarnings(records),
  }
}

function collectWarnings(records: NormalizedDataModelRecordSet): NormalizedDataModelWarning[] {
  return [
    ...records.warnings,
    ...records.entities.flatMap((entity) => entity.warnings),
    ...records.fields.flatMap((field) => field.warnings),
    ...records.relationships.flatMap((relationship) => relationship.warnings),
  ].sort((left, right) =>
    [
      left.kind,
      left.entityName ?? '',
      left.fieldName ?? '',
      left.toEntityName ?? '',
      left.message,
      left.sourceRefs?.[0]?.filePath ?? '',
      String(left.sourceRefs?.[0]?.line ?? -1),
    ]
      .join('\0')
      .localeCompare(
        [
          right.kind,
          right.entityName ?? '',
          right.fieldName ?? '',
          right.toEntityName ?? '',
          right.message,
          right.sourceRefs?.[0]?.filePath ?? '',
          String(right.sourceRefs?.[0]?.line ?? -1),
        ].join('\0')
      )
  )
}
