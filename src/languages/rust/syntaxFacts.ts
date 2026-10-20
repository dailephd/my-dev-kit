import type { Node, Tree } from 'web-tree-sitter'
import type { ExtractionResult } from '../../symbol-index/symbolExtractor.js'
import type { RustSyntaxFact, SymbolDefinition, SymbolKind } from '../../symbol-index/types.js'
import { RUST_MAX_SOURCE_BYTES } from './parser.js'

const children = (node: Node): Node[] => node.namedChildren.filter((child): child is Node => child !== null)

const kinds: Readonly<Record<string, SymbolKind>> = {
  function_item: 'function', function_signature_item: 'function', struct_item: 'struct',
  union_item: 'union', enum_item: 'enum', enum_variant: 'variant', trait_item: 'trait',
  type_item: 'type', const_item: 'const', static_item: 'variable', mod_item: 'module',
  macro_definition: 'macro', field_declaration: 'field',
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
  const starts: number[] = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  const text = (node: Node | null | undefined, limit = 2048): string => {
    if (!node) return ''
    if (node.endIndex - node.startIndex > limit) throw new Error(`Rust syntax evidence exceeds bounded text storage: ${file}`)
    return source.slice(node.startIndex, node.endIndex)
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
    const base = { ...loc, ...(owner ? { ownerKey: owner } : {}), status: contaminated || node.hasError ? 'parser-error' as const : 'syntax-only' as const }
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
      addSymbol({ name, kind, location: { file, ...loc }, exported: visibility === 'pub', signature,
        ...(owner ? { ownerKey: owner, qualifiedName: `${owner}::${name}` } : {}),
        declarationMetadata: { rust: { syntaxKind: node.type, visibility, attributes, declarationOnly: !body, modifiers, ...(shape ? { shape } : {}) } },
      })
      addFact({ kind: node.type === 'mod_item' ? 'module' : 'declaration', syntaxKind: node.type, name, ...base,
        ...(attributes.length ? { attributes } : {}), ...(node.type === 'mod_item' ? { inline: !!body } : {}) })
      childOwner = scope(`${node.type}:${name}`)
      childContext = node.type === 'trait_item' ? 'trait' : node.type === 'mod_item' ? 'module' : kind === 'function' || kind === 'method' ? 'function' : context
    }
    if (node.type === 'impl_item') {
      const typePath = text(node.childForFieldName('type')), traitPath = text(node.childForFieldName('trait'))
      childOwner = scope(`impl:${typePath}${traitPath ? ':trait:' + traitPath : ''}`)
      childContext = 'impl'
      addFact({ kind: 'impl', syntaxKind: node.type, ...base, ownerKey: childOwner,
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
      addFact({ kind: 'use', syntaxKind: visibility ? 're-export' : 'use', text: observed, forms: [...new Set(forms)], ...base, attributes })
    }
    if (node.type === 'foreign_mod_item') {
      addFact({ kind: 'ffi', syntaxKind: node.type, text: source.slice(node.startIndex, node.childForFieldName('body')?.startIndex ?? node.endIndex).trim().slice(0, 120), ...base, attributes })
      childOwner = scope('extern'); childContext = 'extern'
    }
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
        addSymbol({ name: String(index), kind: 'field', location: { file, ...fieldLoc, ...(fieldVisibility ? { line: preceding.startPosition.row + 1 } : {}) }, exported: fieldVisibility === 'pub', ...(owner ? { ownerKey: owner } : {}), signature: text(field).slice(0, 120),
          declarationMetadata: { rust: { syntaxKind: 'positional_field', visibility: fieldVisibility, attributes: [], declarationOnly: true, modifiers: [] } } })
      })
    }
    const nested = children(node)
    for (let i = nested.length - 1; i >= 0; i--) pending.push({ node: nested[i], owner: childOwner, context: childContext, bad: contaminated || (node.type !== 'source_file' && node.hasError), depth: depth + 1 })
  }
  if (tree.rootNode.hasError) warnings.push(`Rust parser recovery in ${file}; contaminated declaration boundaries are unknown; syntax evidence is incomplete`)
  if (diagnosticCount > 32) warnings.push(`Rust parser diagnostics capped at 32 in ${file} (${diagnosticCount} observed)`)
  return { language: 'rust', lineCount: lines.length, imports, exports: symbols.filter(s => s.exported).map(s => s.name), symbols,
    reExportSpecifiers: [], exportAllSpecifiers: [], rustSyntaxFacts: facts, warnings }
}
