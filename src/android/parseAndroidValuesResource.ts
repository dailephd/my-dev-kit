/**
 * Parses a values-directory XML resource file's `<resources>` root into
 * individual value-resource definitions (`string`, `color`, `style`,
 * `bool`, `integer`, `dimen`, `fraction`, `plurals`, arrays, `attr`,
 * `declare-styleable`, and explicit `<item type="..." name="...">`).
 * Conservative: never evaluates string formatting, style inheritance, or
 * attribute resolution — only preserves raw declared structure.
 */

import type { XmlElement } from './xml/parseXml.js'
import { findChildren } from './xml/parseXml.js'
import { classifyResourceReference } from './xml/collectResourceReferences.js'
import type {
  AndroidResourceArrayItem,
  AndroidResourceAttrEnumFlag,
  AndroidResourceDefinition,
  AndroidResourceKey,
  AndroidResourcePluralItem,
  AndroidResourceQualifiers,
  AndroidResourceReference,
  AndroidResourceSourceRef,
  AndroidResourceStyleItem,
  AndroidResourceType,
} from './androidResourceTypes.js'

export interface ParseValuesResourceContext {
  fileId: string
  filePath: string
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
}

export interface ParseValuesResourceResult {
  definitions: AndroidResourceDefinition[]
  references: AndroidResourceReference[]
}

const ARRAY_TAGS = new Set(['string-array', 'integer-array', 'array'])
const SIMPLE_SCALAR_TYPES: Record<string, AndroidResourceType> = { bool: 'bool', integer: 'integer', dimen: 'dimen', fraction: 'fraction' }

