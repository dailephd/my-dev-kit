import * as path from 'node:path'
import * as ts from 'typescript'
import type {
  NormalizedDataModelEntityRecord,
  NormalizedDataModelFieldRecord,
  NormalizedDataModelRecordSet,
  NormalizedDataModelSourceRef,
  NormalizedDataModelWarning,
} from '../normalizedTypes.js'
import type { DataModelEntityKind, DataModelFieldCardinality, DataModelWarningKind } from '../types.js'

export interface ExtractTypeScriptDataModelsInput {
  filePath: string
  sourceText: string
}

export interface ExtractTypeScriptDataModelsResult {
  records: NormalizedDataModelRecordSet
}

export function extractTypeScriptDataModels(
  input: ExtractTypeScriptDataModelsInput
): ExtractTypeScriptDataModelsResult {
  const sourceFile = ts.createSourceFile(
    input.filePath,
    input.sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(input.filePath)
  )

  const records: NormalizedDataModelRecordSet = {
    entities: [],
    fields: [],
    relationships: [],
    warnings: [],
  }

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isInterfaceDeclaration(node) && hasExportKeyword(node)) {
      extractInterfaceDeclaration(node, sourceFile, input.filePath, records)
      return
    }

    if (ts.isTypeAliasDeclaration(node) && hasExportKeyword(node)) {
      extractTypeAliasDeclaration(node, sourceFile, input.filePath, records)
      return
    }

    if (ts.isClassDeclaration(node) && node.name && hasExportKeyword(node)) {
      extractClassDeclaration(node, sourceFile, input.filePath, records)
      return
    }

    if (ts.isFunctionDeclaration(node) && node.name && hasExportKeyword(node)) {
      if (functionReturnsObjectLiteral(node)) {
        records.warnings.push(
          createWarning(
            'skipped-dynamic-pattern',
            `Skipped exported runtime object factory "${node.name.text}".`,
            input.filePath,
            sourceFile,
            node,
            { entityName: node.name.text }
          )
        )
      }
      return
    }

    if (ts.isVariableStatement(node) && hasExportKeyword(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        if (functionLikeInitializerReturnsObjectLiteral(declaration.initializer)) {
          records.warnings.push(
            createWarning(
              'skipped-dynamic-pattern',
              `Skipped exported runtime object factory "${declaration.name.text}".`,
              input.filePath,
              sourceFile,
              declaration,
              { entityName: declaration.name.text }
            )
          )
        }
      }
    }
  })

  return {
    records: sortRecordSet(records),
  }
}

function extractInterfaceDeclaration(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
  records: NormalizedDataModelRecordSet
): void {
  const entityName = node.name.text
  if (shouldSkipTsxPropsLikeEntity(filePath, entityName)) {
    records.warnings.push(
      createWarning(
        'unsupported-pattern',
        `Skipped likely React props/state contract "${entityName}" in TSX source.`,
        filePath,
        sourceFile,
        node,
        { entityName }
      )
    )
    return
  }

  const entity: NormalizedDataModelEntityRecord = {
    name: entityName,
    kind: inferEntityKind(filePath),
    sourceRefs: [createSourceRef(filePath, sourceFile, node, entityName)],
    warnings: [],
  }

  if ((node.heritageClauses?.length ?? 0) > 0) {
    entity.warnings.push(
      createWarning(
        'partial-extraction',
        `Interface "${entityName}" extends other types; only direct property signatures were extracted.`,
        filePath,
        sourceFile,
        node,
        { entityName }
      )
    )
  }

  records.entities.push(entity)

  for (const member of node.members) {
    if (ts.isPropertySignature(member)) {
      const fieldName = extractMemberName(member.name)
      if (!fieldName) {
        entity.warnings.push(
          createWarning(
            'unsupported-pattern',
            `Skipped computed or unsupported property name in interface "${entityName}".`,
            filePath,
            sourceFile,
            member,
            { entityName }
          )
        )
        continue
      }

      records.fields.push(buildFieldRecord(entityName, fieldName, member.type, !!member.questionToken, filePath, sourceFile, member))
      continue
    }

    entity.warnings.push(
      createWarning(
        'unsupported-pattern',
        `Skipped unsupported interface member in "${entityName}".`,
        filePath,
        sourceFile,
        member,
        { entityName }
      )
    )
  }
}

