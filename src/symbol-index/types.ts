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

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Schema version string for artifact forward-compatibility checks. */
export const SCHEMA_VERSION = '2'

/** Artifact filenames (relative to the output directory). */
export const ARTIFACT_MAIN = 'symbol-index.json'
export const ARTIFACT_CALL_GRAPH = 'symbol-index.call-graph.json'

/** Supported source language labels. */
export type SourceLanguage = 'typescript' | 'javascript' | 'python'

/** Classification of a symbol declaration. */
export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'variable'

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
}

/**
 * A single symbol (function, class, interface, type alias, enum, or variable)
 * defined at a specific location in a source file.
 */
export interface SymbolDefinition {
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
