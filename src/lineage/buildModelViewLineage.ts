import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import type { SourceFileInput } from '../languages/types.js'
import { ensureInsideProjectRoot } from '../lookup/getSourceSlice.js'
import type { SourceArtifacts } from '../indexing/loadIndexArtifacts.js'
import { loadSourceArtifacts } from '../indexing/loadIndexArtifacts.js'
import type { FileSummary, SymbolIndex } from '../symbol-index/types.js'
import type { DataModelArtifact, DataModelEntity, DataModelField } from '../data-model/types.js'
import {
  MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
  MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
  type ModelViewLineageArtifact,
  type ModelViewLineageConfidence,
  type ModelViewLineageEdge,
  type ModelViewLineageEvidenceRef,
  type ModelViewLineageNode,
  type ModelViewLineageWarning,
  type ModelViewLineageWarningKind,
} from './types.js'

interface FieldOrigin {
  entity: DataModelEntity
  field: DataModelField
  sourceNodeId: string
  evidenceRefs: ModelViewLineageEvidenceRef[]
}

interface TransformationOutput {
  origin: FieldOrigin
  viewModelNodeId: string
}

interface TransformationRecord {
  name: string
  nodeId: string
  evidenceRefs: ModelViewLineageEvidenceRef[]
  outputs: Map<string, TransformationOutput>
}

interface ComponentRenderInfo {
  name: string
  nodeId: string
  evidenceRefs: ModelViewLineageEvidenceRef[]
  renderedProps: Set<string>
}

interface AnalysisContext {
  dataModel: DataModelArtifact
  entitiesByName: Map<string, DataModelEntity>
  fieldsByEntity: Map<string, Map<string, DataModelField>>
  nodes: Map<string, ModelViewLineageNode>
  edges: Map<string, ModelViewLineageEdge>
  warnings: ModelViewLineageWarning[]
}

export interface BuildModelViewLineageInput {
  dataModel: DataModelArtifact
  indexDir?: string
  artifacts?: SourceArtifacts
  sourceFiles?: readonly SourceFileInput[]
  createdAt?: string
}

export interface BuildModelViewLineageResult {
  artifact: ModelViewLineageArtifact
  warnings: ModelViewLineageWarning[]
}

export function buildModelViewLineage(input: BuildModelViewLineageInput): BuildModelViewLineageResult {
  const context: AnalysisContext = {
    dataModel: input.dataModel,
    entitiesByName: new Map(input.dataModel.entities.map((entity) => [entity.name, entity])),
    fieldsByEntity: new Map(
      input.dataModel.entities.map((entity) => [entity.name, new Map(entity.fields.map((field) => [field.name, field]))])
    ),
    nodes: new Map(),
    edges: new Map(),
    warnings: [],
  }

  addDataModelNodes(context)
  const sourceFiles = resolveSourceFiles(input)
  for (const file of sourceFiles) {
    analyzeSourceFile(context, file)
  }

  const nodes = [...context.nodes.values()].sort((left, right) => left.id.localeCompare(right.id))
  const edges = [...context.edges.values()].sort((left, right) => left.id.localeCompare(right.id))
  const warnings = sortWarnings(context.warnings)
  const evidenceCount =
    nodes.reduce((count, node) => count + node.evidenceRefs.length, 0) +
    edges.reduce((count, edge) => count + edge.evidenceRefs.length, 0) +
    warnings.reduce((count, warning) => count + (warning.evidenceRefs?.length ?? 0), 0)
  const warningCount =
    warnings.length +
    nodes.reduce((count, node) => count + node.warnings.length, 0) +
    edges.reduce((count, edge) => count + edge.warnings.length, 0)

  return {
    artifact: {
      artifactKind: MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
      schemaVersion: MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
      createdAt: input.createdAt ?? input.dataModel.createdAt,
      nodes,
      edges,
      warnings,
      summary: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        evidenceCount,
        warningCount,
      },
    },
    warnings,
  }
}

