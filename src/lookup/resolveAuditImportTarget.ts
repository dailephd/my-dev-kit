import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createDefaultRegistry } from '../languages/registry.js'
import { PythonAdapter } from '../languages/python/adapter.js'
import { TypeScriptAdapter, enumerateJsTsCandidatePaths } from '../languages/typescript/adapter.js'
import type { SourceAuditEvidenceArtifact, SourceAuditFact, SourceAuditFile } from '../symbol-index/auditEvidenceTypes.js'
import { SOURCE_AUDIT_SCHEMA_VERSION } from '../symbol-index/auditEvidenceTypes.js'
import { assertSourceAuditFileFresh, readSourceAuditEvidence, SourceAuditEvidenceError } from './readSourceAuditEvidence.js'
import { ensureInsideProjectRoot, UnsafeSourceError } from './getSourceSlice.js'

/**
 * Filesystem/source-selection evidence for one recorded import or JS/TS re-export fact. It is NOT a claim that the import
 * binds semantically; the fact's own importResolution and targetPaths keep their meanings.
 */
export interface AuditImportTargetProof {
  schemaVersion: '1.1.0'
  mode: 'audit-import-target'
  snapshotId: string
  importFactId: string
  originFile: string
  sourceSpecifier: string
  status: 'present' | 'proven-missing' | 'outside-selected-roots' | 'indeterminate'
  candidatePaths: string[]
  selectionComplete: boolean
  reasonCode: string
  declarationProof?: {
    scope: 'selected-ordinary-jvm-sources'
    targetKind: NonNullable<SourceAuditFact['jvmImportTarget']>['kind']
    targetQualifiedName: string | null
    targetPackageName: string | null
    domainComplete: boolean
    packageWitnessFactIds: string[]
    matchingDeclarationFactIds: string[]
    matchingSourcePaths: string[]
    matchingQualifiedNames: string[]
    incompletenessReasons: string[]
  }
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function findImportFact(artifact: SourceAuditEvidenceArtifact, factId: string): { file: SourceAuditFile; fact: SourceAuditFact } {
  for (const file of artifact.files) {
    const fact = file.facts.find((candidate) => candidate.id === factId)
    if (!fact) continue
    const reExport = fact.kind === 'export' && fact.exportOrigin === 're-export' &&
      typeof fact.sourceSpecifier === 'string' && fact.sourceSpecifier.length > 0 &&
      (file.language === 'typescript' || file.language === 'javascript')
    if (fact.kind !== 'import' && !reExport) {
      throw new SourceAuditEvidenceError('AUDIT_FACT_NOT_IMPORT', `Fact "${factId}" is a ${fact.kind} fact, not an import fact.`)
    }
    if (fact.span.path !== file.path) {
      throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', `Import fact "${factId}" span path does not match its recorded file.`)
    }
    return { file, fact }
  }
  throw new SourceAuditEvidenceError('AUDIT_FACT_NOT_FOUND', `No source-audit fact with id "${factId}" is recorded in this index.`)
}

function insideSelectedRoots(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => root === '.' || candidate === root || candidate.startsWith(`${root}/`))
}

/** True when the candidate is lexically inside the project root; ".." prefixed paths are never followed. */
function insideProjectRoot(candidate: string): boolean {
  return candidate !== '' && candidate !== '..' && !candidate.startsWith('../') && !candidate.startsWith('/') && !/^[A-Za-z]:/.test(candidate)
}

type ProbeResult = 'absent' | 'exists' | 'unknown'

/** Read-only existence probe of one already-enumerated, root-contained candidate; never reads content. */
function probeCandidate(projectRoot: string, candidate: string): ProbeResult {
  try {
    fs.lstatSync(path.resolve(projectRoot, candidate))
    return 'exists'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unknown'
  }
}

/**
 * Decides a complete, enumerated candidate set when no candidate is a selected file. `proven-missing`
 * requires: every candidate inside the project and the selected roots, a complete selection, and no
 * candidate present on disk (a present-but-unselected candidate is excluded or newer than the index).
 */
