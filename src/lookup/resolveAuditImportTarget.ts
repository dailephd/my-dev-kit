import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { createDefaultRegistry } from '../languages/registry.js'
import { PythonAdapter } from '../languages/python/adapter.js'
import { TypeScriptAdapter, enumerateJsTsCandidatePaths } from '../languages/typescript/adapter.js'
import { ConfiguredImportResolver } from '../languages/typescript/configuredImportResolver.js'
import type { SourceAuditEvidenceArtifact, SourceAuditFact, SourceAuditFile } from '../symbol-index/auditEvidenceTypes.js'
import { SOURCE_AUDIT_SCHEMA_VERSION } from '../symbol-index/auditEvidenceTypes.js'
import { auditSpanAt, parseTypeScriptSource } from '../symbol-index/symbolExtractor.js'
import { readAuthenticatedAuditBytes } from '../source/readAuthenticatedAuditBytes.js'
import { assertSourceAuditFileFresh, readSourceAuditEvidence, SourceAuditEvidenceError } from './readSourceAuditEvidence.js'
import { ensureInsideProjectRoot, readSourceBytes, UnsafeSourceError } from './getSourceSlice.js'

interface SourceReferencePremise {
  role: 'config' | 'package-metadata' | 'candidate' | 'path'
  path: string
  state: 'absent' | 'file' | 'directory'
  contentSha256: string | null
}

interface SourceReferenceProof {
  schemaVersion: '1.0.0'
  profile: 'js-ts-selected-source-reference-v1'
  pathIdentityProfile: 'selected-source-path-v1'
  snapshotId: string
  selectionFingerprint: string
  selectedDomainDigest: string
  originFile: string
  originContentSha256: string
  importFactId: string
  sourceSpecifier: string
  resolutionPlatform: 'win32' | 'posix'
  candidateEnumerationComplete: boolean
  candidateDomain: string[] | null
  qualifiedReference: { targetPath: string; targetContentSha256: string; referenceKind: 'selected-source-reference' } | null
  premiseRefs: SourceReferencePremise[]
  reasonCode: string | null
}

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
  sourceReferenceProof?: SourceReferenceProof
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
 * the existing language resolvers and the recorded selected inventory. NodeNext checks the mode of an
 * existing fact using the same parser on authenticated origin bytes. This lookup never rebuilds the
 * index or writes anything. Unresolved is never translated into missing without a complete enumerated
 * candidate set in a complete selection. Re-export chains are not traversed: a present immediate target
 * says nothing about its exported bindings, cycles, external dependencies or global reference coverage.
 */
export function resolveAuditImportTarget(indexDir: string, importFactId: string): AuditImportTargetProof {
  return resolveAuditImportTargetFromArtifact(readSourceAuditEvidence(indexDir), importFactId)
}

