# Roadmap

## Overview

`my-dev-kit` is a CLI-first development context kit for indexing codebases, building graph artifacts, searching project structure, slicing relevant neighborhoods, and retrieving bounded source context for LLM-assisted development.

The product goal is simple: help developers understand large projects without reading whole files, broad folders, or unfiltered documentation — and support downstream tools and LLM-assisted workflows with deterministic, bounded local artifacts.

The current stable v1 line focuses on deterministic local artifacts and graph-guided retrieval:

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`
- optional `call-graph.json`
- `data-model.json`
- `data-model-graph.json`
- `model-view-lineage.json`
- `frontend-semantic.json`
- `frontend-reachability.json`
- `classification.json`
- bounded source retrieval
- source continuation and local source bundles
- graph slices
- DOT, SVG, and PNG graph views
- deterministic keyword search over index artifacts
- compact semantic and classification metadata surfaced through retrieval commands

Future releases should preserve the core model:

```text
index -> manifest -> artifacts -> search -> lookup -> slice -> source -> view
```

New languages, frameworks, and platforms should be added through adapters and artifact producers rather than by replacing the retrieval model.

## Product principles

`my-dev-kit` should remain:

- local-first
- deterministic
- inspectable
- read-only with respect to indexed projects
- conservative in static-analysis claims
- useful to humans and coding agents
- compatible with staged workflows in `my-dev-kit-orchestrator`

`my-dev-kit` should not:

- call an LLM
- make network requests during indexing or retrieval
- edit source files
- execute the target application
- connect to databases
- claim runtime behavior when it only has static evidence
- become a second orchestrator runtime

## Version 1.0.0

Version 1.0.0 is the first stable CLI release of `my-dev-kit`.

### Command surface

Version 1.0.0 includes six primary commands:

- `index`
- `lookup`
- `source`
- `slice`
- `view`
- `search`

### Implemented capabilities

#### Indexing

- TypeScript indexing
- JavaScript indexing
- Python indexing
- symbol extraction for functions, classes, constants, imports, exports, and source locations
- file-level graph nodes
- symbol-level graph nodes
- typed graph edges
- static call graph generation through `--call-graph`
- conservative TypeScript, JavaScript, and Python call extraction
- `symbol-index.json` output
- `code-graph.json` output

#### Lookup

- exact node lookup
- configurable graph depth
- file and symbol lookup support
- structured output for downstream tooling

#### Source retrieval

- line-range retrieval
- symbol-name retrieval
- node-ID retrieval
- bounded source extraction
- `json`, `plain`, and `numbered` output formats
- file output through `--out <path>`

#### Graph slicing

- bounded graph-neighborhood extraction
- focus-node slicing
- graph context suitable for prompt preparation
- typed node and edge output

#### Graph viewing

- Graphviz DOT output
- SVG output through Graphviz
- PNG output through Graphviz
- semantic edge styling
- labeled edge styling
- minimal edge styling
- graph legend support for semantic views

#### Search

- deterministic keyword search over index artifacts
- field-weighted ranking
- search over files, symbols, paths, and graph metadata
- retrieval-oriented candidate discovery

## Version 1.0.x

Version 1.0.x releases focus on release hardening, documentation quality, and safer retrieval workflows without changing the core artifact model.

### Large-repository safety

- default ignore rules for common generated folders (implemented)
- `--exclude` support where missing (implemented)
- `--dry-run` support for expensive commands (implemented)
- progress reporting during indexing (implemented)
- clearer output when a repository is large: safe-maximum preflight warnings and documentation for indexing large monorepos landed as part of [Version 1.8.0 Batch 1](#version-180)
- safer behavior when a command would scan too many files: see the `large-file-count`/`broad-source-root` preflight warnings in [Version 1.8.0 Batch 1](#version-180); `my-dev-kit` still does not hard-fail large scans

### Retrieval workflow reporting

Planned and incremental improvements:

- report search queries used
- report selected candidate nodes
- report lookup targets
- report slice focus nodes
- report source nodes retrieved
- report source line ranges retrieved
- report fallback reason when line-range retrieval is used
- report fallback reason when a full-file read is recommended by an external coding agent

The graph-guided workflow should be easy to audit:

1. search candidate nodes
2. lookup the strongest nodes
3. slice around the strongest node or nodes
4. retrieve source by exact node or symbol
5. use line ranges only when symbol retrieval is not enough
6. use full-file reads only as a justified fallback

### Documentation and examples

Planned and incremental improvements:

- clearer `README.md`
- clearer `QUICKSTART.md`
- clearer `COMMANDS.md`
- clearer graph-guided retrieval examples
- better examples for existing projects
- better examples for multi-root projects
- clearer explanation of generated artifacts
- clearer explanation of when to use each command
- removal of confusing or unused example scripts

## Version 1.1.0

Version 1.1.0 adds the first semantic integration layer on top of the existing code graph workflow.

### Implemented

#### Index-first semantic architecture

- `index` runs semantic analyzers as part of the index run
- `manifest.json` is the authoritative artifact registry; it records all current artifact paths and analyzer status
- stale artifacts from previous runs are removed when `index` refreshes the artifact directory
- analyzer registry in `manifest.json` records status, version, and artifact refs per analyzer

#### Semantic metadata contracts

- `semanticRoles` and `artifactRefs` arrays on symbols in `symbol-index.json`
- `semanticRoles` and `artifactRefs` arrays on symbol nodes in `code-graph.json`
- `evidenceRefs` collected from semantic roles for use in lookup output
- semantic schema version `1.0.0` with defined role names

#### Data-model artifacts linked from index

- `data-model.json` and `data-model-graph.json` written by `index` when the TypeScript model analyzer produces output
- artifact paths recorded in `manifest.json`
- compact `data-entity` and `data-field` roles embedded on qualifying symbols in index artifacts

#### Data-model extraction and inspection

- conservative TypeScript model extraction for exported interfaces, type aliases, and classes
- exact entity lookup by name or stable ID
- exact field lookup by `Entity.field`
- `data-model.json` and `data-model-graph.json` as separate artifacts
- `data-model` command for focused inspection and regeneration

#### Conservative model-to-view lineage

- `model-view-lineage.json` produced in `data-model --trace-view` mode
- conservative static lineage for supported transformation, view-model, component prop, and JSX rendering patterns
- `trace-view` mode for entity and field-level lineage

#### Semantic-aware commands

- `search` indexes semantic fields and returns semantic metadata on matched items
- `lookup` returns `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the focus node
- `slice` preserves semantic metadata on nodes in the slice output
- `source` propagates semantic metadata from the symbol target

## Version 1.2.0

Version 1.2.0 adds React/TSX and frontend-test indexing, exact source string retrieval and repeated literal reporting, React region retrieval, local component-tree prop/event-flow retrieval, and frontend semantic graph views.

### Implemented

#### TSX and React indexing

- exported component indexing
- local component indexing
- prop type indexing
- hook block indexing
- event-handler indexing
- JSX region indexing
- `frontend-semantic.json` written and registered in `manifest.json`

#### Frontend-test indexing

- `describe`, `test`, and `it` block indexing with titles
- setup and teardown indexing
- locator indexing
- route-like string indexing
- test helper indexing

#### Exact string and repeated literal retrieval

- `source --contains <string>` exact string search across indexed source files
- `source --context <n>` context lines around each match
- `source --path <prefix>` path prefix filter for `--contains`
- match classification based on static heuristics
- frontend value context enrichment when the string is frontend-indexed

#### React region retrieval

- `source --react-region <region> --file <path>` retrieves a named React component, hook, handler, JSX region, or prop type
- case-insensitive region name matching with priority ordering
- JSON output includes `reactRegion` metadata

#### Local component-tree prop/event-flow retrieval

- statically extracted React prop and event flow relationships
- `source --symbol <component> --file <path> --include-local-component-tree`
- `source --prop <name>` filter for component-tree retrieval

#### Frontend graph views

- `view --graph react-component`
- `view --graph react-flow`
- `view --graph react-prop-event-flow`
- `view --graph frontend-test`

All frontend facts are static artifact-backed evidence. They do not prove runtime rendering, route reachability, or browser-state behavior.

## Version 1.3.0

Version 1.3.0 adds route-aware, browser-storage-aware, and UI-reachability retrieval.

The goal is to help developers answer: what route, component, UI marker, storage key, state gate, and test evidence are involved in a piece of UI?

All v1.3.0 facts are conservative static evidence. The tool records what the source text contains. It does not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

### Implemented

#### Frontend reachability artifact

- `frontend-reachability.json` written by `index` and registered in `manifest.json` when the frontend analyzer runs
- analyzer status recorded in `manifest.json`
- deterministic artifact structure and ordering

#### Route fact extraction

- static route strings from React Router literals, Next.js `pages/` convention, and route strings mentioned in tests
- route path to owning component association
- confidence and warnings for dynamic route patterns

#### Browser storage key extraction

- `localStorage` and `sessionStorage` static string keys
- storage key to component association
- state-variable linkage in the same component scope when detectable
- confidence and warnings for computed keys

#### UI marker and reachability fact extraction

- UI markers such as `data-testid`, `aria-label`, visible text, `placeholder`, and `aria-labelledby`
- component and JSX-region context
- JSX condition gates
- route and storage linkage through static component membership
- test evidence linked by exact locator-value match

#### Cross-domain reachability edges

- `route-serves-component`
- `component-uses-storage`
- `component-renders-ui`
- `storage-gates-ui`
- `route-reaches-ui`
- `test-covers-ui`
- `ui-in-gated-region`

#### Reachability-aware commands

- `search --route <path>`, `search --storage-key <key>`, `search --ui <value>`
- `lookup --route`, `lookup --storage-key`, `lookup --ui`
- `slice --route`, `slice --storage-key`, `slice --ui` with relevant include modifiers
- `source --route`, `source --storage-key`, `source --ui`
- `view --graph route`, `view --graph browser-storage`, `view --graph ui-reachability`

### Future work for this area

- producer support for UI markers defined in local sub-components
- route-to-API-handler and access-policy relationships
- cookie storage key extraction

## Version 1.4.0

Version 1.4.0 adds source continuation and bounded local dependency expansion.

The goal is to reduce full-file reads when the correct file, symbol, or component is already known.

