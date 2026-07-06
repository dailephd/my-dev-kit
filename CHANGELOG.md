# Changelog

## 1.8.0 - 2026-07-06

Final v1.8.0 release line: safer large-repo indexing ergonomics, incremental indexing with partial rebuild for the core artifact pipeline, and deterministic read-only graph comparison. Deferred from the implemented v1.8.0 release work: watch mode, retrieval filtering, a dedicated `call-graph.json` diff section, and non-fallback partial call-graph rebuild.

- `index` and `index --dry-run` now skip `.my-dev-kit` and any `.my-dev-kit-*` directory by default, so indexing no longer re-scans its own or another `my-dev-kit` output directory
- Added a deterministic large-repo preflight step: both `index` and `index --dry-run` report a `preflightWarnings` array (`{ code, message }`) in JSON output and a `Preflight warnings:` section in human output, in a fixed order
  - `large-file-count`: eligible file count exceeds a static threshold of 5000
  - `broad-source-root`: a `--src` value resolves to the project root and discovered file count exceeds 1000
  - warnings are advisory only: they never fail the command and never claim safety beyond static file-count evidence
- Added an "Indexing large monorepos" section to `docs/COMMANDS.md` covering per-package `--src`/`--out` scoping and using `--dry-run` before indexing an unfamiliar large repository
- No changes to `manifest.json` schema, artifact file names, or existing `--dry-run`/`--progress`/default-ignore behavior for small projects

**v1.8.0 Batch 2** adds the incremental-indexing foundation: cache metadata and changed-file detection. **`--incremental` does not perform a partial artifact rebuild yet** — any detected change, or any incompatible/missing/stale cache, still triggers a full rebuild through the existing pipeline; only a genuine no-op run skips rebuilding.

- Added `index --incremental`: compares the current file set against an internal `cache-metadata.json` (SHA-256 content hash per file, plus a config fingerprint over source roots/`--exclude`/`--call-graph`/`--language`/default-ignore rules) and reports a deterministic `cache` object (`{ requested, mode, cacheMetadataPath, invalidationReason, changedFileSummary }`) in JSON output and a `Cache mode:`/`Changed files:` section in human output
  - modes: `incremental-full-initial`, `incremental-full-cache-incompatible`, `incremental-full-config-changed`, `incremental-no-change`, `incremental-change-detected-full-rebuild`
  - `changedFileSummary` reports added/changed/removed/unchanged counts plus bounded (20-entry), alphabetically sorted samples
- Added `index --reset-cache`: deletes only `cache-metadata.json` from `--out` (never `manifest.json` or other artifacts), reports `{ requested, existed, path }` in both JSON and human output, and succeeds when no cache exists; combined with `--incremental`, resets first and then performs a safe `incremental-full-initial` run
- `manifest.json` now records `indexMode` (`"full"`/`"incremental"`) on every build, and `cacheMode`/`cacheInvalidationReason`/`changedFileSummary` on builds that actually ran
- `cache-metadata.json` is internal indexer bookkeeping only — not registered in `manifest.json`'s `artifacts` map and not part of the documented public artifact set
- Preserved all Batch 1 behavior: `preflightWarnings`, `--dry-run` (writes no artifacts, never touches the cache), `--progress` (stdout stays parseable JSON), and `.my-dev-kit`/`.my-dev-kit-*` self-ignore (cache metadata is never indexed as source)
- Does not implement: partial artifact rebuild, deterministic artifact merge across changed/unchanged analyses, stable artifact IDs across partial rebuilds, graph-diff, or watch mode

**v1.8.0 Batch 3** adds real partial-rebuild correctness for the core artifact pipeline (`symbol-index.json`/`code-graph.json`), on top of Batch 2's cache metadata and changed-file detection.

- `index --incremental` now reuses unchanged files' per-file analysis instead of re-parsing them, re-analyzes changed/added files exactly like a full build, and removes deleted files from every affected artifact
  - two new modes: `incremental-partial` (partial rebuild used, no artifact fallback needed) and `incremental-partial-with-artifact-fallback` (partial rebuild used, but at least one artifact family — currently only ever `call-graph` — was fully regenerated instead of reused; reported in `partialRebuildFallbackArtifacts`)
  - `incremental-change-detected-full-rebuild` is now reserved for the honest fallback case where partial-rebuild reuse is not safely possible (missing/unreadable/schema-incompatible previous `symbol-index.json`) — not the default path for a healthy cache anymore