function resolveSourceFiles(input: BuildModelViewLineageInput): SourceFileInput[] {
  if (input.sourceFiles) {
    return [...input.sourceFiles]
      .map((file) => ({
        filePath: normalizeFilePath(file.filePath),
        sourceText: file.sourceText,
      }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath))
  }

  const artifacts = resolveArtifacts(input)
  const symbolIndex = artifacts.symbolIndex
  if (!symbolIndex) {
    throw new Error('Loaded source artifacts must include symbolIndex.')
  }

  const candidates = symbolIndex.files
    .filter((file) => path.extname(file.path).toLowerCase() === '.ts' || path.extname(file.path).toLowerCase() === '.tsx')
    .sort((left, right) => left.path.localeCompare(right.path))

  return candidates.map((file) => {
    const absolutePath = ensureInsideProjectRoot(artifacts.resolved.manifest.projectRoot, file.path)
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`Source file does not exist: ${file.path}`)
    }
    return {
      filePath: file.path,
      sourceText: fs.readFileSync(absolutePath, 'utf8'),
    }
  })
}

function resolveArtifacts(input: BuildModelViewLineageInput): SourceArtifacts & { symbolIndex: SymbolIndex } {
  if (input.artifacts) {
    if (!input.artifacts.symbolIndex) {
      throw new Error('Loaded source artifacts must include symbolIndex.')
    }
    return input.artifacts as SourceArtifacts & { symbolIndex: SymbolIndex }
  }
  if (!input.indexDir) {
    throw new Error('buildModelViewLineage requires sourceFiles, loaded artifacts, or indexDir.')
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

function addDataModelNodes(context: AnalysisContext): void {
  for (const entity of context.dataModel.entities) {
    upsertNode(context, {
      id: buildDataEntityNodeId(entity.id),
      kind: 'data-entity',
      label: entity.name,
      confidence: 'explicit',
      dataModelEntityId: entity.id,
      dataModelFieldId: null,
      evidenceRefs: entity.sourceRefs.map((sourceRef) => ({
        filePath: sourceRef.filePath,
        symbolId: sourceRef.symbolId ?? null,
        line: sourceRef.line ?? null,
        column: sourceRef.column ?? null,
        dataModelEntityId: entity.id,
        dataModelFieldId: null,
      })),
      warnings: [],
    })

    for (const field of entity.fields) {
      upsertNode(context, {
        id: buildDataFieldNodeId(field.id),
        kind: 'data-field',
        label: `${entity.name}.${field.name}`,
        confidence: 'explicit',
        dataModelEntityId: entity.id,
        dataModelFieldId: field.id,
        evidenceRefs: field.sourceRefs.map((sourceRef) => ({
          filePath: sourceRef.filePath,
          symbolId: sourceRef.symbolId ?? null,
          line: sourceRef.line ?? null,
          column: sourceRef.column ?? null,
          dataModelEntityId: entity.id,
          dataModelFieldId: field.id,
        })),
        warnings: [],
      })
    }
  }
}

function analyzeSourceFile(context: AnalysisContext, file: SourceFileInput): void {
  const sourceFile = ts.createSourceFile(
    file.filePath,
    file.sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.extname(file.filePath).toLowerCase() === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  const transformations = new Map<string, TransformationRecord>()
  const components = new Map<string, ComponentRenderInfo>()

  for (const statement of sourceFile.statements) {
    const named = getNamedFunctionLike(statement)
    if (named) {
      const transformation = buildTransformationRecord(context, file.filePath, sourceFile, named.name, named.node, named.parameters, named.body)
      if (transformation) {
        transformations.set(named.name, transformation)
      }

      const component = buildComponentRenderInfo(context, file.filePath, sourceFile, named.name, named.node, named.parameters, named.body)
      if (component) {
        components.set(named.name, component)
      }
    }
  }

  const topLevelModelAliases = new Map<string, DataModelEntity>()
  const topLevelViewModels = new Map<string, Map<string, FieldOrigin & { viewModelNodeId: string }>>()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const variableName = declaration.name.text
      const typedEntity = resolveEntityFromType(context, declaration.type)
      if (typedEntity) {
        topLevelModelAliases.set(variableName, typedEntity)
      }

      if (!declaration.initializer) continue

      const objectLiteralOrigins = extractObjectLiteralOrigins(
        context,
        declaration.initializer,
        file.filePath,
        sourceFile,
        topLevelModelAliases,
        topLevelViewModels
      )
      if (objectLiteralOrigins.size > 0) {
        topLevelViewModels.set(variableName, objectLiteralOrigins)
        for (const [propertyName, origin] of objectLiteralOrigins) {
          const viewModelNodeId = buildVariableViewModelNodeId(file.filePath, variableName, propertyName)
          upsertNode(context, {
            id: viewModelNodeId,
            kind: 'view-model',
            label: `${variableName}.${propertyName}`,
            confidence: 'explicit',
            dataModelEntityId: origin.entity.id,
            dataModelFieldId: origin.field.id,
            evidenceRefs: origin.evidenceRefs,
            warnings: [],
          })
          upsertEdge(context, {
            id: buildEdgeId('derives-field', origin.sourceNodeId, viewModelNodeId),
            kind: 'derives-field',
            source: origin.sourceNodeId,
            target: viewModelNodeId,
            confidence: 'explicit',
            evidenceRefs: origin.evidenceRefs,
            warnings: [],
          })
          objectLiteralOrigins.set(propertyName, {
            ...origin,
            viewModelNodeId,
          })
        }
        continue
      }

      if (ts.isCallExpression(declaration.initializer) && ts.isIdentifier(declaration.initializer.expression)) {
        const callName = declaration.initializer.expression.text
        const transformation = transformations.get(callName)
        if (transformation) {
          const derived = new Map<string, FieldOrigin & { viewModelNodeId: string }>()
          for (const [propertyName, output] of transformation.outputs) {
            const viewModelNodeId = buildVariableViewModelNodeId(file.filePath, variableName, propertyName)
            upsertNode(context, {
              id: viewModelNodeId,
              kind: 'view-model',
              label: `${variableName}.${propertyName}`,
              confidence: 'explicit',
              dataModelEntityId: output.origin.entity.id,
              dataModelFieldId: output.origin.field.id,
              evidenceRefs: output.origin.evidenceRefs,
              warnings: [],
            })
            upsertEdge(context, {
              id: buildEdgeId('derives-field', output.viewModelNodeId, viewModelNodeId),
              kind: 'derives-field',
              source: output.viewModelNodeId,
              target: viewModelNodeId,
              confidence: 'explicit',
              evidenceRefs: output.origin.evidenceRefs,
              warnings: [],
            })
            derived.set(propertyName, {
              ...output.origin,
              viewModelNodeId,
            })
          }
          topLevelViewModels.set(variableName, derived)
          continue
        }

        if (declaration.initializer.arguments.some((argument) => resolveOriginFromExpression(context, argument, topLevelModelAliases, topLevelViewModels) !== null)) {
          pushWarning(
            context,
            'ambiguous-lineage',
            `Skipped unresolved transformation call "${callName}" because its lineage is not available in current source evidence.`,
            [{
              filePath: file.filePath,
              line: lineOf(sourceFile, declaration.initializer),
              column: columnOf(sourceFile, declaration.initializer),
            }]
          )
        }
      }
    }
  }

  scanForDynamicPropertyAccess(context, file.filePath, sourceFile, sourceFile, topLevelModelAliases, topLevelViewModels)
  scanJsxUsage(context, file.filePath, sourceFile, topLevelModelAliases, topLevelViewModels, components)
}

function getNamedFunctionLike(
  node: ts.Statement
): { name: string; node: ts.Node; parameters: readonly ts.ParameterDeclaration[]; body: ts.ConciseBody | undefined } | null {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return {
      name: node.name.text,
      node,
      parameters: node.parameters,
      body: node.body,
    }
  }
  if (!ts.isVariableStatement(node)) return null
  for (const declaration of node.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
    if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
      return {
        name: declaration.name.text,
        node: declaration.initializer,
        parameters: declaration.initializer.parameters,
        body: declaration.initializer.body,
      }
    }
  }
  return null
}

