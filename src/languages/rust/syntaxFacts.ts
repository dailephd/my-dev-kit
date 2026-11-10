import type { Node, Tree } from 'web-tree-sitter'
import type { ExtractionResult } from '../../symbol-index/symbolExtractor.js'
import type { RustSyntaxFact, SymbolDefinition, SymbolKind } from '../../symbol-index/types.js'
import { RUST_MAX_SOURCE_BYTES } from './parser.js'
import { auditCapabilityMap, type SourceAuditExtractionPayload } from '../../symbol-index/auditObservations.js'
import type { SourceAuditFact, SourceAuditSpan, SourceAuditVisibility } from '../../symbol-index/auditEvidenceTypes.js'

const children = (node: Node): Node[] => node.namedChildren.filter((child): child is Node => child !== null)

const kinds: Readonly<Record<string, SymbolKind>> = {
  function_item: 'function', function_signature_item: 'function', struct_item: 'struct',
  union_item: 'union', enum_item: 'enum', enum_variant: 'variant', trait_item: 'trait',
  type_item: 'type', const_item: 'const', static_item: 'variable', mod_item: 'module',
  macro_definition: 'macro', field_declaration: 'field',
}

/** Rust visibility as written; contexts that inherit visibility from a parent are `unknown`, never guessed. */
function rustVisibility(written: string, inherited: boolean): { visibility: SourceAuditVisibility; exported: boolean | null; origin: SourceAuditFact['exportOrigin'] } {
  if (inherited) return { visibility: 'unknown', exported: null, origin: 'unknown' }
  const text = written.replace(/\s+/g, '')
  if (text === '') return { visibility: 'private', exported: false, origin: 'none' }
  if (text === 'pub') return { visibility: 'public', exported: true, origin: 'declared-export' }
  if (text === 'pub(crate)') return { visibility: 'internal', exported: false, origin: 'declared-export' }
  if (text === 'pub(super)' || text.startsWith('pub(in')) return { visibility: 'module', exported: false, origin: 'declared-export' }
  if (text === 'pub(self)') return { visibility: 'private', exported: false, origin: 'declared-export' }
  return { visibility: 'unknown', exported: null, origin: 'unknown' }
}

