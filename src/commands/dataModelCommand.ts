import * as path from 'node:path'
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

interface DataModelCommandOptions {
  index?: string
  out?: string
  entity?: string
  field?: string
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
    .option('--json', 'print JSON output')
    .action(async (options: DataModelCommandOptions) => {
      if (!options.index) throw new Error('The data-model command requires --index <dir>.')
      if (options.entity && options.field) {
        throw new Error('The data-model command accepts either --entity or --field, but not both.')
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
