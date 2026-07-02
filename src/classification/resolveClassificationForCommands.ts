import * as fs from 'node:fs'
import * as path from 'node:path'
import { isInsideRoot } from '../io/pathUtils.js'
import type { IndexManifest } from '../indexing/manifestTypes.js'
import type { SemanticArtifactRef } from '../semantics/index.js'
import type {
  ClassificationArtifact,
  ClassificationEntry,
  ClassificationRole,
  EditGuidance,
  Readiness,
  RiskLabel,
  SourceRef,
  UncertaintyTier,
  ClassificationWarning,
} from './classificationTypes.js'

/**
 * Compact per-target summary for command output - deliberately excludes the
 * full evidence objects (staticPattern/reason/uncertaintyReason text) and
 * sourceRefs/reason from ClassificationEntry, per the task's "avoid loading
 * unrelated large artifacts" / "do not duplicate the whole detailed artifact"
 * constraints. Full detail remains available only via classification.json
 * itself (or lookup's --resolve-classification opt-in, which returns the
 * full ClassificationEntry per classification-contract.txt section 8).
 */
export interface ClassificationCommandSummary {
  classifications: ClassificationRole[]
  editGuidance: EditGuidance
  readiness: Readiness
  risks: RiskLabel[]
  uncertainty: UncertaintyTier
  evidenceRefs: SourceRef[]
  artifactRefs: SemanticArtifactRef[]
  warnings: ClassificationWarning[]
}

/**
 * Resolves the classification.json path from manifest.analyzers (NOT from
 * semanticArtifactPaths, which by design never carries a classification
 * field - classification-contract.txt section 1 explicitly decided against
 * extending the fixed-shape IndexSemanticArtifacts interface). Returns null
 * when the analyzer entry, its artifact list, or the artifact path is
 * absent - never throws.
 */
export function resolveClassificationArtifactPath(manifest: IndexManifest, indexDir: string): string | null {
  const analyzer = manifest.analyzers?.find((entry) => entry.id === 'classification')
  const artifactPath = analyzer?.artifacts?.[0]?.path
  if (!artifactPath) return null
  const resolved = path.resolve(indexDir, artifactPath)
  if (!isInsideRoot(indexDir, resolved)) return null
  return resolved
}

/**
 * Loads classification.json if present and registered; returns null on any
 * failure (missing analyzer entry, missing file, malformed JSON) rather than
 * throwing - matching INV-004's graceful-degradation requirement so that
 * search/lookup/slice/source never crash on an older index or a failed
 * classification analyzer run.
 */
export function loadClassificationArtifact(indexDir: string, manifest: IndexManifest): ClassificationArtifact | null {
  const artifactPath = resolveClassificationArtifactPath(manifest, indexDir)
  if (!artifactPath) return null
  try {
    if (!fs.existsSync(artifactPath)) return null
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as ClassificationArtifact
  } catch {
    return null
  }
}

export function findClassificationEntryByTargetId(
  artifact: ClassificationArtifact | null,
  targetId: string
): ClassificationEntry | null {
  if (!artifact) return null
  return artifact.entries.find((entry) => entry.targetId === targetId) ?? null
}

export function buildClassificationCommandSummary(entry: ClassificationEntry | null): ClassificationCommandSummary | null {
  if (!entry) return null
  return {
    classifications: entry.classifications,
    editGuidance: entry.editGuidance,
    readiness: entry.readiness,
    risks: entry.risks,
    uncertainty: entry.uncertainty,
    evidenceRefs: dedupeSourceRefs(entry.evidence.map((evidence) => evidence.sourceLocation).filter(isPresent)),
    artifactRefs: entry.artifactRefs,
    warnings: entry.warnings,
  }
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

function dedupeSourceRefs(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>()
  const result: SourceRef[] = []
  for (const ref of refs) {
    const key = JSON.stringify(ref)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(ref)
  }
  return result
}