/** Iterative CST traversal. All retained values are plain, bounded syntax observations. */
export function extractRustSyntax(file: string, source: string, tree: Tree): ExtractionResult {
  const symbols: SymbolDefinition[] = []
  const facts: RustSyntaxFact[] = []
  // Count serialized observations as they are retained: nested owner strings
  // otherwise repeat quadratically. This storage bound derives from the same
  // 64 KiB source envelope (eight syntax fields per source unit), not a new
  // parser performance qualification. Exceeding it aborts the whole extraction.
  let retainedUnits = 0
  const reserve = (value: SymbolDefinition | RustSyntaxFact): void => {
    retainedUnits += JSON.stringify(value).length
    if (retainedUnits > 8 * RUST_MAX_SOURCE_BYTES) throw new Error(`Rust retained syntax evidence exceeds storage envelope: ${file}`)
  }
  const addFact = (fact: RustSyntaxFact): void => { reserve(fact); facts.push(fact) }
  const addSymbol = (symbol: SymbolDefinition): void => { reserve(symbol); symbols.push(symbol) }
  const imports: string[] = []
  const warnings: string[] = []
  const lines = source.split('\n')
  // v1.15.0 source-audit facts come from this one traversal of the one parse.
  const auditFacts: SourceAuditFact[] = []
  const auditBase = { id: '', extractionMethod: 'rust-tree-sitter' as const }
  const traitImplOwners = new Set<string>()
  let itemMacroSeen = false
  let conditionalSeen = false
  let unsupportedUseSeen = false
  let externCrateSeen = false
  const starts: number[] = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  const text = (node: Node | null | undefined, limit = 2048): string => {
    if (!node) return ''
    if (node.endIndex - node.startIndex > limit) throw new Error(`Rust syntax evidence exceeds bounded text storage: ${file}`)
    return source.slice(node.startIndex, node.endIndex)
  }
  const auditSpan = (node: Node, contaminated: boolean, startNode: Node = node): SourceAuditSpan => {
    const start = startNode.startPosition, end = node.endPosition
    const startsValid = startNode.startIndex >= 0 && starts[start.row] !== undefined && starts[start.row]! + start.column === startNode.startIndex
    const endsValid = startsValid && node.endIndex <= source.length && starts[end.row] !== undefined && starts[end.row]! + end.column === node.endIndex && !contaminated && !node.hasError && !startNode.hasError
    return { path: file, startLine: start.row + 1, startColumn: startsValid ? start.column : null, endLine: endsValid ? end.row + 1 : null, endColumn: endsValid ? end.column : null }
  }
  const auditDeclaration = (span: SourceAuditSpan, name: string, kind: string, written: string, inherited: boolean, ownerKey: string | undefined): void => {
    const { visibility, exported, origin } = rustVisibility(written, inherited)
    auditFacts.push({ ...auditBase, kind: 'declaration', span, name, symbolId: '', declarationKind: kind, ownerKey: ownerKey ?? null, visibility, exported, exportOrigin: origin })
    if (exported === true) auditFacts.push({ ...auditBase, kind: 'export', span, name, exportOrigin: 'declared-export', visibility, exported: true })
  }
  const location = (node: Node, contaminated: boolean): { line: number; endLine?: number } => {
    const start = node.startPosition, end = node.endPosition
    const line = start.row + 1
    // B01 verified JS offsets/columns in this runtime are UTF-16 units. Validate
    // against source line offsets rather than persisting unproven byte columns.
    const valid = node.startIndex >= 0 && node.endIndex >= node.startIndex && node.endIndex <= source.length &&
      starts[start.row] !== undefined && starts[end.row] !== undefined &&
      starts[start.row] + start.column === node.startIndex && starts[end.row] + end.column === node.endIndex
    const endLine = end.row + (end.column === 0 && node.endIndex > node.startIndex ? 0 : 1)
    return { line, ...(valid && !contaminated && !node.hasError && endLine >= line && endLine <= lines.length ? { endLine } : {}) }
  }
  // Structural bounds derive from the qualified byte envelope. Iteration avoids
  // JavaScript call-stack depth assumptions; cap exhaustion aborts extraction.
  const budget = 8 * RUST_MAX_SOURCE_BYTES
  const pending: Array<{ node: Node; owner?: string; context?: string; bad: boolean; depth: number }> = [
    { node: tree.rootNode, bad: false, depth: 0 },
  ]
  let visited = 0
  let diagnosticCount = 0
  while (pending.length) {
    const { node, owner, context, bad, depth } = pending.pop()!
    if (++visited > budget || depth > RUST_MAX_SOURCE_BYTES || facts.length + symbols.length > RUST_MAX_SOURCE_BYTES) {
      throw new Error(`Rust CST/evidence exceeds qualified-source structural envelope: ${file}`)
    }
    const contaminated = bad || node.isError || node.isMissing
    const loc = location(node, contaminated)
    if (node.isError || node.isMissing) {
      if (++diagnosticCount <= 32) addFact({ kind: 'diagnostic', syntaxKind: node.type, line: loc.line, status: 'parser-error' })
    }
    const attributesNode = node.childForFieldName('attributes')
    const attributes = attributesNode ? [text(attributesNode)] : children(node).filter(n => n.type === 'attribute_item' || n.type === 'attributes').map(n => text(n))
    const visibility = text(children(node).find(n => n.type === 'visibility_modifier'))
    const nameNode = node.childForFieldName('name')
    const name = text(nameNode)
    const base = { ...loc, sourceIndex: node.startIndex, ...(owner ? { ownerKey: owner } : {}), status: contaminated || node.hasError ? 'parser-error' as const : 'syntax-only' as const }
    // Inner attributes apply to the containing file/module, not the following item.
    if (node.type === 'inner_attribute_item') addFact({ kind: 'attribute', syntaxKind: node.type, ...base, attributes: [text(node)] })
    const scope = (label: string) => `${owner ? owner + '/' : 'rust:'}${label.replace(/\s+/g, ' ')}@${loc.line}:${node.startIndex}`
    let childOwner = owner, childContext = context
    const declaredKind = kinds[node.type]
    if (declaredKind && name && nameNode && !nameNode.hasError && !nameNode.isMissing) {
      const kind = declaredKind === 'function' && (context === 'impl' || context === 'trait') ? 'method' : declaredKind
      const body = node.childForFieldName('body')
      const signatureEnd = body?.startIndex ?? node.endIndex
      const signature = source.slice(node.startIndex, signatureEnd).trim().replace(/\s+/g, ' ').slice(0, 120)
      const shape = node.type === 'struct_item' || node.type === 'enum_variant'
        ? body?.type === 'ordered_field_declaration_list' ? 'tuple' as const : body ? 'named' as const : 'unit' as const : undefined
      const modifiers = children(node).filter(n => n.type === 'function_modifiers' || n.type === 'extern_modifier' || n.type === 'mutable_specifier').map(n => text(n))
      const inherited = declaredKind === 'variant' || context === 'trait' || (!!owner && traitImplOwners.has(owner))
      auditDeclaration(auditSpan(node, contaminated), name, kind, visibility, inherited, owner)
      addSymbol({ name, kind, location: { file, ...loc }, exported: visibility === 'pub', signature,
        ...(owner ? { ownerKey: owner, qualifiedName: `${owner}::${name}` } : {}),
        declarationMetadata: { rust: { syntaxKind: node.type, visibility, attributes, declarationOnly: !body, modifiers, ...(shape ? { shape } : {}) } },
      })
      addFact({ kind: node.type === 'mod_item' ? 'module' : 'declaration', syntaxKind: node.type, name, ...base,
        ...(attributes.length ? { attributes } : {}), ...(node.type === 'mod_item' ? { inline: !!body, moduleKey: scope(`${node.type}:${name}`), sourceIndex: node.startIndex } : {}) })
      childOwner = scope(`${node.type}:${name}`)
      childContext = node.type === 'trait_item' ? 'trait' : node.type === 'mod_item' ? 'module' : kind === 'function' || kind === 'method' ? 'function' : context
    }
    if (node.type === 'impl_item') {
      const typePath = text(node.childForFieldName('type')), traitPath = text(node.childForFieldName('trait'))
      const genericParameters = node.childForFieldName('type_parameters')
      childOwner = scope(`impl:${typePath}${traitPath ? ':trait:' + traitPath : ''}`)
      childContext = 'impl'
      if (traitPath) traitImplOwners.add(childOwner)
      addFact({ kind: 'impl', syntaxKind: node.type, ...base, ownerKey: childOwner,
        ...(owner ? { parentOwnerKey: owner } : {}), genericParameters: text(genericParameters),
        genericParameterNames: (genericParameters ? children(genericParameters) : []).filter(n => n.type === 'type_parameter' || n.type === 'const_parameter').map(n => text(n.childForFieldName('name'))),
        negative: node.children.some(n => n?.type === '!'),
        implementation: traitPath ? 'trait' : 'inherent', typePath, ...(traitPath ? { traitPath } : {}), attributes,
        text: source.slice(node.startIndex, node.childForFieldName('body')?.startIndex ?? node.endIndex).trim().slice(0, 120) })
    }
    if (node.type === 'use_declaration') {
      const argument = node.childForFieldName('argument')
      const observed = text(argument)
      imports.push(observed)
      const forms: NonNullable<RustSyntaxFact['forms']> = []
      const useNodes = argument ? [argument] : []
      while (useNodes.length) {
        const part = useNodes.pop()!
        if (part.type === 'use_list' || part.type === 'scoped_use_list') forms.push('grouped')
        if (part.type === 'use_wildcard') forms.push('glob')
        if (part.type === 'use_as_clause') forms.push('aliased')
        if (part.type === 'identifier' || ['self', 'super', 'crate'].includes(part.type)) forms.push('named')
        useNodes.push(...children(part))
      }
      const useLeaves: NonNullable<RustSyntaxFact['useLeaves']> = []
      let unsupportedUse = false
      const pendingUses: Array<{ part: Node; prefix: string }> = argument ? [{ part: argument, prefix: '' }] : []
      const join = (prefix: string, value: string) => value === 'self' && prefix ? prefix : prefix ? `${prefix}::${value}` : value
      while (pendingUses.length) {
        const { part, prefix } = pendingUses.pop()!
        if (part.type === 'use_list') {
          pendingUses.push(...children(part).reverse().map(part => ({ part, prefix })))
        } else if (part.type === 'scoped_use_list') {
          const path = part.childForFieldName('path'), list = part.childForFieldName('list')
          if (list) pendingUses.push({ part: list, prefix: join(prefix, text(path).replace(/\s+/g, '')) })
          else unsupportedUse = true
        } else {
          const aliased = part.type === 'use_as_clause'
          const glob = part.type === 'use_wildcard'
          const path = aliased ? part.childForFieldName('path') : glob ? children(part)[0] : part
          // In a group, `*` has no path child; its exact prefix is the target.
          const value = glob && !path && prefix ? 'self' : text(path).replace(/\s+/g, '')
          if (!value || (!aliased && !glob && !['identifier','scoped_identifier','self','super','crate'].includes(part.type))) { unsupportedUse = true; continue }
          useLeaves.push({ path: join(prefix, value), ...(aliased ? { alias: text(part.childForFieldName('alias')) } : {}), glob,
            line: part.startPosition.row + 1, sourceIndex: part.startIndex })
        }
      }
      const useSpan = auditSpan(node, contaminated)
      const lastSegment = (path: string): string => path.split('::').filter(Boolean).pop() ?? path
      auditFacts.push({
        ...auditBase, kind: 'import', span: useSpan, sourceSpecifier: observed.replace(/\s+/g, ' ').trim(),
        importedNames: useLeaves.map((leaf) => (leaf.glob ? '*' : lastSegment(leaf.path))), importResolution: 'observed',
      })
      if (visibility.replace(/\s+/g, '') === 'pub') {
        for (const leaf of useLeaves) {
          auditFacts.push({
            ...auditBase, kind: 'export', span: useSpan, name: leaf.glob ? '*' : leaf.alias || lastSegment(leaf.path),
            exportOrigin: 're-export', sourceSpecifier: leaf.path, visibility: 'public', exported: true,
          })
        }
      }
      if (unsupportedUse) unsupportedUseSeen = true
      addFact({ kind: 'use', syntaxKind: visibility ? 're-export' : 'use', text: observed, forms: [...new Set(forms)], ...base, attributes, visibility, useLeaves, ...(unsupportedUse ? { unsupportedUse } : {}) })
    }
    if (node.type === 'foreign_mod_item') {
      addFact({ kind: 'ffi', syntaxKind: node.type, text: source.slice(node.startIndex, node.childForFieldName('body')?.startIndex ?? node.endIndex).trim().slice(0, 120), ...base, attributes })
      childOwner = scope('extern'); childContext = 'extern'
    }
    if (node.type === 'extern_crate_declaration') externCrateSeen = true
    if (node.type === 'macro_definition' || (node.type === 'macro_invocation' && (node.parent?.type === 'source_file' || node.parent?.type === 'declaration_list'))) itemMacroSeen = true
    if (attributes.some(value => /\bcfg(?:_attr)?\s*\(/.test(value)) || (node.type === 'inner_attribute_item' && /\bcfg(?:_attr)?\s*\(/.test(text(node)))) conditionalSeen = true
    if (node.type === 'macro_invocation') addFact({ kind: 'macro', syntaxKind: node.type, name: text(node.childForFieldName('macro')), ...base })
    if (attributes.length) addFact({ kind: 'attribute', syntaxKind: node.type, ...base, attributes, ...(name ? { name } : {}) })
    // Macro token trees/rules are opaque; never manufacture generated declarations.
    if (node.type === 'macro_invocation' || node.type === 'macro_definition' || node.type === 'attributes') continue
    if (node.type === 'ordered_field_declaration_list') {
      node.childrenForFieldName('type').filter((child): child is Node => child !== null).forEach((field, index) => {
        const fieldLoc = location(field, contaminated || node.hasError)
        const siblings = children(node)
        const fieldIndex = siblings.findIndex(sibling => sibling.id === field.id)
        const preceding = siblings[fieldIndex - 1]
        const fieldVisibility = preceding?.type === 'visibility_modifier' ? text(preceding) : ''
        auditDeclaration(auditSpan(field, contaminated || node.hasError, fieldVisibility && preceding ? preceding : field), String(index), 'field', fieldVisibility, false, owner)
        addSymbol({ name: String(index), kind: 'field', location: { file, ...fieldLoc, ...(fieldVisibility ? { line: preceding.startPosition.row + 1 } : {}) }, exported: fieldVisibility === 'pub', ...(owner ? { ownerKey: owner } : {}), signature: text(field).slice(0, 120),
          declarationMetadata: { rust: { syntaxKind: 'positional_field', visibility: fieldVisibility, attributes: [], declarationOnly: true, modifiers: [] } } })
      })
    }
    const nested = children(node)
    for (let i = nested.length - 1; i >= 0; i--) pending.push({ node: nested[i], owner: childOwner, context: childContext, bad: contaminated || (node.type !== 'source_file' && node.hasError), depth: depth + 1 })
  }
  if (tree.rootNode.hasError) warnings.push(`Rust parser recovery in ${file}; contaminated declaration boundaries are unknown; syntax evidence is incomplete`)
  if (diagnosticCount > 32) warnings.push(`Rust parser diagnostics capped at 32 in ${file} (${diagnosticCount} observed)`)
  const capabilities = auditCapabilityMap('unsupported')
  const auditDiagnostics: SourceAuditExtractionPayload['diagnostics'] = []
  const note = (code: string, message: string): void => { auditDiagnostics.push({ code, message, span: null }) }
  capabilities.declarations = 'complete'
  capabilities.imports = 'complete'
  capabilities.exports = 'partial'
  capabilities['source-ranges'] = 'complete'
  note('rust-reachability-not-modeled', 'Rust exports record written visibility only; module reachability and crate public API are not resolved.')
  note('rust-use-resolution-not-attempted', 'Use paths are observed syntax; external crates and local module targets are not resolved here.')
  const weaken = (code: string, message: string, capabilitiesToWeaken: Array<'declarations' | 'imports' | 'exports'>): void => {
    for (const capability of capabilitiesToWeaken) capabilities[capability] = 'partial'
    note(code, message)
  }
  if (tree.rootNode.hasError) {
    weaken('rust-parser-recovery', 'The parser recovered from syntax errors; declaration boundaries are incomplete.', ['declarations', 'imports', 'exports'])
    capabilities['source-ranges'] = 'partial'
  }
  if (itemMacroSeen) weaken('rust-macro-may-generate-items', 'Item-position macros or macro definitions may generate declarations that are not expanded.', ['declarations', 'imports', 'exports'])
  if (conditionalSeen) weaken('rust-conditional-compilation', 'cfg or cfg_attr attributes make item presence depend on unevaluated configuration.', ['declarations', 'imports', 'exports'])
  if (unsupportedUseSeen) weaken('rust-unsupported-use-form', 'A use declaration contains a form that is not fully enumerated.', ['imports'])
  if (externCrateSeen) weaken('rust-extern-crate-not-enumerated', 'extern crate declarations are not enumerated as imports.', ['imports'])
  return { language: 'rust', lineCount: lines.length, imports, exports: symbols.filter(s => s.exported).map(s => s.name), symbols,
    reExportSpecifiers: [], exportAllSpecifiers: [], rustSyntaxFacts: facts, warnings,
    sourceAudit: { facts: auditFacts, capabilities, diagnostics: auditDiagnostics } }
}