export function resolveAuditImportTargetFromArtifact(artifact: SourceAuditEvidenceArtifact, importFactId: string): AuditImportTargetProof {
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
  const legacy = proof(resolution.status, resolution.candidatePaths, resolution.reasonCode)
  if (artifact.schemaVersion !== '1.2.0' || !file.contentSha256 || fact.extractionMethod !== 'typescript-ast' ||
      (file.language !== 'typescript' && file.language !== 'javascript') ||
      !isBoundedReferenceSpecifier(specifier) || Buffer.byteLength(file.path) > 4096) return legacy
  return { ...legacy, sourceReferenceProof: buildSourceReferenceProof(artifact, file, fact, specifier, legacy) }
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

function* defaultConfigurationPaths(origin: string): Iterable<string> {
  let directory = path.posix.dirname(origin)
  for (;;) {
    yield path.posix.join(directory, 'tsconfig.json')
    yield path.posix.join(directory, 'jsconfig.json')
    if (directory === '.') return
    directory = path.posix.dirname(directory)
  }
}

/** Qualify only implicit default source mapping. A source snapshot does not pin compiler options. */
function defaultSourceMapping(projectRoot: string, origin: string): boolean {
  for (const config of defaultConfigurationPaths(origin)) {
    if (probeCandidate(projectRoot, config) !== 'absent') return false
  }
  return true
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

export function isBoundedReferenceSpecifier(specifier: string): boolean {
  return Buffer.byteLength(specifier, 'utf8') <= 4096
}

const MAX_REFERENCE_CANDIDATES = 256
const MAX_REFERENCE_PREMISES = 1024
const MAX_REFERENCE_BYTES = 1024 * 1024
const hashReferenceBytes = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

class UnqualifiedReference extends Error {}

/** Check each existing component before concluding absence under a missing parent. */
function inspectReferencePath(
  root: string, relative: string, states = new Map<string, SourceReferencePremise['state']>(),
): SourceReferencePremise['state'] {
  const segments = relative.split('/')
  if (!insideProjectRoot(relative) || Buffer.byteLength(relative) > 4096 ||
      segments.some(segment => !isOrdinaryPathSegment(segment) || segment.toLowerCase() === 'node_modules')) {
    throw new UnqualifiedReference('UNQUALIFIED_PATH_IDENTITY')
  }
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    let state = states.get(current)
    if (!state) {
      let stat: fs.Stats | undefined
      try {
        stat = fs.lstatSync(current)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new UnqualifiedReference('PATH_PROBE_FAILED')
      }
      if (stat) {
        if (stat.isSymbolicLink() || fs.realpathSync.native(current) !== current) {
          throw new UnqualifiedReference('UNQUALIFIED_PATH_IDENTITY')
        }
        if (!stat.isFile() && !stat.isDirectory()) throw new UnqualifiedReference('UNSUPPORTED_PATH_ENTRY')
      }
      state = !stat ? 'absent' : stat.isFile() ? 'file' : 'directory'
      states.set(current, state)
    }
    if (index === segments.length - 1 || state === 'absent') return state
    if (state !== 'directory') throw new UnqualifiedReference('UNSUPPORTED_PATH_ENTRY')
  }
  return 'directory'
}

/** Proof-local observations share one byte identity per path, including across roles. */
export class ReferencePremises {
  private readonly pathStates = new Map<string, SourceReferencePremise['state']>()
  private readonly observations = new Map<string, {
    state: SourceReferencePremise['state']; bytes: Buffer | null; contentSha256: string | null; sizeBytes: number | null
  }>()
  private readonly refs = new Map<string, SourceReferencePremise>()
  private serializedBytes = 0

  constructor(private readonly root: string) {}

  capture(role: SourceReferencePremise['role'], relative: string, limit = MAX_REFERENCE_BYTES) {
    const key = role + '\0' + relative
    let observation = this.observations.get(relative)
    if (!observation) {
      const state = inspectReferencePath(this.root, relative, this.pathStates)
      const bytes = state === 'file' ? readSourceBytes(this.root, relative, limit) : null
      observation = {
        state, bytes: role === 'config' || role === 'package-metadata' ? bytes : null,
        contentSha256: bytes && hashReferenceBytes(bytes), sizeBytes: bytes?.length ?? null,
      }
      this.observations.set(relative, observation)
    }
    if (!this.refs.has(key)) {
      const { state, contentSha256 } = observation
      const premise = { role, path: relative, state, contentSha256 }
      this.serializedBytes += Buffer.byteLength(JSON.stringify(premise)) + 1
      if (this.refs.size >= MAX_REFERENCE_PREMISES || this.serializedBytes > MAX_REFERENCE_BYTES) {
        throw new UnqualifiedReference('REFERENCE_PREMISE_BUDGET_EXCEEDED')
      }
      this.refs.set(key, premise)
    }
    return observation
  }

  recheck(): SourceReferencePremise[] {
    const pathStates = new Map<string, SourceReferencePremise['state']>()
    for (const [relative, observed] of this.observations) {
      if (inspectReferencePath(this.root, relative, pathStates) !== observed.state ||
          (observed.state === 'file' && hashReferenceBytes(readSourceBytes(this.root, relative, observed.sizeBytes!)) !== observed.contentSha256)) {
        throw new UnqualifiedReference('REFERENCE_PREMISE_CHANGED')
      }
    }
    return [...this.refs.values()].sort((a, b) => compareText(a.role, b.role) || compareText(a.path, b.path))
  }
}

function declarationBlockers(base: string): string[] {
  const ext = path.posix.extname(base).toLowerCase()
  if (!ext) return ['.d.ts', '.d.mts', '.d.cts'].flatMap(suffix => [base + suffix, base + '/index' + suffix])
  const stem = base.slice(0, -ext.length)
  if (ext === '.js' || ext === '.jsx') return [stem + '.d.ts']
  if (ext === '.mjs' || ext === '.cjs') return [stem + (ext === '.mjs' ? '.d.mts' : '.d.cts')]
  return []
}

// These explicit substitution families are shared by the pinned TypeScript
// Bundler and NodeNext ESM resolvers. Declaration alternatives stay blockers.
function explicitSourceCandidates(base: string, candidates: string[]): { paths: string[]; blockers: string[] } {
  const extension = path.posix.extname(base).toLowerCase()
  const stem = base.slice(0, -extension.length)
  if (/\.d\.[cm]?ts$/i.test(base)) throw new UnqualifiedReference('DECLARATION_RESOLUTION_BLOCKER')
  if (/^(?:\.[jt]sx?)$/.test(extension)) {
    return { paths: [...new Set([...candidates, ...['.ts', '.tsx', '.js', '.jsx'].map(suffix => stem + suffix)])], blockers: [stem + '.d.ts'] }
  }
  const family = extension[1]
  return { paths: [...new Set([...candidates, stem + '.' + family + 'ts', stem + '.' + family + 'js'])], blockers: [stem + '.d.' + family + 'ts'] }
}

function bundlerSourceCandidates(base: string, candidates: string[]): { paths: string[]; blockers: string[] } {
  if (path.posix.extname(base)) return explicitSourceCandidates(base, candidates)
  const modern = /\.[cm][jt]s$/
  return { paths: candidates.filter(candidate => !modern.test(candidate)), blockers: candidates.filter(candidate => modern.test(candidate)) }
}

function nearestReferencePackage(premises: ReferencePremises, sourcePath: string): {
  path: string; type: 'module' | 'commonjs' | undefined
} | null {
  let directory = path.posix.dirname(sourcePath)
  for (;;) {
    const name = path.posix.join(directory, 'package.json')
    const metadata = premises.capture('package-metadata', name)
    if (metadata.state !== 'absent') {
      if (!metadata.bytes) throw new UnqualifiedReference('UNQUALIFIED_PACKAGE_METADATA')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(metadata.bytes)
      let value: unknown
      try { value = JSON.parse(text) } catch { throw new UnqualifiedReference('UNQUALIFIED_PACKAGE_METADATA') }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnqualifiedReference('UNQUALIFIED_PACKAGE_METADATA')
      // Reject duplicate top-level keys before relying on JSON's last-key-wins
      // object. The pinned parser decodes escaped property names as well.
      const statement = ts.parseJsonText(name, text).statements[0]
      if (!statement || !ts.isExpressionStatement(statement) || !ts.isObjectLiteralExpression(statement.expression)) {
        throw new UnqualifiedReference('UNQUALIFIED_PACKAGE_METADATA')
      }
      const keys = new Set<string>()
      for (const property of statement.expression.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) || keys.has(property.name.text)) {
          throw new UnqualifiedReference('UNQUALIFIED_PACKAGE_METADATA')
        }
        keys.add(property.name.text)
      }
      const type = (value as { type?: unknown }).type
      if (type !== undefined && type !== 'module' && type !== 'commonjs') throw new UnqualifiedReference('UNQUALIFIED_PACKAGE_METADATA')
      return { path: name, type }
    }
    if (directory === '.') return null
    directory = path.posix.dirname(directory)
  }
}

