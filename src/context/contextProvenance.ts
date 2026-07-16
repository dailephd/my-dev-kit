/**
 * v1.10.1 Batch 4: deterministic evidence provenance (section 28).
 *
 * Reuses `EvidenceItemRef.provenance` (a free-form string set by Batch 2/3
 * producers) and `ChangedSurfaceProvenance` (`caller`/`graph-diff`/`both`) to
 * classify each evidence item into a stable `ProvenanceCategory`, then merges
 * duplicate (category, sourcePath, evidenceId) triples deterministically. This
 * is a read-only summarizer over existing evidence: it never re-derives
 * evidence or stores a second copy of any payload.
 */
import type { ChangedSurface, ContextRole, EvidenceItemRef, ProvenanceCategory, ProvenanceRecord } from './types.js'

export interface ProvenanceInput {
  items: EvidenceItemRef[]
  role: ContextRole | null
  requestField: string | null
  derivedByModule: string
}

function classifyCategory(item: EvidenceItemRef): ProvenanceCategory {
  const p = item.provenance
  if (p === 'caller') return item.itemKind === 'symbol' ? 'caller-changed-symbol' : 'caller-changed-file'
  if (p === 'graph-diff') return 'graph-diff'
  if (p === 'both') return 'graph-diff'
  if (p.startsWith('import-specifier-scan') || p === 'graph-edge:imports') return 'import-scan'
  if (p.startsWith('vitest-config')) return 'test-configuration'
  if (p.includes('package.json script')) return 'package-json'
  if (p === 'selected-graph' || p === 'candidate-ranking') return 'code-graph'
  if (p.startsWith('symbol-index')) return 'symbol-index'
  return 'code-graph'
}

/** Deterministic ID: `${category}:${sourcePath ?? sourceId ?? 'unknown'}:${evidenceId}`. */
function makeProvenanceId(category: ProvenanceCategory, sourcePath: string | null, sourceId: string | null, evidenceId: string): string {
  return `${category}:${sourcePath ?? sourceId ?? 'unknown'}:${evidenceId}`
}

/** Builds one provenance record per evidence item, then merges records that
 * describe the same (category, sourcePath/sourceId, evidenceId) triple: distinct
 * `relationshipBasis`/`requestField` values are preserved (joined), never dropped,
 * and the evidence item itself is never duplicated (section 28.4). */
export function buildProvenanceRecords(inputs: ProvenanceInput[]): ProvenanceRecord[] {
  const byId = new Map<string, ProvenanceRecord>()
  for (const input of inputs) {
    for (const item of input.items) {
      const category = classifyCategory(item)
      const sourcePath = item.path ?? null
      const sourceId = item.nodeId ?? item.symbolId ?? null
      const id = makeProvenanceId(category, sourcePath, sourceId, item.id)
      const existing = byId.get(id)
      if (!existing) {
        byId.set(id, {
          id,
          category,
          sourcePath,
          sourceId,
          evidenceId: item.id,
          relationshipBasis: item.relationship,
          role: input.role,
          requestField: input.requestField,
          derivedByModule: input.derivedByModule,
        })
        continue
      }
      // Merge: preserve every distinct relationship basis and derivation module
      // rather than picking one arbitrarily (section 28.4).
      const mergedBasis = new Set(existing.relationshipBasis.split('; ').concat(item.relationship))
      const mergedModule = new Set(existing.derivedByModule.split('; ').concat(input.derivedByModule))
      byId.set(id, {
        ...existing,
        relationshipBasis: [...mergedBasis].sort().join('; '),
        derivedByModule: [...mergedModule].sort().join('; '),
        requestField: existing.requestField === input.requestField ? existing.requestField : (existing.requestField ?? input.requestField),
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Provenance records derived from `ChangedSurface` directly (files/symbols carry
 * their own `caller`/`graph-diff`/`both` provenance, distinct from `EvidenceItemRef`). */
export function buildChangedSurfaceProvenance(changedSurface: ChangedSurface, role: ContextRole | null): ProvenanceRecord[] {
  const records: ProvenanceRecord[] = []
  for (const file of changedSurface.files) {
    const categories: ProvenanceCategory[] = file.provenance === 'both' ? ['caller-changed-file', 'graph-diff'] : file.provenance === 'caller' ? ['caller-changed-file'] : ['graph-diff']
    for (const category of categories) {
      records.push({
        id: makeProvenanceId(category, file.path, null, file.path),
        category,
        sourcePath: file.path,
        sourceId: null,
        evidenceId: file.path,
        relationshipBasis: file.status,
        role,
        requestField: 'changedFiles',
        derivedByModule: 'changedSurface.ts',
      })
    }
  }
  for (const symbol of changedSurface.symbols) {
    const categories: ProvenanceCategory[] = symbol.provenance === 'both' ? ['caller-changed-symbol', 'graph-diff'] : symbol.provenance === 'caller' ? ['caller-changed-symbol'] : ['graph-diff']
    for (const category of categories) {
      records.push({
        id: makeProvenanceId(category, symbol.filePath ?? null, symbol.symbolId, symbol.symbolId),
        category,
        sourcePath: symbol.filePath ?? null,
        sourceId: symbol.symbolId,
        evidenceId: symbol.symbolId,
        relationshipBasis: symbol.status,
        role,
        requestField: 'changedSymbols',
        derivedByModule: 'changedSurface.ts',
      })
    }
  }
  return records.sort((a, b) => a.id.localeCompare(b.id))
}

export function mergeProvenanceRecords(groups: ProvenanceRecord[][]): ProvenanceRecord[] {
  const byId = new Map<string, ProvenanceRecord>()
  for (const group of groups) {
    for (const record of group) {
      if (!byId.has(record.id)) byId.set(record.id, record)
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}