function buildTransformationRecord(
  context: AnalysisContext,
  filePath: string,
  sourceFile: ts.SourceFile,
  functionName: string,
  node: ts.Node,
  parameters: readonly ts.ParameterDeclaration[],
  body: ts.ConciseBody | undefined
): TransformationRecord | null {
  if (!body) return null
  const localModelAliases = new Map<string, DataModelEntity>()
  for (const parameter of parameters) {
    if (!ts.isIdentifier(parameter.name)) continue
    const entity = resolveEntityFromType(context, parameter.type)
    if (entity) {
      localModelAliases.set(parameter.name.text, entity)
    }
  }

  if (localModelAliases.size === 0) return null

  scanForDynamicPropertyAccess(context, filePath, sourceFile, body, localModelAliases, new Map())
  const returnObject = extractReturnedObjectLiteral(body)
  if (!returnObject) return null

  const transformationNodeId = buildTransformationNodeId(filePath, functionName)
  const transformationEvidence = [createEvidenceRef(filePath, sourceFile, node, null, null, functionName)]
  upsertNode(context, {
    id: transformationNodeId,
    kind: 'transformation',
    label: functionName,
    confidence: 'explicit',
    dataModelEntityId: null,
    dataModelFieldId: null,
    evidenceRefs: transformationEvidence,
    warnings: [],
  })

  const outputs = new Map<string, TransformationOutput>()
  for (const property of returnObject.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const propertyName = extractPropertyName(property.name)
    if (!propertyName) {
      pushWarning(
        context,
        'unsupported-pattern',
        `Skipped computed property name in transformation "${functionName}".`,
        [createEvidenceRef(filePath, sourceFile, property, null, null)]
      )
      continue
    }

    const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name
    const origin = resolveOriginFromExpression(context, initializer, localModelAliases, new Map())
    if (!origin) continue

    const viewModelNodeId = buildTransformationViewModelNodeId(filePath, functionName, propertyName)
    upsertNode(context, {
      id: viewModelNodeId,
      kind: 'view-model',
      label: `${functionName}.${propertyName}`,
      confidence: 'explicit',
      dataModelEntityId: origin.entity.id,
      dataModelFieldId: origin.field.id,
      evidenceRefs: origin.evidenceRefs,
      warnings: [],
    })
    upsertEdge(context, {
      id: buildEdgeId('reads-field', origin.sourceNodeId, transformationNodeId),
      kind: 'reads-field',
      source: origin.sourceNodeId,
      target: transformationNodeId,
      confidence: 'explicit',
      evidenceRefs: origin.evidenceRefs,
      warnings: [],
    })
    upsertEdge(context, {
      id: buildEdgeId('creates-view-model', transformationNodeId, viewModelNodeId),
      kind: 'creates-view-model',
      source: transformationNodeId,
      target: viewModelNodeId,
      confidence: 'explicit',
      evidenceRefs: origin.evidenceRefs,
      warnings: [],
    })
    outputs.set(propertyName, {
      origin,
      viewModelNodeId,
    })
  }

  if (outputs.size === 0) return null

  return {
    name: functionName,
    nodeId: transformationNodeId,
    evidenceRefs: transformationEvidence,
    outputs,
  }
}