function isNodeNextEsmReference(
  artifact: SourceAuditEvidenceArtifact, file: SourceAuditFile, fact: SourceAuditFact,
  specifier: string, packageType: 'module' | 'commonjs' | undefined,
): boolean {
  if (!runtimeProfileIsDefault() || fact.span.endLine === null || fact.span.endColumn === null ||
      /\.d\.[cm]?ts$/.test(file.path) ||
      !(file.path.endsWith('.mts') || file.path.endsWith('.mjs') ||
        packageType === 'module' && /\.[jt]sx?$/.test(file.path))) return false
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    readAuthenticatedAuditBytes(artifact, file, MAX_REFERENCE_BYTES),
  )
  const sf = parseTypeScriptSource(file.path, text)
  sf.impliedNodeFormat = ts.ModuleKind.ESNext
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
  const matches = (node: ts.Node) => {
    const span = auditSpanAt(sf, file.path, node.getStart(sf), node.end, true)
    return span.path === fact.span.path && span.startLine === fact.span.startLine &&
      span.startColumn === fact.span.startColumn && span.endLine === fact.span.endLine && span.endColumn === fact.span.endColumn
  }
  const qualifies = (operand: ts.Expression | undefined) => operand && ts.isStringLiteral(operand) &&
    operand.text === specifier && ts.getModeForUsageLocation(sf, operand, options) === ts.ModuleKind.ESNext
  for (const statement of sf.statements) {
    if (fact.kind === 'import' && ts.isImportDeclaration(statement) && matches(statement)) {
      return !!qualifies(statement.moduleSpecifier)
    }
    if (fact.kind === 'export' && fact.exportOrigin === 're-export' && ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      const nodes = !clause ? [statement] : ts.isNamespaceExport(clause) ? [clause] : clause.elements
      if (nodes.some(matches)) return !!qualifies(statement.moduleSpecifier)
    }
  }
  // A linked dynamic expression can supply an ordinary literal-import fact.
  // Require the literal at the recorded span and leave computed operands to
  // the separate expression proof profile.
  if (fact.kind !== 'import' || !file.facts.some(entry => entry.literalImportFactId === fact.id)) return false
  const literalImport = (node: ts.Node): boolean =>
    ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 && matches(node) && !!qualifies(node.arguments[0]) ||
    ts.forEachChild(node, literalImport) === true
  return literalImport(sf)
}

