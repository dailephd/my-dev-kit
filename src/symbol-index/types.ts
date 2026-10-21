/**
 * Type definitions for the symbol-index retrieval layer.
 *
 * Two artifacts are produced by the builder:
 *   log/symbol-index.json            — main artifact (always written)
 *   log/symbol-index.call-graph.json — optional call-graph artifact (only when --call-graph is passed)
 *
 * The call-graph artifact is kept separate from the main artifact so that
 * the orchestrator can load the main index without pulling in call-graph edges.
 */

import type { SemanticArtifactRef, SemanticRole } from '../semantics/index.js'
import type { ClassificationRoleRef } from '../classification/classificationTypes.js'
import type { AndroidComponentRoleRef } from '../android/androidComponentTypes.js'

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Schema version string for artifact forward-compatibility checks. */
export const SCHEMA_VERSION = '3'

/** Artifact filenames (relative to the output directory). */
export const ARTIFACT_MAIN = 'symbol-index.json'
export const ARTIFACT_CALL_GRAPH = 'symbol-index.call-graph.json'

/** Supported source language labels. */
export type SourceLanguage = 'typescript' | 'javascript' | 'python' | 'kotlin' | 'java' | 'rust'

/** Classification of a symbol declaration. */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'field'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'variable'
  /** Kotlin `object`/`companion object` declarations: a singleton/namespace, not cleanly a `class`. */
  | 'object'
  | 'struct'
  | 'union'
  | 'trait'
  | 'variant'
  | 'module'
  | 'macro'

// ---------------------------------------------------------------------------
// Symbol index types
// ---------------------------------------------------------------------------

/**
 * A file location: used for symbol definitions and call-graph edges.
 * `file` is always relative to the repo root, using forward slashes.
 * `line` is 1-based.
 */
export interface SymbolLocation {
  file: string
  line: number
  /**
   * 1-based inclusive declaration end line. Present only when the language
   * extractor's parser establishes a trustworthy boundary (an integer >= `line`
   * and within the file); absent when the boundary is unknown.
   */
  endLine?: number
}

/**
 * A single symbol (function, class, interface, type alias, enum, or variable)
 * defined at a specific location in a source file.
 */
export interface SymbolDefinition {
  declarationMetadata?: { decorators?: DecoratorMetadata[]; jsdoc?: JSDocMetadata[]; rust?: RustDeclarationMetadata }
  nodeId?: string
  qualifiedName?: string
  ownerKey?: string
  /** Declared name of the symbol. */
  name: string
  /** Declaration kind. */
  kind: SymbolKind
  /** Source location of the declaration. */
  location: SymbolLocation
  /** Whether the symbol is exported from its module. */
  exported: boolean
  /**
   * Brief first-line text of the declaration, trimmed and capped at 120
   * characters. Useful as a compact signature for prompt assembly.
   */
  signature?: string
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  /** Android component roles detected for this symbol (v1.9.0 Batch 4). Only ever present on Kotlin/Java symbols in an Android project. */
  androidComponentRoles?: AndroidComponentRoleRef[]
  androidComponentRefs?: SemanticArtifactRef[]
}

/**
 * A compact summary of one source file.
 *
 * This is the primary unit of the main symbol-index artifact.
 * It is designed to be small enough to include in a prompt context block
 * while still providing enough information for:
 * - file path identification
 * - import/export relationships
 * - symbol discovery and location
 */
export interface FileSummary {
  rustSyntaxFacts?: RustSyntaxFact[]
  commonJsExports?: CommonJsExportFact[]
  pythonOrmFacts?: PythonOrmFact[]
  frameworkRouteFacts?: FrameworkRouteFact[]
  warnings?: string[]
  importBindings?: ImportBinding[]
  /** File path relative to the repo root, forward slashes. */
  path: string
  /** Source language of the file. */
  language: SourceLanguage
  /** Total number of lines in the file. */
  lineCount: number
  /**
   * Module specifiers of all static imports in this file.
   * Relative paths are left as-is; not resolved to absolute.
   */
  imports: string[]
  /**
   * Names of all symbols exported by this file.
   * Derived from declarations with `export` keyword and `export { }` clauses.
   */
  exports: string[]
  /** All named symbol definitions found in this file. */
  symbols: SymbolDefinition[]
  /**
   * True if the call-graph artifact contains edges involving this file.
   * False if call-graph was not built or this file has no edges.
   */
  hasCallGraphEntries: boolean
}