### Implemented

#### Source continuation

- `source --file <path> --continue-from <n>`
- `source --file <path> --symbol <name> --continue`
- `source --node <id> --continue`
- `source --file <path> --symbol <name> --continue-from <n>`
- continuation cursor metadata in JSON output
- continuation and EOF footers in numbered output
- warnings when symbol boundaries are unknown

#### Local dependency expansion

- `--include-local-types`
- `--include-props`
- `--include-local-components`
- `--include-local-deps`
- `--expand-to-local-dependencies`
- `--include-imports`
- `--max-bundle-lines <n>`
- `--max-blocks <n>`
- `SourceBundle` output with primary block, expansion blocks, skipped blocks, limits, stats, continuation cursors, and warnings
- deterministic block ordering and deduplication
- explanation for every included and skipped block

#### Static boundaries

- direct, same-file dependency resolution only
- no cross-file closure
- no runtime tracing
- no browser execution
- degraded or skipped frontend-specific expansion when frontend artifacts are unavailable

### Future work for this area

- cross-file dependency closure
- richer semantic type-checking for dependency detection
- bundle-quality benchmarks

## Version 1.5.0

Version 1.5.0 adds conservative static schema and layer classification, built on the existing artifact and command-integration model.

The goal is to help developers avoid editing the wrong layer by classifying files and symbols by their role in the project, and by surfacing conservative edit guidance, readiness, risk labels, evidence, and uncertainty through the existing retrieval commands without introducing a second retrieval system.

### Implemented

#### Classification producer and artifact

- `classification.json` detailed classification entries
- category assignments
- edit guidance
- readiness
- additive risk labels
- evidence
- uncertainty tier
- warnings
- refs back to source/artifacts
- analyzer entry in `manifest.json`
- stale-artifact refresh/removal behavior

#### File-level and symbol-level categories

- canonical type
- artifact type
- database model
- projection type
- view model
- UI-only state
- test fixture
- persistence adapter
- route handler
- client component
- server component
- generated file
- configuration file
- command handler
- analyzer
- validator
- public docs
- internal planning docs

#### Compact metadata and command integration

- `classificationRoles` and `classificationRefs` as separate optional compact fields
- `search` includes classification role and edit-guidance fields
- `lookup` includes compact metadata and supports `--resolve-classification`
- `slice` preserves compact classification metadata
- `source` propagates compact classification metadata and a compact classification summary when available

#### Static boundaries

- classification is derived only from source text, the existing graph, and existing artifacts
- no runtime execution
- no browser execution
- no database connection
- no LLM or network calls
- absence of `classification.json` never breaks existing retrieval commands
- classification guidance is advisory and evidence-backed, not an automatic edit decision

### Future work for this area

- task-specific context-report aggregation
- stronger cross-file classification signal aggregation
- additional categories only when real code evidence justifies them

## Version 1.6.0

Version 1.6.0 focuses on orchestrator-ready retrieval capsules and context packets.

The goal is not to replace `my-dev-kit-orchestrator`. The goal is to make `my-dev-kit` produce compact, task-specific retrieval outputs that the orchestrator can consume without raw graph dumps or full-file context.

### Implemented capabilities

#### Retrieval capsules

- compact context packets built from `search`, `lookup`, `slice`, `source`, semantic artifacts, source bundles, and classification metadata
- retained and dropped evidence summaries
- explicit reasons for selected files, symbols, docs, and source blocks
- source continuation and source bundle summaries included when used
- classification/edit-guidance summary included when available
- stable JSON output suitable for downstream prompts and audit reports

#### Retrieval audit records

- search queries used
- candidate nodes selected
- lookup targets used
- slice focus nodes used
- source blocks retrieved
- source continuation used or skipped
- local expansion used or skipped
- metadata inspected
- full-file read recommendations or fallback reasons

#### Context capsule modes

Implemented modes are `general`, `feature-add`, and `subsystem`. They apply
small deterministic ranking adjustments only; they do not control workflows or
replace orchestrator stages.

#### Compatibility boundary

- `my-dev-kit` produces capsules and audit records
- `my-dev-kit-orchestrator` remains the staged workflow controller
- no autonomous agent execution
- no automatic source modification

## Version 1.7.0

Version 1.7.0 implements an internal, developer-facing retrieval regression suite for `my-dev-kit` itself.

The goal is to prevent regressions in the bounded-context behavior introduced and expanded through v1.6.0 context capsules.

### Batch 1 status (implemented)

Batch 1 added the internal foundation: TypeScript contracts for suite
config/task/report/verdict shapes, a config loader with clear validation
errors, a JSON+TXT report writer, a minimal runner, and the
`npm run benchmark:retrieval` entry point. It is internal-only (no public
CLI command) and not wired into `npm run verify` or CI.

### Batch 2 status (implemented)

Batch 2 adds the execution core: a fixture/source-root resolver with
filesystem-safe task-ID and output-path handling, per-task index
preparation (reusing `runIndexCommand()` directly), and a context
execution adapter that runs the real v1.6 `context` command as a
subprocess against each task's fresh index. `core.json`'s one task is now
executable (no longer `skip: true`) and produces real
`context-capsule.json`/`retrieval-audit-record.json`/`task-execution.json`
artifacts per run. A task that executes successfully is reported
`executed` (verdict `PASS` meaning "ran without error"); a task whose
fixture/index/context step fails is reported `blocked`. There is still no
assertion engine: nothing compares the retrieved evidence against
per-task expectations yet, and the `REGRESSION` verdict remains
unreachable.

### Batch 3 status (implemented)

Batch 3 adds the judgment layer on top of Batch 2's execution core:

- a deterministic assertion engine (`src/retrievalRegression/assertions.ts`)
  that reads each task's generated `context-capsule.json` and
  `retrieval-audit-record.json` and evaluates configurable expectations
  for candidate files/nodes, focus, selected graph evidence, bounded
  source evidence, semantic/classification summaries, artifact
  references, conflicts, mode effects, audit steps (including ordering
  and uniqueness), no-raw-content, cap compliance, and context adequacy
- a metrics engine (`src/retrievalRegression/metrics.ts`) that aggregates
  task/assertion counts and per-category pass rates deterministically
  (missing denominators report `null`, never a fabricated rate)
- verdict logic (`src/retrievalRegression/verdict.ts`) that makes
  `REGRESSION` reachable: a task regresses when a required assertion
  fails, is blocked when execution or a required assertion could not be
  evaluated, and otherwise passes; the suite verdict is `BLOCKED` if any
  task is blocked, else `REGRESSION` if any task regressed, else `PASS`
- `--fail-on-regression` (only fails the process nonzero on
  `REGRESSION`/`BLOCKED` when passed; a report is always written) and
  `--max-failures` (stops running remaining tasks once the limit of
  blocked/regressed tasks is reached, recording them as `planned` with a
  clear reason) on the `runRetrievalRegression.ts` entry point
- `core.json`'s one executable task now carries real, stable expectations
  based on the actual generated Batch 2 capsule/audit shapes, and
  `npm run benchmark:retrieval` now passes `--fail-on-regression`
- JSON and TXT reports include assertion results, metrics, verdicts, and
  a compact failed-assertions-by-task summary, without inlining raw
  source, graph, capsule, audit, semantic, or classification content

### Batch 4 status (implemented)

Batch 4 completes a representative six-task core suite using the existing
data-model, React/TSX, and basic TypeScript examples. It covers
data-model feature-add, subsystem mode, no-source behavior, React/TSX
retrieval, no-false-conflict behavior, and ambiguity, with audit,
no-raw-content, caps, and adequacy expectations on every executable task.
Classification-absent behavior remains covered by assertion unit tests but
is deferred as an executable task because current indexing always emits
classification and the runner does not mutate generated artifacts.

`benchmark:retrieval` remains separate from `npm run verify`: it is a
heavier subprocess-based maintainer check, while the broader test suite
has known unrelated timeout flakiness. Historical baseline comparison is
not implemented.

### Purpose

The planned suite should answer product-specific retrieval questions such as:

- did query planning regress?
- did candidate file or candidate node ranking regress?
- did single-seed focus selection regress?
- did selected graph evidence regress?
- did bounded source evidence regress?
- did semantic, classification, or artifact-reference summaries regress?
- did conservative static conflict detection regress?
- did `general`, `feature-add`, or `subsystem` mode behavior regress?
- did `--no-source` behavior regress?
- did context adequacy, audit completeness, cap compliance, compatibility, or no-raw-content guarantees regress?

### Retrieval regression coverage

Representative deterministic local tasks cover:

- context capsule generation
- retrieval audit record generation
- query planning
- candidate file ranking
- candidate node ranking
- focus selection
- selected graph evidence
- bounded source evidence
- semantic summaries
- classification summaries
- artifact-reference summaries
- conservative static conflict detection
- mode behavior for `general`, `feature-add`, and `subsystem`
- `--no-source`
- cap compliance
- no-raw-content guarantees
- context adequacy states
- older-index and classification-absent compatibility

### Assertions

The assertion engine and representative suite are implemented. Assertions
remain deterministic and local:

- the right bounded context is retained for representative tasks
- retained and dropped reasons remain stable and explainable
- audit records remain complete and ordered
- no raw graph, source, semantic, or classification artifacts leak into normal outputs
- caps are enforced without hiding required evidence
- older-index compatibility stays intact when optional artifacts are absent
- full-file-read recommendations stay empty unless targeted retrieval is truly insufficient

### Planned metrics

The metrics engine itself is implemented as of Batch 3 (see above), computing
task/assertion counts and per-category pass rates from real assertion results.
Likely internal retrieval regression metrics include:

- selected file, node, edge, and source-slice counts
- retained-versus-dropped evidence counts
- conflict and ambiguity signal counts
- full-file recommendation counts
- compatibility warning counts
- fixture pass/fail summaries by retrieval behavior area

These are maintainer metrics for regression detection, not a public performance benchmark or hosted benchmark service.

### Entry point decision

Initial implementation should prefer a maintainer or development entry point such as `npm run benchmark:retrieval`.

A public CLI command remains undecided. If a public command is ever added later, that should be justified by the implementation rather than assumed by the roadmap now.

### Boundary with my-dev-kit-lab