function classifyAbsentCandidates(
  projectRoot: string,
  roots: readonly string[],
  candidates: readonly string[],
  selectionComplete: boolean,
): { status: AuditImportTargetProof['status']; reasonCode: string } {
  if (candidates.some((candidate) => !insideSelectedRoots(roots, candidate))) {
    return { status: 'outside-selected-roots', reasonCode: 'CANDIDATE_OUTSIDE_SELECTED_ROOTS' }
  }
  if (!selectionComplete) return { status: 'indeterminate', reasonCode: 'SELECTION_INCOMPLETE' }
  const probes = candidates.map((candidate) => probeCandidate(projectRoot, candidate))
  if (probes.includes('unknown')) return { status: 'indeterminate', reasonCode: 'CANDIDATE_PROBE_FAILED' }
  if (probes.includes('exists')) return { status: 'indeterminate', reasonCode: 'CANDIDATE_EXISTS_BUT_NOT_SELECTED' }
  return { status: 'proven-missing', reasonCode: 'ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION' }
}

/**
 * Read-only existence proof for one indexed import or JS/TS re-export fact. Uses the identity-verified source-audit artifact,
 * the existing language resolvers and the recorded selected inventory; it never reparses source, rebuilds
 * the index or writes anything. Unresolved is never translated into missing without a complete enumerated
 * candidate set in a complete selection. Re-export chains are not traversed: a present immediate target
 * says nothing about its exported bindings, cycles, external dependencies or global reference coverage.
 */
export function resolveAuditImportTarget(indexDir: string, importFactId: string): AuditImportTargetProof {
  const artifact = readSourceAuditEvidence(indexDir)
  const { file, fact } = findImportFact(artifact, importFactId)
  // The origin file must still be the indexed one before any conclusion is drawn from its import.
  assertSourceAuditFileFresh(artifact, file)

  const selectionComplete = artifact.coverage.inventoryComplete && artifact.coverage.exclusionsAreExplicit
  const specifier = fact.sourceSpecifier

  const proof = (status: AuditImportTargetProof['status'], candidatePaths: readonly string[], reasonCode: string): AuditImportTargetProof => ({
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    mode: 'audit-import-target',
    snapshotId: artifact.source.snapshotId,
    importFactId,
    originFile: file.path,
    sourceSpecifier: specifier ?? '',
    status,
    candidatePaths: [...new Set(candidatePaths)].sort(compareText),
    selectionComplete,
    reasonCode,
  })

  if (!specifier) return proof('indeterminate', [], 'NO_STATIC_SPECIFIER')

  if (file.language === 'java' || file.language === 'kotlin') {
    const target = fact.jvmImportTarget
    const targetName = target?.qualifiedName ?? null
    const ordinary = artifact.files.filter((entry) => /\.(java|kt)$/i.test(entry.path))
    const reasons: string[] = []
    if (!selectionComplete) reasons.push('SELECTION_INCOMPLETE')
    if (!target || target.kind === 'unsupported' || !targetName) reasons.push('UNSUPPORTED_JVM_TARGET')
    if (!/\.(java|kt)$/i.test(file.path)) reasons.push('SCRIPT_SEMANTICS_UNSUPPORTED')
    for (const entry of ordinary) {
      assertSourceAuditFileFresh(artifact, entry)
      if (entry.jvmPackageName === undefined) reasons.push(`UNKNOWN_PACKAGE:${entry.path}`)
      if (entry.capabilities.jvmDeclarations !== 'complete') reasons.push(`INCOMPLETE_DECLARATIONS:${entry.path}`)
      if (entry.diagnostics.some((diagnostic) => /truncat|dropped/.test(diagnostic.code))) reasons.push(`TRUNCATED_EVIDENCE:${entry.path}`)
    }
    const declarations = ordinary.flatMap((entry) => entry.facts.filter((candidate) => candidate.kind === 'declaration' && candidate.jvmDeclaration).map((candidate) => ({ file: entry, fact: candidate, identity: candidate.jvmDeclaration! })))
    const matches = (targetName && target?.kind !== 'unsupported' && /\.(java|kt)$/i.test(file.path)
      ? declarations.filter((candidate) => candidate.identity.qualifiedName === targetName && (target?.kind === 'kotlin-direct' || candidate.identity.role === 'type')) : []
    ).sort((a, b) => compareText(a.fact.id, b.fact.id))
    // A nested type's package cannot be inferred by splitting its final component. Use observed
    // package identities, preserving uncertainty when more than one package partition is possible.
    const packages = [...new Set(ordinary.flatMap((entry) => entry.jvmPackageName !== undefined && targetName && (entry.jvmPackageName === '' ? !targetName.includes('.') : targetName.startsWith(`${entry.jvmPackageName}.`)) ? [entry.jvmPackageName] : []))]
    const matchingPackages = [...new Set(matches.map((candidate) => candidate.identity.packageName))]
    const targetPackage = matchingPackages.length === 1 ? matchingPackages[0]! : packages.length === 1 ? packages[0]! : null
    const witnesses = targetPackage === null ? [] : declarations.filter((candidate) => candidate.identity.packageName === targetPackage)
    if (targetPackage === null) reasons.push('TARGET_PACKAGE_UNESTABLISHED')
    if (witnesses.length === 0) reasons.push('NO_PACKAGE_WITNESS')
    const domainComplete = reasons.length === 0
    const status = domainComplete ? matches.length > 0 ? 'present' : 'proven-missing' : 'indeterminate'
    return {
      ...proof(status, [], status === 'present' ? 'QUALIFIED_DECLARATION_MATCH' : status === 'proven-missing' ? 'ABSENT_IN_COMPLETE_JVM_DECLARATION_DOMAIN' : 'JVM_DECLARATION_DOMAIN_INCOMPLETE'),
      declarationProof: {
        scope: 'selected-ordinary-jvm-sources', targetKind: target?.kind ?? 'unsupported', targetQualifiedName: targetName,
        targetPackageName: targetPackage, domainComplete,
        packageWitnessFactIds: witnesses.map((candidate) => candidate.fact.id).sort(compareText),
        matchingDeclarationFactIds: matches.map((candidate) => candidate.fact.id),
        matchingSourcePaths: matches.map((candidate) => candidate.file.path),
        matchingQualifiedNames: matches.map((candidate) => candidate.identity.qualifiedName),
        incompletenessReasons: [...new Set(reasons)].sort(compareText),
      },
    }
  }

  const esm = fact.kind === 'export' || file.facts.some(entry => entry.literalImportFactId === fact.id)
  const resolution = resolveAuditTargetCandidates(artifact, file, specifier, fact.importedNames ?? [], esm)
  return proof(resolution.status, resolution.candidatePaths, resolution.reasonCode)
}

