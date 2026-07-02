# Changelog

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