`my-dev-kit` should own the retrieval regression suite because it validates whether `my-dev-kit` retrieves the right bounded context from deterministic fixtures and protects context, search, slice, source, classification, and audit behavior from regressions.

`my-dev-kit-lab` should remain responsible for release readiness, security posture, dependency and package safety, and external release gates. It should not be the home for product-specific retrieval-quality assertions.

### Non-goals

Version 1.7.0 is not planned as:

- a general benchmark framework
- a public benchmark platform
- my-dev-kit-lab functionality
- security validation
- release validation
- package-content or dependency audit automation
- CodeQL, Semgrep, or OSV workflow ownership
- performance benchmarking or load testing
- runtime app testing or browser execution
- LLM evaluation
- embedding or semantic-similarity benchmarking
- a replacement for `my-dev-kit-lab`

## Version 1.8.0

Version 1.8.0 focuses on scalability and indexing ergonomics.

The goal is to make `my-dev-kit` more practical for larger repositories before expanding into heavier multi-language and Android projects.

### Batch 1 status (implemented)

Batch 1 is the indexing ergonomics foundation: it makes the existing `index` command safer and more informative for larger repositories, without implementing incremental indexing, graph diff, or watch mode.

- Default ignores now also skip `.my-dev-kit` and any `.my-dev-kit-*` directory (custom `--out` directories and generated smoke/index output folders), so `index` does not re-scan its own or another `my-dev-kit` output directory. `--exclude` and existing default ignores are unchanged and still apply.
- Added a deterministic large-repo preflight step (`src/indexing/preflight.ts`) that reports `preflightWarnings` (`{ code, message }`) on both `index` and `index --dry-run`, in a fixed, deterministic order: `large-file-count` (eligible file count exceeds a static threshold of 5000) and `broad-source-root` (a `--src` value resolves to the project root and discovered file count exceeds 1000). Warnings are advisory only — they never fail the command and never claim safety beyond static file-count evidence.
- `index --dry-run` and file-count estimation, progress reporting (`--progress`, stderr-only diagnostics that keep `--json` stdout parseable), and improved default ignores for common generated/build/cache directories were already implemented ahead of this roadmap entry; Batch 1 extends that existing foundation with the `.my-dev-kit*` self-ignore and the preflight-warning layer above rather than replacing it.
- Added a "Indexing large monorepos" documentation section (`docs/COMMANDS.md`) covering per-package `--src`/`--out` scoping and using `--dry-run` before indexing an unfamiliar large repository.

Batch 1 does not implement incremental indexing, cache metadata, changed-file detection, partial rebuild, graph diff, watch mode, or search/lookup/slice filtering — those remain planned below for later `v1.8.0` batches.

### Batch 2 status (implemented)

Batch 2 is the incremental-indexing foundation: cache metadata, changed-file detection, and config invalidation, built on top of Batch 1's preflight/dry-run/progress/default-ignore work. **It does not implement partial artifact rebuild** — every `--incremental` run that finds a change (or an incompatible/missing/stale cache) still performs a full rebuild through the existing indexing pipeline; only a true no-op ("nothing changed") run skips rebuilding.

- Added `index --incremental`, which compares the current file set against an internal `cache-metadata.json` (SHA-256 content hash per file plus a config fingerprint) and reports one of six deterministic modes: `incremental-full-initial`, `incremental-full-cache-incompatible`, `incremental-full-config-changed`, `incremental-no-change`, or `incremental-change-detected-full-rebuild` (see `docs/COMMANDS.md`).
- Added `index --reset-cache`, which deletes only `cache-metadata.json` from `--out` (never `manifest.json` or other normal artifacts) and reports `{ requested, existed, path }`; combined with `--incremental` it resets first and then performs a safe `incremental-full-initial` run.
- Added deterministic added/changed/removed/unchanged file classification (`src/indexing/cacheMetadata.ts`), with alphabetically sorted, bounded (20-entry) samples.
- Added cache/config invalidation: a corrupt or schema/version-incompatible cache, or a changed config fingerprint (source roots, `--exclude`, `--call-graph`, `--language`, or default-ignore rules), triggers a full rebuild with a reported `cacheInvalidationReason` rather than silently reusing a stale or incompatible cache.
- `manifest.json` now records `indexMode`, and, on builds that actually ran, `cacheMode`/`cacheInvalidationReason`/`changedFileSummary` (see `docs/GRAPH_SCHEMA.md`). `cache-metadata.json` itself remains internal bookkeeping, not a public semantic artifact.
- Preserved all Batch 1 behavior: `preflightWarnings` still appear on `index`/`index --dry-run`; `--dry-run` still writes no artifacts and never touches the cache; `--progress` still keeps `--json` stdout parseable; `.my-dev-kit`/`.my-dev-kit-*` self-ignore still applies (cache metadata is never indexed as source).

Batch 2 does not implement full partial artifact rebuild, deterministic artifact merge across changed/unchanged analyses, stable artifact ID equivalence across partial rebuilds, graph-diff, watch mode, or search/lookup/slice filtering — those remain planned below for later `v1.8.0` batches.

### Batch 3 status (implemented)

Batch 3 adds real partial-rebuild correctness on top of Batch 2's cache metadata and changed-file detection.

- `index --incremental` now reuses unchanged files' per-file analysis (read back from the previous `symbol-index.json`, combined with `reExportSpecifiers`/`exportAllSpecifiers` now also carried in `cache-metadata.json`) instead of re-parsing them, re-analyzes changed/added files exactly like a full build, and drops removed files from every affected artifact — reported as two new modes, `incremental-partial` and `incremental-partial-with-artifact-fallback` (see `docs/COMMANDS.md`).
- `graph.fileDeps`/`graph.symbols` (and the code graph built from them) are still recomputed globally from the full merged file set on every partial rebuild — import/re-export/export-all resolution depends on the complete current file set, not just the files that changed, so this is not a shortcut but a correctness requirement. File and symbol node IDs (`file:<path>`, `symbol:<path>#<name>`) stay stable for unchanged files because they are derived purely from path/name, never from build order or run-specific state.
- `--call-graph`, when requested during a partial rebuild, is always fully regenerated (call-graph extraction re-parses source text directly and is not derived from cached per-file analysis) — reported honestly via `cacheMode: "incremental-partial-with-artifact-fallback"` and `partialRebuildFallbackArtifacts: ["call-graph"]`, never silently treated as reused.
- `data-model.json`, `frontend-semantic.json`, `frontend-reachability.json`, and `classification.json` needed no analyzer-specific partial-rebuild logic: they already run over the complete current `symbol-index.json`/`code-graph.json` on every build (full or partial), so a correctly merged core index keeps them fully correct with no stale entries automatically.
- When partial-rebuild reuse is not safely possible (the previous `symbol-index.json` is missing, unreadable, or from an incompatible schema version), `--incremental` falls back honestly to a full rebuild — reported as `incremental-change-detected-full-rebuild` with the reason in `cacheInvalidationReason` — rather than guessing or silently producing incorrect output.
- Equivalence tests (`tests/index/partialRebuild.spec.ts`) prove partial incremental `symbol-index.json`/`code-graph.json`/`call-graph.json` output is logically equivalent (normalized for timestamps only) to a clean full `index` run of the same source tree, across changed-file, added-file, removed-file, and re-export/export-all cross-file-dependency fixtures, and that unchanged file/symbol node IDs stay bit-identical across a partial rebuild.
- `manifest.json` gained `partialRebuildFallbackArtifacts` (see `docs/GRAPH_SCHEMA.md`). Preserved all Batch 1 and Batch 2 behavior: preflight warnings, `--dry-run`, `--progress`, `.my-dev-kit`/`.my-dev-kit-*` self-ignore, `--reset-cache`, and the `incremental-no-change`/`incremental-full-*` modes all continue to work exactly as before.

Batch 3 does not implement graph-diff, watch mode, or search/lookup/slice filtering — those remain planned below.

### Batch 4 status (implemented)

Batch 4 adds the `graph-diff` command: a deterministic, read-only comparison of two existing index directories, built on Batch 3's stable node/edge IDs.

- Added `graph-diff --before <index-dir> --after <index-dir> --json`, which compares `manifest.json`/`code-graph.json` (required) and `symbol-index.json`/`classification.json`/`data-model.json`/`frontend-semantic.json`/`frontend-reachability.json` (optional, degrading gracefully when absent) between the two directories. It never runs `index` and never writes to or modifies either input directory.
- Node/edge diffing reuses the existing stable `node.id`/`edge.id` identity from Batch 3 — no new comparison scheme was introduced. Reports `added`/`removed` (compact refs) and `changed` (only the fields that actually differ, with `before`/`after` limited to those fields — never a full node/edge dump).
- `symbol-index.json` gets a compact companion diff (added/removed/changed file paths and symbol ids), `manifest.json` gets a fixed-field diff (`indexMode`, `cacheMode`, `changedFileSummary`, `partialRebuildFallbackArtifacts`, analyzer status changes, etc. — excluding `createdAt`), `classification.json` gets a per-entry diff by its own stable id (added/removed/changed edit guidance, risk labels, etc.), and `data-model.json`/`frontend-semantic.json`/`frontend-reachability.json` get a safe summary-count-only diff (not a fragile deep per-entry diff, since they lack a single stable per-entry identity).
- Exit behavior: `0` for valid inputs whether or not differences are found; non-zero with a clear error for invalid arguments, a missing index directory, or a malformed required artifact; a missing *optional* artifact never causes a non-zero exit, only a warning and an "unavailable" diff section.
- Equivalence tests (`tests/graph-diff/graphDiff.spec.ts`) prove `graph-diff` correctly reports no differences for identical indexes and correctly reports added/removed/changed nodes and edges for changed/added/removed-file fixtures, alongside determinism and read-only-input-directory checks.

Batch 4 does not implement watch mode, search/lookup/slice/source filtering, or a dedicated `call-graph.json` diff section — those remain planned below or deferred as noted.

### Remaining deferred items and future work

The completed v1.8.0 implementation currently stops at Batch 4. The items below remain deferred from that implementation close-out unless and until a later release or follow-up batch explicitly lands them.

### Planned capabilities

#### Incremental indexing

