import * as path from 'node:path'
import * as fs from 'node:fs'
import type { Command } from 'commander'
import {
  buildDataModelFromIndex,
  lookupDataModelEntity,
  lookupDataModelField,
  readDataModelArtifacts,
  writeDataModelArtifacts,
  type NormalizedDataModelWarning,
} from '../data-model/index.js'
import { toForwardSlash } from '../io/pathUtils.js'
import {
  buildModelViewLineage,
  MODEL_VIEW_LINEAGE_ARTIFACT_FILENAME,
  MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
  MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
  writeModelViewLineage,
  type ModelViewLineageArtifact,
  type ModelViewLineageWarning,
} from '../lineage/index.js'
import type { IndexManifest } from '../indexing/manifestTypes.js'

interface DataModelCommandOptions {
  index?: string
  out?: string
  entity?: string
  field?: string
  traceView?: boolean | string
  json?: boolean
}

export function registerDataModelCommand(program: Command): void {
  program
    .command('data-model')
    .description('Build or inspect data-model artifacts from an existing index.')
    .option('--index <dir>', 'index artifact directory')
    .option('--out <dir>', 'output directory for data-model artifacts; defaults to --index')
    .option('--entity <name-or-id>', 'inspect an exact entity from existing data-model artifacts')
    .option('--field <entity.field>', 'inspect an exact field from existing data-model artifacts')
    .option('--trace-view [entity]', 'build conservative static model-to-view lineage for an entity or the selected field')
    .option('--json', 'print JSON output')
    .action(async (options: DataModelCommandOptions) => {
      if (!options.index) throw new Error('The data-model command requires --index <dir>.')
      if (options.traceView && options.entity) {
        throw new Error('The data-model command cannot combine --entity with --trace-view.')
      }
      if (options.entity && options.field) {
        throw new Error('The data-model command accepts either --entity or --field, but not both.')
      }

      if (options.traceView) {
        const result = runTraceMode(options)
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printTraceSummary(result)
        return
      }

      if (options.entity || options.field) {
        const result = runLookupMode(options)
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printLookupSummary(result)
        return
      }

      const result = runGenerationMode(options)
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printGenerationSummary(result)
    })
}

function runGenerationMode(options: DataModelCommandOptions): {
  status: 'ok'
  mode: 'generate'
  indexDir: string
  outDir: string
  dataModelPath: string
  dataModelGraphPath: string
  entityCount: number
  fieldCount: number
  relationshipCount: number
  graphNodeCount: number
  graphEdgeCount: number
  warningCount: number
  warnings: NormalizedDataModelWarning[]
} {
  const indexDir = path.resolve(options.index!)
  const outDir = path.resolve(options.out ?? options.index!)
  const buildResult = buildDataModelFromIndex({ indexDir })
  const writeResult = writeDataModelArtifacts({
    outputDir: outDir,
    dataModel: buildResult.dataModel,
    dataModelGraph: buildResult.dataModelGraph,
  })

  return {
    status: 'ok',
    mode: 'generate',
    indexDir: toForwardSlash(indexDir),
    outDir: toForwardSlash(writeResult.outputDir),
    dataModelPath: toForwardSlash(writeResult.dataModelPath),
    dataModelGraphPath: toForwardSlash(writeResult.dataModelGraphPath),
    entityCount: writeResult.entityCount,
    fieldCount: writeResult.fieldCount,
    relationshipCount: writeResult.relationshipCount,
    graphNodeCount: writeResult.graphNodeCount,
    graphEdgeCount: writeResult.graphEdgeCount,
    warningCount: buildResult.warnings.length,
    warnings: buildResult.warnings,
  }
}

function runLookupMode(options: DataModelCommandOptions):
  | {
      status: 'ok'
      mode: 'entity'
      indexDir: string
      artifactDir: string
      entity: ReturnType<typeof lookupDataModelEntity>['entity']
      sourceRefs: ReturnType<typeof lookupDataModelEntity>['sourceRefs']
      warnings: ReturnType<typeof lookupDataModelEntity>['warnings']
    }
  | {
      status: 'ok'
      mode: 'field'
      indexDir: string
      artifactDir: string
      entity: ReturnType<typeof lookupDataModelField>['entity']
      field: ReturnType<typeof lookupDataModelField>['field']
      sourceRefs: ReturnType<typeof lookupDataModelField>['sourceRefs']
      warnings: ReturnType<typeof lookupDataModelField>['warnings']
    } {
  const indexDir = path.resolve(options.index!)
  const artifactDir = path.resolve(options.out ?? options.index!)
  const loaded = readDataModelArtifacts(artifactDir)

  if (options.entity) {
    const found = lookupDataModelEntity(loaded.dataModel, options.entity)
    return {
      status: 'ok',
      mode: 'entity',
      indexDir: toForwardSlash(indexDir),
      artifactDir: toForwardSlash(loaded.outputDir),
      entity: found.entity,
      sourceRefs: found.sourceRefs,
      warnings: found.warnings,
    }
  }

  const found = lookupDataModelField(loaded.dataModel, options.field!)
  return {
    status: 'ok',
    mode: 'field',
    indexDir: toForwardSlash(indexDir),
    artifactDir: toForwardSlash(loaded.outputDir),
    entity: found.entity,
    field: found.field,
    sourceRefs: found.sourceRefs,
    warnings: found.warnings,
  }
}