- `graph.fileDeps`/`graph.symbols` are still recomputed globally from the full merged file set on every partial rebuild (import/re-export/export-all resolution depends on the complete current file set); file and symbol node IDs stay stable for unchanged files since they are derived purely from path/name
- `--call-graph` is always fully regenerated during a partial rebuild (its extraction re-parses source text directly) — never silently treated as reused
- `data-model.json`/`frontend-semantic.json`/`frontend-reachability.json`/`classification.json` needed no changes: they already run over the complete current index on every build and are automatically kept correct by a correctly merged core index
- `cache-metadata.json` per-file entries now also carry `reExportSpecifiers`/`exportAllSpecifiers` (needed to safely reuse an unchanged file's analysis); `CACHE_SCHEMA_VERSION` was bumped so a pre-Batch-3 cache is rebuilt once rather than misread
- `manifest.json` gained `partialRebuildFallbackArtifacts`
- Added equivalence tests (`tests/index/partialRebuild.spec.ts`) proving partial incremental output is logically equivalent to a clean full `index` run across changed/added/removed-file and re-export/export-all cross-file-dependency fixtures, plus stable-ID and call-graph-fallback coverage
- Preserved all Batch 1 and Batch 2 behavior: preflight warnings, `--dry-run`, `--progress`, `.my-dev-kit`/`.my-dev-kit-*` self-ignore, `--reset-cache`, and `incremental-no-change`/`incremental-full-*` modes
- Does not implement: partial (non-fallback) call-graph rebuild, graph-diff, or watch mode

**v1.8.0 Batch 4** adds the `graph-diff` command: a deterministic, read-only comparison of two existing index directories, built on Batch 3's stable node/edge IDs.

- Added `graph-diff --before <index-dir> --after <index-dir> --json`: compares `manifest.json`/`code-graph.json` (required) and `symbol-index.json`/`classification.json`/`data-model.json`/`frontend-semantic.json`/`frontend-reachability.json` (optional, degrading to a warning + "unavailable" section when absent from either side)
- Node/edge diffing reuses the existing stable `node.id`/`edge.id` identity — no new comparison scheme. Reports `added`/`removed` (compact refs, sorted) and `changed` (only the differing fields, with compact `before`/`after` limited to those fields)
- `symbol-index.json`: compact added/removed/changed file-path and symbol-id companion diff
- `manifest.json`: fixed-field diff (`indexMode`, `cacheMode`, `changedFileSummary`, `partialRebuildFallbackArtifacts`, analyzer status changes, etc. — excludes `createdAt`)
- `classification.json`: per-entry diff by its own stable id (added/removed/changed edit guidance, risk labels, classifications, readiness, uncertainty)
- `data-model.json`/`frontend-semantic.json`/`frontend-reachability.json`: safe summary-count-only diff (not a fragile deep per-entry diff — these artifacts have no single stable per-entry identity)
- Never runs `index`; never writes to or modifies either `--before`/`--after` directory
- Exit `0` for any valid comparison (with or without differences); non-zero with a clear error for invalid arguments, a missing index directory, or a malformed required artifact; a missing *optional* artifact never causes a non-zero exit
- Added `tests/graph-diff/graphDiff.spec.ts` (17 tests): no-difference, added/removed/changed node and edge fixtures, optional-artifact presence handling, error paths, determinism, and read-only-input-directory verification
- Does not implement: watch mode, search/lookup/slice/source filtering, or a dedicated `call-graph.json` diff section

**v1.8.0 Batch 5** performs the final integration and compatibility gate for the shipped v1.8.0 work.

- Reconciled `README.md`, `docs/GRAPH_SCHEMA.md`, `docs/PROJECT_OVERVIEW.md`, `docs/ROADMAP.md`, and help/test coverage so the documented v1.8.0 behavior matches the implemented Batch 1 through 4 surfaces
- Re-verified package contents with `npm pack --dry-run`; generated `.my-dev-kit*` folders, workflow reports, and other private/generated artifacts remain excluded from the published package
- No new CLI commands, flags, persisted artifact schemas, Android support, release audit, security validation, or publishing behavior

## 1.6.1 - 2026-07-04

Repository-hygiene patch release: no source, CLI, or artifact-contract changes.

- Reorganized and consolidated `.gitignore` (sectioned comments, consolidated `.my-dev-kit*` ignore patterns, generalized `*.txt` ignore rule, removed stale entries)
- No changes to `package.json` `files` allowlist, published package contents, or CLI behavior

## 1.6.0 - 2026-07-04

Added deterministic context-capsule generation and retrieval audit artifacts for downstream planning workflows.

- Added the `context` CLI command for bounded, local, deterministic query-to-context retrieval against an existing index
- Added `context-capsule.json` output with deterministic query planning, candidate ranking, single-seed focus selection, bounded graph evidence, bounded source evidence, semantic/classification/artifact-reference summaries, retention/pruning, required/optional/dropped context, context adequacy, conservative static conflict detection, mode effects, and source-control metadata
- Added optional `retrieval-audit-record.json` output with an ordered 32-step audit trail, fallbacks, warnings, and full-file recommendation reporting
- Added deterministic mode-specific ranking adjustments for `feature-add` and `subsystem`; `general` remains the balanced baseline
- Added conservative static conflict detection for incompatible edit-guidance cases backed by existing static evidence
- Added `--no-source` to disable source slices and source bundles while retaining graph and metadata evidence
- Added compatibility coverage for older indexes without `classification.json` and indexes missing optional semantic artifacts
- Added deterministic output, no-raw-dump, audit-completeness, conflict, mode, and source-control tests for the context pipeline
- Added public command and example documentation for context capsules, retrieval audits, bounded source defaults, and `--no-source`

## 1.5.0 - 2026-07-02

Added conservative static schema/layer classification of files and symbols, surfaced through the existing `search`, `lookup`, `slice`, and `source` commands.

- Added `classification.json`, a static classification artifact (schemaVersion `1.0.0`) recording category assignment(s), edit guidance, readiness, additive risk labels, evidence, and an uncertainty tier per file/symbol
- Added the `classification` analyzer, registered in `manifest.json`'s `analyzers` array; runs after the data-model, frontend, and frontend-reachability analyzers so their output is available as evidence
- Classification categories: `canonical-type`, `artifact-type`, `database-model`, `projection-type`, `view-model`, `ui-only-state`, `test-fixture`, `persistence-adapter`, `route-handler`, `client-component`, `server-component`, `generated-file`, `configuration-file`, `command-handler`, `analyzer`, `validator`, `public-docs`, `internal-planning-docs`
- Added edit-guidance values (`safe-primary-edit-target`, `inspect-before-edit`, `avoid-primary-edit-target`, `read-only-reference`, `generated-do-not-edit`, `test-only`, `docs-only`, `uncertain`), readiness states (`ready`, `needs-more-context`, `risky-assumption`), additive risk labels, and uncertainty tiers (`certain`, `likely`, `possible`, `unknown`)
- Added `classificationRoles` and `classificationRefs` compact fields on `CodeGraphNode`/`GraphSymbolRecord`/`SymbolDefinition` — new fields, separate from `semanticRoles`/`artifactRefs`
- `search`: classification role and edit-guidance are now searchable fields; results include compact `classificationRoles`/`classificationRefs`
- `lookup`: focus node includes `classificationRoles`/`classificationRefs`; added `--resolve-classification` to resolve the full `classification.json` entry on request
- `slice`: preserves `classificationRoles`/`classificationRefs` on every node
- `source`: propagates `classificationRoles`/`classificationRefs` for `--node`/`--symbol` targets, plus a compact `classificationSummary` (risk labels, edit guidance, warnings)
- Classification is static and conservative only: no runtime execution, no browser, no database connection, no LLM or network calls; low-confidence classifications are marked `possible`/`unknown` with an explanatory warning rather than rounded up
- An index without `classification.json` (an older index, or an analyzer that has not run) is fully compatible — existing command output is unaffected

## 1.4.0 - 2026-06-25

Added source continuation and bounded local dependency expansion.

- Added `source --file <path> --continue-from <n>` — reads from an explicit line number with a `ContinuationCursor` in JSON output pointing to the next window
- Added `source --file <path> --symbol <name> --continue` — continues from the end of the symbol's initial 20-line preview window
- Added `source --node <id> --continue` — continues from the end of the node's initial preview window
- Added `source --file <path> --symbol <name> --continue-from <n>` — reads from explicit line with optional symbol metadata attached
- Added `ContinuationCursor` to every `SourceSlice` JSON response: `nextStartLine`, `previousEndLine`, `eof`/`exhausted`, `reason`, `symbolBoundaryKnown`
- Added `[CONTINUE: <file> from line N]` and `[EOF: <file> (N lines total)]` footers to numbered output
- Added `source --include-local-types` — includes same-file interface/type/enum definitions referenced in the primary window
- Added `source --include-props` — includes same-file prop type definitions (uses `frontend-semantic.json` when available for exact end lines)
- Added `source --include-local-components` — includes same-file local React child components rendered by the primary symbol
- Added `source --include-local-deps` — composite flag: includes same-file prop types, local types, constants above the primary symbol, and directly called helper functions
- Added `source --expand-to-local-dependencies` — alias for `--include-local-deps`
- Added `source --include-imports` — includes local import-site lines; external packages and dynamic imports go to `skippedBlocks` with reason codes
- Added `source --max-bundle-lines <n>` — caps total bundle line count (default 300); exceeded candidates become `skippedBlocks`
- Added `source --max-blocks <n>` — caps total block count (default 20); exceeded candidates become `skippedBlocks`
- Added `SourceBundle` output type with `primaryBlock`, `expansionBlocks`, `skippedBlocks`, `limits`, `stats`, `continuationCursors`, `warnings`
- Each `SourceExpansionBlock` has `expansionReasons`, `confidence`, `dedupeKey`, `targetRelationship`, `fallbackReason` (when end line estimated from heuristic)
- Overlapping same-file blocks are merged deterministically; both expansion reasons are preserved
- Numbered bundle output: block headers `=== [<kind>] <file>:<start>-<end> (<N> lines) — <reasons> ===`, skipped section, warnings section, continuation footer
- Expansion is static-analysis only: direct, same-file dependencies; no cross-file closure, no runtime tracing, no browser execution
- Notes: symbol end lines are still not stored in the symbol index; `--include-*` and `--continue` flags use the frontend-semantic artifact or a next-symbol heuristic to estimate end lines when available; confidence is reported per block

## 1.3.0 - 2026-06-25

Added route-aware, browser-storage-aware, and UI-reachability retrieval backed by a new static frontend reachability artifact.

- Added `frontend-reachability.json`, a static semantic artifact that records route, browser-storage, UI-marker, and reachability evidence
- Added route-aware retrieval for static route, page, navigation, and test evidence through `search`, `lookup`, `slice`, and `source`
- Added browser-storage tracing for supported `sessionStorage` and `localStorage` read, write, remove, and clear patterns
- Added static UI reachability evidence connecting routes, components, UI markers, storage keys, gates, and tests where detectable
- Added `--route`, `--storage-key`, and `--ui` selectors to `search`, `lookup`, `slice`, and `source`
- Added `view --graph route`, `view --graph browser-storage`, and `view --graph ui-reachability`
- Updated React/TSX examples and command documentation to demonstrate v1.3.0 route, storage, and UI reachability workflows
- Notes: v1.3.0 is conservative static analysis only; it does not execute applications, run browsers, prove runtime UI visibility, or prove user reachability

## 1.2.0 - 2026-06-18

Added React/TSX and frontend-test indexing, exact source string retrieval and repeated literal reporting, React region retrieval, local component-tree prop/event-flow retrieval, and four new frontend semantic graph views.

- Added frontend analyzer running as part of `index`: produces `frontend-semantic.json` for `.tsx` and `.jsx` files
- Added `frontend-semantic.json` containing exported and local React components, prop types, hooks, handlers, JSX regions, test blocks, locators, and UI strings
- Added `source --contains` for exact string retrieval across all indexed files with context lines, match classification, and repeated literal reporting
- Added `source --path` for path-prefix filtering of `--contains` results
- Added `source --react-region` for retrieving a named React region (component, hook, handler, JSX region, prop type) by name from the frontend semantic artifact
- Added `source --include-local-component-tree` for retrieving a component and its local child components as a connected source bundle with prop, callback, state, handler, and branch blocks
- Added `source --prop` for filtering local-component-tree output to a specific prop name
- Added `view --graph react-component` for rendering exported and local components with structural relationships
- Added `view --graph react-flow` for rendering all frontend flow facts: hooks, handlers, JSX regions, and flow relationships
- Added `view --graph react-prop-event-flow` for rendering only prop and event flow relationships
- Added `view --graph frontend-test` for rendering test structure from frontend test facts in `frontend-semantic.json`
- Added `search` enrichment from frontend semantic values: `data-testid` and `aria-label` values are indexed and ranked alongside symbol matches
- Added `basic-react-tsx` bundled example with `WorkspaceEditorShell` TSX component and pre-built `.my-dev-kit-index` artifacts
- Known limitation: the base indexer excludes `.test.` and `.spec.` files from default file discovery; `view --graph frontend-test` produces output only when test files reach the frontend analyzer through a custom indexing path

## 1.1.0 - 2026-05-01

Added index-first semantic integration, manifest as authoritative artifact registry, semantic role metadata on index artifacts, data-model artifacts linked from the index, and semantic-aware search, lookup, slice, and source commands.

- Added managed artifact refresh: `index` removes stale artifacts from previous runs when refreshing the artifact directory
- Added `manifest.json` as the authoritative artifact registry for the current run, including `semanticArtifacts` paths and an `analyzers` array with status per analyzer
- Added `semanticRoles` and `artifactRefs` arrays on symbols in `symbol-index.json` and on symbol nodes in `code-graph.json`, populated by the TypeScript model analyzer
- Added the TypeScript model analyzer running as part of `index`: produces `data-entity` and `data-field` roles for qualifying exported interfaces, type aliases, and classes
- Added `data-model.json` and `data-model-graph.json` written by `index` when the TypeScript model analyzer produces output
- Added semantic schema `1.0.0` with defined role names, confidence levels, source identifiers, artifact refs, and evidence refs
- Added semantic-aware search: `search` indexes `semanticRole`, `semanticSubtype`, `semanticSource`, and `semanticArtifactRef` fields; result items include `semanticRoles` and `artifactRefs` when present
- Added semantic metadata to `lookup` output: `semanticRoles`, `artifactRefs`, and `evidenceRefs` returned from the focus node when present
- Added semantic metadata preservation in `slice` output: nodes carry `semanticRoles` and `artifactRefs` from `code-graph.json`
- Added semantic metadata propagation in `source` output: `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the symbol target included in JSON output
- Added the `data-model` command for focused inspection and regeneration of data-model artifacts, exact entity lookup, exact field lookup, and conservative static `trace-view`
- Added `model-view-lineage.json` for conservative static lineage evidence in `trace-view` mode
- Added `view --graph <code|data-model|model-view-lineage>` for rendering code, data-model, and model-to-view lineage graph artifacts through the existing DOT/SVG/PNG Graphviz pipeline
- Added conservative TypeScript model extraction for exported interfaces, exported object-literal type aliases, and exported classes with property declarations
- Added exact entity lookup by name or stable ID and exact field lookup by `Entity.field`
- Added warnings for unsupported or ambiguous extraction and lineage patterns instead of guessed relationships
- Added end-to-end and subsystem coverage for semantic metadata contracts, managed artifacts, manifest authority, and semantic-aware command behavior

## 1.0.0 - 2026-05-29

Initial release.

- Six CLI commands: `index`, `lookup`, `source`, `slice`, `view`, `search`
- TypeScript, JavaScript, and Python indexing with symbol extraction, code graph, and optional static call graph
- Python indexing covers functions, classes, constants, imports, and conservative syntactic call edges
- Graph-guided symbol retrieval workflow: `search` -> `lookup` -> `slice` -> `source`
- Source output formats: `json`, `plain`, `numbered`; file output with `--out`
- Semantic graph visualization with three edge styles: `semantic` (default), `labeled`, `minimal`; DOT, SVG, and PNG output
- Deterministic local keyword search over indexed artifacts with field-weighted ranking
- Security hardening: artifact path containment, source retrieval path containment, DOT escaping, Graphviz subprocess isolation
- CI validation baseline via GitHub Actions
- MIT license, copyright 2026 dailephd LLC