function buildComponentRenderInfo(
  context: AnalysisContext,
  filePath: string,
  sourceFile: ts.SourceFile,
  componentName: string,
  node: ts.Node,
  parameters: readonly ts.ParameterDeclaration[],
  body: ts.ConciseBody | undefined
): ComponentRenderInfo | null {
  if (!body || !startsWithUppercase(componentName) || !containsJsx(body)) return null
  const componentNodeId = buildComponentNodeId(filePath, componentName)
  const evidence = [createEvidenceRef(filePath, sourceFile, node, null, null, componentName)]
  upsertNode(context, {
    id: componentNodeId,
    kind: 'component',
    label: componentName,
    confidence: 'explicit',
    dataModelEntityId: null,
    dataModelFieldId: null,
    evidenceRefs: evidence,
    warnings: [],
  })

  const renderedProps = new Set<string>()
  const parameter = parameters[0]
  if (!parameter) {
    return { name: componentName, nodeId: componentNodeId, evidenceRefs: evidence, renderedProps }
  }

  if (ts.isIdentifier(parameter.name)) {
    const propsName = parameter.name.text
    visit(body, (child) => {
      if (!ts.isJsxExpression(child) || !child.expression || !ts.isPropertyAccessExpression(child.expression)) return
      if (!ts.isIdentifier(child.expression.expression) || child.expression.expression.text !== propsName) return
      const propName = child.expression.name.text
      renderedProps.add(propName)
      const propNodeId = buildComponentPropNodeId(filePath, componentName, propName)
      const renderedNodeId = buildRenderedFieldNodeId(filePath, componentName, propName)
      const propEvidence = [createEvidenceRef(filePath, sourceFile, child.expression, null, null, `${componentName}.${propName}`)]
      upsertNode(context, {
        id: propNodeId,
        kind: 'component-prop',
        label: `${componentName}.${propName}`,
        confidence: 'explicit',
        dataModelEntityId: null,
        dataModelFieldId: null,
        evidenceRefs: propEvidence,
        warnings: [],
      })
      upsertNode(context, {
        id: renderedNodeId,
        kind: 'rendered-field',
        label: `${componentName}.${propName}`,
        confidence: 'explicit',
        dataModelEntityId: null,
        dataModelFieldId: null,
        evidenceRefs: propEvidence,
        warnings: [],
      })
      upsertEdge(context, {
        id: buildEdgeId('renders-field', propNodeId, renderedNodeId),
        kind: 'renders-field',
        source: propNodeId,
        target: renderedNodeId,
        confidence: 'explicit',
        evidenceRefs: propEvidence,
        warnings: [],
      })
    })
    return { name: componentName, nodeId: componentNodeId, evidenceRefs: evidence, renderedProps }
  }

  if (ts.isObjectBindingPattern(parameter.name)) {
    for (const element of parameter.name.elements) {
      if (!ts.isIdentifier(element.name)) continue
      const propName = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text
      renderedProps.add(propName)
      const propNodeId = buildComponentPropNodeId(filePath, componentName, propName)
      const renderedNodeId = buildRenderedFieldNodeId(filePath, componentName, propName)
      const propEvidence = [createEvidenceRef(filePath, sourceFile, element.name, null, null, `${componentName}.${propName}`)]
      upsertNode(context, {
        id: propNodeId,
        kind: 'component-prop',
        label: `${componentName}.${propName}`,
        confidence: 'explicit',
        dataModelEntityId: null,
        dataModelFieldId: null,
        evidenceRefs: propEvidence,
        warnings: [],
      })
      upsertNode(context, {
        id: renderedNodeId,
        kind: 'rendered-field',
        label: `${componentName}.${propName}`,
        confidence: 'explicit',
        dataModelEntityId: null,
        dataModelFieldId: null,
        evidenceRefs: propEvidence,
        warnings: [],
      })
      upsertEdge(context, {
        id: buildEdgeId('renders-field', propNodeId, renderedNodeId),
        kind: 'renders-field',
        source: propNodeId,
        target: renderedNodeId,
        confidence: 'explicit',
        evidenceRefs: propEvidence,
        warnings: [],
      })
    }
  }

  return { name: componentName, nodeId: componentNodeId, evidenceRefs: evidence, renderedProps }
}

