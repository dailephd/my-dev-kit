import type {
  FrontendFileResult,
  FrontendSemanticArtifact,
  JsxRegionCandidate,
  LocatorCandidate,
  TestBlockCandidate,
  UiStringCandidate,
} from '../frontend/index.js'
import {
  normalizeUiValue,
  type JsxRegionKind,
  type ReachabilityConfidence,
  type ReachabilityEvidenceRef,
  type ReachabilityWarning,
  type StorageKeyFact,
  type TestEvidenceRef,
  type UiMarkerKind,
  type UiReachabilityFact,
} from './types.js'

const SUPPORTED_MARKER_KINDS: ReadonlySet<string> = new Set([
  'data-testid',
  'aria-label',
  'visible-text',
  'placeholder',
  'aria-labelledby',
])

/** Maps a UI marker kind to the Playwright locator kind that targets it. */
const MARKER_TO_LOCATOR: Record<UiMarkerKind, string> = {
  'data-testid': 'getByTestId',
  'aria-label': 'getByLabel',
  'visible-text': 'getByText',
  placeholder: 'getByPlaceholder',
  'aria-labelledby': 'getByLabel',
}

export interface ExtractUiReachabilityFactsOptions {
  frontendArtifact: FrontendSemanticArtifact
  storageKeys: StorageKeyFact[]
}

/** Extracts UiReachabilityFact[] from a FrontendSemanticArtifact. */
export function extractUiReachabilityFacts(options: ExtractUiReachabilityFactsOptions): UiReachabilityFact[] {
  const { frontendArtifact, storageKeys } = options
  const results: UiReachabilityFact[] = []
  const storageKeyByStateVar = indexStorageKeysByStateVar(storageKeys)
  const locatorIndex = indexLocatorsByValue(frontendArtifact)
  const testBlockIndex = indexTestBlocks(frontendArtifact)

  for (const file of frontendArtifact.files) {
    for (const uiStr of file.uiStrings ?? []) {
      if (!SUPPORTED_MARKER_KINDS.has(uiStr.kind)) continue
      const markerKind = uiStr.kind as UiMarkerKind

      const region = findJsxRegion(file, uiStr.jsxRegionId ?? null)
      const jsxRegionKind: JsxRegionKind | null = region ? region.kind : null
      const conditionText = region?.conditionText ?? null
      const gateStorageKeyIds = resolveGateStorageKeys(conditionText, file, storageKeyByStateVar)
      const testEvidenceRefs = findTestEvidenceRefs(markerKind, uiStr.value, locatorIndex, testBlockIndex)
      const confidence = assignUiConfidence(jsxRegionKind, conditionText, testEvidenceRefs.length)

      const warnings: ReachabilityWarning[] = []
      const factId = buildUiFactId(markerKind, uiStr.value)
      if (jsxRegionKind && jsxRegionKind !== 'return' && jsxRegionKind !== 'fragment' && !conditionText) {
        warnings.push({
          kind: 'dynamic-condition',
          message: `Condition for UI marker "${uiStr.value}" is dynamic or unavailable`,
          factId,
        })
      }

      results.push({
        id: factId,
        markerKind,
        value: uiStr.value,
        componentId: uiStr.componentId ?? null,
        jsxRegionKind,
        conditionText,
        gateStorageKeyIds,
        gateRouteIds: [],
        testEvidenceRefs,
        sourceRef: toEvidenceRef(uiStr),
        confidence,
        warnings,
      })
    }
  }

  return results.sort((a, b) =>
    `${a.markerKind}:${a.value}`.localeCompare(`${b.markerKind}:${b.value}`)
  )
}

function buildUiFactId(markerKind: UiMarkerKind, value: string): string {
  return `ui:${markerKind}:${normalizeUiValue(value)}`
}

function findJsxRegion(file: FrontendFileResult, jsxRegionId: string | null): JsxRegionCandidate | null {
  if (!jsxRegionId) return null
  return (file.jsxRegions ?? []).find((r) => r.id === jsxRegionId) ?? null
}

function indexStorageKeysByStateVar(storageKeys: StorageKeyFact[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const sk of storageKeys) {
    for (const stateVar of sk.stateVarNames) {
      if (!map.has(stateVar)) map.set(stateVar, sk.id)
    }
  }
  return map
}

function resolveGateStorageKeys(
  conditionText: string | null,
  file: FrontendFileResult,
  storageKeyByStateVar: Map<string, string>
): string[] {
  if (!conditionText) return []
  const ids = new Set<string>()
  for (const hook of file.hooks ?? []) {
    if (hook.kind === 'useState' && hook.stateVarName && conditionText.includes(hook.stateVarName)) {
      const keyId = storageKeyByStateVar.get(hook.stateVarName)
      if (keyId) ids.add(keyId)
    }
  }
  return [...ids]
}

function indexLocatorsByValue(frontend: FrontendSemanticArtifact): Map<string, LocatorCandidate[]> {
  const map = new Map<string, LocatorCandidate[]>()
  for (const file of frontend.files) {
    for (const locator of file.locators ?? []) {
      if (locator.value == null) continue
      const key = `${locator.kind}:${locator.value}`
      const list = map.get(key) ?? []
      list.push(locator)
      map.set(key, list)
    }
  }
  return map
}

function indexTestBlocks(frontend: FrontendSemanticArtifact): Map<string, TestBlockCandidate> {
  const map = new Map<string, TestBlockCandidate>()
  for (const file of frontend.files) {
    for (const block of file.testBlocks ?? []) {
      map.set(block.id, block)
    }
  }
  return map
}

function findTestEvidenceRefs(
  markerKind: UiMarkerKind,
  value: string,
  locatorIndex: Map<string, LocatorCandidate[]>,
  testBlockIndex: Map<string, TestBlockCandidate>
): TestEvidenceRef[] {
  const targetLocatorKind = MARKER_TO_LOCATOR[markerKind]
  const matches = locatorIndex.get(`${targetLocatorKind}:${value}`) ?? []
  return matches
    .map((locator) => {
      const block = locator.testBlockId ? testBlockIndex.get(locator.testBlockId) : undefined
      return {
        filePath: locator.sourceRef.filePath.replace(/\\/g, '/'),
        line: locator.sourceRef.line,
        locatorKind: locator.kind,
        locatorValue: locator.value ?? '',
        testBlockId: locator.testBlockId ?? null,
        testBlockTitle: block?.title ?? null,
        testFramework: block?.framework ?? null,
      }
    })
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line)
}

function assignUiConfidence(
  jsxRegionKind: JsxRegionKind | null,
  conditionText: string | null,
  testEvidenceCount: number
): ReachabilityConfidence {
  if (!jsxRegionKind || jsxRegionKind === 'return' || jsxRegionKind === 'fragment') {
    return testEvidenceCount > 0 ? 'high' : 'medium'
  }
  if (conditionText) return 'medium'
  return 'low'
}

function toEvidenceRef(uiStr: UiStringCandidate): ReachabilityEvidenceRef {
  return {
    filePath: uiStr.sourceRef.filePath.replace(/\\/g, '/'),
    line: uiStr.sourceRef.line,
    column: uiStr.sourceRef.column ?? null,
    symbolId: uiStr.sourceRef.symbolId ?? null,
  }
}