export function parseAndroidValuesResource(root: XmlElement, ctx: ParseValuesResourceContext): ParseValuesResourceResult {
  const definitions: AndroidResourceDefinition[] = []
  const references: AndroidResourceReference[] = []
  let defIndex = 0
  let refIndex = 0

  const sourceRefOf = (el: XmlElement): AndroidResourceSourceRef => ({ file: ctx.filePath, line: el.line, column: el.column })

  const nextDefId = (): string => {
    const id = `${ctx.fileId}#value:${defIndex}`
    defIndex++
    return id
  }

  const addReferencesFromText = (el: XmlElement, text: string, attrName: string | null): string[] => {
    const ids: string[] = []
    const pattern = /[@?][\w+.:/]+/g
    for (const match of text.matchAll(pattern)) {
      const raw = match[0]
      const classified = classifyResourceReference(raw)
      const id = `${ctx.fileId}#reference:${refIndex}`
      refIndex++
      references.push({
        id,
        raw,
        kind: classified.kind,
        packagePrefix: classified.packagePrefix,
        resourceType: classified.resourceType,
        resourceName: classified.resourceName,
        sourceFileId: ctx.fileId,
        sourceElement: el.name,
        sourceAttribute: attrName,
        source: sourceRefOf(el),
        candidateTargetIds: [],
        warnings: classified.warning ? [classified.warning] : [],
      })
      ids.push(id)
    }
    return ids
  }

  const key = (type: AndroidResourceType, name: string): AndroidResourceKey => ({ packageScope: null, type, name })

  const baseDefinition = (type: AndroidResourceType, name: string, el: XmlElement): AndroidResourceDefinition => ({
    id: nextDefId(),
    key: key(type, name),
    type,
    name,
    moduleId: ctx.moduleId,
    sourceSet: ctx.sourceSet,
    qualifiers: ctx.qualifiers,
    fileId: ctx.fileId,
    file: ctx.filePath,
    source: sourceRefOf(el),
    rawValue: null,
    translatable: null,
    formatted: null,
    product: null,
    hasChildMarkup: false,
    parent: null,
    parentExplicit: false,
    items: [],
    arrayKind: null,
    arrayItems: [],
    pluralItems: [],
    format: null,
    enumValues: [],
    flagValues: [],
    styleableAttrRefs: [],
    referenceIds: [],
    warnings: [],
  })

  for (const el of root.children) {
    const name = el.attributes['name']
    const warnings: string[] = []

    if (el.name === 'string') {
      if (!name) {
        warnings.push('<string> element has no name attribute.')
        continue
      }
      const def = baseDefinition('string', name, el)
      def.rawValue = el.text
      def.translatable = boolAttr(el, 'translatable')
      def.formatted = boolAttr(el, 'formatted')
      def.product = el.attributes['product'] ?? null
      def.hasChildMarkup = el.children.length > 0
      def.referenceIds = addReferencesFromText(el, el.text, null)
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (el.name === 'color') {
      if (!name) {
        warnings.push('<color> element has no name attribute.')
        continue
      }
      const def = baseDefinition('color', name, el)
      def.rawValue = el.text
      if (!isLikelyColorLiteral(el.text) && !el.text.startsWith('@') && !el.text.startsWith('?')) {
        warnings.push(`Color "${name}" value "${el.text}" is not a recognizable literal or resource reference.`)
      }
      def.referenceIds = addReferencesFromText(el, el.text, null)
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (el.name in SIMPLE_SCALAR_TYPES) {
      if (!name) {
        warnings.push(`<${el.name}> element has no name attribute.`)
        continue
      }
      const def = baseDefinition(SIMPLE_SCALAR_TYPES[el.name]!, name, el)
      def.rawValue = el.text
      def.referenceIds = addReferencesFromText(el, el.text, null)
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (el.name === 'item') {
      const type = el.attributes['type']
      if (!name || !type) {
        warnings.push('<item> element in <resources> requires both name and type attributes.')
        continue
      }
      const def = baseDefinition(type as AndroidResourceType, name, el)
      def.rawValue = el.text
      def.referenceIds = addReferencesFromText(el, el.text, null)
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (el.name === 'style') {
      if (!name) {
        warnings.push('<style> element has no name attribute.')
        continue
      }
      const def = baseDefinition('style', name, el)
      const explicitParent = el.attributes['parent']
      if (explicitParent !== undefined) {
        def.parent = explicitParent
        def.parentExplicit = true
      } else if (name.includes('.')) {
        def.parent = name.slice(0, name.lastIndexOf('.'))
        def.parentExplicit = false
      }
      const items: AndroidResourceStyleItem[] = []
      for (const itemEl of findChildren(el, 'item')) {
        const itemName = itemEl.attributes['name']
        if (!itemName) continue
        const refIds = addReferencesFromText(itemEl, itemEl.text, itemName)
        items.push({ name: itemName, rawValue: itemEl.text, referenceId: refIds[0] ?? null, source: sourceRefOf(itemEl) })
      }
      def.items = items
      def.referenceIds = items.flatMap((i) => (i.referenceId ? [i.referenceId] : []))
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (ARRAY_TAGS.has(el.name)) {
      if (!name) {
        warnings.push(`<${el.name}> element has no name attribute.`)
        continue
      }
      const def = baseDefinition('array', name, el)
      def.arrayKind = el.name as 'string-array' | 'integer-array' | 'array'
      const items: AndroidResourceArrayItem[] = []
      for (const itemEl of findChildren(el, 'item')) {
        const refIds = addReferencesFromText(itemEl, itemEl.text, null)
        items.push({ rawValue: itemEl.text, referenceId: refIds[0] ?? null, source: sourceRefOf(itemEl) })
      }
      def.arrayItems = items
      def.referenceIds = items.flatMap((i) => (i.referenceId ? [i.referenceId] : []))
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (el.name === 'plurals') {
      if (!name) {
        warnings.push('<plurals> element has no name attribute.')
        continue
      }
      const def = baseDefinition('plurals', name, el)
      const items: AndroidResourcePluralItem[] = []
      for (const itemEl of findChildren(el, 'item')) {
        const quantity = itemEl.attributes['quantity']
        if (!quantity) continue
        const refIds = addReferencesFromText(itemEl, itemEl.text, null)
        items.push({ quantity, rawValue: itemEl.text, referenceId: refIds[0] ?? null, source: sourceRefOf(itemEl) })
      }
      def.pluralItems = items
      def.referenceIds = items.flatMap((i) => (i.referenceId ? [i.referenceId] : []))
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (el.name === 'attr') {
      if (!name) {
        warnings.push('<attr> element has no name attribute.')
        continue
      }
      const def = baseDefinition('attr', name, el)
      def.format = el.attributes['format'] ?? null
      def.enumValues = findChildren(el, 'enum').map((e) => ({ name: e.attributes['name'] ?? '', value: e.attributes['value'] ?? null }))
      def.flagValues = findChildren(el, 'flag').map((e) => ({ name: e.attributes['name'] ?? '', value: e.attributes['value'] ?? null }))
      def.warnings = warnings
      definitions.push(def)
      continue
    }

    if (el.name === 'declare-styleable') {
      if (!name) {
        warnings.push('<declare-styleable> element has no name attribute.')
        continue
      }
      const def = baseDefinition('declare-styleable', name, el)
      const attrRefs: string[] = []
      for (const attrEl of findChildren(el, 'attr')) {
        const attrName = attrEl.attributes['name']
        if (attrName) attrRefs.push(attrName)
      }
      def.styleableAttrRefs = attrRefs.sort()
      def.warnings = warnings
      definitions.push(def)
      continue
    }
    // Unrecognized top-level value-resource element: conservatively skipped, no invented definition.
  }

  return { definitions, references }
}

function boolAttr(el: XmlElement, name: string): boolean | null {
  const value = el.attributes[name]
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function isLikelyColorLiteral(text: string): boolean {
  return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text.trim())
}
