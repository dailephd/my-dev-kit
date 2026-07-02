import type { FileSummary } from '../symbol-index/types.js'
import {
  buildWarning,
  createEvidence,
  deriveReadiness,
  editGuidanceForUnresolved,
  readinessForUnresolved,
  resolveCandidateConflicts,
  validateEntry,
  type CategoryCandidate,
} from './classificationHelpers.js'
import type { ClassificationEntry, EditGuidance, RiskLabel } from './classificationTypes.js'

const ANALYZER_PARENT_DIRECTORIES = ['src/semantics/', 'src/data-model/', 'src/frontend/', 'src/frontend-reachability/']
const ANALYZER_EXCLUDED_BASENAMES = /(^|\/)(types|index)\.ts$/i
const ANALYZER_NAME_PATTERN = /(analyzer|^build|^apply)/i

const VALIDATOR_NAME_PATTERN = /^valid(ate|ation|ator)/i
const VALIDATOR_EXPORT_PATTERN = /^(validate|require|assert|is[A-Z]\w*Valid|check[A-Z])/

const GENERATED_FILE_PATTERN = /(\.generated\.[jt]sx?$|\.gen\.[jt]sx?$|(^|\/)(__)?generated(__)?\/)/i
const CONFIGURATION_FILE_PATTERN =
  /(\.config\.[jt]sx?$|^tsconfig(\..+)?\.json$|(^|\/)tsconfig(\..+)?\.json$|(^|\/)package\.json$|(^|\/)\.[a-z][\w.-]*rc(\.[jt]s(on)?)?$)/i
const TEST_FILE_PATTERN = /(^|\/)tests\/|\.spec\.[jt]sx?$/i
const PLANNING_ARTIFACT_DIR_PATTERN = /(^|\/)\.my-dev-kit(-orchestrator|-v\d+-planning)\//i
const DOCS_PATTERN = /(^|\/)docs\/.*\.md$|(^|\/)readme\.md$/i

export function classifyFile(file: FileSummary): ClassificationEntry {
  const targetId = `file:${file.path}`
  const candidates: CategoryCandidate[] = []

  if (GENERATED_FILE_PATTERN.test(file.path)) {
    candidates.push({
      role: 'generated-file',
      confidence: 'likely',
      evidence: [
        createEvidence({
          kind: 'filename-pattern',
          source: 'classification-file-analyzer',
          staticPattern: 'filename/path matches a generated-file convention',
          reason: 'file path matches a known generated-output naming/directory convention',
        }),
      ],
    })
  }

  if (CONFIGURATION_FILE_PATTERN.test(file.path)) {
    candidates.push({
      role: 'configuration-file',
      confidence: 'likely',
      evidence: [
        createEvidence({
          kind: 'filename-pattern',
          source: 'classification-file-analyzer',
          staticPattern: 'filename matches a known configuration-file convention',
          reason: 'file path matches a known configuration-file naming convention',
        }),
      ],
    })
  }

  if (isCommandHandlerFile(file)) {
    const hasRegisterExport = file.exports.some((name) => /^register[A-Z]\w*Command$/.test(name))
    candidates.push({
      role: 'command-handler',
      confidence: hasRegisterExport ? 'certain' : 'likely',
      evidence: [
        createEvidence({
          kind: hasRegisterExport ? 'directory-convention' : 'filename-pattern',
          source: 'classification-file-analyzer',
          staticPattern: 'src/commands/*Command.ts naming convention',
          reason: hasRegisterExport
            ? 'file is under src/commands/, named *Command.ts, and exports a register*Command function'
            : 'file is under src/commands/ and named *Command.ts',
        }),
      ],
    })
  }

  if (isAnalyzerFile(file.path)) {
    const strongNameMatch = ANALYZER_NAME_PATTERN.test(basename(file.path))
    candidates.push({
      role: 'analyzer',
      confidence: strongNameMatch ? 'likely' : 'possible',
      evidence: [
        createEvidence({
          kind: 'directory-convention',
          source: 'classification-file-analyzer',
          staticPattern: 'src/semantics|data-model|frontend|frontend-reachability analyzer directory convention',
          reason: strongNameMatch
            ? 'file is under an analyzer-producer directory and its name matches the Analyzer/build*/apply* convention'
            : 'file is under an analyzer-producer directory but its name does not match a stronger naming convention',
          uncertaintyReason: strongNameMatch ? null : 'directory match only, no corroborating naming convention',
        }),
      ],
    })
  }

  const validatorNameMatch = VALIDATOR_NAME_PATTERN.test(basename(file.path)) || /(^|\/)validators\//i.test(file.path)
  if (validatorNameMatch) {
    const hasValidatorExport = file.exports.some((name) => VALIDATOR_EXPORT_PATTERN.test(name))
    candidates.push({
      role: 'validator',
      confidence: hasValidatorExport ? 'likely' : 'possible',
      evidence: [
        createEvidence({
          kind: hasValidatorExport ? 'directory-convention' : 'filename-pattern',
          source: 'classification-file-analyzer',
          staticPattern: 'filename/path matches validation naming convention',
          reason: hasValidatorExport
            ? 'file name matches a validation convention and exports validate/require/assert-style guard functions'
            : 'file name matches a validation convention but no corroborating guard-style export was found',
          uncertaintyReason: hasValidatorExport ? null : 'naming match only, no corroborating export evidence',
        }),
      ],
    })
  }

  if (TEST_FILE_PATTERN.test(file.path)) {
    candidates.push({
      role: 'test-fixture',
      confidence: 'certain',
      evidence: [
        createEvidence({
          kind: 'test-directory-convention',
          source: 'classification-file-analyzer',
          staticPattern: 'tests/ directory or *.spec.ts naming convention',
          reason: 'file is under a tests/ directory or matches the *.spec.ts naming convention',
        }),
      ],
    })
  }

  if (PLANNING_ARTIFACT_DIR_PATTERN.test(file.path)) {
    candidates.push({
      role: 'internal-planning-docs',
      confidence: 'certain',
      evidence: [
        createEvidence({
          kind: 'directory-convention',
          source: 'classification-file-analyzer',
          staticPattern: '.my-dev-kit-orchestrator/ (or historical .my-dev-kit-vN-planning/) directory convention',
          reason: 'file is under a planning-artifact workspace directory',
        }),
      ],
    })
  } else if (DOCS_PATTERN.test(file.path)) {
    candidates.push({
      role: 'public-docs',
      confidence: 'likely',
      evidence: [
        createEvidence({
          kind: 'directory-convention',
          source: 'classification-file-analyzer',
          staticPattern: 'docs/*.md or README.md convention',
          reason: 'file is under docs/ or is a README.md file',
        }),
      ],
    })
  }

  if (candidates.length === 0) {
    return buildFileEntry(file, targetId, {
      roles: [],
      overallUncertainty: 'unknown',
      warningsToAdd: [buildWarning('no-static-evidence', 'no static file-level pattern matched')],
      evidence: [],
      editGuidance: editGuidanceForUnresolved(),
      readiness: readinessForUnresolved(),
      risks: [],
      reason: 'no static file-level pattern matched',
    })
  }

  const resolved = resolveCandidateConflicts(candidates)
  const editGuidance = deriveFileEditGuidance(resolved.roles.map((role) => role.role), resolved.overallUncertainty)
  const risks = deriveFileRisks(resolved.roles.map((role) => role.role), file)
  const readiness = deriveReadiness(
    resolved.overallUncertainty,
    resolved.warningsToAdd.some((warning) => warning.kind === 'conflicting-category')
  )

  return buildFileEntry(file, targetId, {
    roles: resolved.roles,
    overallUncertainty: resolved.overallUncertainty,
    warningsToAdd: resolved.warningsToAdd,
    evidence: resolved.evidence,
    editGuidance,
    readiness,
    risks,
    reason: `matched ${resolved.roles.length} static file-level pattern(s): ${resolved.roles.map((r) => r.role).join(', ')}`,
  })
}