function scanJsxUsage(
  context: AnalysisContext,
  filePath: string,
  sourceFile: ts.SourceFile,
  topLevelModelAliases: Map<string, DataModelEntity>,
  topLevelViewModels: Map<string, Map<string, FieldOrigin & { viewModelNodeId: string }>>,
  components: Map<string, ComponentRenderInfo>
): void {
  visit(sourceFile, (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const componentName = node.tagName.getText(sourceFile)
      const componentInfo = components.get(componentName)
      if (!componentInfo && !startsWithUppercase(componentName)) return

      if (!componentInfo) {
        upsertNode(context, {
          id: buildComponentNodeId(filePath, componentName),
          kind: 'component',
          label: componentName,
          confidence: 'partial',
          dataModelEntityId: null,
          dataModelFieldId: null,
          evidenceRefs: [createEvidenceRef(filePath, sourceFile, node, null, null, componentName)],
          warnings: [],
        })
      }

      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) {
          if (!ts.isIdentifier(attribute.name)) continue
          const propName = attribute.name.text
          const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer)
            ? attribute.initializer.expression
            : null
          if (!expression) continue
          const origin = resolveOriginFromExpression(context, expression, topLevelModelAliases, topLevelViewModels)
          if (!origin) continue
          const sourceNodeId = 'viewModelNodeId' in origin && origin.viewModelNodeId ? origin.viewModelNodeId : origin.sourceNodeId
          const propNodeId = buildComponentPropNodeId(filePath, componentName, propName)
          const evidence = [createEvidenceRef(filePath, sourceFile, expression, origin.entity.id, origin.field.id, `${componentName}.${propName}`)]
          upsertNode(context, {
            id: propNodeId,
            kind: 'component-prop',
            label: `${componentName}.${propName}`,
            confidence: 'explicit',
            dataModelEntityId: origin.entity.id,
            dataModelFieldId: origin.field.id,
            evidenceRefs: evidence,
            warnings: [],
          })
          upsertEdge(context, {
            id: buildEdgeId('passes-prop', sourceNodeId, propNodeId),
            kind: 'passes-prop',
            source: sourceNodeId,
            target: propNodeId,
            confidence: 'explicit',
            evidenceRefs: evidence,
            warnings: [],
          })
          if (components.get(componentName)?.renderedProps.has(propName)) {
            const renderedNodeId = buildRenderedFieldNodeId(filePath, componentName, propName)
            upsertNode(context, {
              id: renderedNodeId,
              kind: 'rendered-field',
              label: `${componentName}.${propName}`,
              confidence: 'explicit',
              dataModelEntityId: origin.entity.id,
              dataModelFieldId: origin.field.id,
              evidenceRefs: evidence,
              warnings: [],
            })
            upsertEdge(context, {
              id: buildEdgeId('renders-field', propNodeId, renderedNodeId),
              kind: 'renders-field',
              source: propNodeId,
              target: renderedNodeId,
              confidence: 'explicit',
              evidenceRefs: evidence,
              warnings: [],
            })
          }
          continue
        }

        if (ts.isJsxSpreadAttribute(attribute) && ts.isIdentifier(attribute.expression)) {
          if (topLevelViewModels.has(attribute.expression.text)) {
            pushWarning(
              context,
              'partial-lineage',
              `Skipped spread props for "${componentName}" because field identity is not explicit.`,
              [createEvidenceRef(filePath, sourceFile, attribute, null, null)]
            )
          }
        }
      }
    }

    if (ts.isJsxExpression(node) && node.expression) {
      const origin = resolveOriginFromExpression(context, node.expression, topLevelModelAliases, topLevelViewModels)
      if (!origin) return
      const sourceNodeId = 'viewModelNodeId' in origin && origin.viewModelNodeId ? origin.viewModelNodeId : origin.sourceNodeId
      const evidence = [createEvidenceRef(filePath, sourceFile, node.expression, origin.entity.id, origin.field.id)]
      const renderedNodeId = buildRenderedFieldNodeId(filePath, 'inline', `${node.expression.getText(sourceFile)}@${lineOf(sourceFile, node.expression)}`)
      upsertNode(context, {
        id: renderedNodeId,
        kind: 'rendered-field',
        label: node.expression.getText(sourceFile),
        confidence: 'explicit',
        dataModelEntityId: origin.entity.id,
        dataModelFieldId: origin.field.id,
        evidenceRefs: evidence,
        warnings: [],
      })
      upsertEdge(context, {
        id: buildEdgeId('renders-field', sourceNodeId, renderedNodeId),
        kind: 'renders-field',
        source: sourceNodeId,
        target: renderedNodeId,
        confidence: 'explicit',
        evidenceRefs: evidence,
        warnings: [],
      })
    }
  })
}