/** Authenticate the already-enumerated domain for one exact, default-profile relative destination. */
export function captureDefaultExactReferencePremises(
  artifact: SourceAuditEvidenceArtifact, origin: SourceAuditFile, specifier: string,
  target: SourceAuditFile, candidates: readonly string[],
): SourceReferencePremise[] | null {
  if (!/^\.\.?\//.test(specifier) || /[\\%?#\s\x00-\x1f]/.test(specifier) ||
      specifier.replace(/^(?:\.\.?\/)+/, '').split('/').some(segment => !isOrdinaryPathSegment(segment)) ||
      path.posix.normalize(path.posix.join(path.posix.dirname(origin.path), specifier)) !== target.path ||
      !target.contentSha256 || target.sizeBytes === null ||
      (target.language !== 'typescript' && target.language !== 'javascript')) return null
  try {
    if (!isQualifiedDefaultEsmSelectedReference(artifact, origin, specifier, target.path)) return null
    const { projectRoot } = artifact.source
    const root = fs.realpathSync.native(projectRoot)
    if (inspectReferencePath(root, origin.path) !== 'file') return null
    const premises = new ReferencePremises(root)
    for (const config of defaultConfigurationPaths(origin.path)) {
      if (premises.capture('config', config).state !== 'absent') return null
    }
    for (const blocker of declarationBlockers(target.path)) {
      if (premises.capture('path', blocker).state !== 'absent') return null
    }
    for (const candidate of candidates) {
      if (candidate === target.path) {
        const observed = premises.capture('candidate', candidate, target.sizeBytes)
        if (observed.state !== 'file' || observed.contentSha256 !== target.contentSha256 || observed.sizeBytes !== target.sizeBytes) return null
      } else if (premises.capture('candidate', candidate).state !== 'absent') return null
    }
    const refs = premises.recheck()
    if (fs.realpathSync.native(projectRoot) !== root || inspectReferencePath(root, origin.path) !== 'file') return null
    assertSourceAuditFileFresh(artifact, origin)
    return refs
  } catch {
    // Qualification is additive. A failure here does not alter the parent domain.
    return null
  }
}