/** PSE-021: deterministic edit-guidance pairing. generated-file is always generated-do-not-edit (INV-003). */
function deriveFileEditGuidance(roles: readonly string[], overallUncertainty: string): EditGuidance {
  if (roles.includes('generated-file')) return 'generated-do-not-edit'
  if (roles.includes('configuration-file')) return 'inspect-before-edit'
  if (roles.includes('internal-planning-docs')) return 'read-only-reference'
  if (roles.includes('public-docs')) return 'docs-only'
  if (roles.includes('test-fixture')) return 'test-only'
  if (overallUncertainty === 'unknown') return 'uncertain'
  if (overallUncertainty === 'possible') return 'inspect-before-edit'
  if (roles.includes('command-handler') || roles.includes('analyzer') || roles.includes('validator')) {
    return 'safe-primary-edit-target'
  }
  return 'inspect-before-edit'
}

function deriveFileRisks(roles: readonly string[], file: FileSummary): RiskLabel[] {
  const risks: RiskLabel[] = []
  if (roles.includes('generated-file')) risks.push('generated-file-risk')
  const isProjectRoleFile = roles.includes('command-handler') || roles.includes('analyzer') || roles.includes('validator')
  if (isProjectRoleFile && !file.hasCallGraphEntries) {
    risks.push('requires-test-validation')
  }
  if (file.exports.length > 0 && roles.includes('command-handler')) {
    risks.push('public-contract-risk')
  }
  return risks
}

function isCommandHandlerFile(file: FileSummary): boolean {
  return file.path.startsWith('src/commands/') && /Command\.ts$/.test(basename(file.path))
}

function isAnalyzerFile(filePath: string): boolean {
  if (ANALYZER_EXCLUDED_BASENAMES.test(filePath)) return false
  return ANALYZER_PARENT_DIRECTORIES.some((dir) => filePath.startsWith(dir))
}

function basename(filePath: string): string {
  return filePath.split('/').at(-1) ?? filePath
}

function buildFileEntry(
  file: FileSummary,
  targetId: string,
  parts: {
    roles: { role: string; subtype?: string | null; confidence: 'certain' | 'likely' | 'possible' | 'unknown' }[]
    overallUncertainty: 'certain' | 'likely' | 'possible' | 'unknown'
    warningsToAdd: ReturnType<typeof buildWarning>[]
    evidence: ClassificationEntry['evidence']
    editGuidance: EditGuidance
    readiness: ReturnType<typeof deriveReadiness>
    risks: RiskLabel[]
    reason: string
  }
): ClassificationEntry {
  const entry: ClassificationEntry = {
    id: `classification:file:${targetId}`,
    targetId,
    targetKind: 'file',
    filePath: file.path,
    symbolName: null,
    nodeId: targetId,
    classifications: parts.roles as ClassificationEntry['classifications'],
    editGuidance: parts.editGuidance,
    readiness: parts.readiness,
    risks: parts.risks,
    evidence: parts.evidence,
    uncertainty: parts.overallUncertainty,
    reason: parts.reason,
    sourceRefs: [{ filePath: file.path }],
    artifactRefs: [],
    warnings: parts.warningsToAdd,
  }
  validateEntry(entry)
  return entry
}