function extractObjectLiteralOrigins(
  context: AnalysisContext,
  expression: ts.Expression,
  filePath: string,
  sourceFile: ts.SourceFile,
  modelAliases: Map<string, DataModelEntity>,
  topLevelViewModels: Map<string, Map<string, FieldOrigin & { viewModelNodeId: string }>>
): Map<string, FieldOrigin & { viewModelNodeId: string }> {
  if (!ts.isObjectLiteralExpression(expression)) return new Map()
  const origins = new Map<string, FieldOrigin & { viewModelNodeId: string }>()
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const propertyName = extractPropertyName(property.name)
    if (!propertyName) {
      pushWarning(
        context,
        'unsupported-pattern',
        'Skipped computed property name in view-model-like object.',
        [createEvidenceRef(filePath, sourceFile, property, null, null)]
      )
      continue
    }
    const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name
    const origin = resolveOriginFromExpression(context, initializer, modelAliases, topLevelViewModels)
    if (!origin) continue
    origins.set(propertyName, {
      ...origin,
      viewModelNodeId: '',
    })
  }
  return origins
}

function resolveOriginFromExpression(
  context: AnalysisContext,
  expression: ts.Expression,
  modelAliases: Map<string, DataModelEntity>,
  viewModels: Map<string, Map<string, FieldOrigin & { viewModelNodeId: string }>>
): (FieldOrigin & { viewModelNodeId?: string | null }) | null {
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const baseName = expression.expression.text
    const propertyName = expression.name.text
    const entity = modelAliases.get(baseName)
    if (entity) {
      const field = context.fieldsByEntity.get(entity.name)?.get(propertyName)
      if (!field) return null
      return {
        entity,
        field,
        sourceNodeId: buildDataFieldNodeId(field.id),
        evidenceRefs: [{
          filePath: normalizeFilePath(expression.getSourceFile().fileName),
          line: lineOf(expression.getSourceFile(), expression),
          column: columnOf(expression.getSourceFile(), expression),
          dataModelEntityId: entity.id,
          dataModelFieldId: field.id,
        }],
      }
    }

    const viewModel = viewModels.get(baseName)?.get(propertyName)
    if (viewModel) {
      return {
        ...viewModel,
        viewModelNodeId: viewModel.viewModelNodeId,
      }
    }
  }

  return null
}

