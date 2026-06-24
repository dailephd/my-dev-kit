import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type {
  FrontendFileResult,
  FrontendSemanticArtifact,
  HookCandidate,
  ReactComponentCandidate,
} from '../frontend/index.js'
import {
  mergeConfidence,
  type ReachabilityConfidence,
  type ReachabilityEvidenceRef,
  type StorageKeyFact,
  type StorageKind,
} from './types.js'

interface StoragePattern {
  regex: RegExp
  kind: StorageKind
}

const STORAGE_PATTERNS: StoragePattern[] = [
  {
    regex: /(?:window\.)?localStorage\.(?:getItem|setItem|removeItem|clear)\s*\(\s*['"]([^'"]+)['"]/g,
    kind: 'localStorage',
  },
  {
    regex: /(?:window\.)?sessionStorage\.(?:getItem|setItem|removeItem|clear)\s*\(\s*['"]([^'"]+)['"]/g,
    kind: 'sessionStorage',
  },
]

/** Detects a dynamic/computed storage key call on the same line (template literal or variable). */
const DYNAMIC_STORAGE_REGEX =
  /(?:window\.)?(?:local|session)Storage\.(?:getItem|setItem|removeItem)\s*\(\s*(?:`[^`]*\$\{|[A-Za-z_$])/g

export interface ExtractStorageKeyFactsOptions {
  frontendArtifact: FrontendSemanticArtifact
  repoRoot: string
}

interface StorageMatch {
  key: string
  storageKind: StorageKind
  line: number
  componentId: string | null
  stateVarName: string | null
  confidence: ReachabilityConfidence
}

/**
 * Extracts StorageKeyFact[] by scanning source files for
 * localStorage/sessionStorage patterns with static string-literal keys.
 */
export function extractStorageKeyFacts(options: ExtractStorageKeyFactsOptions): StorageKeyFact[] {
  const { frontendArtifact, repoRoot } = options
  const storageMap = new Map<string, StorageKeyFact>()

  for (const file of frontendArtifact.files) {
    let sourceText: string
    try {
      sourceText = fs.readFileSync(nodePath.join(repoRoot, file.filePath), 'utf8')
    } catch {
      continue
    }
    for (const match of collectStorageMatches(file, sourceText)) {
      upsertStorageKeyFact(storageMap, file, match)
    }
  }

  return [...storageMap.values()].sort((a, b) =>
    `${a.storageKind}:${a.key}`.localeCompare(`${b.storageKind}:${b.key}`)
  )
}

function collectStorageMatches(file: FrontendFileResult, sourceText: string): StorageMatch[] {
  const matches: StorageMatch[] = []
  const lines = sourceText.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const lineNumber = i + 1
    const isDynamic = hasDynamicStorageCall(line)
    for (const pattern of STORAGE_PATTERNS) {
      pattern.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.regex.exec(line)) !== null) {
        const key = m[1]
        const componentId = findOwningComponentId(file, lineNumber)
        matches.push({
          key,
          storageKind: pattern.kind,
          line: lineNumber,
          componentId,
          stateVarName: findStateVarName(file, componentId),
          confidence: 'high',
        })
      }
    }
    if (isDynamic) {
      // A dynamic call on this line that did not match a static literal pattern.
      const kind = line.includes('sessionStorage') ? 'sessionStorage' : 'localStorage'
      const alreadyStatic = matches.some((mm) => mm.line === lineNumber)
      if (!alreadyStatic) {
        const componentId = findOwningComponentId(file, lineNumber)
        matches.push({
          key: extractDynamicKeyLabel(line),
          storageKind: kind,
          line: lineNumber,
          componentId,
          stateVarName: findStateVarName(file, componentId),
          confidence: 'low',
        })
      }
    }
  }
  return matches
}

function hasDynamicStorageCall(line: string): boolean {
  DYNAMIC_STORAGE_REGEX.lastIndex = 0
  return DYNAMIC_STORAGE_REGEX.test(line)
}

function extractDynamicKeyLabel(line: string): string {
  const templateMatch = line.match(/Storage\.(?:getItem|setItem|removeItem)\s*\(\s*`([^`]*)`/)
  if (templateMatch) return templateMatch[1]
  const varMatch = line.match(/Storage\.(?:getItem|setItem|removeItem)\s*\(\s*([A-Za-z_$][\w$.]*)/)
  if (varMatch) return `<computed:${varMatch[1]}>`
  return '<computed>'
}

function findOwningComponentId(file: FrontendFileResult, line: number): string | null {
  let best: ReactComponentCandidate | null = null
  for (const component of file.components) {
    const start = component.sourceRef.line
    const end = component.sourceRef.endLine
    if (line >= start && line <= end) {
      if (!best || component.sourceRef.line > best.sourceRef.line) best = component
    }
  }
  if (!best && file.components.length === 1) best = file.components[0]
  return best?.id ?? null
}

function findStateVarName(file: FrontendFileResult, componentId: string | null): string | null {
  if (!componentId) return null
  const hook = (file.hooks ?? []).find(
    (h: HookCandidate) => h.kind === 'useState' && h.componentId === componentId && h.stateVarName
  )
  return hook?.stateVarName ?? null
}

function toEvidenceRef(file: FrontendFileResult, line: number): ReachabilityEvidenceRef {
  return {
    filePath: file.filePath.replace(/\\/g, '/'),
    line,
    column: null,
    symbolId: null,
  }
}

function upsertStorageKeyFact(
  map: Map<string, StorageKeyFact>,
  file: FrontendFileResult,
  match: StorageMatch
): void {
  const id = `storage:${match.storageKind}:${match.key}`
  const evidenceRef = toEvidenceRef(file, match.line)
  const existing = map.get(id)
  if (existing) {
    if (match.componentId && !existing.componentIds.includes(match.componentId)) {
      existing.componentIds.push(match.componentId)
    }
    if (match.stateVarName && !existing.stateVarNames.includes(match.stateVarName)) {
      existing.stateVarNames.push(match.stateVarName)
    }
    existing.sourceRefs.push(evidenceRef)
    existing.confidence = mergeConfidence(existing.confidence, match.confidence)
    if (match.confidence === 'low' && !existing.warnings.some((w) => w.kind === 'dynamic-storage-key')) {
      existing.warnings.push({
        kind: 'dynamic-storage-key',
        message: `Storage key for ${match.storageKind} is computed or template-literal`,
        factId: id,
      })
    }
    return
  }

  map.set(id, {
    id,
    key: match.key,
    storageKind: match.storageKind,
    componentIds: match.componentId ? [match.componentId] : [],
    stateVarNames: match.stateVarName ? [match.stateVarName] : [],
    sourceRefs: [evidenceRef],
    confidence: match.confidence,
    warnings:
      match.confidence === 'low'
        ? [
            {
              kind: 'dynamic-storage-key',
              message: `Storage key for ${match.storageKind} is computed or template-literal`,
              factId: id,
            },
          ]
        : [],
  })
}
