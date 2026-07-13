/**
 * Shared bounded reference/ID-declaration walker for Android resource XML
 * (layouts, drawables, generic `xml/`, etc.). Recursively scans every
 * element's attribute values for `@type/name`, `@+id/name`, `?attr/name`,
 * and related forms, classifying each conservatively. Never resolves a
 * reference to a specific target here — that candidate-enumeration pass
 * happens later in `buildAndroidResourceProject.ts`, once every file's
 * definitions are known.
 */

import type { XmlElement } from './parseXml.js'
import type {
  AndroidResourceIdDefinition,
  AndroidResourceKey,
  AndroidResourceQualifiers,
  AndroidResourceReference,
  AndroidResourceReferenceKind,
  AndroidResourceSourceRef,
} from '../androidResourceTypes.js'

export interface CollectResourceReferencesContext {
  fileId: string
  filePath: string
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  ownerRecordId: string
}

export interface CollectResourceReferencesResult {
  references: AndroidResourceReference[]
  idDefinitions: AndroidResourceIdDefinition[]
}

export function collectResourceEvidence(root: XmlElement, ctx: CollectResourceReferencesContext): CollectResourceReferencesResult {
  const references: AndroidResourceReference[] = []
  const idDefinitions: AndroidResourceIdDefinition[] = []
  let refIndex = 0
  let idIndex = 0

  const visit = (el: XmlElement): void => {
    for (const [attrName, value] of Object.entries(el.attributes)) {
      if (attrName.startsWith('xmlns')) continue
      if (!(value.startsWith('@') || value.startsWith('?'))) continue

      const classified = classifyResourceReference(value)
      const sourceRef: AndroidResourceSourceRef = { file: ctx.filePath, line: el.line, column: el.column }
      const refId = `${ctx.fileId}#reference:${refIndex}`
      refIndex++

      references.push({
        id: refId,
        raw: value,
        kind: classified.kind,
        packagePrefix: classified.packagePrefix,
        resourceType: classified.resourceType,
        resourceName: classified.resourceName,
        sourceFileId: ctx.fileId,
        sourceElement: el.name,
        sourceAttribute: attrName,
        source: sourceRef,
        candidateTargetIds: [],
        warnings: classified.warning ? [classified.warning] : [],
      })

      if (classified.kind === 'id-declaration' && classified.resourceName) {
        const key: AndroidResourceKey = { packageScope: null, type: 'id', name: classified.resourceName }
        idDefinitions.push({
          id: `${ctx.fileId}#id:${idIndex}`,
          key,
          rawValue: value,
          fileId: ctx.fileId,
          file: ctx.filePath,
          ownerRecordId: ctx.ownerRecordId,
          elementName: el.name,
          attributeName: attrName,
          moduleId: ctx.moduleId,
          sourceSet: ctx.sourceSet,
          qualifiers: ctx.qualifiers,
          source: sourceRef,
        })
        idIndex++
      }
    }
    for (const child of el.children) visit(child)
  }

  visit(root)
  return { references, idDefinitions }
}

export function classifyResourceReference(raw: string): {
  kind: AndroidResourceReferenceKind
  packagePrefix: string | null
  resourceType: string | null
  resourceName: string | null
  warning: string | null
} {
  if (raw === '@null' || raw === '@empty') {
    return { kind: 'null-or-empty', packagePrefix: null, resourceType: null, resourceName: null, warning: null }
  }

  const sigil = raw[0]
  if (sigil !== '@' && sigil !== '?') {
    return { kind: 'unresolved', packagePrefix: null, resourceType: null, resourceName: null, warning: `"${raw}" is not a resource reference.` }
  }

  const isIdDeclaration = raw.startsWith('@+')
  const body = isIdDeclaration ? raw.slice(2) : raw.slice(1)

  const fullMatch = /^(?:([\w.]+):)?([\w.]+)\/([\w.]+)$/.exec(body)
  if (fullMatch) {
    const [, pkg, type, name] = fullMatch
    const packagePrefix = pkg ?? null
    const resourceType = type ?? null
    const resourceName = name ?? null
    const isFramework = packagePrefix === 'android'

    let kind: AndroidResourceReferenceKind
    if (sigil === '?') kind = 'theme-attribute'
    else if (isIdDeclaration && resourceType === 'id') kind = 'id-declaration'
    else if (resourceType === 'id') kind = 'id-reference'
    else if (isFramework) kind = 'framework-resource'
    else if (packagePrefix) kind = 'package-qualified-resource'
    else kind = 'resource'

    return { kind, packagePrefix, resourceType, resourceName, warning: null }
  }

  if (sigil === '?') {
    const shorthandMatch = /^(?:([\w.]+):)?([\w.]+)$/.exec(body)
    if (shorthandMatch) {
      const [, pkg, name] = shorthandMatch
      return { kind: 'theme-attribute', packagePrefix: pkg ?? null, resourceType: 'attr', resourceName: name ?? null, warning: null }
    }
  }

  return { kind: 'unresolved', packagePrefix: null, resourceType: null, resourceName: null, warning: `Malformed resource reference "${raw}".` }
}