function buildSourceReferenceProof(
  artifact: SourceAuditEvidenceArtifact, file: SourceAuditFile, fact: SourceAuditFact, specifier: string, legacy: AuditImportTargetProof,
): SourceReferenceProof {
  const { projectRoot, selectionFingerprint, snapshotId } = artifact.source
  const records = new Map(artifact.files.map(entry => [entry.path, entry]))
  const identity = {
    schemaVersion: '1.0.0', profile: 'js-ts-selected-source-reference-v1', pathIdentityProfile: 'selected-source-path-v1',
    snapshotId, selectionFingerprint, selectedDomainDigest: hashReferenceBytes(JSON.stringify([...records.keys()].sort())),
    originFile: file.path, originContentSha256: file.contentSha256!, importFactId: fact.id, sourceSpecifier: specifier,
    resolutionPlatform: process.platform === 'win32' ? 'win32' : 'posix',
  } as const
  const incomplete = (reasonCode: string): SourceReferenceProof => ({
    ...identity, candidateEnumerationComplete: false, candidateDomain: null, qualifiedReference: null, premiseRefs: [], reasonCode,
  })
  if (!legacy.selectionComplete) return incomplete('SELECTION_INCOMPLETE')
  if (/[%?#\\\x00-\x20]|\s$/.test(specifier) || specifier.endsWith('/') ||
      specifier.replace(/^(?:\.\.?\/)+/, '').split('/').some(segment => !isOrdinaryPathSegment(segment))) {
    return incomplete('UNSUPPORTED_SPECIFIER_SHAPE')
  }
  const relative = /^(?:\.\.?)(?:\/|$)/.test(specifier)
  if (!relative && /^(?:[./\\]|[A-Za-z][A-Za-z0-9+.-]*:)/.test(specifier)) return incomplete('UNSUPPORTED_SPECIFIER_SHAPE')

  try {
    const root = fs.realpathSync.native(projectRoot)
    if (inspectReferencePath(root, file.path) !== 'file') return incomplete('UNQUALIFIED_ORIGIN')
    const localPath = relative ? jsTsPath(projectRoot, file.path, specifier, false)?.localPath : undefined
    if (relative && !localPath) return incomplete('UNSUPPORTED_RELATIVE_PATH')
    const premises = new ReferencePremises(root)
    const resolver = new ConfiguredImportResolver(root, configPath => {
      const observation = premises.capture('config', configPath)
      if (observation.state === 'directory') throw new UnqualifiedReference('UNSUPPORTED_CONFIG')
      return observation.bytes
    })
    const configured = resolver.sourceReferenceBases(specifier, file.path, relative)
    if (!configured) return incomplete('UNQUALIFIED_CONFIGURATION_OR_MAPPING')
    const nodeNext = configured.mode === 'nodenext'
    if (nodeNext) {
      if (!localPath || !/\.(?:jsx?|[mc]js)$/.test(localPath) || /\.d\.(?:jsx?|[mc]js)$/i.test(localPath)) {
        return incomplete('UNSUPPORTED_NODENEXT_SPECIFIER')
      }
      const originPackage = nearestReferencePackage(premises, file.path)
      if (!isNodeNextEsmReference(artifact, file, fact, specifier, originPackage?.type)) {
        return incomplete('UNQUALIFIED_NODENEXT_ESM_REFERENCE')
      }
      if (path.posix.dirname(localPath) !== path.posix.dirname(file.path) &&
          nearestReferencePackage(premises, localPath)?.path !== originPackage?.path) {
        return incomplete('UNQUALIFIED_NODENEXT_PACKAGE_BOUNDARY')
      }
    }
    const bases = localPath ? [localPath] : configured.bases
    const domain = new Set<string>()
    const targets: Array<{ path: string; contentSha256: string }> = []
    for (const base of bases) {
      if (!base) return incomplete('UNQUALIFIED_MAPPING_TARGET')
      const enumerated = enumerateJsTsCandidatePaths(relativeCandidate(file.path, base), file.path)
      if (!enumerated?.length) return incomplete('UNSUPPORTED_CANDIDATE_SHAPE')
      const family = nodeNext ? explicitSourceCandidates(base, enumerated)
        : configured.mode === 'bundler' ? bundlerSourceCandidates(base, enumerated) : null
      const candidates = family?.paths ?? enumerated
      for (const candidate of candidates) domain.add(candidate)
      if (domain.size > MAX_REFERENCE_CANDIDATES) return incomplete('REFERENCE_CANDIDATE_BUDGET_EXCEEDED')

      if (!candidates.includes(base)) {
        const literal = premises.capture('path', base)
        if (literal.state === 'file') return incomplete('EXTENSIONLESS_FILE_PRESENT')
        if (premises.capture('package-metadata', base + '/package.json').state !== 'absent') {
          return incomplete('UNSUPPORTED_DIRECTORY_METADATA')
        }
        for (const entry of [base + '.json', base + '.node', base + '/index.json', base + '/index.node']) {
          if (premises.capture('path', entry).state !== 'absent') return incomplete('UNSUPPORTED_SOURCE_ENTRY')
        }
      }
      for (const blocker of declarationBlockers(base)) {
        if (premises.capture('path', blocker).state !== 'absent') return incomplete('DECLARATION_RESOLUTION_BLOCKER')
      }
      for (const blocker of family?.blockers ?? []) {
        if (premises.capture('path', blocker).state !== 'absent') {
          return incomplete(/\.d\.[cm]?ts$/.test(blocker) ? 'DECLARATION_RESOLUTION_BLOCKER' : 'UNSUPPORTED_CANDIDATE_SHAPE')
        }
      }
      for (const candidate of candidates) {
        const selected = records.get(candidate)
        const observed = premises.capture('candidate', candidate, selected?.sizeBytes ?? MAX_REFERENCE_BYTES)
        if (observed.state === 'absent' && !selected) continue
        if (observed.state !== 'file' || !selected?.contentSha256 || observed.contentSha256 !== selected.contentSha256 ||
            observed.sizeBytes !== selected.sizeBytes ||
            (selected.language !== 'typescript' && selected.language !== 'javascript')) {
          return incomplete('UNQUALIFIED_CANDIDATE_STATE')
        }
        targets.push({ path: candidate, contentSha256: selected.contentSha256 })
      }
      // Only an entirely absent qualified mapping admits its next fallback.
      if (targets.length > 0) break
    }
    if (!domain.size || (!relative && !targets.length)) return incomplete('BARE_SPECIFIER_FALLBACK_UNKNOWN')
    const contradictsTarget = (candidate: string): boolean => !targets.some(target => target.path === candidate)
    if ((legacy.status === 'proven-missing' && targets.length > 0) ||
        (legacy.status === 'present' && legacy.candidatePaths.some(contradictsTarget)) ||
        fact.targetPaths?.some(contradictsTarget)) return incomplete('RECORDED_TARGET_CONFLICT')
    const singleton = targets.length === 1 ? targets[0] : undefined
    const premiseRefs = premises.recheck()
    if (fs.realpathSync.native(projectRoot) !== root || inspectReferencePath(root, file.path) !== 'file') {
      return incomplete('UNQUALIFIED_ORIGIN')
    }
    assertSourceAuditFileFresh(artifact, file)
    const result: SourceReferenceProof = {
      ...identity, candidateEnumerationComplete: true, candidateDomain: [...domain].sort(),
      qualifiedReference: singleton ? {
        targetPath: singleton.path, targetContentSha256: singleton.contentSha256, referenceKind: 'selected-source-reference',
      } : null,
      premiseRefs, reasonCode: null,
    }
    return Buffer.byteLength(JSON.stringify(result)) <= MAX_REFERENCE_BYTES ? result : incomplete('REFERENCE_RESPONSE_BUDGET_EXCEEDED')
  } catch (error) {
    return incomplete(error instanceof UnqualifiedReference ? error.message : 'REFERENCE_PREMISE_UNAVAILABLE')
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