function extractTypeAliasDeclaration(
  node: ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
  records: NormalizedDataModelRecordSet
): void {
  const entityName = node.name.text
  if (shouldSkipTsxPropsLikeEntity(filePath, entityName)) {
    records.warnings.push(
      createWarning(
        'unsupported-pattern',
        `Skipped likely React props/state contract "${entityName}" in TSX source.`,
        filePath,
        sourceFile,
        node,
        { entityName }
      )
    )
    return
  }

  if (!ts.isTypeLiteralNode(node.type)) {
    records.warnings.push(
      createWarning(
        'unsupported-pattern',
        `Skipped exported type alias "${entityName}" because only object literal type aliases are supported.`,
        filePath,
        sourceFile,
        node,
        { entityName }
      )
    )
    return
  }

  const entity: NormalizedDataModelEntityRecord = {
    name: entityName,
    kind: inferEntityKind(filePath),
    sourceRefs: [createSourceRef(filePath, sourceFile, node, entityName)],
    warnings: [],
  }
  records.entities.push(entity)

  for (const member of node.type.members) {
    if (ts.isPropertySignature(member)) {
      const fieldName = extractMemberName(member.name)
      if (!fieldName) {
        entity.warnings.push(
          createWarning(
            'unsupported-pattern',
            `Skipped computed or unsupported property name in type alias "${entityName}".`,
            filePath,
            sourceFile,
            member,
            { entityName }
          )
        )
        continue
      }

      records.fields.push(buildFieldRecord(entityName, fieldName, member.type, !!member.questionToken, filePath, sourceFile, member))
      continue
    }

    entity.warnings.push(
      createWarning(
        'unsupported-pattern',
        `Skipped unsupported type-literal member in "${entityName}".`,
        filePath,
        sourceFile,
        member,
        { entityName }
      )
    )
  }
}

function extractClassDeclaration(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
  records: NormalizedDataModelRecordSet
): void {
  const entityName = node.name!.text
  if (shouldSkipTsxPropsLikeEntity(filePath, entityName)) {
    records.warnings.push(
      createWarning(
        'unsupported-pattern',
        `Skipped likely React props/state contract "${entityName}" in TSX source.`,
        filePath,
        sourceFile,
        node,
        { entityName }
      )
    )
    return
  }

  if ((ts.canHaveDecorators(node) ? ts.getDecorators(node)?.length : 0) ?? 0) {
    records.warnings.push(
      createWarning(
        'unsupported-pattern',
        `Skipped decorated class "${entityName}" because decorator-based ORM extraction is not supported.`,
        filePath,
        sourceFile,
        node,
        { entityName }
      )
    )
    return
  }

  const entity: NormalizedDataModelEntityRecord = {
    name: entityName,
    kind: inferEntityKind(filePath),
    sourceRefs: [createSourceRef(filePath, sourceFile, node, entityName)],
    warnings: [],
  }

  if ((node.heritageClauses?.length ?? 0) > 0) {
    entity.warnings.push(
      createWarning(
        'partial-extraction',
        `Class "${entityName}" extends or implements other types; only direct property declarations were extracted.`,
        filePath,
        sourceFile,
        node,
        { entityName }
      )
    )
  }

  records.entities.push(entity)

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      if (hasStaticModifier(member)) {
        entity.warnings.push(
          createWarning(
            'unsupported-pattern',
            `Skipped static property in class "${entityName}".`,
            filePath,
            sourceFile,
            member,
            { entityName }
          )
        )
        continue
      }

      const fieldName = extractMemberName(member.name)
      if (!fieldName) {
        entity.warnings.push(
          createWarning(
            'unsupported-pattern',
            `Skipped computed or unsupported property name in class "${entityName}".`,
            filePath,
            sourceFile,
            member,
            { entityName }
          )
        )
        continue
      }

      records.fields.push(
        buildFieldRecord(
          entityName,
          fieldName,
          member.type,
          !!member.questionToken,
          filePath,
          sourceFile,
          member
        )
      )
      continue
    }

    if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      entity.warnings.push(
        createWarning(
          'unsupported-pattern',
          `Skipped method or accessor member in class "${entityName}".`,
          filePath,
          sourceFile,
          member,
          { entityName }
        )
      )
    }
  }
}

function buildFieldRecord(
  entityName: string,
  fieldName: string,
  typeNode: ts.TypeNode | undefined,
  optional: boolean,
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node
): NormalizedDataModelFieldRecord {
  return {
    entityName,
    fieldName,
    typeText: typeNode?.getText(sourceFile) ?? 'unknown',
    optional,
    nullable: includesNull(typeNode),
    cardinality: inferCardinality(typeNode),
    sourceRefs: [createSourceRef(filePath, sourceFile, node, `${entityName}.${fieldName}`)],
    warnings: [],
  }
}