function runTraceMode(options: DataModelCommandOptions):
  | {
      status: 'ok'
      mode: 'trace-entity'
      indexDir: string
      outDir: string
      modelViewLineagePath: string
      entity: { id: string; name: string }
      lineageNodeCount: number
      lineageEdgeCount: number
      warningCount: number
      lineage: { nodes: ModelViewLineageArtifact['nodes']; edges: ModelViewLineageArtifact['edges'] }
      warnings: ModelViewLineageWarning[]
    }
  | {
      status: 'ok'
      mode: 'trace-field'
      indexDir: string
      outDir: string
      modelViewLineagePath: string
      entity: { id: string; name: string }
      field: { id: string; name: string; typeText: string }
      lineageNodeCount: number
      lineageEdgeCount: number
      warningCount: number
      lineage: { nodes: ModelViewLineageArtifact['nodes']; edges: ModelViewLineageArtifact['edges'] }
      warnings: ModelViewLineageWarning[]
    } {
  if (options.field && typeof options.traceView === 'string') {
    throw new Error('The data-model command does not accept an entity value for --trace-view when --field is used.')
  }
  if (!options.field && options.traceView === true) {
    throw new Error('The data-model command requires --trace-view <entity> or --field <entity.field> --trace-view.')
  }

  const indexDir = path.resolve(options.index!)
  const outDir = path.resolve(options.out ?? options.index!)
  const buildResult = buildDataModelFromIndex({ indexDir })
  writeDataModelArtifacts({
    outputDir: outDir,
    dataModel: buildResult.dataModel,
    dataModelGraph: buildResult.dataModelGraph,
  })

  const lineageResult = buildModelViewLineage({
    dataModel: buildResult.dataModel,
    indexDir,
  })
  const writeResult = writeModelViewLineage({
    outputDir: outDir,
    lineage: lineageResult.artifact,
  })
  updateManifestWithLineageArtifact(outDir, lineageResult.artifact)

  if (options.field) {
    const fieldLookup = lookupDataModelField(buildResult.dataModel, options.field)
    const filtered = filterLineageByField(lineageResult.artifact, fieldLookup.field.id)
    return {
      status: 'ok',
      mode: 'trace-field',
      indexDir: toForwardSlash(indexDir),
      outDir: toForwardSlash(outDir),
      modelViewLineagePath: toForwardSlash(writeResult.modelViewLineagePath),
      entity: {
        id: fieldLookup.entity.id,
        name: fieldLookup.entity.name,
      },
      field: {
        id: fieldLookup.field.id,
        name: fieldLookup.field.name,
        typeText: fieldLookup.field.typeText,
      },
      lineageNodeCount: filtered.nodes.length,
      lineageEdgeCount: filtered.edges.length,
      warningCount: filtered.warnings.length,
      lineage: filtered,
      warnings: filtered.warnings,
    }
  }

  const entitySelector = typeof options.traceView === 'string' ? options.traceView : ''
  const entityLookup = lookupDataModelEntity(buildResult.dataModel, entitySelector)
  const filtered = filterLineageByEntity(lineageResult.artifact, entityLookup.entity.id)
  return {
    status: 'ok',
    mode: 'trace-entity',
    indexDir: toForwardSlash(indexDir),
    outDir: toForwardSlash(outDir),
    modelViewLineagePath: toForwardSlash(writeResult.modelViewLineagePath),
    entity: {
      id: entityLookup.entity.id,
      name: entityLookup.entity.name,
    },
    lineageNodeCount: filtered.nodes.length,
    lineageEdgeCount: filtered.edges.length,
    warningCount: filtered.warnings.length,
    lineage: filtered,
    warnings: filtered.warnings,
  }
}

