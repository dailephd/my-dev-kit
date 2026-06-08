import type { DataModelGraphArtifact, DataModelGraphNode } from '../data-model/dataModelGraphTypes.js'
import { DATA_MODEL_GRAPH_ARTIFACT_KIND } from '../data-model/dataModelGraphTypes.js'
import type { ModelViewLineageArtifact, ModelViewLineageNode } from '../lineage/types.js'
import { MODEL_VIEW_LINEAGE_ARTIFACT_KIND } from '../lineage/types.js'
import type { CodeGraph, CodeGraphNode } from './codeGraphTypes.js'
import type { RenderableGraph } from './renderableGraphTypes.js'

export type GraphArtifactSelection = 'code' | 'data-model' | 'model-view-lineage'

export function adaptCodeGraph(graph: CodeGraph): RenderableGraph {
  if (!graph || typeof graph !== 'object') throw new Error('Invalid code-graph.json: expected an object.')
  if (graph.artifactKind !== 'code-graph') {
    throw new Error('Invalid code-graph.json: artifactKind must be code-graph.')
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Invalid code-graph.json: nodes and edges must be arrays.')
  }
  return {
    id: 'code',
    label: 'CodeGraph',
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: codeNodeLabel(node),
      shape: codeNodeShape(node),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.label ?? edge.kind,
    })),
  }
}

export function adaptDataModelGraph(graph: DataModelGraphArtifact): RenderableGraph {
  if (!graph || typeof graph !== 'object') throw new Error('Invalid data-model-graph.json: expected an object.')
  if (graph.artifactKind !== DATA_MODEL_GRAPH_ARTIFACT_KIND) {
    throw new Error(`Invalid data-model-graph.json: artifactKind must be ${DATA_MODEL_GRAPH_ARTIFACT_KIND}.`)
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Invalid data-model-graph.json: nodes and edges must be arrays.')
  }
  return {
    id: 'data-model',
    label: 'DataModelGraph',
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: dataModelNodeLabel(node),
      shape: node.kind === 'entity' ? 'box' : 'ellipse',
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.kind,
    })),
  }
}

export function adaptModelViewLineageGraph(graph: ModelViewLineageArtifact): RenderableGraph {
  if (!graph || typeof graph !== 'object') throw new Error('Invalid model-view-lineage.json: expected an object.')
  if (graph.artifactKind !== MODEL_VIEW_LINEAGE_ARTIFACT_KIND) {
    throw new Error(`Invalid model-view-lineage.json: artifactKind must be ${MODEL_VIEW_LINEAGE_ARTIFACT_KIND}.`)
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Invalid model-view-lineage.json: nodes and edges must be arrays.')
  }
  return {
    id: 'model-view-lineage',
    label: 'ModelViewLineage',
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: lineageNodeLabel(node),
      shape: lineageNodeShape(node.kind),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.kind,
    })),
  }
}

function codeNodeLabel(node: CodeGraphNode): string {
  if (node.kind === 'file') return node.path ?? node.label
  if (node.kind === 'symbol') {
    const base = node.symbolName ?? node.label
    const roles = compactSemanticRoles(node)
    return roles ? `${base}\n[${roles}]` : base
  }
  return node.label
}

function compactSemanticRoles(node: CodeGraphNode): string | null {
  const roles = [...new Set((node.semanticRoles ?? []).map((role) => role.subtype ?? role.role))]
    .filter(Boolean)
    .slice(0, 2)
  return roles.length > 0 ? roles.join(', ') : null
}

function codeNodeShape(node: CodeGraphNode): string {
  if (node.kind === 'file') return 'box'
  if (node.kind === 'symbol') return 'ellipse'
  return 'oval'
}

function dataModelNodeLabel(node: DataModelGraphNode): string {
  if (node.kind === 'field' && node.parentEntityId && !node.label.includes('.')) {
    const entityName = node.parentEntityId.replace(/^entity:/, '')
    return `${entityName}.${node.label}`
  }
  return node.label
}

function lineageNodeLabel(node: ModelViewLineageNode): string {
  return `${node.label}\n[${node.kind}]`
}

function lineageNodeShape(kind: string): string {
  if (kind === 'data-entity' || kind === 'component') return 'box'
  if (kind === 'transformation') return 'diamond'
  if (kind === 'view-model') return 'ellipse'
  if (kind === 'rendered-field' || kind === 'component-prop' || kind === 'data-field') return 'oval'
  return 'oval'
}
