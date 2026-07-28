import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import { VERSION } from '../version.js'
import type { RawEvidenceIndexIdentity } from './rawEvidenceIdentity.js'
import type {
  AuditStep,
  BudgetSummary,
  ContextAdequacyStatement,
  ContextCapsuleRequest,
  FreshnessSummary,
  FullFileFallbackSummary,
  ProvenanceRecord,
  ResponsibilityMappingSummary,
  RetrievalAuditRecord,
  RoleAdequacyStatement,
  RoleContextSummary,
  TruncationSummary,
} from './types.js'

export interface BuildRetrievalAuditRecordOptions {
  identity: RawEvidenceIndexIdentity
  request: ContextCapsuleRequest
  steps: AuditStep[]
  /** v1.10.1 Batch 1: request-normalization warnings (e.g. deferred-field notices). */
  warnings?: string[]
  /** v1.10.1 Batch 2: operational role/focus/changed-surface summary. */
  roleContext: RoleContextSummary
  /** v1.10.1 Batch 4: the same computed adequacy verdict written to the capsule. Optional
   * (defaults to the pre-Batch-4 static stub) so existing Batch 1/2/3 callers/tests that
   * do not pass it keep their prior behavior. */
  contextAdequacy?: ContextAdequacyStatement
  responsibilityMappings?: ResponsibilityMappingSummary
  roleAdequacy?: RoleAdequacyStatement
  freshness?: FreshnessSummary
  budget?: BudgetSummary
  truncation?: TruncationSummary
  fullFileFallback?: FullFileFallbackSummary
  provenance?: ProvenanceRecord[]
}

const LEGACY_CONTEXT_ADEQUACY: ContextAdequacyStatement = {
  status: 'context sufficient with listed assumptions',
  summary: 'Batch 1 capsule includes request and index/artifact summaries only.',
  assumptions: ['No graph focus, source bundles, or ranked candidates are selected yet.'],
  gaps: [],
}

const EMPTY_RESPONSIBILITY_MAPPINGS: ResponsibilityMappingSummary = {
  requested: false,
  operational: false,
  mappings: [],
  unknownResponsibilityIds: [],
  duplicateResponsibilityIds: [],
  limit: null,
  availableCount: 0,
  usedCount: 0,
  truncated: false,
  droppedCount: 0,
  criticalDropped: false,
  warnings: [],
}

const EMPTY_FRESHNESS: FreshnessSummary = {
  state: 'unknown',
  role: null,
  evidenceUsed: [],
  evidenceUnavailable: [],
  comparedIdentities: [],
  reason: 'Freshness classification was not computed for this request.',
  relevantChangedPaths: [],
  warnings: [],
}

const EMPTY_BUDGET: BudgetSummary = { limits: [], characters: null, warnings: [] }
const EMPTY_TRUNCATION: TruncationSummary = { truncated: false, records: [], warnings: [] }
const EMPTY_FULL_FILE_FALLBACK: FullFileFallbackSummary = { enabled: true, limit: null, used: 0, fallbacks: [], warnings: [] }

function emptyRoleAdequacy(status: ContextAdequacyStatement['status']): RoleAdequacyStatement {
  return {
    role: null,
    status,
    requiredConditions: [],
    satisfiedConditions: [],
    missingConditions: [],
    blockingConditions: [],
    warnings: [],
    supportingEvidence: [],
    affectedResponsibilityIds: [],
    truncationImpact: false,
    freshnessImpact: false,
  }
}

export function buildRetrievalAuditRecord(options: BuildRetrievalAuditRecordOptions): RetrievalAuditRecord {
  const {
    identity,
    request,
    steps,
    warnings = [],
    roleContext,
    contextAdequacy = LEGACY_CONTEXT_ADEQUACY,
    responsibilityMappings = EMPTY_RESPONSIBILITY_MAPPINGS,
    roleAdequacy = emptyRoleAdequacy(contextAdequacy.status),
    freshness = EMPTY_FRESHNESS,
    budget = EMPTY_BUDGET,
    truncation = EMPTY_TRUNCATION,
    fullFileFallback = EMPTY_FULL_FILE_FALLBACK,
    provenance = [],
  } = options
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    tool: { name: 'my-dev-kit', version: VERSION },
    request,
    index: {
      indexPath: identity.indexPath,
      manifestPath: identity.manifestPath,
      manifestSchemaVersion: identity.manifestSchemaVersion,
      projectRoot: identity.projectRoot,
    },
    steps,
    fallbacks: [],
    fullFileReadRecommendations: [],
    warnings,
    roleContext,
    contextAdequacy,
    responsibilityMappings,
    roleAdequacy,
    freshness,
    budget,
    truncation,
    fullFileFallback,
    provenance,
  }
}

export function writeRetrievalAuditRecord(outputPath: string, record: RetrievalAuditRecord): string {
  const resolved = path.resolve(outputPath)
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new Error(`Failed to write retrieval audit record to ${outputPath}: ${(error as Error).message}`)
  }
  return toForwardSlash(resolved)
}