function createSourceRef(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  symbolId: string
): NormalizedDataModelSourceRef {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    filePath: normalizeFilePath(filePath),
    symbolId: `symbol:${normalizeFilePath(filePath)}#${symbolId}`,
    evidenceKind: 'source',
    line: line + 1,
    column: character + 1,
  }
}

function createWarning(
  kind: DataModelWarningKind,
  message: string,
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  options: {
    entityName?: string | null
    fieldName?: string | null
    toEntityName?: string | null
  } = {}
): NormalizedDataModelWarning {
  return {
    kind,
    message,
    entityName: options.entityName ?? null,
    fieldName: options.fieldName ?? null,
    toEntityName: options.toEntityName ?? null,
    sourceRefs: [createSourceRef(filePath, sourceFile, node, options.entityName ?? 'warning')],
  }
}

function inferEntityKind(filePath: string): DataModelEntityKind {
  return path.extname(filePath).toLowerCase() === '.tsx' ? 'view-model' : 'canonical-model'
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.js') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function hasExportKeyword(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function hasStaticModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false
}

function shouldSkipTsxPropsLikeEntity(filePath: string, entityName: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.tsx' && ext !== '.jsx') return false
  return /(Props|State)$/u.test(entityName)
}

function extractMemberName(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return null
}

function includesNull(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false
  if (typeNode.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isLiteralTypeNode(typeNode) && typeNode.literal.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isParenthesizedTypeNode(typeNode)) return includesNull(typeNode.type)
  if (!ts.isUnionTypeNode(typeNode)) return false
  return typeNode.types.some((part) => includesNull(part))
}

function inferCardinality(typeNode: ts.TypeNode | undefined): DataModelFieldCardinality {
  if (!typeNode) return 'unknown'
  if (ts.isArrayTypeNode(typeNode)) return 'many'
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName.getText()
    if (typeName === 'Array' || typeName === 'ReadonlyArray') return 'many'
  }
  return 'one'
}

function functionReturnsObjectLiteral(node: ts.FunctionDeclaration): boolean {
  if (!node.body) return false
  return node.body.statements.some(
    (statement) => ts.isReturnStatement(statement) && !!statement.expression && ts.isObjectLiteralExpression(statement.expression)
  )
}

function functionLikeInitializerReturnsObjectLiteral(initializer: ts.Expression | undefined): boolean {
  if (!initializer) return false
  if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return false
  if (ts.isObjectLiteralExpression(initializer.body)) return true
  if (ts.isBlock(initializer.body)) {
    return initializer.body.statements.some(
      (statement) => ts.isReturnStatement(statement) && !!statement.expression && ts.isObjectLiteralExpression(statement.expression)
    )
  }
  return false
}

function sortRecordSet(records: NormalizedDataModelRecordSet): NormalizedDataModelRecordSet {
  return {
    entities: [...records.entities].sort((left, right) => left.name.localeCompare(right.name)),
    fields: [...records.fields].sort((left, right) =>
      compareTuples([left.entityName, left.fieldName], [right.entityName, right.fieldName])
    ),
    relationships: [...records.relationships].sort((left, right) =>
      compareTuples(
        [left.kind, left.fromEntityName, left.fromFieldName ?? '', left.toEntityName, left.toFieldName ?? ''],
        [right.kind, right.fromEntityName, right.fromFieldName ?? '', right.toEntityName, right.toFieldName ?? '']
      )
    ),
    warnings: [...records.warnings].sort((left, right) =>
      compareTuples(
        [
          left.kind,
          left.entityName ?? '',
          left.fieldName ?? '',
          left.toEntityName ?? '',
          left.message,
          left.sourceRefs?.[0]?.filePath ?? '',
          String(left.sourceRefs?.[0]?.line ?? -1),
        ],
        [
          right.kind,
          right.entityName ?? '',
          right.fieldName ?? '',
          right.toEntityName ?? '',
          right.message,
          right.sourceRefs?.[0]?.filePath ?? '',
          String(right.sourceRefs?.[0]?.line ?? -1),
        ]
      )
    ),
  }
}

function compareTuples(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const result = (left[index] ?? '').localeCompare(right[index] ?? '')
    if (result !== 0) return result
  }
  return 0
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}