function resolveEntityFromType(context: AnalysisContext, typeNode: ts.TypeNode | undefined): DataModelEntity | null {
  if (!typeNode) return null
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName.getText()
    return context.entitiesByName.get(typeName) ?? null
  }
  return null
}

function extractReturnedObjectLiteral(body: ts.ConciseBody): ts.ObjectLiteralExpression | null {
  if (ts.isObjectLiteralExpression(body)) return body
  if (!ts.isBlock(body)) return null
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression && ts.isObjectLiteralExpression(statement.expression)) {
      return statement.expression
    }
  }
  return null
}

function scanForDynamicPropertyAccess(
  context: AnalysisContext,
  filePath: string,
  sourceFile: ts.SourceFile,
  root: ts.Node,
  modelAliases: Map<string, DataModelEntity>,
  viewModels: Map<string, Map<string, FieldOrigin & { viewModelNodeId: string }>>
): void {
  visit(root, (node) => {
    if (!ts.isElementAccessExpression(node) || !ts.isIdentifier(node.expression)) return
    const baseName = node.expression.text
    if (!modelAliases.has(baseName) && !viewModels.has(baseName)) return
    pushWarning(
      context,
      'skipped-dynamic-pattern',
      `Skipped dynamic property access "${node.getText(sourceFile)}" because static field identity is not available.`,
      [createEvidenceRef(filePath, sourceFile, node, null, null)]
    )
  })
}

function createEvidenceRef(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  dataModelEntityId: string | null,
  dataModelFieldId: string | null,
  note: string | null = null
): ModelViewLineageEvidenceRef {
  return {
    filePath: normalizeFilePath(filePath),
    symbolId: null,
    line: lineOf(sourceFile, node),
    column: columnOf(sourceFile, node),
    dataModelEntityId,
    dataModelFieldId,
    note,
  }
}

function upsertNode(context: AnalysisContext, node: ModelViewLineageNode): void {
  const existing = context.nodes.get(node.id)
  if (!existing) {
    context.nodes.set(node.id, {
      ...node,
      evidenceRefs: sortEvidenceRefs(node.evidenceRefs),
      warnings: sortWarnings(node.warnings),
    })
    return
  }

  existing.confidence = mergeConfidence(existing.confidence, node.confidence)
  existing.dataModelEntityId = existing.dataModelEntityId ?? node.dataModelEntityId ?? null
  existing.dataModelFieldId = existing.dataModelFieldId ?? node.dataModelFieldId ?? null
  existing.evidenceRefs = sortEvidenceRefs([...existing.evidenceRefs, ...node.evidenceRefs])
  existing.warnings = sortWarnings([...existing.warnings, ...node.warnings])
}

function upsertEdge(context: AnalysisContext, edge: ModelViewLineageEdge): void {
  const existing = context.edges.get(edge.id)
  if (!existing) {
    context.edges.set(edge.id, {
      ...edge,
      evidenceRefs: sortEvidenceRefs(edge.evidenceRefs),
      warnings: sortWarnings(edge.warnings),
    })
    return
  }

  existing.confidence = mergeConfidence(existing.confidence, edge.confidence)
  existing.evidenceRefs = sortEvidenceRefs([...existing.evidenceRefs, ...edge.evidenceRefs])
  existing.warnings = sortWarnings([...existing.warnings, ...edge.warnings])
}

function pushWarning(
  context: AnalysisContext,
  kind: ModelViewLineageWarningKind,
  message: string,
  evidenceRefs: ModelViewLineageEvidenceRef[],
  nodeId: string | null = null,
  edgeId: string | null = null
): void {
  context.warnings.push({
    kind,
    message,
    nodeId,
    edgeId,
    evidenceRefs: sortEvidenceRefs(evidenceRefs),
  })
}

