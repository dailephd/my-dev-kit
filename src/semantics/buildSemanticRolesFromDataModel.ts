import type { DataModelArtifact, DataModelEntity, DataModelSourceRef } from '../data-model/types.js'
import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole, SemanticRoleSubtype } from './semanticTypes.js'

export interface SemanticMetadataForSymbol {
  semanticRoles: SemanticRole[]
  artifactRefs: SemanticArtifactRef[]
}

export interface BuildSemanticRolesFromDataModelOptions {
  dataModel: DataModelArtifact
  dataModelPath?: string
  dataModelGraphPath?: string
}

export function buildSemanticRolesFromDataModel(
  options: BuildSemanticRolesFromDataModelOptions
): Map<string, SemanticMetadataForSymbol> {
  const bySymbolId = new Map<string, SemanticMetadataForSymbol>()

  for (const entity of options.dataModel.entities) {
    const symbolIds = entity.sourceRefs
      .map((sourceRef) => sourceRef.symbolId)
      .filter((symbolId): symbolId is string => !!symbolId && !symbolId.split('#').at(-1)?.includes('.'))
    if (symbolIds.length === 0) continue

    const artifactRefs = buildEntityArtifactRefs(entity, options)
    const evidenceRefs = entity.sourceRefs.map(toEvidenceRef)
    const role: SemanticRole = {
      role: 'data-entity',
      subtype: entityKindToSubtype(entity.kind),
      confidence: entity.sourceRefs.some((sourceRef) => sourceRef.symbolId) ? 'explicit' : 'inferred-static',
      source: 'typescript-model-analyzer',
      artifactRefs,
      evidenceRefs,
      warnings: entity.warnings.map((warning) => ({
        kind: warning.kind === 'partial-extraction' ? 'partial-classification' : 'unsupported-pattern',
        message: warning.message,
        artifactRefs,
        evidenceRefs: (warning.sourceRefs ?? []).map(toEvidenceRef),
      })),
    }

    for (const symbolId of symbolIds) {
      const current = bySymbolId.get(symbolId) ?? { semanticRoles: [], artifactRefs: [] }
      current.semanticRoles = [...current.semanticRoles, role]
      current.artifactRefs = mergeArtifactRefs(current.artifactRefs, artifactRefs)
      bySymbolId.set(symbolId, current)
    }
  }

  return bySymbolId
}

function buildEntityArtifactRefs(
  entity: DataModelEntity,
  options: BuildSemanticRolesFromDataModelOptions
): SemanticArtifactRef[] {
  return [
    {
      artifact: options.dataModelPath ?? 'data-model.json',
      artifactKind: 'data-model',
      id: entity.id,
      path: options.dataModelPath ?? 'data-model.json',
    },
    {
      artifact: options.dataModelGraphPath ?? 'data-model-graph.json',
      artifactKind: 'data-model-graph',
      id: `data-model-entity:${entity.name}`,
      path: options.dataModelGraphPath ?? 'data-model-graph.json',
    },
  ]
}

function toEvidenceRef(sourceRef: DataModelSourceRef): SemanticEvidenceRef {
  return {
    filePath: sourceRef.filePath,
    symbolId: sourceRef.symbolId ?? sourceRef.nodeId ?? null,
    line: sourceRef.line ?? null,
    source: sourceRef.evidenceKind ?? null,
    analyzer: 'typescript-model-analyzer',
  }
}

function entityKindToSubtype(kind: DataModelEntity['kind']): SemanticRoleSubtype {
  if (kind === 'canonical-model') return 'canonical-type'
  if (kind === 'schema-model') return 'schema-model'
  if (kind === 'view-model') return 'view-model'
  return 'unknown'
}

function mergeArtifactRefs(left: SemanticArtifactRef[], right: SemanticArtifactRef[]): SemanticArtifactRef[] {
  const merged = new Map<string, SemanticArtifactRef>()
  for (const ref of [...left, ...right]) {
    merged.set(`${ref.artifact}\0${ref.id}`, ref)
  }
  return [...merged.values()]
}