/** A completeness premise belongs to the candidate resolver, independent of operand evaluation. */
interface AuditCandidateResolution {
  status: AuditImportTargetProof['status']
  candidatePaths: string[]
  reasonCode: string
  candidateEnumerationComplete: boolean
  candidateDomain: readonly string[] | null
}

function runtimeProfileIsDefault(): boolean {
  if (process.env.NODE_OPTIONS?.trim()) return false
  const hasResolverOptions = process.execArgv.some(arg =>
    /^--(?:experimental-loader|loader|import|require|conditions|preserve-symlinks(?:-main)?)(?:=|$)/.test(arg) ||
    /^-[rC]/.test(arg))
  if (!hasResolverOptions || !process.argv[1]) return true
  // The bundled CLI is its own entry point. Programmatic and source development
  // callers can have a tool loader of their own, independent of the fixed
  // resolver profile used to inspect target source.
  try {
    return fs.realpathSync(process.argv[1]) !== fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

/** Qualify only implicit default source mapping. A source snapshot does not pin compiler options. */
function defaultSourceMapping(projectRoot: string, origin: string): boolean {
  let directory = path.posix.dirname(origin)
  for (;;) {
    if (['tsconfig.json', 'jsconfig.json'].some(name =>
      probeCandidate(projectRoot, path.posix.join(directory, name)) !== 'absent')) return false
    if (directory === '.') return true
    directory = path.posix.dirname(directory)
  }
}

function isOrdinaryPathSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..' || /[\\\x00-\x1f]/.test(segment)) return false
  return process.platform !== 'win32' || !(/[<>:"|?*]|[ .]$/.test(segment) ||
    /^(?:con|prn|aux|nul|com[1-9Â¹Â²Â³]|lpt[1-9Â¹Â²Â³])(?:\.|$)/i.test(segment))
}

function relativeCandidate(origin: string, localPath: string): string {
  const relative = path.posix.relative(path.posix.dirname(origin), localPath)
  return relative.startsWith('../') ? relative : './' + relative
}

function jsTsPath(projectRoot: string, origin: string, operand: string, esm: boolean) {
  if (Buffer.byteLength(operand, 'utf8') > 4096 || operand.includes('\0')) return null
  // URL parsing starts only after the module specifier is classified. In particular
  // a bare package name must never become a relative file via the URL base.
  const relative = /^(?:\.\.?)(?:\/|$)/.test(operand)
  const fileUrl = /^file:\/\//i.test(operand)
  const absolute = operand.startsWith('/') && !operand.startsWith('//')
  if (!relative && !(esm && (fileUrl || absolute))) return null
  // An ordinary fact can describe require() as well as import. Only a linked
  // dynamic expression or a re-export establishes the URL-based mechanism.
  if (!esm && /[%?#\\\x00-\x20]|\s$/.test(operand)) return null
  try {
    const url = new URL(operand, pathToFileURL(path.resolve(projectRoot, origin)))
    if (url.protocol !== 'file:' || url.host || url.pathname.endsWith('/')) return null
    const absolutePath = fileURLToPath(url)
    const root = path.resolve(projectRoot)
    const prefix = root.endsWith(path.sep) ? root : root + path.sep
    if (process.platform === 'win32' && !absolutePath.startsWith(prefix)) {
      // Drive/volume case folding is not a reliable selected-path identity.
      return path.relative(projectRoot, absolutePath).startsWith('..') ? { escaped: true } as const : null
    }
    const localPath = path.relative(projectRoot, absolutePath).split(path.sep).join('/')
    if (!insideProjectRoot(localPath)) return { escaped: true } as const
    if (!localPath.split('/').every(isOrdinaryPathSegment)) return null
    return { localPath, specifier: relativeCandidate(origin, localPath) } as const
  } catch {
    return null
  }
}

/** An origin reached through an alias can give Node a different base directory. */
function hasCanonicalPath(projectRoot: string, origin: string): boolean {
  try {
    const physicalRoot = fs.realpathSync(projectRoot)
    const physicalOrigin = fs.realpathSync(path.resolve(projectRoot, origin))
    return path.relative(physicalRoot, physicalOrigin).split(path.sep).join('/') === origin
  } catch {
    return false
  }
}

/** Shared resolver for authenticated ordinary imports and evaluated expression alternatives. */
export function resolveAuditTargetCandidates(
  artifact: SourceAuditEvidenceArtifact, file: SourceAuditFile, specifier: string, importedNames: string[], esm = false,
): AuditCandidateResolution {
  const { projectRoot, sourceRoots: roots } = artifact.source
  const selectionComplete = artifact.coverage.inventoryComplete && artifact.coverage.exclusionsAreExplicit
  const records = new Map(artifact.files.map(entry => [entry.path, entry]))
  const inventory = [...records.keys()].sort(compareText)
  const adapter = createDefaultRegistry(projectRoot).adapterForFile(file.path)
  const result = (
    status: AuditImportTargetProof['status'], paths: readonly string[], reasonCode: string,
    candidateDomain: readonly string[] | null = null,
  ): AuditCandidateResolution => ({
    status, candidatePaths: [...new Set(paths)].sort(compareText), reasonCode,
    candidateEnumerationComplete: candidateDomain !== null, candidateDomain,
  })
  if (!adapter) return result('indeterminate', [], 'UNSUPPORTED_LANGUAGE_RESOLUTION')

  let enumerated: string[] | null = null
  let existing: string[] = []
  let notEnumerableReason = 'UNSUPPORTED_LANGUAGE_RESOLUTION'
  let incompleteProfile: string | undefined
  let literalPath: string | undefined

  try {
    if (adapter instanceof TypeScriptAdapter) {
      if (!runtimeProfileIsDefault() || !hasCanonicalPath(projectRoot, file.path)) {
        return result('indeterminate', [], 'INCOMPLETE_REFERENCE_PROFILE')
      }
      const normalized = jsTsPath(projectRoot, file.path, specifier, esm)
      if (normalized?.escaped) return result('indeterminate', [], 'CANDIDATE_ESCAPES_PROJECT_ROOT')
      if (normalized) {
        literalPath = normalized.localPath
        enumerated = enumerateJsTsCandidatePaths(normalized.specifier, file.path)
        existing = enumerated?.filter(candidate => records.has(candidate)) ?? []
        notEnumerableReason = 'UNSUPPORTED_SPECIFIER_SHAPE'
        if (enumerated && !defaultSourceMapping(projectRoot, file.path)) {
          incompleteProfile = 'INCOMPLETE_REFERENCE_PROFILE'
        }
      } else if (!/^(?:[./\\]|[A-Za-z][A-Za-z0-9+.-]*:)|[%?#\x00-\x20]/.test(specifier)) {
        // Configured lookup is a live positive observation. Neither successful
        // mapping nor an empty result closes the configured resolution domain.
        existing = adapter.resolveCandidates(specifier, file.path, inventory)
        notEnumerableReason = 'EXTERNAL_OR_CONFIGURED_SPECIFIER'
      } else {
        notEnumerableReason = 'UNSUPPORTED_SPECIFIER_SHAPE'
      }
    } else if (adapter instanceof PythonAdapter) {
      existing = adapter.resolveAuditCandidates(specifier, importedNames, file.path, inventory)
      enumerated = adapter.enumerateAuditCandidatePaths(specifier, file.path)
      notEnumerableReason = 'PYTHON_CANDIDATES_NOT_ENUMERABLE'
    } else {
      const target = adapter.resolveImportToFile(specifier, file.path, inventory)
      existing = target ? [target] : []
      notEnumerableReason = file.language === 'rust' ? 'RUST_CANDIDATES_NOT_ENUMERABLE' : 'JVM_CANDIDATES_NOT_ENUMERABLE'
    }
  } catch (error) {
    if (error instanceof SourceAuditEvidenceError || error instanceof UnsafeSourceError) throw error
    return result('indeterminate', [], 'RESOLVER_FAILED')
  }

  existing = existing.filter(candidate => records.has(candidate))
  if (existing.length > 0) {
    for (const candidate of existing) assertSourceAuditFileFresh(artifact, records.get(candidate)!)
    const reason = existing.length === 1 ? 'TARGET_IN_SELECTED_INVENTORY' : 'MULTIPLE_TARGETS_IN_SELECTED_INVENTORY'
    const complete = enumerated !== null && !incompleteProfile && (
      !literalPath || (
        (enumerated.includes(literalPath) || probeCandidate(projectRoot, literalPath) === 'absent') &&
        enumerated.every(candidate => records.has(candidate) ? hasCanonicalPath(projectRoot, candidate) :
          insideProjectRoot(candidate) && probeCandidate(projectRoot, candidate) === 'absent')
      )
    )
    return result('present', adapter instanceof TypeScriptAdapter ? existing : enumerated ?? existing, reason,
      complete ? enumerated : null)
  }
  if (!enumerated?.length) return result('indeterminate', [], notEnumerableReason)

  if (enumerated.some(candidate => !insideProjectRoot(candidate))) {
    return result('indeterminate', enumerated.filter(insideProjectRoot), 'CANDIDATE_ESCAPES_PROJECT_ROOT')
  }
  try {
    for (const candidate of enumerated) ensureInsideProjectRoot(projectRoot, candidate)
  } catch {
    return result('indeterminate', enumerated, 'CANDIDATE_ESCAPES_PROJECT_ROOT')
  }
  if (incompleteProfile) return result('indeterminate', enumerated, incompleteProfile)
  // An extensionless literal can exist or denote a directory with its own
  // package entry. The source-extension candidates alone do not bound it.
  if (literalPath && !enumerated.includes(literalPath)) {
    if (!insideSelectedRoots(roots, literalPath)) {
      return result('outside-selected-roots', enumerated, 'CANDIDATE_OUTSIDE_SELECTED_ROOTS')
    }
    const literal = probeCandidate(projectRoot, literalPath)
    if (literal === 'unknown') return result('indeterminate', enumerated, 'CANDIDATE_PROBE_FAILED')
    if (literal === 'exists') return result('indeterminate', enumerated, 'CANDIDATE_EXISTS_BUT_NOT_SELECTED')
  }
  const decision = classifyAbsentCandidates(projectRoot, roots, enumerated, selectionComplete)
  return result(decision.status, enumerated, decision.reasonCode, decision.status === 'proven-missing' ? enumerated : null)
}
/**
 * A source-extension candidate is not a positive ESM reference witness.
 * The default ESM file URL must itself designate this exact selected path.
 * This is source-reference evidence, not a promise the module can be loaded.
 * Reuse the shared candidate owner's URL, containment and profile checks.
 */
export function isQualifiedDefaultEsmSelectedReference(
  artifact: SourceAuditEvidenceArtifact,
  origin: SourceAuditFile,
  specifier: string,
  selectedPath: string,
): boolean {
  if (origin.language !== 'typescript' && origin.language !== 'javascript') return false
  if (!runtimeProfileIsDefault() || !hasCanonicalPath(artifact.source.projectRoot, origin.path)) return false
  const normalized = jsTsPath(artifact.source.projectRoot, origin.path, specifier, true)
  if (!normalized || !('localPath' in normalized) || normalized.localPath !== selectedPath) return false
  if (!insideSelectedRoots(artifact.source.sourceRoots, selectedPath)) return false
  return hasCanonicalPath(artifact.source.projectRoot, selectedPath)
}