- changed-file detection (implemented in Batch 2)
- cache/config invalidation (implemented in Batch 2)
- clear cache reset command (implemented in Batch 2)
- partial index rebuild for the core artifact pipeline — `symbol-index.json`/`code-graph.json` (implemented in Batch 3)
- deterministic artifact merge across changed and unchanged file analyses, for the core artifact pipeline (implemented in Batch 3)
- stable artifact IDs across partial rebuilds, for the core artifact pipeline (implemented in Batch 3)
- partial (non-fallback) call-graph rebuild (not implemented — `--call-graph` is always fully regenerated during a partial rebuild and reported as an artifact fallback)

#### Watch mode

- watch source roots
- rebuild changed files
- update affected graph artifacts
- report changed nodes and edges
- keep output deterministic

#### Graph diff

- compare two index runs (implemented in Batch 4)
- report added nodes (implemented in Batch 4)
- report removed nodes (implemented in Batch 4)
- report changed nodes (implemented in Batch 4)
- report added edges (implemented in Batch 4)
- report removed edges (implemented in Batch 4)
- report changed edge metadata (implemented in Batch 4)
- dedicated `call-graph.json` diff section (not implemented — call-graph content is already reflected in `code-graph.json`'s `calls` edges)

#### Search and lookup filtering

- filter search by node kind
- filter search by symbol kind
- filter search by edge kind
- filter lookup output by edge kind
- filter graph slices by node and edge kinds

## Version 1.9.0

Version 1.9.0 starts Android support with Android project detection and Kotlin/Java structural indexing.

The goal is to let `my-dev-kit` recognize Android project structure and retrieve useful Kotlin/Java source context without rewriting the existing artifact model.

### Batch 1 status (implemented)

Batch 1 is the Android project detection foundation: static Gradle/Android project, module, and source-set detection, with zero Kotlin/Java structural indexing yet.

- `index` now performs static Android project detection against `--root` on every run (no new flag): `settings.gradle(.kts)` `include(...)` parsing (conservative, regex-based, not a real Groovy/Kotlin-DSL parser), root/module `build.gradle(.kts)` Android plugin-id substring evidence (`com.android.application`/`com.android.library`), `AndroidManifest.xml` path existence, and `main`/`test`/`androidTest` source-set + Kotlin/Java source-root existence — all existence/substring-based, never Gradle execution, never Kotlin/Java parsing.
- Added `android-project.json` (own `artifactKind`, own schema version, own ID space — not merged into `code-graph.json`/`symbol-index.json`), written only when Android evidence is found, registered in `manifest.json`'s `analyzers` array as `{ id: 'android-project', ... }` using the same pattern `classification` already uses. A non-Android project is completely unaffected (`status: 'skipped'`, no file written).
- `.gradle` added to the default-ignore directory list; `build` (already default-ignored since v1.8.0 Batch 1) already covers all nested Android build-output paths by existing depth-independent basename matching, with zero new ignore-pattern code needed.
- `index --incremental`'s config fingerprint now covers detected Android structure (an `androidEvidenceFingerprint` derived from the built artifact itself, not raw file hashing), so a Gradle/manifest edit that changes detected structure correctly invalidates the cache even though those files live outside `--src`; an edit that doesn't change any detected fact correctly does not. `--reset-cache`, the no-change fast path, and stale-artifact cleanup all continue to work unchanged.
- `graph-diff` requires zero code changes: it never enumerates the index directory, so `android-project.json` is inert to it; the existing generic `manifest.analyzerChanges` diff already reports Android analyzer-status changes between two indexes. Proven by a dedicated compatibility test suite, not just asserted.
- Kept the artifact simpler than originally sketched: module summaries live directly inside `android-project.json`; a separate `android-modules.json` was not needed and was not created.

Batch 1 does not implement Kotlin/Java structural indexing, Kotlin/Java file/symbol nodes in `code-graph.json`/`symbol-index.json`, Android component-role detection, Room/Retrofit/Hilt/Dagger detection, a detailed Gradle project model, a detailed `AndroidManifest.xml` artifact, Android resources/navigation artifacts, or Compose semantic retrieval — those remain planned below for later `v1.9.0` batches.

### Planned capabilities

#### Android project detection

- detect Android projects from Gradle files and Android manifests (implemented in Batch 1)
- detect Gradle modules (implemented in Batch 1)
- distinguish app modules and library modules (implemented in Batch 1)
- detect source sets such as `main`, `test`, and `androidTest` (implemented in Batch 1)
- detect Kotlin source roots (implemented in Batch 1)
- detect Java source roots (implemented in Batch 1)
- detect generated/build directories that should be ignored (implemented in Batch 1)
- Gradle version-catalog plugin-alias resolution (not implemented — only literal plugin-id substrings are recognized)
- custom Gradle `projectDir` remap support (not implemented — module paths always follow the default Gradle directory convention)

Artifact:

- `android-project.json` (implemented in Batch 1; module summaries live inside it — a separate `android-modules.json` was not needed)

### Batch 2 status (implemented)

Batch 2 adds Kotlin structural indexing on top of Batch 1's Android/source-root detection foundation.

- `.kt` files under a requested `--src` root are now discovered and indexed exactly like `.ts`/`.js`/`.py` files, through a new `KotlinAdapter` registered in the existing `LanguageRegistry` — no new indexing pipeline, no new command, no new flag.
- A conservative, deterministic, line/regex-based extractor (not the Kotlin compiler, not a grammar parser) extracts: package declaration, imports (including wildcards), top-level `class`/`data class`/`sealed class`/`interface`/`object`/`enum class` declarations, top-level functions (including extension functions), and top-level `val`/`var` properties.
- **Top-level declarations only** — matches the existing TypeScript (`ts.forEachChild`, direct children only) and Python (`tree.body`, top-level only) precedent exactly; class members are not extracted as separate symbols for any language today, so Kotlin doesn't invent a new member-symbol model either.
- Modifiers, `suspend`, extension receivers, annotations, and `Flow`/`StateFlow` usage are surfaced through the existing `signature` text field (no new fields added to `SymbolDefinition`/`ExtractionResult`) — the same choice the Python adapter already made for decorators.
- One new `SymbolKind` value, `object`, added because Kotlin's `object`/`companion object` (a singleton/namespace) doesn't map cleanly onto `class`. `SourceLanguage` gained `kotlin`.
- Import resolution is a best-effort, honestly-limited heuristic (single-top-level-declaration-per-file convention); wildcard imports and multi-declaration files correctly resolve to no target rather than guessing.
- Call-graph extraction is not implemented for Kotlin (`supportsCallGraph: false`) — Kotlin's trailing-lambda call syntax makes regex-based call detection too unreliable; documented as a limitation, not silently skipped.
- `search`, `lookup`, `slice`, and `source` all work on Kotlin file/symbol nodes with zero new flags, since Kotlin symbols land in the same `symbol-index.json`/`code-graph.json` artifacts. Verified by dedicated tests, not just asserted.
- Incremental indexing and `graph-diff` remain fully compatible: Kotlin files participate in the existing changed-file/partial-rebuild machinery and appear as ordinary graph nodes with no Kotlin-specific special-casing needed anywhere in either system.
- Preserves the existing `--src` source-root boundary: Kotlin source roots recorded in `android-project.json` (Batch 1) are informational only and never expand or override `--src`.

Batch 2 does not implement Java structural indexing, Android component-role detection, Compose semantic retrieval, member function/property symbols, or call-graph edges for Kotlin — those remain planned below or deferred as noted.

#### Kotlin structural indexing

- `.kt` file discovery (implemented in Batch 2)
- package declarations (implemented in Batch 2)
- imports (implemented in Batch 2)
- classes (implemented in Batch 2)
- interfaces (implemented in Batch 2)
- objects (implemented in Batch 2)
- data classes (implemented in Batch 2)
- sealed classes (implemented in Batch 2)
- enums (implemented in Batch 2)
- top-level functions (implemented in Batch 2)
- extension functions (implemented in Batch 2)
- top-level properties (implemented in Batch 2)
- member functions/properties as separate symbol-index entries (not implemented — matches existing TypeScript/Python top-level-only precedent)
- constructors as separate symbols (not implemented — primary constructor parameters remain visible via the class's `signature` text)
- annotations (implemented in Batch 2 — visible via `signature` text, not a new field)
- `suspend` functions (implemented in Batch 2 — visible via `signature` text)
- basic coroutine and `Flow`/`StateFlow` usage markers (implemented in Batch 2 — visible via `signature` text and `imports`)
- Kotlin call-graph edges (not implemented — documented limitation, regex-based call detection deemed too unreliable)

### Batch 3 status (implemented)

Batch 3 adds Java structural indexing on top of Batch 1's Android detection and Batch 2's Kotlin indexing.

- `.java` files under a requested `--src` root are now discovered and indexed exactly like `.ts`/`.js`/`.py`/`.kt` files, through a new `JavaAdapter` registered in the existing `LanguageRegistry` — no new indexing pipeline, no new command, no new flag.
- A conservative, deterministic, line/regex-based extractor (not `javac`, no Maven/Gradle execution) mirrors the Kotlin adapter's design almost exactly: package declaration, imports (including `static` and wildcard forms), top-level `class`/`interface`/`enum`/`record`/`@interface` (annotation type) declarations.
- **Top-level declarations only** — same rule as Kotlin and the existing TypeScript/Python precedent; no method/field/constructor symbols were added, and no member-symbol schema change was needed or made.
- Modifiers (`abstract`/`final`/`static`/`sealed`/`non-sealed`), `extends`/`implements` targets, and annotations are surfaced through the existing `signature` text field — no new fields added to `SymbolDefinition`/`ExtractionResult`.
- **Zero new `SymbolKind` values** — `record` maps to `class`, `@interface` annotation types map to `interface`; both existing kinds already fit cleanly.
- Import resolution uses the same best-effort single-declaration-per-file heuristic as Kotlin (`<packageDir>/<Name>.java`); wildcard and static-wildcard imports correctly resolve to no target.
- Call-graph extraction is not implemented for Java (`supportsCallGraph: false`), matching the Kotlin decision.
- `search`, `lookup`, `slice`, and `source` all work on Java file/symbol nodes with zero new flags, verified by dedicated tests.
- Incremental indexing and `graph-diff` remain fully compatible with zero Java-specific special-casing.
- Preserves the `--src` source-root boundary: Batch 1's detected Android Java source roots are informational only and never expand or override `--src`.

Batch 3 does not implement method/field/constructor symbols, Java call-graph edges, semantic type resolution, cross-file `extends`/`implements` resolution, or Maven/Gradle model parsing.

#### Java structural indexing

- `.java` file discovery (implemented in Batch 3)
- package declarations (implemented in Batch 3)
- imports, including `static` and wildcard forms (implemented in Batch 3)
- top-level classes (implemented in Batch 3)
- top-level interfaces (implemented in Batch 3)
- top-level enums (implemented in Batch 3)
- top-level annotation type declarations (implemented in Batch 3 — mapped to `interface`)
- top-level record declarations (implemented in Batch 3 — mapped to `class`)
- annotations on top-level declarations (implemented in Batch 3 — visible via `signature` text)
- `extends` and `implements` relationships (implemented in Batch 3 — visible via `signature` text, not resolved across files)
- methods (not implemented — matches existing TypeScript/Kotlin/Python top-level-only precedent)
- fields (not implemented — matches existing TypeScript/Kotlin/Python top-level-only precedent)
- Java call-graph edges (not implemented — matches the Kotlin decision)

### Batch 4 status (implemented)

Batch 4 adds conservative static Android component-role detection on top of Batch 1's Android detection and Batch 2/3's Kotlin/Java structural indexing.

- A new `detectAndroidComponents()` (`src/android/detectAndroidComponents.ts`) evaluates every top-level Kotlin/Java `class`/`interface`/`object` symbol already in `symbolIndex` against 14 roles, using the evidence priority annotation > superclass/interface > import > package/path > naming suffix (weakest, never alone sufficient for `high` confidence).
- Runs automatically on every `index` of an Android project — no new flag, no new command, no second indexing pipeline.
- New optional artifact `android-components.json`, written only when at least one role is detected, registered in `manifest.json`'s `analyzers` array (`{ id: 'android-components', ... }`) via the exact same pattern `android-project`/`classification` already use.
- Compact `androidComponentRoles`/`androidComponentRefs` fields added to `SymbolDefinition`, `GraphSymbolRecord`, and `CodeGraphNode` — the same compact-projection-plus-artifact-ref pattern `classificationRoles`/`classificationRefs` already established; zero breaking changes to any existing field.
- `search`, `lookup`, `slice`, and `source` all surface role metadata with zero new flags: `search` gained one new indexed field (`androidComponentRole`); `lookup`/`source` mirror the existing `classificationRoles`/`classificationRefs` pass-through wiring exactly; `slice` needed no changes at all (it already returns whole node objects).
- Only Retrofit-service detection reads past a symbol's own declaration line (HTTP method annotations are on methods, not the interface declaration) — a small, bounded, brace-depth-scanned re-read of the already-indexed file (capped at 400 lines) covers that one case; every other role uses only data already in `symbolIndex`.
- Preserves the `--src` source-root boundary: detection only reads files already present in `symbolIndex` (i.e. already under a requested `--src` root) — it never scans additional source roots Batch 1 may have recorded.
- Does not implement: method/field/constructor-level role evidence, a detailed `AndroidManifest.xml`-based component registry, Compose semantic retrieval, or any runtime/dependency-injection/navigation verification.

Batch 5 hardens and verifies end-to-end retrieval and command compatibility for the Android/Kotlin/Java work added in Batches 1 through 4 — integration hardening only, no new commands, no new flags, no schema redesign.

- Added `tests/fixtures/android/mixed-kotlin-java-app`, a single Android module with role-bearing and plain Kotlin and Java sources side by side, so `index`/`search`/`lookup`/`source`/`slice`/`context`/`graph-diff`/`--incremental` are all proven against one index containing Android project facts, Kotlin symbols, Java symbols, and Android component roles together, not just each language in isolation as Batches 1–4 tested.
- Confirmed `context` and `graph-diff` were already fully generic with respect to Android/Kotlin/Java data (neither needed Android-specific code in any prior batch); added compatibility tests proving the context capsule can surface Android/Kotlin/Java candidates for task-like queries while staying bounded, and that `graph-diff` reports added/changed Kotlin and Java nodes (including role-metadata changes) with no dedicated Android/Kotlin/Java diff section.
- No production source changes were required — this batch is tests-and-fixture-only.
- Does not implement: new commands, new flags, a detailed Gradle model, a detailed `AndroidManifest.xml` artifact, Android resources/navigation artifacts, Compose semantic retrieval, or any Android build/emulator/runtime/security validation.

#### Android component detection

Static detection for common Android classes and patterns:

- `Activity` (implemented in Batch 4)
- `Fragment` (implemented in Batch 4)
- `ViewModel` (implemented in Batch 4)
- `Service` (implemented in Batch 4)
- `BroadcastReceiver` (implemented in Batch 4)
- `ContentProvider` (implemented in Batch 4)
- `Worker` (implemented in Batch 4)
- repository classes (implemented in Batch 4 — medium confidence ceiling, no annotation/superclass evidence tier)
- use-case classes (implemented in Batch 4 — medium confidence ceiling)
- Room entities and DAOs when detectable by annotations (implemented in Batch 4)
- Room databases when detectable by annotation or `RoomDatabase` superclass (implemented in Batch 4)
- Retrofit services when detectable by annotations (implemented in Batch 4 — via a bounded body scan, since HTTP method annotations are inside the interface)
- Hilt/Dagger modules when detectable by annotations (implemented in Batch 4)
- Android component-role classification beyond these 14 role tags (not implemented — deferred)

#### Command integration

- include Kotlin/Java symbols in `symbol-index.json` (implemented in Batch 2/3)
- include Kotlin/Java file and symbol nodes in `code-graph.json` (implemented in Batch 2/3)
- preserve existing TypeScript/JavaScript/Python behavior (preserved)
- keep Android artifacts registered in `manifest.json` (implemented in Batch 1/4)
- keep static-analysis boundaries explicit (preserved)
- verify `search`/`lookup`/`source`/`slice`/`context`/`graph-diff`/`--incremental` compatibility when Android/Kotlin/Java facts coexist in one index (verified in Batch 5)

### Non-goals

- no Android build execution during indexing
- no emulator execution
- no runtime app analysis
- no APK or AAB inspection in this version
- no Play Store workflow
- no Gradle dependency resolution beyond static file parsing

## Version 1.10.0

Version 1.10.0 adds Android Gradle, manifest, resource, and navigation artifacts.

The goal is to make Android behavior visible outside Kotlin/Java source files, because important app behavior is often defined in Gradle, XML manifests, resources, and navigation graphs.

### Batch 1 status (implemented)

Batch 1 is the detailed static Gradle project model: it extends v1.9.0 Batch 1's Android/module/source-set detection foundation with plugins, dependencies, `android {}` configuration, and version-catalog evidence. Manifest, resource, and navigation artifacts are not part of Batch 1 and remain planned below.

- Added `android-gradle.json` (own `artifactKind`, own schema version), written when detailed Gradle evidence is found, registered in `manifest.json`'s `analyzers` array as `{ id: 'android-gradle', ... }` — the same pattern `android-project`/`android-components` already use. `android-project.json` is unchanged and remains the coarse project/module/source-set summary; `android-gradle.json` is a detailed layer built on the same module set.
- Extends the existing `src/android/parseGradleEvidence.ts` regex/brace-scanning parser (not a new Gradle scanner) with: settings evidence (`rootProject.name`, `include(...)` reused from v1.9.0, `includeBuild(...)`, `project(...).projectDir` remaps), plugin evidence (`id(...)`, `id '...'`, `alias(libs.plugins.*)`, `apply plugin:`/`apply(plugin = ...)`), dependency evidence (external-module/project/version-catalog-alias/platform/file/unknown, per configuration), `android {}` evidence (`namespace`, `compileSdk`, `applicationId`, `minSdk`, `targetSdk`, `versionCode`, `versionName`, `testInstrumentationRunner`, `buildFeatures`, `buildTypes`, `productFlavors`, `flavorDimensions`, source-set overrides), and a bounded `gradle/libs.versions.toml` parser (no new runtime dependency — the TOML subset the file actually uses is hand-parsed).
- Every SDK/config value is a resolved-literal-or-raw-unresolved-with-warning union (`AndroidGradleValue<T>`): a dynamic expression (variable reference, function call, string concatenation) is always preserved as raw source text with a warning, never guessed at.
- `index --incremental`'s config fingerprint now also covers an `androidGradleEvidenceFingerprint`, alongside v1.9.0's `androidEvidenceFingerprint`; any settings/build/version-catalog edit that changes detected Gradle evidence invalidates the cache and regenerates `android-gradle.json` in full (no partial per-module rebuild in this batch). Stale-artifact cleanup and `--reset-cache` behavior are unchanged.

Batch 1 does not implement `AndroidManifest.xml` parsing, resource/navigation artifacts, Compose semantic retrieval, or any new retrieval selector/graph view — those remain planned below for later `v1.10.0` batches.

### Planned capabilities

#### Gradle project model

Static parsing for:

- `settings.gradle` (implemented in Batch 1)
- `settings.gradle.kts` (implemented in Batch 1)
- `build.gradle` (implemented in Batch 1)
- `build.gradle.kts` (implemented in Batch 1)
- `gradle/libs.versions.toml` (implemented in Batch 1)

Extract where practical:

- included modules (implemented in Batch 1)
- Android Gradle plugin usage (implemented in Batch 1)
- application/library module type (implemented in Batch 1; `test`/`dynamic-feature` also recognized)
- namespace (implemented in Batch 1)
- application ID (implemented in Batch 1)
- min SDK (implemented in Batch 1)
- target SDK (implemented in Batch 1)
- compile SDK (implemented in Batch 1)
- build types (implemented in Batch 1)
- product flavors (implemented in Batch 1)
- dependencies (implemented in Batch 1)
- plugins (implemented in Batch 1)
- source sets (source-set *overrides* implemented in Batch 1; the base source-set model itself remains in `android-project.json`)

Candidate artifact:

- `android-gradle.json` (implemented in Batch 1)

### Batch 2 status (implemented)

Batch 2 is the detailed static Android manifest model: it discovers and parses `AndroidManifest.xml` files using v1.9.0's module/source-set detection and Batch 1's Gradle namespace/custom-manifest-path evidence. Resource and navigation artifacts are not part of Batch 2 and remain planned below.

- Added `android-manifest.json` (own `artifactKind`, own schema version), written when one or more manifest files are discovered, registered in `manifest.json`'s `analyzers` array as `{ id: 'android-manifest', ... }` — the same pattern `android-gradle`/`android-project` already use.
- Added a bounded, non-executing XML parser (`src/android/xml/parseXml.ts`, hand-written rather than a new runtime dependency — the same call Batch 1 made for TOML) backing `src/android/discoverAndroidManifests.ts` (discovery: default source-set locations plus statically-visible custom Gradle manifest paths) and `src/android/parseAndroidManifest.ts` (per-manifest parsing), orchestrated by `src/android/buildAndroidManifestProject.ts`.
- **Manifest merging is never simulated**: every source-set manifest (`main`, `debug`, `release`, product flavors, `test`, `androidTest`, custom source sets) is parsed and preserved as its own independent record, including duplicate declarations across source sets.
- Extracted per manifest: `package`/`uses-sdk`/`sharedUserId`/`installLocation`; `uses-permission`/`uses-permission-sdk-23`/declared `permission`/`uses-feature`; the `application` declaration and its attributes; `activity`/`activity-alias`/`service`/`receiver`/`provider` components with `exported` state (never overinterpreted — `"true"`/`"false"`/`"unspecified"` only), process/permission attributes, and provider authorities/grant-uri-permission/path-permission evidence; `intent-filter`/`action`/`category`/`data`; `meta-data` (including FileProvider-style references); launcher and deep-link candidates from direct static intent-filter evidence only.
- Component names (`.Name`/`Name`/`com.example.Name` forms) resolve against the manifest's own `package` attribute first, falling back to the Gradle namespace only when no `package` attribute exists — never against `applicationId`, never invented when neither base is available (left unresolved with a warning).
- Every non-string attribute value is a resolved-literal/resource-reference/placeholder/unresolved/absent union; resource references (`@type/name`, `?attr/name`) are preserved but never resolved to an actual value.
- `index --incremental`'s config fingerprint now also covers an `androidManifestEvidenceFingerprint`, alongside v1.9.0's `androidEvidenceFingerprint` and Batch 1's `androidGradleEvidenceFingerprint`; any manifest add/edit/delete, Gradle namespace change, or custom-manifest-path change invalidates the cache and regenerates `android-manifest.json` in full (no partial per-manifest rebuild in this batch).

Batch 2 does not implement resource XML parsing/resolution, `android-resources.json`, `android-navigation.json`, a broad declaration-to-source relationship graph, or any Android retrieval selector/graph view — those remain planned below for later `v1.10.0` batches.

#### Manifest artifact

Static parsing for `AndroidManifest.xml`:

- package/namespace information where available (implemented in Batch 2)
- permissions (implemented in Batch 2)
- activities (implemented in Batch 2)
- services (implemented in Batch 2)
- receivers (implemented in Batch 2)
- providers (implemented in Batch 2; also activity-alias, implemented alongside the four named above)
- exported components (implemented in Batch 2; explicit `true`/`false`/`unspecified` only — no effective-value computation from platform-version/merging rules)
- intent filters (implemented in Batch 2)
- launcher activity (implemented in Batch 2, as launcher *candidates* from direct static evidence — no manifest-merging or build-variant resolution)
- deep links (implemented in Batch 2, as deep-link *candidates* from direct static evidence — no runtime reachability or domain-verification proof)
- application metadata (implemented in Batch 2; component-level `meta-data` also implemented)

Candidate artifact:

- `android-manifest.json` (implemented in Batch 2)

### Batch 3 status (implemented)

Batch 3 is the detailed static Android resource model: it discovers and indexes `res/` resource directories using v1.9.0's module/source-set detection and Batch 1's Gradle resource-directory evidence. Navigation semantics, manifest-to-resource/source-to-resource relationships, and resource resolution are not part of Batch 3 and remain planned below.

- Added `android-resources.json` (own `artifactKind`, own schema version), written when one or more resource files are discovered, registered in `manifest.json`'s `analyzers` array as `{ id: 'android-resources', ... }` — the same pattern `android-manifest`/`android-gradle`/`android-project` already use.
- Added `src/android/discoverAndroidResourceDirectories.ts` (default source-set locations plus Batch 1 Gradle `res.srcDirs(...)` overrides) and `src/android/parseResourceDirectoryName.ts` (conservative qualifier parsing — locale, night mode, API level, density, orientation, smallest-width/width/height — with unrecognized segments preserved rather than discarded).
- Added `src/android/parseAndroidValuesResource.ts` (`values*` XML: `string`/`color`/`style`/`bool`/`integer`/`dimen`/`fraction`/`plurals`/arrays/`attr`/`declare-styleable`/explicit-type `item`) and `src/android/parseAndroidResourceFile.ts` (layouts with declared IDs and `<include>`/`<fragment>` evidence; generic file-based XML for drawables/mipmaps/menus/anims/animators/color-state-lists/fonts/navigation graphs; FileProvider `<paths>`; `<network-security-config>`), all built on Batch 2's shared bounded XML parser, additively extended with an element `text` field (zero change to Batch 2 manifest-parsing behavior, verified by the existing Batch 2 regression suite).
- **Resource merging, overlay precedence, and device-configuration matching are never simulated**: every qualified directory/file across every source set is indexed and preserved independently; duplicate logical resource names are never collapsed, no runtime winner is ever selected.
- Every resource reference (`@type/name`, `@+id/name`, `@id/name`, `?attr/name`, `@android:...`, `@package:type/name`, `@null`/`@empty`) is classified and given a `candidateTargetIds[]` — every statically-known local definition sharing its logical key, enumerated rather than resolved to one target.
- A `res/navigation/*.xml` file is recorded only as a generic file-based resource — no destination/action/argument/deep-link navigation semantics were pulled forward from the planned Navigation artifact below.
- `index --incremental`'s config fingerprint now also covers an `androidResourcesEvidenceFingerprint`; because binary resource files contribute no parsed content to the artifact JSON, their fingerprint additionally folds in a per-file content hash so a binary edit still invalidates the cache. Any resource add/edit/delete or custom Gradle resource-directory change regenerates `android-resources.json` in full (no partial per-file rebuild in this batch).

Batch 3 does not implement navigation destination/action/argument extraction, manifest-to-resource or source-to-resource cross-artifact relationships, resource resolution/compilation, or any Android retrieval selector/graph view — those remain planned below for later `v1.10.0` batches.

#### Resource artifact

Static resource indexing for:

- `res/values/strings.xml` (implemented in Batch 3)
- `res/values/colors.xml` (implemented in Batch 3)
- `res/values/themes.xml` (implemented in Batch 3, as `style` definitions — no theme-inheritance resolution)
- `res/drawable/` (implemented in Batch 3; binary bitmap content is indexed by path/qualifier/extension only, never decoded)
- `res/mipmap/` (implemented in Batch 3, same boundary as drawables)
- `res/xml/` (implemented in Batch 3, including FileProvider paths and network-security config as specialized records)
- `res/layout/` when XML views are used (implemented in Batch 3)

Extract where practical:

- string resource keys (implemented in Batch 3)
- style/theme names (implemented in Batch 3; no inheritance resolution)
- color names (implemented in Batch 3)
- drawable names (implemented in Batch 3)
- layout IDs (implemented in Batch 3)
- view IDs (implemented in Batch 3)
- navigation XML references (implemented in Batch 3 only as bounded generic file-resource evidence — no destination/action/argument extraction; full navigation semantics remain planned below)

Candidate artifact:

- `android-resources.json` (implemented in Batch 3)

### Batch 4 status (implemented)

Batch 4 is the detailed static Android navigation model: it discovers and indexes `res/navigation/*.xml` graphs (reusing Batch 3's already-discovered navigation resource-file records) and narrowly-supported static Compose navigation routes from already-indexed Kotlin/Java source. Manifest deep-link linking, screen-to-route cross-artifact relationships, and full Compose semantics are not part of Batch 4 and remain planned below.

- Added `android-navigation.json` (own `artifactKind`, own schema version), written when navigation XML or supported Compose route evidence is found, registered in `manifest.json`'s `analyzers` array as `{ id: 'android-navigation', ... }` — the same pattern the other three Android analyzers use.
- Added `src/android/buildAndroidNavigationXmlModel.ts` (root/nested graphs, `fragment`/`activity`/`dialog` destinations with unrecognized elements conservatively preserved as `custom`, `<action>` with candidate destination/popUpTo enumeration and flags/animation references, `<argument>` with classified default values, `<deepLink>` with parsed scheme/host/placeholder evidence, `<include>` with multi-candidate target resolution) and `src/android/buildComposeNavigationRoutes.ts` (bounded static extraction from `composable`/`navigation`/`dialog`/`activity`/`NavHost` calls — direct string literals, same-file `const val` resolution, and type-route arguments only; dynamic expressions always left unresolved with a warning, never invented), merged by `src/android/buildAndroidNavigationProject.ts`.
- **XML and Compose evidence are two clearly separated evidence kinds, never auto-linked**: this batch never infers that an XML destination and a Compose route are "the same" screen from name/string similarity alone.
- Extended the shared XML parser (`src/android/xml/parseXml.ts`) with `findNamespacePrefixForUri`, a generalization of Batch 2's Android-namespace-only lookup needed for navigation XML's `app`/`tools` namespaces — zero change to Batch 2/3 parsing behavior, verified by their existing regression suites.
- A **direct screen candidate** is recorded only when a route's content lambda is exactly one top-level PascalCase call with no control-flow keywords anywhere in the body; ambiguous content (e.g. an `if`/`else` choosing between screens) still produces route evidence but no screen candidate.
- Compose route evidence is computed inside the same index-finishing pipeline stage `android-components.json` (v1.9.0 Batch 4) already uses, since it needs the already-built symbol index; the XML portion is computed early (like the other three Android builders) with its own `androidNavigationXmlEvidenceFingerprint`, since navigation XML isn't tracked by the normal `--src` changed-file mechanism — Kotlin/Java changes affecting Compose routes are already covered by that existing mechanism.

Batch 4 does not implement manifest-to-navigation deep-link relationships, navigation-to-resource or destination-to-source relationships, route-to-screen graph edges, full Compose semantic indexing, or any Android retrieval selector/graph view — manifest/navigation/resource/source relationship linking was implemented in Batch 5 (below); retrieval selectors/graph views remain planned for Batch 6 or v1.11.0.

#### Navigation artifact

Static parsing for Android navigation evidence:

- XML navigation graph destinations when present (implemented in Batch 4)
- Compose route string constants when detectable (implemented in Batch 4, narrowly — direct string literals, same-file `const val`, and type-route arguments only; dynamic expressions are never invented)
- deep-link mappings from manifest/navigation resources (XML navigation deep links implemented in Batch 4; exact manifest-to-navigation deep-link *linking* implemented in Batch 5)
- screen-to-route relationships when statically visible (direct screen *candidates* implemented in Batch 4; destination/route-to-symbol graph edges implemented in Batch 5)

Candidate artifact:

- `android-navigation.json` (implemented in Batch 4)

### Batch 5 status (implemented)

Batch 5 connects the six Android artifacts from Batches 1-4 (plus v1.9.0's `android-project.json`/`android-components.json`) through compact, deterministic, conservative static graph relationships — integrated additively into the existing `code-graph.json`, not a new artifact, not a parallel graph.

- Added `src/android/buildAndroidArtifactRelationships.ts`, called at the end of the same index-finishing pipeline stage `android-components.json`/Compose route extraction already use, and `src/graph/addAndroidRelationshipsToCodeGraph.ts`, which additively merges the result into `code-graph.json` by `id` — the same merge pattern `addFrontendRelationshipsToCodeGraph.ts` already uses for frontend routes.
- Extended `CodeGraphNodeKind`/`CodeGraphEdgeKind` (backward-compatible additive union extension) with 13 new Android node kinds and 17 new Android edge kinds; extended `CodeGraphNode` with optional `androidArtifactId`/`androidEntityId`/`androidModuleId`/`androidSourceSetId`/`androidMetadata` fields.
- Every relationship node reuses the stable ID its owning artifact already assigned (module/manifest-component/resource-definition/navigation-destination/etc. IDs are never re-minted); every source-side edge endpoint reuses the existing `symbol`- or `file`-kind node from structural indexing — Kotlin/Java class nodes are never duplicated.
- Implements all required relationship families: `module-contains-source-set`, `manifest-declares-component`, `manifest-component-resolves-to-source` (exact fully-qualified class name only, following `targetActivity` for `activity-alias`), `component-has-intent-filter`, `component-uses-permission`/`manifest-uses-permission` (no security verdict drawn), `resource-defined-in-file`, `source-references-resource` (bounded, comment/string-stripped `R.type.name` scan of indexed Kotlin/Java source; `android.R.*` framework references always skipped), `navigation-graph-contains-destination`, `navigation-destination-has-action`, `navigation-action-targets-destination`/`navigation-action-pop-up-to-destination`, `navigation-graph-includes-graph`, `navigation-destination-has-deep-link`, `manifest-deep-link-matches-navigation-deep-link` (exact scheme/host/port/path only — a manifest `pathPrefix`/`pathPattern` or a navigation deep link with a placeholder is always a non-match), `navigation-destination-resolves-to-screen`, `compose-route-resolves-to-screen`.
- Every one-to-many static match (multiple candidate classes, resource definitions, navigation targets, or screen functions) is enumerated as one edge per candidate — never narrowed to a single runtime winner, since edge metadata cannot hold arrays.
- Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-relationships', ... }` with `artifacts: []` (it enriches `code-graph.json` in place, producing no new top-level file).
- No dedicated incremental fingerprint: relationships are recomputed fresh whenever the finishing pipeline runs, which already happens on any upstream Android evidence fingerprint change or tracked Kotlin/Java source change. `graph-diff` required zero code changes — it already diffs `CodeGraph.nodes`/`.edges` purely by `id` equality.

Batch 5 does not implement retrieval selectors, graph views, or any new CLI flag for these relationships (that is Batch 6's scope), and does not claim runtime reachability, effective permission enforcement, or deep-link resolution success — only static structural evidence.

### Batch 6 status (implemented)

Batch 6 exposes the Android evidence and Batch 5 relationships through the existing `search`, `lookup`, `source`, `slice`, `context`, and `view` command families — no new top-level command, no second retrieval runtime, no second graph.

- Added `src/android/androidRetrieval.ts`: one shared, bounded resolver (artifact/graph loading, exact-match candidate resolution for routes/permissions/resources/components, search/lookup result builders) reused by every command below.
- `search` gained `--android-route`, `--permission`, `--resource`, and `--android-component` (each mutually exclusive with `--query` and the existing reachability selectors), returning `my-dev-kit-v1-android-search-result` with every exact candidate preserved.
- `lookup` gained `--android-component`, returning `found`/`not-found`/`ambiguous` (mirroring the existing lookup ambiguity contract) with detailed component evidence — intent filters, permission edges, source-class candidates, deep-link matches — on a unique match.
- `source` gained `--android-route` and `--resource`, retrieving a bounded excerpt via the resolved node's own `path`/`line` (no reparsing); binary resources (`.png`/`.ttf`/etc.) return metadata only, never decoded content; multiple exact candidates (e.g. a resource defined in `values/` and `values-es/`) return `ambiguous` with every candidate ID, never a chosen qualifier/source-set winner.
- `slice` gained `--android-route` and `--android-component`, resolving a unique root then calling the **unmodified** `sliceGraph` engine — identical depth/direction/edge-kind/cap behavior to `--node`.
- `view` gained `--graph android-module`, `--graph android-manifest`, and `--graph android-navigation` (`src/graph/adaptGraphArtifact.ts`), each rendering `code-graph.json` itself (the same artifact `--graph code` renders) filtered to a Batch 5 node-kind seed set expanded one hop across a fixed, named set of real relationship edges — the existing DOT/SVG/PNG renderer, no second renderer.
- `context` needed no new command or flag: `src/search/searchIndex.ts` now treats `android-*` code-graph nodes as searchable (previously only `file`/`symbol`), and `src/context/candidateRanking.ts` now accepts those kinds into the same generic candidate-ranking/graph-expansion/source-selection pipeline — a route/permission/resource/component-shaped query can now select an Android node as focus, expand across real Batch 5 edges, and attach bounded source evidence for it.
- `src/lookup/resolveSourceTarget.ts` (`resolveFileNodeTarget`, already shared by `source --node` and `context`'s source-slice selection) was additively extended to resolve a bounded excerpt for `android-*` nodes carrying a `path`/`line`.
- Added a combined fixture, `tests/fixtures/android-retrieval/combined-app/`, and two test files (`tests/android/androidRetrieval.spec.ts`, `tests/cli/androidRetrievalCommands.spec.ts`) covering exact-match/ambiguity/no-match behavior, binary-resource non-decoding, real relationship traversal in slices/views, context Android-query integration, missing-Android-evidence and non-Android-project compatibility, and stale-retrieval-after-re-index (route rename, permission removal, full/incremental equivalence).

Batch 6 does not implement full Compose semantic retrieval, Android UI-test indexing, Android architecture/data-flow classification, or an Android retrieval benchmark program — those remain planned below for v1.11.0-v1.13.0.

### Command integration

Implemented selectors (v1.10.0 Batch 6):

- `search --android-route <route>`
- `search --permission <permission>`
- `search --resource <name>`
- `search --android-component <name>`
- `lookup --android-component <name>`
- `source --android-route <route>`
- `source --resource <name>`
- `slice --android-route <route>`
- `slice --android-component <name>`
- `view --graph android-module`
- `view --graph android-manifest`
- `view --graph android-navigation`
- `context` Android-query integration (no new flag)

### Batch 7 status (implemented)

Batch 7 is the combined Android integration and regression gate: it validates Batches 1-6 as one coherent capability (source → detection → Gradle/manifest/resource/navigation models → Kotlin/Java indexing → Android component evidence → code-graph relationships → incremental indexing → graph-diff → search/lookup/source/slice/context/view) against one canonical fixture, rather than adding new product scope.

- Extended the existing Batch 6 canonical fixture (`tests/fixtures/android-retrieval/combined-app/`) into a full-coverage combined fixture — a second (`:core`) library module, Groovy alongside Kotlin DSL, product flavors/version-catalog/dynamic-dependency evidence, an activity-alias with resolved `targetActivity`, `uses-permission-sdk-23`/`uses-feature`/metadata, an exact plus a host-mismatched deep link, a component with no matching source class, additional resource types (styles/arrays/plurals/styleable/night-qualified duplicates), a nested/included navigation graph, a `popUpTo` action and a missing-target action, and full Compose builder coverage including a direct type-safe route (`composable<HomeRoute>()`) — rather than creating a second overlapping fixture.
- Added `tests/integration/` (five suites, 181 tests): fixture integrity, full artifact-generation plus cross-artifact identity plus the complete Batch 5 relationship-family matrix plus graph compactness, the complete Batch 6 retrieval/lookup/source/slice/view/context matrix, a combined incremental/stale-evidence/determinism gate, and a graph-diff plus missing/malformed-index gate.
- Closed the two fixture-level gaps Batch 6 explicitly reported as deferred: dedicated activity-alias public-retrieval tests (search/lookup/slice all resolve the alias to its exact `targetActivity` source class) and dedicated resource-deletion/component-rename stale-retrieval tests (each verified against both incremental re-indexing and a clean full re-index for equivalence).
- Corrected one narrow Batch 5→6 gap discovered by the direct type-safe-route fixture: `route.typeRouteName` was recorded by Batch 4 but never projected into Batch 5's compact `android-compose-route` `androidMetadata`, so a type-safe route existed in the graph but could never be found by `search`/`source`/`slice --android-route`. Added the missing `typeRouteName` field to the existing `androidMetadata` shape and a matching branch in the Batch 6 resolver — no new relationship family, no new artifact field beyond the one already-agreed compact-metadata contract.
- Full test suite: 1645/1645 passing (1464 Batch 6 baseline + 181 new Batch 7 integration tests), `npm run verify` (typecheck, build, docs:check) clean, and `npm run benchmark:retrieval` still PASS (confirms Batch 6's context candidate-eligibility change caused no regression).

Batches 1 through 8 are complete. The v1.10.0 implementation is complete, documentation is reconciled, and the implementation-completeness audit has passed. Pre-release readiness remains next; v1.10.0 has not been published.

### Static boundaries

- no Gradle build execution
- no dependency downloads
- no runtime intent resolution
- no proof that a deep link works at runtime
- no Play Store or signing validation

## Version 1.11.0

Version 1.11.0 adds Jetpack Compose semantic retrieval and Android UI-test indexing.

The goal is to make Android UI work feel similar to the existing React/TSX workflow: retrieve the screen, state, handlers, UI strings, test tags, child composables, and related tests without reading random whole files.

### Planned capabilities

#### Compose semantic artifact

Candidate artifact:

- `android-compose-semantic.json`

Extract conservative static facts:

- `@Composable` functions
- screen-level composables
- local composables
- `@Preview` functions
- child composable calls
- `remember` and `rememberSaveable` state
- `collectAsState` / `collectAsStateWithLifecycle` usage
- `LaunchedEffect` and `DisposableEffect` usage
- `Modifier.testTag` values
- visible text literals
- `stringResource` references
- click handlers
- navigation calls
- `Scaffold`, `LazyColumn`, `NavHost`, and major UI-region markers where detectable
- ViewModel references

#### Compose source retrieval

Candidate command shapes:

- `source --composable <name>`
- `source --composable <name> --include-compose-tree`
- `source --android-ui <text>`
- `source --test-tag <tag>`
- `slice --composable <name>`
- `slice --composable <name> --include-viewmodel`
- `slice --composable <name> --include-navigation`

#### Android test indexing

Index facts from:

- `test/` unit tests
- `androidTest/` instrumented tests
- Compose UI tests
- Espresso tests where detectable
- Robolectric tests where detectable

Extract:

- test class names
- test method names
- JUnit annotations
- Compose test rules
- visible text assertions
- test tag assertions
- route strings
- fake repositories
- mocked ViewModels or dependencies

#### Android graph views

Candidate graph views:

- `view --graph compose-ui`
- `view --graph compose-navigation`
- `view --graph android-test`

### Static boundaries

- no emulator execution
- no Compose runtime execution
- no proof that UI is visible at runtime
- no screenshot or accessibility-tree analysis
- no automatic test execution

## Version 1.12.0

Version 1.12.0 adds Android architecture classification and Android data-flow retrieval.

The goal is to help coding agents avoid wrong-layer edits in Android apps by identifying screens, state owners, data owners, persistence layers, network layers, resources, and tests.

### Planned classifications

Add Android-specific categories to classification metadata:

- Android project
- Gradle module
- app module
- library module
- Android manifest
- manifest component
- Activity
- Fragment
- Compose screen
- Compose UI component
- ViewModel
- UI state
- UI event
- navigation route
- repository
- use case
- Room entity
- Room DAO
- Room database
- Retrofit service
- Hilt module
- Worker
- resource file
- XML layout
- Compose UI test
- instrumented test
- Android unit test
- generated Android build file

### Planned edit guidance

Use existing edit-guidance concepts where possible:

- safe primary edit target
- inspect before edit
- avoid primary edit target
- read-only reference
- generated do not edit
- test only
- docs only
- uncertain

Android-specific risk labels may include:

- wrong-layer risk
- manifest-security-risk
- generated-build-file-risk
- resource-contract-risk
- navigation-contract-risk
- emulator-validation-required
- instrumented-test-required

### Android data-flow retrieval

Candidate slice modes:

- screen to ViewModel
- ViewModel to repository
- repository to DAO
- repository to Retrofit service
- route to screen
- manifest deep link to route/screen
- UI string or test tag to composable and test
- Room entity to DAO and repository

Candidate command shapes:

- `slice --composable <name> --include-viewmodel --include-repository`
- `slice --android-route <route> --include-screen --include-viewmodel --include-tests`
- `slice --room-entity <entity> --include-dao --include-repository`
- `search --android-role viewmodel`
- `search --android-role repository`

### Static boundaries

- Android classification remains advisory and static
- no runtime dependency injection resolution
- no database inspection
- no network inspection
- no emulator execution
- no guarantee that navigation or UI is reachable at runtime

## Version 1.13.0

Version 1.13.0 adds Android retrieval benchmarks, examples, and workflow documentation.

The goal is to make Android support testable, usable, and repeatable for real app-building workflows.

### Planned benchmark coverage

Representative Android tasks:

- add a new Compose screen
- modify an existing Compose screen
- trace a button test tag to its handler and ViewModel state
- trace a route to its composable and navigation declaration
- trace a UI string resource to composables and tests
- trace a ViewModel state field to UI rendering
- trace a repository call to Retrofit or Room
- modify a Room entity and find DAO/repository/test implications
- find manifest permissions and exported components
- distinguish screen UI from ViewModel state ownership
- avoid generated Gradle/build output
- retrieve Android unit tests and instrumented tests separately

### Planned examples

Example projects or fixtures:

- minimal Kotlin Android app fixture
- minimal Compose screen fixture
- Compose + ViewModel + Repository fixture
- Room entity/DAO fixture
- Retrofit service fixture
- manifest/deep-link fixture
- Compose UI test fixture

### Planned documentation

- Android quickstart
- Android indexing examples
- Android command examples
- Android static-analysis boundaries
- Android workflow examples for coding agents
- Android test retrieval examples
- Android wrong-layer edit examples

## Version 1.14.0

Version 1.14.0 broadens non-Android language and framework coverage after the Android foundation is in place.

The goal is to expand support while keeping static analysis conservative and adapter-based.

### Python improvements

Planned features:

- richer alias handling
- better cross-module call resolution
- better method-call resolution
- better class-member extraction
- better decorator metadata extraction
- better Django model extraction
- better SQLAlchemy model extraction
- FastAPI route extraction

### JavaScript improvements

Planned features:

- improved JSDoc type extraction
- better CommonJS handling where practical
- better mixed JavaScript and TypeScript project support
- better Express route extraction
- better NestJS decorator extraction where useful

### Framework improvements

Candidate framework targets:

- React
- Next.js
- Playwright
- Vitest
- NestJS
- Express
- FastAPI
- Django
- SQLAlchemy
- Prisma

### Additional future languages

Candidate future languages:

- Go
- Rust
- Java beyond Android use cases
- C#
- Kotlin beyond Android use cases

Additional language support should be added through language adapters rather than hardcoded into one scanner.

## Version 2.0.0

Version 2.0.0 focuses on a larger artifact and plugin model.

The goal is to expand the v1 CLI into a more extensible retrieval platform while preserving the core graph-guided workflow.

### Artifact schema v2

Candidate first-class node types:

- file
- symbol
- local function
- React component
- local React component tree
- hook
- state variable
- JSX branch
- UI string
- test block
- route
- storage key
- literal reference
- enum or union value reference
- React render region
- prop flow
- event handler flow
- data entity
- data field
- view model
- transformation step
- rendered field
- model-to-view lineage edge
- artifact type
- database model
- projection type
- graph-local evidence bundle
- Gradle module
- Android manifest component
- Android resource
- Android navigation route
- Kotlin symbol
- Java symbol
- Compose screen
- Compose UI component
- ViewModel
- Room entity
- DAO
- Retrofit service
- Android test block

### Plugin architecture

Candidate plugin categories:

- language plugins
- framework plugins
- test-framework plugins
- ORM plugins
- schema plugins
- mobile-platform plugins
- graph-view plugins
- retrieval-ranking plugins

### Retrieval API

Candidate command groups:

- `search`
- `lookup`
- `slice`
- `source`
- `source-bundle`
- `refs`
- `trace-props`
- `trace-events`
- `route-map`
- `ui-reachability`
- `storage-trace`
- `schema-classify`
- `data-model`
- `model-lineage`
- `model-view-trace`
- `graph-diff`
- `android-project`
- `android-manifest`
- `android-resources`
- `compose`
- `android-test`

### Compatibility

If artifact formats change, the release provides one of the following:

- a migration command
- a compatibility reader
- a documented version boundary
- a clear artifact regeneration path

## Ecosystem integration notes

`my-dev-kit` should provide Android artifacts and retrieval results that other tools can consume.

`my-dev-kit-orchestrator` should remain responsible for staged workflow control. Android support in the orchestrator should be added as workflow profiles or prompt modules that consume `my-dev-kit` Android artifacts. The orchestrator should not become the Android parser.

`my-dev-kit-lab` should remain responsible for security validation. Android security checks should consume target project files and `my-dev-kit` Android artifacts where useful, but they belong in the lab project rather than in the core indexing CLI.

Recommended ecosystem split for Android:

```text
my-dev-kit
  Android/Kotlin/Java/Gradle/Manifest/Compose indexing and retrieval

my-dev-kit-orchestrator
  Android-aware architecture-context, test-strategy, implementation, and verification profiles

my-dev-kit-lab
  Android security and release-risk validation profiles
```

## Long-term direction

`my-dev-kit` should remain local-first, deterministic, and inspectable.

The core product direction is:

- compact structural artifacts instead of raw context dumps
- graph-guided retrieval instead of full-file reads
- bounded source context instead of broad source injection
- source continuation and source bundles instead of full-file fallback
- classification metadata instead of wrong-layer edits
- model-to-view lineage instead of manual tracing from schemas to generated UI
- literal and reference tracing instead of full-file string hunting
- React render-flow retrieval instead of full-component reading
- local React prop and event-flow tracing instead of full-file component-tree reading
- Android project, Gradle, manifest, resource, Compose, and ViewModel-aware retrieval for mobile app work
- explicit fallback reporting instead of hidden assumptions
- conservative static analysis instead of overclaimed runtime understanding
- framework-aware retrieval where it improves real development workflows
- clear artifacts that can be inspected, versioned, and reused by humans or coding agents

The product should continue to work as a standalone CLI. Any future UI, hosted service, or agent integration should build on the same artifact model rather than replacing it.
