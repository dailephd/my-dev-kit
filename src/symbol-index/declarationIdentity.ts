import type { SymbolDefinition } from './types.js'

/** Physical declaration paths are portable, repository-relative paths. */
export function normalizeDeclarationFile(file: string): string {
  const normalized = file.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Invalid repository-relative declaration path: ${file}`)
  }
  return normalized.split('/').filter((part) => part && part !== '.').join('/')
}

export function legacyDeclarationId(file: string, name: string): string {
  return `symbol:${normalizeDeclarationFile(file)}#${name}`
}

export function qualifiedDeclarationId(file: string, ownerKey: string, name: string, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error('Invalid declaration ordinal')
  return `symbolq:${encodeURIComponent(normalizeDeclarationFile(file))}#${encodeURIComponent(ownerKey)}#${encodeURIComponent(name)}#${ordinal}`
}

/** Readers use persisted identity; they never infer lost legacy duplicate identities. */
export function declarationNodeId(file: string, symbol: { name: string; nodeId?: string }): string {
  return symbol.nodeId ?? legacyDeclarationId(file, symbol.name)
}

/** Called only by producers. Stable extraction order breaks ties for same-line declarations. */
export function assignDeclarationIdentities(file: string, symbols: readonly SymbolDefinition[]): SymbolDefinition[] {
  const normalized = normalizeDeclarationFile(file)
  const result = symbols.map((symbol) => ({ ...symbol }))
  const counts = new Map<string, number>()
  const ordered = result.map((symbol, index) => ({ symbol, index }))
    .sort((a, b) => a.symbol.location.line - b.symbol.location.line || a.index - b.index)
  for (const { symbol } of ordered) {
    const owner = symbol.ownerKey ?? ''
    const key = JSON.stringify([owner, symbol.name])
    const ordinal = counts.get(key) ?? 0
    counts.set(key, ordinal + 1)
    symbol.nodeId ??= owner || ordinal > 0
      ? qualifiedDeclarationId(normalized, owner, symbol.name, ordinal)
      : legacyDeclarationId(normalized, symbol.name)
  }
  return result
}

export function parseDeclarationNodeId(nodeId: string): { filePath: string; symbolName: string; ownerKey?: string; ordinal?: number } | null {
  if (nodeId.startsWith('symbolq:')) {
    const parts = nodeId.slice(8).split('#')
    if (parts.length !== 4 || !/^(0|[1-9]\d*)$/.test(parts[3])) throw new Error(`Malformed qualified symbol ID: ${nodeId}`)
    try {
      const [filePath, ownerKey, symbolName] = parts.slice(0, 3).map(decodeURIComponent)
      const ordinal = Number(parts[3])
      if (!symbolName || qualifiedDeclarationId(filePath, ownerKey, symbolName, ordinal) !== nodeId) throw new Error('Noncanonical ID')
      return { filePath, ownerKey, symbolName, ordinal }
    } catch {
      throw new Error(`Malformed qualified symbol ID: ${nodeId}`)
    }
  }
  if (!nodeId.startsWith('symbol:')) return null
  const body = nodeId.slice(7)
  const separator = body.lastIndexOf('#')
  if (separator < 1 || separator === body.length - 1) return null
  return { filePath: normalizeDeclarationFile(body.slice(0, separator)), symbolName: body.slice(separator + 1) }
}