function updateManifestWithLineageArtifact(outDir: string, lineage: ModelViewLineageArtifact): void {
  const manifestPath = path.join(outDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as IndexManifest
  manifest.semanticArtifacts = {
    dataModel: manifest.semanticArtifacts?.dataModel ?? 'data-model.json',
    dataModelGraph: manifest.semanticArtifacts?.dataModelGraph ?? 'data-model-graph.json',
    modelViewLineage: MODEL_VIEW_LINEAGE_ARTIFACT_FILENAME,
    frontendSemantic: manifest.semanticArtifacts?.frontendSemantic ?? null,
  }
  const warningCount = lineage.summary.warningCount
  const analyzer = {
    id: 'model-view-lineage' as const,
    status: warningCount > 0 ? 'partial' as const : 'complete' as const,
    version: MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
    schemaVersion: lineage.schemaVersion,
    artifacts: [
      {
        name: 'modelViewLineage',
        path: MODEL_VIEW_LINEAGE_ARTIFACT_FILENAME,
        artifactKind: MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
      },
    ],
    warningCount,
    errorCount: 0,
    summary: {
      nodeCount: lineage.summary.nodeCount,
      edgeCount: lineage.summary.edgeCount,
      evidenceCount: lineage.summary.evidenceCount,
      warningCount: lineage.summary.warningCount,
    },
  }
  const analyzers = manifest.analyzers ?? []
  const nextAnalyzers = analyzers.filter((entry) => entry.id !== 'model-view-lineage')
  nextAnalyzers.push(analyzer)
  manifest.analyzers = nextAnalyzers
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function printGenerationSummary(result: ReturnType<typeof runGenerationMode>): void {
  console.log(`Data-model entities: ${result.entityCount}`)
  console.log(`Fields: ${result.fieldCount}`)
  console.log(`Relationships: ${result.relationshipCount}`)
  console.log(`Graph nodes: ${result.graphNodeCount}`)
  console.log(`Graph edges: ${result.graphEdgeCount}`)
  console.log(`Output: ${result.outDir}`)
  console.log('Artifacts: data-model.json, data-model-graph.json')
  if (result.warningCount > 0) {
    console.log(`Warnings: ${result.warningCount}`)
  }
}

function printLookupSummary(result: ReturnType<typeof runLookupMode>): void {
  if (result.mode === 'entity') {
    console.log(`Entity: ${result.entity.name}`)
    console.log(`Fields: ${result.entity.fields.length}`)
    if (result.warnings.length > 0) {
      console.log(`Warnings: ${result.warnings.length}`)
    }
    return
  }

  console.log(`Field: ${result.entity.name}.${result.field.name}`)
  console.log(`Type: ${result.field.typeText}`)
  if (result.warnings.length > 0) {
    console.log(`Warnings: ${result.warnings.length}`)
  }
}

function printTraceSummary(result: ReturnType<typeof runTraceMode>): void {
  if (result.mode === 'trace-entity') {
    console.log(`Trace entity: ${result.entity.name}`)
  } else {
    console.log(`Trace field: ${result.entity.name}.${result.field.name}`)
  }
  console.log(`Lineage nodes: ${result.lineageNodeCount}`)
  console.log(`Lineage edges: ${result.lineageEdgeCount}`)
  if (result.warningCount > 0) {
    console.log(`Warnings: ${result.warningCount}`)
  }
}

function filterLineageByEntity(
  artifact: ModelViewLineageArtifact,
  entityId: string
): { nodes: ModelViewLineageArtifact['nodes']; edges: ModelViewLineageArtifact['edges']; warnings: ModelViewLineageWarning[] } {
  const startIds = artifact.nodes
    .filter((node) => node.dataModelEntityId === entityId)
    .map((node) => node.id)
  return filterReachableLineage(artifact, startIds)
}

function filterLineageByField(
  artifact: ModelViewLineageArtifact,
  fieldId: string
): { nodes: ModelViewLineageArtifact['nodes']; edges: ModelViewLineageArtifact['edges']; warnings: ModelViewLineageWarning[] } {
  const startIds = artifact.nodes
    .filter((node) => node.dataModelFieldId === fieldId)
    .map((node) => node.id)
  return filterReachableLineage(artifact, startIds)
}

function filterReachableLineage(
  artifact: ModelViewLineageArtifact,
  startIds: string[]
): { nodes: ModelViewLineageArtifact['nodes']; edges: ModelViewLineageArtifact['edges']; warnings: ModelViewLineageWarning[] } {
  const visited = new Set<string>(startIds)
  const queue = [...startIds]
  const edges = artifact.edges.sort((left, right) => left.id.localeCompare(right.id))
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source !== current) continue
      if (visited.has(edge.target)) continue
      visited.add(edge.target)
      queue.push(edge.target)
    }
  }

  const nodes = artifact.nodes.filter((node) => visited.has(node.id))
  const filteredEdges = edges.filter((edge) => visited.has(edge.source) && visited.has(edge.target))
  const warnings = artifact.warnings.filter((warning) =>
    (warning.evidenceRefs ?? []).some((ref) =>
      nodes.some((node) =>
        node.dataModelEntityId === ref.dataModelEntityId ||
        node.dataModelFieldId === ref.dataModelFieldId
      )
    )
  )

  return {
    nodes,
    edges: filteredEdges,
    warnings,
  }
}