/** Compact parser observations, never Cargo/module resolution or macro expansion. */
export interface RustDeclarationMetadata {
  syntaxKind: string
  visibility: string
  attributes: string[]
  declarationOnly: boolean
  modifiers: string[]
  shape?: 'named' | 'tuple' | 'unit'
}

export interface RustSyntaxFact {
  /** B10 source-grounded observations from the existing CST traversal. */
  parentOwnerKey?: string
  visibility?: string
  genericParameters?: string
  genericParameterNames?: string[]
  negative?: boolean
  useLeaves?: Array<{ path: string; alias?: string; glob: boolean; line: number; sourceIndex: number }>
  unsupportedUse?: boolean
  /** Parser-owned lexical key and offset for exact module-parent joins (B09). */
  moduleKey?: string
  sourceIndex?: number
  kind: 'declaration' | 'module' | 'use' | 'impl' | 'macro' | 'attribute' | 'ffi' | 'diagnostic'
  syntaxKind: string
  line: number
  endLine?: number
  name?: string
  ownerKey?: string
  nodeId?: string
  text?: string
  attributes?: string[]
  inline?: boolean
  implementation?: 'inherent' | 'trait'
  typePath?: string
  traitPath?: string
  forms?: Array<'named' | 'grouped' | 'glob' | 'aliased'>
  status: 'syntax-only' | 'parser-error'
}

/** Bounded documentation syntax, never a type-checker result. */
export interface JSDocMetadata {
  tagName: string
  parameterName?: string
  typeExpression?: string
  textSummary?: string
  startLine: number
  endLine?: number
  status: 'syntax-only' | 'partial' | 'unsupported'
}

export interface CommonJsExportFact {
  exportedName: string | null
  bindingName?: string
  assignmentKind: 'exports-member' | 'module-exports-member' | 'module-exports'
  startLine: number
  endLine?: number
  resolutionStatus: 'observed' | 'resolved-local' | 'ambiguous' | 'unresolved'
  reason?: string
}

/** Bounded syntax evidence from the isolated Python AST adapter. */
export interface PythonOrmFact {
  name: string
  line: number
  nodeId?: string
  family: 'django' | 'sqlalchemy'
  declarativeBase?: boolean
  baseReference?: string
  ownership?: 'verified' | 'unresolved'
  ownerKey?: string
  table?: string
  fields: Array<{
    name: string
    line: number
    type: string
    options: Record<string, string | number | boolean | null>
    target?: string
    targetKind?: 'name' | 'string' | 'foreign-key' | 'dynamic'
    relationship?: 'many-to-one' | 'one-to-one' | 'many-to-many' | 'field-reference'
    unresolved?: boolean
  }>
}

export interface FrameworkRouteFact {
  framework?: 'fastapi' | 'express' | 'nestjs'
  kind: 'router' | 'route' | 'mount' | 'import' | 'controller' | 'export'
  ownerKey?: string
  endLine?: number
  controllerId?: string
  handlerStatus?: 'resolved' | 'unresolved'
  syntax?: string[]
  provenance?: string
  warnings?: string[]
  name: string
  line: number
  column: number
  status: 'static' | 'unresolved'
  prefix?: string
  path?: string
  method?: string
  handlerName?: string
  handlerLine?: number
  handlerId?: string
  target?: string
  module?: string
  importedName?: string
  qualifier?: string
  relativeLevel?: number
}

/**
 * The main symbol-index artifact.
 * Written to `log/symbol-index.json`.
 */
export interface SymbolIndex {
  /** Schema version. Must equal SCHEMA_VERSION for compatibility. */
  schemaVersion: string
  /** ISO 8601 timestamp of when the index was built. */
  buildTime: string
  /** Absolute path of the repo root (informational; not for runtime path joining). */
  repoRoot: string
  /** Source root directories that were scanned, relative to repoRoot. */
  sourceRoots: string[]
  /** Total number of files indexed. */
  fileCount: number
  /** Total number of symbol definitions across all files. */
  symbolCount: number
  /** Per-file summaries. */
  files: FileSummary[]
  /**
   * Richer file-dependency graph data.
   *
   * Present when the builder populates graph construction (the default).
   * Absent only on older artifacts or when graph construction is skipped.
   *
   * See SymbolIndexGraph for the relationship between this section,
   * the per-file `files[]` summaries, and the separate `callGraphArtifact`.
   */
  graph?: SymbolIndexGraph
  /**
   * Relative path (from repo root) to the call-graph artifact, if built.
   * Absent when call-graph was not requested.
   */
  callGraphArtifact?: string
}

// ---------------------------------------------------------------------------
// File-dependency graph types  (graph section of the main artifact)
// ---------------------------------------------------------------------------

