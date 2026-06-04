import {
  DATA_MODEL_GRAPH_ARTIFACT_KIND,
  type DataModelGraphArtifact,
  type DataModelGraphEdge,
  type DataModelGraphNode,
} from './dataModelGraphTypes.js'
import { DATA_MODEL_SCHEMA_VERSION, type DataModelArtifact, type DataModelRelationship } from './types.js'

export interface BuildDataModelGraphInput {
  artifact: DataModelArtifact
  createdAt?: string
}

export function buildDataModelGraph(input: BuildDataModelGraphInput): DataModelGraphArtifact {
  const createdAt = input.createdAt ?? input.artifact.createdAt
  const entityNodes: DataModelGraphNode[] = input.artifact.entities
    .map((entity) => ({
      id: buildEntityNodeId(entity.name),
      kind: 'entity' as const,
      label: entity.name,
      entityId: entity.id,
      fieldId: null,
      parentEntityId: null,
      sourceRefs: [...entity.sourceRefs],
      warnings: [...entity.warnings],
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const fieldNodes: DataModelGraphNode[] = input.artifact.entities
    .flatMap((entity) =>
      entity.fields.map((field) => ({
        id: buildFieldNodeId(entity.name, field.name),
        kind: 'field' as const,
        label: `${entity.name}.${field.name}`,
        entityId: entity.id,
        fieldId: field.id,
        parentEntityId: entity.id,
        sourceRefs: [...field.sourceRefs],
        warnings: [...field.warnings],
      }))
    )
    .sort((left, right) => left.id.localeCompare(right.id))

  const hasFieldEdges: DataModelGraphEdge[] = input.artifact.entities
    .flatMap((entity) =>
      entity.fields.map((field) => ({
        id: `data-model-edge:has-field:${entity.name}.${field.name}`,
        source: buildEntityNodeId(entity.name),
        target: buildFieldNodeId(entity.name, field.name),
        kind: 'has-field' as const,
        relationshipId: null,
        sourceRefs: [...field.sourceRefs],
        warnings: [...field.warnings],
      }))
    )
    .sort((left, right) => left.id.localeCompare(right.id))

  const relationshipCounts = new Map<string, number>()
  const relationshipEdges = [...input.artifact.relationships]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((relationship) => buildRelationshipEdge(relationship, input.artifact, relationshipCounts))
    .sort((left, right) => left.id.localeCompare(right.id))

  const nodes = [...entityNodes, ...fieldNodes]
  const edges = [...hasFieldEdges, ...relationshipEdges]
  const warningCount =
    input.artifact.warnings.length +
    nodes.reduce((count, node) => count + node.warnings.length, 0) +
    edges.reduce((count, edge) => count + edge.warnings.length, 0)

  return {
    artifactKind: DATA_MODEL_GRAPH_ARTIFACT_KIND,
    schemaVersion: DATA_MODEL_SCHEMA_VERSION,
    createdAt,
    nodes,
    edges,
    warnings: [...input.artifact.warnings],
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      entityNodeCount: entityNodes.length,
      fieldNodeCount: fieldNodes.length,
      relationshipEdgeCount: relationshipEdges.length,
      warningCount,
    },
  }
}

function buildRelationshipEdge(
  relationship: DataModelRelationship,
  artifact: DataModelArtifact,
  relationshipCounts: Map<string, number>
): DataModelGraphEdge {
  const fromEntity = artifact.entities.find((entity) => entity.id === relationship.fromEntityId)
  const toEntity = artifact.entities.find((entity) => entity.id === relationship.toEntityId)
  if (!fromEntity || !toEntity) {
    throw new Error(`Relationship references missing entity: ${relationship.id}`)
  }

  const edgeKind = relationship.kind === 'derives-from' ? 'derives-from' : 'relates-to'
  const signature = `${edgeKind}:${fromEntity.name}:${toEntity.name}:${relationship.id}`
  const index = relationshipCounts.get(signature) ?? 0
  relationshipCounts.set(signature, index + 1)

  return {
    id: `data-model-edge:${edgeKind}:${fromEntity.name}:${toEntity.name}:${index}`,
    source: buildEntityNodeId(fromEntity.name),
    target: buildEntityNodeId(toEntity.name),
    kind: edgeKind,
    relationshipId: relationship.id,
    sourceRefs: [...relationship.sourceRefs],
    warnings: [...relationship.warnings],
  }
}

function buildEntityNodeId(entityName: string): string {
  return `data-model-entity:${entityName}`
}

function buildFieldNodeId(entityName: string, fieldName: string): string {
  return `data-model-field:${entityName}.${fieldName}`
}