function sortEvidenceRefs(evidenceRefs: readonly ModelViewLineageEvidenceRef[]): ModelViewLineageEvidenceRef[] {
  const seen = new Set<string>()
  return [...evidenceRefs]
    .filter((ref) => {
      const key = [
        ref.filePath,
        ref.symbolId ?? '',
        ref.line ?? -1,
        ref.column ?? -1,
        ref.dataModelEntityId ?? '',
        ref.dataModelFieldId ?? '',
        ref.note ?? '',
      ].join('\0')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) =>
      [
        left.filePath,
        left.symbolId ?? '',
        String(left.line ?? -1),
        String(left.column ?? -1),
        left.dataModelEntityId ?? '',
        left.dataModelFieldId ?? '',
        left.note ?? '',
      ]
        .join('\0')
        .localeCompare(
          [
            right.filePath,
            right.symbolId ?? '',
            String(right.line ?? -1),
            String(right.column ?? -1),
            right.dataModelEntityId ?? '',
            right.dataModelFieldId ?? '',
            right.note ?? '',
          ].join('\0')
        )
    )
}

function sortWarnings(warnings: readonly ModelViewLineageWarning[]): ModelViewLineageWarning[] {
  return [...warnings].sort((left, right) =>
    [
      left.kind,
      left.message,
      left.nodeId ?? '',
      left.edgeId ?? '',
      left.evidenceRefs?.[0]?.filePath ?? '',
      String(left.evidenceRefs?.[0]?.line ?? -1),
    ]
      .join('\0')
      .localeCompare(
        [
          right.kind,
          right.message,
          right.nodeId ?? '',
          right.edgeId ?? '',
          right.evidenceRefs?.[0]?.filePath ?? '',
          String(right.evidenceRefs?.[0]?.line ?? -1),
        ].join('\0')
      )
  )
}

function mergeConfidence(left: ModelViewLineageConfidence, right: ModelViewLineageConfidence): ModelViewLineageConfidence {
  const order: Record<ModelViewLineageConfidence, number> = {
    explicit: 4,
    'inferred-static': 3,
    partial: 2,
    unknown: 1,
  }
  return order[left] >= order[right] ? left : right
}

function extractPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function containsJsx(node: ts.Node): boolean {
  let found = false
  visit(node, (child) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      found = true
    }
  })
  return found
}

function visit(node: ts.Node, fn: (node: ts.Node) => void): void {
  const walk = (current: ts.Node): void => {
    fn(current)
    current.forEachChild(walk)
  }
  walk(node)
}

function buildDataEntityNodeId(entityId: string): string {
  return `lineage:data-entity:${entityId}`
}

function buildDataFieldNodeId(fieldId: string): string {
  return `lineage:data-field:${fieldId}`
}

function buildTransformationNodeId(filePath: string, functionName: string): string {
  return `lineage:transformation:${normalizeFilePath(filePath)}#${functionName}`
}

function buildTransformationViewModelNodeId(filePath: string, functionName: string, propertyName: string): string {
  return `lineage:view-model:${normalizeFilePath(filePath)}#${functionName}.${propertyName}`
}

function buildVariableViewModelNodeId(filePath: string, variableName: string, propertyName: string): string {
  return `lineage:view-model:${normalizeFilePath(filePath)}#${variableName}.${propertyName}`
}

function buildComponentNodeId(filePath: string, componentName: string): string {
  return `lineage:component:${normalizeFilePath(filePath)}#${componentName}`
}

function buildComponentPropNodeId(filePath: string, componentName: string, propertyName: string): string {
  return `lineage:component-prop:${normalizeFilePath(filePath)}#${componentName}.${propertyName}`
}

function buildRenderedFieldNodeId(filePath: string, scope: string, label: string): string {
  return `lineage:rendered-field:${normalizeFilePath(filePath)}#${scope}.${label}`
}

function buildEdgeId(kind: ModelViewLineageEdge['kind'], source: string, target: string): string {
  return `lineage-edge:${kind}:${source}->${target}`
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function columnOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).character + 1
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function startsWithUppercase(name: string): boolean {
  return /^[A-Z]/u.test(name)
}