/** How a file-to-file dependency is expressed in the source. */
export type FileDependencyEdgeKind = 'import' | 're-export' | 'export-all'

/**
 * A single directed internal file dependency edge.
 *
 * Both `from` and `to` are relative to the repo root (forward slashes).
 * Only edges between files inside the scanned source roots are recorded;
 * external package imports are excluded.
 */
export interface FileDependencyEdge {
  /** The importing/depending file. */
  from: string
  /** The imported/depended-on file. */
  to: string
  /** How this dependency is expressed in source. */
  kind: FileDependencyEdgeKind
}

/**
 * A compact graph-level symbol record.
 *
 * Lighter than SymbolDefinition (no `signature`) — intended for graph
 * traversal, cross-file lookup, and visualization labels.
 */
export interface GraphSymbolRecord {
  declarationMetadata?: SymbolDefinition['declarationMetadata']
  nodeId?: string
  qualifiedName?: string
  ownerKey?: string
  /** Source file, relative to repo root (forward slashes). */
  file: string
  /** Declared name of the symbol. */
  name: string
  /** Symbol kind. */
  kind: SymbolKind
  /** Whether the symbol is exported from its module. */
  exported: boolean
  /** 1-based line number of the declaration. */
  line: number
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  androidComponentRoles?: AndroidComponentRoleRef[]
  androidComponentRefs?: SemanticArtifactRef[]
}

/**
 * The graph section embedded in the main symbol-index artifact.
 *
 * Provides compact, graph-oriented data derived from the per-file summaries:
 * - resolved internal file dependency edges (suitable for graph traversal and
 *   later file-dependency visualization)
 * - a flat cross-file symbol lookup table (compact, no signatures)
 *
 * Relationship to other artifact parts:
 * - `files[]`            — verbose per-file summaries with raw import specifiers
 *                          and full symbol signatures (retrieval use)
 * - `graph`              — resolved internal edges + compact cross-file symbol
 *                          records (graph traversal / narrowing / visualization)
 * - `callGraphArtifact`  — pointer to the separate, heavier call-graph artifact
 *                          which carries caller→callee symbol-level edges
 */
export interface SymbolIndexGraph {
  /**
   * All resolved internal file-to-file dependency edges.
   * Sorted by `from` then `to` for deterministic output.
   * External/package imports are excluded.
   */
  fileDeps: FileDependencyEdge[]
  /**
   * Flat cross-file list of compact symbol records.
   * Sorted by `file` then `name` for deterministic lookup.
   * Use `FileSummary.symbols` when you also need `signature` text.
   */
  symbols: GraphSymbolRecord[]
}

// ---------------------------------------------------------------------------
// Call-graph types
// ---------------------------------------------------------------------------

/**
 * A single directed call edge: one symbol calling another.
 * `callee.file` is null when the callee cannot be resolved to a known source
 * file (e.g. external library calls).
 */
export interface CallGraphEdge {
  callerNodeId?: string
  calleeNodeId?: string
  caller: {
    file: string
    name: string
    line: number
  }
  callee: {
    /** null for external / unresolved callees */
    file: string | null
    name: string
  }
  /** Source line of the call expression. */
  callLine: number
}

/** Observed static import syntax; resolution never implies runtime import behavior. */
export interface ImportBinding {
  localName: string
  importedName: string
  sourceSpecifier: string
  syntaxKind: 'python' | 'esm' | 'commonjs' | 'rust-use'
  relativeLevel?: number
  wildcard?: boolean
  startLine: number
  endLine: number
  resolutionStatus?: 'observed' | 'resolved-local' | 'ambiguous' | 'unresolved' | 'external'
}

/** Bounded parser evidence, without evaluating decorator expressions. */
export interface DecoratorMetadata {
  path?: string
  expressionKind: 'name' | 'attribute' | 'call' | 'unsupported'
  startLine: number
  endLine?: number
  argumentShape: 'none' | 'literal' | 'mixed' | 'dynamic'
  literalArguments?: Array<{ positionalIndex?: number; keywordName?: string; value: string | number | boolean | null }>
}

/**
 * The call-graph artifact.
 * Written to `log/symbol-index.call-graph.json`.
 * Optional: the main symbol index remains usable without it.
 */
export interface CallGraph {
  /** Schema version. Must equal SCHEMA_VERSION for compatibility. */
  schemaVersion: string
  /** ISO 8601 timestamp. */
  buildTime: string
  /** Total number of edges. */
  edgeCount: number
  /** All call edges found in the scanned source roots. */
  edges: CallGraphEdge[]
}
