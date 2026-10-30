# Roadmap

## Overview

`my-dev-kit` is a CLI-first development context kit for indexing codebases, building graph artifacts, searching project structure, slicing relevant neighborhoods, and retrieving bounded source context for LLM-assisted development.

The product goal is simple: help developers understand large projects without reading whole files, broad folders, or unfiltered documentation — and support downstream tools and LLM-assisted workflows with deterministic, bounded local artifacts.

The stable v1 line is built around deterministic local artifacts and graph-guided retrieval:

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

### Planned capabilities

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

- default ignore rules for common generated folders
- `--exclude` support wherever an indexing or retrieval command scans the file tree
- `--dry-run` support for expensive commands
- progress reporting during indexing
- safe-maximum preflight warnings when a repository is large, so a large index run is never a silent surprise
- documentation for indexing large monorepos, including per-package `--src`/`--out` scoping guidance

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

### Planned capabilities

#### Index-first semantic architecture

- `index` runs semantic analyzers as part of the index run
- `manifest.json` is the authoritative artifact registry; it records all current artifact paths and analyzer status
- stale artifacts from previous runs are removed when `index` refreshes the artifact directory
- an analyzer registry in `manifest.json` records status, version, and artifact refs per analyzer

#### Semantic metadata contracts

- `semanticRoles` and `artifactRefs` arrays on symbols in `symbol-index.json`
- `semanticRoles` and `artifactRefs` arrays on symbol nodes in `code-graph.json`
- `evidenceRefs` collected from semantic roles for use in lookup output
- a semantic schema version with defined role names

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

### Planned capabilities

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

### Planned capabilities

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

### Future scope

- producer support for UI markers defined in local sub-components
- route-to-API-handler and access-policy relationships
- cookie storage key extraction

## Version 1.4.0

Version 1.4.0 adds source continuation and bounded local dependency expansion.

The goal is to reduce full-file reads when the correct file, symbol, or component is already known.

### Planned capabilities

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

### Architecture and compatibility constraints

- direct, same-file dependency resolution only
- no cross-file closure
- no runtime tracing
- no browser execution
- degraded or skipped frontend-specific expansion when frontend artifacts are unavailable

### Future scope

- cross-file dependency closure
- richer semantic type-checking for dependency detection
- bundle-quality benchmarks

## Version 1.5.0

Version 1.5.0 adds conservative static schema and layer classification, built on the existing artifact and command-integration model.

The goal is to help developers avoid editing the wrong layer by classifying files and symbols by their role in the project, and by surfacing conservative edit guidance, readiness, risk labels, evidence, and uncertainty through the existing retrieval commands without introducing a second retrieval system.

### Planned capabilities

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

### Architecture and compatibility constraints

- classification is derived only from source text, the existing graph, and existing artifacts
- no runtime execution
- no browser execution
- no database connection
- no LLM or network calls
- absence of `classification.json` never breaks existing retrieval commands
- classification guidance is advisory and evidence-backed, not an automatic edit decision

### Future scope

- task-specific context-report aggregation
- stronger cross-file classification signal aggregation
- additional categories only when real code evidence justifies them

## Version 1.6.0

Version 1.6.0 focuses on orchestrator-ready retrieval capsules and context packets.

The goal is not to replace `my-dev-kit-orchestrator`. The goal is to make `my-dev-kit` produce compact, task-specific retrieval outputs that the orchestrator can consume without raw graph dumps or full-file context.

### Planned capabilities

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

Planned modes are `general`, `feature-add`, and `subsystem`. They apply small deterministic ranking adjustments only; they do not control workflows or replace orchestrator stages.

### Architecture and compatibility constraints

- `my-dev-kit` produces capsules and audit records
- `my-dev-kit-orchestrator` remains the staged workflow controller
- no autonomous agent execution
- no automatic source modification

## Version 1.7.0

Version 1.7.0 defines an internal, developer-facing retrieval regression suite for `my-dev-kit` itself.

The goal is to prevent regressions in the bounded-context behavior introduced by v1.6.0 context capsules.

### Purpose

The suite should answer product-specific retrieval questions such as:

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

### Planned capabilities

#### Suite foundation

- TypeScript contracts for suite config/task/report/verdict shapes
- a config loader with clear validation errors
- a JSON and TXT report writer
- a runner reachable through `npm run benchmark:retrieval`
- an internal-only entry point, not a public CLI command, and not wired into `npm run verify` or CI

#### Execution core

- a fixture/source-root resolver with filesystem-safe task-ID and output-path handling
- per-task index preparation that reuses the existing `index` command implementation directly
- a context execution adapter that runs the real `context` command as a subprocess against each task's fresh index
- per-task `context-capsule.json`/`retrieval-audit-record.json`/`task-execution.json` artifacts
- a distinction between a task that executes without error and a task whose fixture/index/context step fails

#### Assertion and metrics engine

- a deterministic assertion engine that reads each task's generated capsule and audit record and evaluates configurable expectations for candidate files/nodes, focus, selected graph evidence, bounded source evidence, semantic/classification summaries, artifact references, conflicts, mode effects, audit steps (ordering and uniqueness), no-raw-content, cap compliance, and context adequacy
- a metrics engine that aggregates task/assertion counts and per-category pass rates deterministically, reporting `null` rather than a fabricated rate when a denominator is missing
- verdict logic where a task regresses when a required assertion fails, is blocked when execution or a required assertion could not be evaluated, and otherwise passes; the suite verdict is blocked if any task is blocked, else regressed if any task regressed, else passing
- `--fail-on-regression` and `--max-failures` options on the suite entry point, with a report always written regardless of exit behavior
- JSON and TXT reports that include assertion results, metrics, verdicts, and a compact failed-assertions-by-task summary, without inlining raw source, graph, capsule, audit, semantic, or classification content

#### Representative core suite

A representative deterministic local task set covering data-model feature-add, subsystem mode, no-source behavior, React/TSX retrieval, no-false-conflict behavior, and ambiguity, with audit, no-raw-content, caps, and adequacy expectations on every executable task.

Classification-absent behavior is exercised through assertion unit tests rather than as an executable task, since indexing always emits classification and the runner does not mutate generated artifacts.

`benchmark:retrieval` remains separate from `npm run verify`: it is a heavier subprocess-based maintainer check. Historical baseline comparison across runs is not part of this plan.

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

The assertion engine and representative suite remain deterministic and local:

- the right bounded context is retained for representative tasks
- retained and dropped reasons remain stable and explainable
- audit records remain complete and ordered
- no raw graph, source, semantic, or classification artifacts leak into normal outputs
- caps are enforced without hiding required evidence
- older-index compatibility stays intact when optional artifacts are absent
- full-file-read recommendations stay empty unless targeted retrieval is truly insufficient

### Planned metrics

Likely internal retrieval regression metrics include:

- selected file, node, edge, and source-slice counts
- retained-versus-dropped evidence counts
- conflict and ambiguity signal counts
- full-file recommendation counts
- compatibility warning counts
- fixture pass/fail summaries by retrieval behavior area

These are maintainer metrics for regression detection, not a public performance benchmark or hosted benchmark service.

### Entry point decision

The suite should prefer a maintainer or development entry point such as `npm run benchmark:retrieval`.

A public CLI command remains undecided. If a public command is ever added later, that should be justified by the implementation rather than assumed by the roadmap now.

### Boundary with my-dev-kit-lab

`my-dev-kit` should own the retrieval regression suite because it validates whether `my-dev-kit` retrieves the right bounded context from deterministic fixtures and protects context, search, slice, source, classification, and audit behavior from regressions.

`my-dev-kit-lab` should remain responsible for release readiness, security posture, dependency and package safety, and external release gates. It should not be the home for product-specific retrieval-quality assertions.

### Explicit exclusions

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

### Planned capabilities

#### Indexing ergonomics

- default ignores that also skip `.my-dev-kit` and any `.my-dev-kit-*` output directory, so `index` never re-scans its own or another `my-dev-kit` output directory
- a deterministic large-repo preflight step that reports advisory `preflightWarnings` (`{ code, message }`) on both `index` and `index --dry-run`, in a fixed order: a large-eligible-file-count warning and a broad-source-root warning; warnings never fail the command and never claim safety beyond static file-count evidence
- `index --dry-run` file-count estimation
- `--progress` progress reporting that keeps `--json` stdout parseable (diagnostics on stderr only)
- documentation for indexing large monorepos, covering per-package `--src`/`--out` scoping and using `--dry-run` before indexing an unfamiliar large repository

#### Incremental indexing

- `index --incremental`, comparing the current file set against internal cache metadata (a content hash per file plus a config fingerprint) and reporting a deterministic mode describing what happened (first run, incompatible/missing cache, changed config, no change, or change detected)
- `index --reset-cache`, which removes only the cache metadata from `--out` (never other artifacts) and reports what it did
- deterministic added/changed/removed/unchanged file classification, with bounded, sorted samples
- cache/config invalidation: a corrupt or incompatible cache, or a changed config fingerprint (source roots, `--exclude`, `--call-graph`, `--language`, or default-ignore rules), triggers a full rebuild with a reported invalidation reason rather than silently reusing a stale or incompatible cache
- `manifest.json` records the index mode and, on builds that ran, the cache mode/invalidation reason/changed-file summary; cache metadata itself remains internal bookkeeping, not a public semantic artifact
- partial rebuild for the core artifact pipeline: unchanged files' per-file analysis is reused rather than re-parsed, changed/added files are re-analyzed like a full build, and removed files are dropped from every affected artifact
- the file-dependency and symbol graph (and the code graph built from them) are always recomputed globally from the full merged file set on every partial rebuild, since import/re-export/export-all resolution depends on the complete current file set rather than only the files that changed; file and symbol node IDs stay stable for unchanged files because they are derived purely from path/name
- when a call graph is requested during a partial rebuild, it is always fully regenerated (call-graph extraction re-parses source text directly rather than deriving from cached per-file analysis) and reported honestly as an artifact fallback, never silently treated as reused
- semantic, data-model, frontend, and classification analyzers require no analyzer-specific partial-rebuild logic, since they already run over the complete current core index on every build
- when partial-rebuild reuse is not safely possible (a missing, unreadable, or schema-incompatible previous index), `--incremental` falls back honestly to a full rebuild with the reason recorded, rather than guessing or producing incorrect output

#### Graph diff

- a `graph-diff` command that performs a deterministic, read-only comparison of two existing index directories, reusing the stable node/edge identity the incremental-indexing plan establishes
- `graph-diff --before <index-dir> --after <index-dir> --json`, comparing the core manifest and code graph (required) and the optional semantic/classification/data-model/frontend artifacts (degrading gracefully when absent), and never running `index` or writing to either input directory
- node/edge diffing reuses the existing stable node/edge identity — no new comparison scheme
- `added`/`removed` reported as compact refs, `changed` reported only for the fields that actually differ, never a full node/edge dump
- a compact companion diff for the symbol index (added/removed/changed file paths and symbol ids), a fixed-field diff for the manifest, a per-entry diff for classification by its own stable id, and a safe summary-count-only diff for artifacts that lack a single stable per-entry identity
- a zero exit code for valid inputs whether or not differences are found; a non-zero exit with a clear error for invalid arguments, a missing index directory, or a malformed required artifact; a missing optional artifact never causes a non-zero exit, only a warning and an "unavailable" diff section

### Dependencies and ordering

1. indexing ergonomics and preflight safety
2. incremental indexing foundation (cache metadata, changed-file detection, invalidation)
3. partial artifact rebuild correctness for the core pipeline
4. graph-diff built on stable node/edge identity
5. search/lookup/slice filtering (future scope)

### Future scope

#### Watch mode

- watch source roots
- rebuild changed files
- update affected graph artifacts
- report changed nodes and edges
- keep output deterministic

#### Search and lookup filtering

- filter search by node kind
- filter search by symbol kind
- filter search by edge kind
- filter lookup output by edge kind
- filter graph slices by node and edge kinds

#### Deferred graph-diff scope

- a dedicated `call-graph.json` diff section (call-graph content is already reflected in `code-graph.json`'s call edges, so a separate section is not currently planned)
- partial (non-fallback) call-graph rebuild during incremental indexing

## Version 1.9.0

Version 1.9.0 starts Android support with Android project detection and Kotlin/Java structural indexing.

The goal is to let `my-dev-kit` recognize Android project structure and retrieve useful Kotlin/Java source context without rewriting the existing artifact model.

### Planned capabilities

#### Android project detection

Static, existence/substring-based detection against `--root` on every `index` run (no new flag) — never Gradle execution, never Kotlin/Java parsing:

- detect Android projects from Gradle files and Android manifests
- detect Gradle modules from `settings.gradle(.kts)` `include(...)` evidence
- distinguish app modules and library modules from Android plugin-id substring evidence
- detect source sets such as `main`, `test`, and `androidTest`
- detect Kotlin source roots
- detect Java source roots
- detect generated/build directories that should be ignored (`.gradle` added to default ignores; `build` already covered by existing depth-independent basename matching)
- Gradle version-catalog plugin-alias resolution remains excluded (only literal plugin-id substrings are recognized)
- custom Gradle `projectDir` remap support remains excluded (module paths follow the default Gradle directory convention)

Artifact:

- `android-project.json`, its own `artifactKind` and schema version, written only when Android evidence is found and registered in `manifest.json`'s `analyzers` array; a non-Android project is completely unaffected. Module summaries live directly inside this artifact rather than a separate module artifact.
- the incremental-indexing config fingerprint covers detected Android structure via an evidence fingerprint derived from the built artifact itself, so a Gradle/manifest edit that changes detected structure correctly invalidates the cache even though those files live outside `--src`
- `graph-diff` requires no Android-specific code: the existing generic analyzer-status diff already reports Android analyzer-status changes between two indexes

#### Kotlin structural indexing

- `.kt` file discovery under a requested `--src` root, indexed like `.ts`/`.js`/`.py` files through a language adapter registered in the existing language registry — no new indexing pipeline, no new command, no new flag
- a conservative, deterministic, line/regex-based extractor (not the Kotlin compiler): package declaration, imports (including wildcards), top-level class/data-class/sealed-class/interface/object/enum declarations, top-level functions (including extension functions), and top-level properties
- top-level declarations only, matching the existing TypeScript and Python precedent; member functions/properties and constructors are not extracted as separate symbols
- modifiers, `suspend`, extension receivers, annotations, and coroutine/`Flow`/`StateFlow` usage are surfaced through the existing signature text field rather than new schema fields
- one additional symbol kind (`object`) for Kotlin's singleton/namespace construct that doesn't map cleanly onto `class`
- import resolution is a best-effort heuristic based on a single-top-level-declaration-per-file convention; wildcard imports and multi-declaration files resolve to no target rather than guessing
- call-graph extraction is excluded for Kotlin, since trailing-lambda call syntax makes regex-based call detection unreliable
- `search`, `lookup`, `slice`, and `source` work on Kotlin file/symbol nodes with no new flags, since Kotlin symbols land in the same core artifacts
- incremental indexing and `graph-diff` remain fully compatible with no Kotlin-specific special-casing
- Kotlin source roots recorded by Android project detection remain informational only and never expand or override `--src`

#### Java structural indexing

- `.java` file discovery under a requested `--src` root, indexed like other languages through a dedicated language adapter — no new indexing pipeline, no new command, no new flag
- a conservative, deterministic, line/regex-based extractor mirroring the Kotlin adapter's design: package declaration, imports (including `static` and wildcard forms), and top-level class/interface/enum/record/annotation-type declarations
- top-level declarations only, matching the Kotlin and TypeScript/Python precedent; no method/field/constructor symbols
- modifiers, `extends`/`implements` targets, and annotations are surfaced through the existing signature text field rather than new schema fields
- zero new symbol-kind values: `record` maps to `class`, annotation types map to `interface`
- import resolution uses the same best-effort single-declaration-per-file heuristic as Kotlin; wildcard and static-wildcard imports resolve to no target
- call-graph extraction is excluded for Java, matching the Kotlin decision
- `search`, `lookup`, `slice`, and `source` work on Java file/symbol nodes with no new flags
- incremental indexing and `graph-diff` remain fully compatible with no Java-specific special-casing
- Android Java source roots remain informational only and never expand or override `--src`
- excluded from this plan: method/field/constructor symbols, Java call-graph edges, semantic type resolution, cross-file `extends`/`implements` resolution, and Maven/Gradle model parsing

#### Android component detection

Static detection for common Android classes and patterns, using annotation, superclass/interface, import, package/path, and naming-suffix evidence (naming alone is never sufficient for high confidence):

- `Activity`
- `Fragment`
- `ViewModel`
- `Service`
- `BroadcastReceiver`
- `ContentProvider`
- `Worker`
- repository classes (medium confidence ceiling, no annotation/superclass evidence tier)
- use-case classes (medium confidence ceiling)
- Room entities and DAOs when detectable by annotations
- Room databases when detectable by annotation or `RoomDatabase` superclass
- Retrofit services when detectable by annotations, via a small bounded scan of the interface body (HTTP method annotations live on methods, not the interface declaration)
- Hilt/Dagger modules when detectable by annotations
- Android component-role classification beyond this set of roles remains future scope

Artifact and compact metadata:

- `android-components.json`, an optional artifact written only when at least one role is detected, registered the same way `android-project`/`classification` are
- compact `androidComponentRoles`/`androidComponentRefs` fields added to symbol/graph records, following the same compact-projection-plus-artifact-ref pattern `classificationRoles`/`classificationRefs` established
- `search`, `lookup`, `slice`, and `source` surface role metadata with no new flags beyond one new indexed search field

### Dependencies and ordering

1. Android project/module/source-set detection foundation
2. Kotlin structural indexing
3. Java structural indexing
4. Android component-role detection
5. combined-fixture regression coverage proving Android, Kotlin, Java, and component-role evidence coexist correctly in one index alongside `search`/`lookup`/`source`/`slice`/`context`/`graph-diff`/`--incremental`

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

### Planned capabilities

#### Gradle project model

A detailed static Gradle project model, extending v1.9.0's Android/module/source-set detection foundation with plugins, dependencies, `android {}` configuration, and version-catalog evidence:

- settings evidence (`rootProject.name`, `include(...)`, `includeBuild(...)`, `project(...).projectDir` remaps)
- plugin evidence (`id(...)`, `apply plugin:`, version-catalog plugin aliases)
- dependency evidence (external-module/project/version-catalog-alias/platform/file/unknown, per configuration)
- `android {}` evidence (`namespace`, `compileSdk`, `applicationId`, `minSdk`, `targetSdk`, `versionCode`, `versionName`, `testInstrumentationRunner`, `buildFeatures`, `buildTypes`, `productFlavors`, `flavorDimensions`, source-set overrides)
- a bounded `gradle/libs.versions.toml` parser covering the TOML subset the file actually uses
- every SDK/config value is a resolved-literal-or-raw-unresolved-with-warning union: a dynamic expression is always preserved as raw source text with a warning, never guessed at
- the incremental-indexing config fingerprint covers detected Gradle evidence, so a settings/build/version-catalog edit that changes detected evidence invalidates the cache

Artifact:

- `android-gradle.json`, its own `artifactKind` and schema version, registered the same way the other Android analyzers are; `android-project.json` remains the coarse project/module/source-set summary, and `android-gradle.json` is a detailed layer built on the same module set

#### Manifest artifact

Static parsing for `AndroidManifest.xml`, using the module/source-set detection foundation and Gradle namespace/custom-manifest-path evidence:

- discovery across default source-set locations plus statically-visible custom Gradle manifest paths
- manifest merging is never simulated: every source-set manifest (`main`, `debug`, `release`, product flavors, `test`, `androidTest`, custom source sets) is parsed and preserved as its own independent record, including duplicate declarations across source sets
- package/namespace information, `uses-sdk`, `sharedUserId`, `installLocation`
- permissions (`uses-permission`, `uses-permission-sdk-23`, declared `permission`, `uses-feature`)
- the application declaration and its attributes
- activities, activity-aliases, services, receivers, and providers, with `exported` state reported only as an explicit `true`/`false`/`unspecified` value — never computed from platform-version/merging rules
- intent filters (actions, categories, data)
- application- and component-level metadata, including FileProvider-style references
- launcher and deep-link candidates from direct static intent-filter evidence only — no manifest-merging or build-variant resolution, no runtime reachability or domain-verification proof
- component names resolve against the manifest's own `package` attribute first, falling back to the Gradle namespace only when no `package` attribute exists — never against `applicationId`, never invented when neither base is available
- every non-string attribute value is a resolved-literal/resource-reference/placeholder/unresolved/absent union
- the incremental-indexing config fingerprint covers manifest evidence, so a manifest add/edit/delete, namespace change, or custom-manifest-path change invalidates the cache

Artifact:

- `android-manifest.json`, its own `artifactKind` and schema version, registered the same way the other Android analyzers are

#### Resource artifact

Static resource indexing, using the module/source-set detection foundation and Gradle resource-directory evidence:

- `res/values/` (strings, colors, styles/themes, bools, integers, dimens, fractions, plurals, arrays, attrs, declare-styleable, explicit-type items)
- `res/drawable/` and `res/mipmap/` — binary bitmap content is indexed by path/qualifier/extension only, never decoded
- `res/xml/`, including FileProvider paths and network-security config as specialized records
- `res/layout/` with declared IDs and `<include>`/`<fragment>` evidence
- conservative qualifier parsing (locale, night mode, API level, density, orientation, smallest-width/width/height), with unrecognized segments preserved rather than discarded
- resource merging, overlay precedence, and device-configuration matching are never simulated: every qualified directory/file across every source set is indexed and preserved independently, and duplicate logical resource names are never collapsed
- every resource reference is classified and given every statically-known local definition sharing its logical key, enumerated rather than resolved to one target
- navigation XML files are recorded only as a generic file-based resource at this layer — destination/action/argument navigation semantics belong to the navigation artifact below
- the incremental-indexing config fingerprint covers resource evidence, including a per-file content hash for binary resources so a binary edit still invalidates the cache

Artifact:

- `android-resources.json`, its own `artifactKind` and schema version, registered the same way the other Android analyzers are

#### Navigation artifact

Static parsing for Android navigation evidence, reusing the resource artifact's already-discovered navigation resource-file records plus narrowly-supported static Compose navigation routes from already-indexed Kotlin/Java source:

- root/nested XML navigation graphs, with `fragment`/`activity`/`dialog` destinations and unrecognized elements conservatively preserved as `custom`
- `<action>` with candidate destination/popUpTo enumeration and flags/animation references
- `<argument>` with classified default values
- `<deepLink>` with parsed scheme/host/placeholder evidence
- `<include>` with multi-candidate target resolution
- bounded static extraction of Compose navigation routes from `composable`/`navigation`/`dialog`/`activity`/`NavHost` calls — direct string literals, same-file constant resolution, and type-route arguments only; dynamic expressions are always left unresolved with a warning, never invented
- XML and Compose evidence are two clearly separated evidence kinds, never auto-linked from name/string similarity alone
- a direct screen candidate is recorded only when a route's content lambda is exactly one top-level PascalCase call with no control-flow keywords anywhere in the body; ambiguous content still produces route evidence but no screen candidate

Artifact:

- `android-navigation.json`, its own `artifactKind` and schema version, registered the same way the other Android analyzers are

#### Cross-artifact relationships

The six Android artifacts (Gradle, manifest, resources, navigation, plus v1.9.0's project and component-role artifacts) connect through compact, deterministic, conservative static graph relationships, integrated additively into `code-graph.json` rather than a new or parallel artifact:

- every relationship node reuses the stable ID its owning artifact already assigned; every source-side edge endpoint reuses the existing symbol- or file-kind node from structural indexing
- relationship families include: module-contains-source-set, manifest-declares-component, manifest-component-resolves-to-source (exact fully-qualified class name only, following `targetActivity` for activity-aliases), component-has-intent-filter, component/manifest-uses-permission (no security verdict drawn), resource-defined-in-file, source-references-resource (a bounded, comment/string-stripped `R.type.name` scan of indexed Kotlin/Java source; framework `android.R.*` references are always skipped), navigation-graph-contains-destination, navigation-destination-has-action, navigation-action-targets/pop-up-to-destination, navigation-graph-includes-graph, navigation-destination-has-deep-link, manifest-deep-link-matches-navigation-deep-link (exact scheme/host/port/path only), navigation-destination-resolves-to-screen, and compose-route-resolves-to-screen
- every one-to-many static match (multiple candidate classes, resource definitions, navigation targets, or screen functions) is enumerated as one edge per candidate, never narrowed to a single runtime winner
- registered in `manifest.json`'s `analyzers` array with no new top-level artifact file, since it enriches `code-graph.json` in place
- `graph-diff` requires no relationship-specific code, since it already diffs graph nodes/edges purely by stable ID equality

#### Command integration

The Android evidence and relationships surface through the existing `search`, `lookup`, `source`, `slice`, `context`, and `view` command families — no new top-level command, no second retrieval runtime, no second graph:

- `search --android-route <route>`, `search --permission <permission>`, `search --resource <name>`, `search --android-component <name>` (each mutually exclusive with `--query` and the existing reachability selectors)
- `lookup --android-component <name>`, returning `found`/`not-found`/`ambiguous` with detailed component evidence on a unique match
- `source --android-route <route>`, `source --resource <name>`, retrieving a bounded excerpt via the resolved node's own path/line; binary resources return metadata only, never decoded content; multiple exact candidates return `ambiguous` with every candidate ID rather than a chosen winner
- `slice --android-route <route>`, `slice --android-component <name>`, resolving a unique root and then calling the unmodified graph-slicing engine — identical depth/direction/edge-kind/cap behavior to `--node`
- `view --graph android-module`, `view --graph android-manifest`, `view --graph android-navigation`, each rendering the existing code graph filtered to a relevant Android node-kind seed set expanded one hop across a fixed, named set of relationship edges — the existing DOT/SVG/PNG renderer, no second renderer
- `context` requires no new command or flag: Android nodes participate in the same searchable/candidate-ranking pipeline as file/symbol nodes, so a route/permission/resource/component-shaped query can select an Android node as focus, expand across real relationship edges, and attach bounded source evidence for it

### Dependencies and ordering

1. Gradle project model
2. manifest artifact
3. resource artifact
4. navigation artifact
5. cross-artifact relationships integrated into the code graph
6. command integration across `search`/`lookup`/`source`/`slice`/`view`/`context`
7. combined-fixture integration and regression coverage across the full Android/Kotlin/Java/Gradle/manifest/resource/navigation/relationship surface

### Static boundaries

- no Gradle build execution
- no dependency downloads
- no runtime intent resolution
- no proof that a deep link works at runtime
- no Play Store or signing validation

## Version 1.10.1

Version 1.10.1 extends the existing context architecture with deterministic role-specific repository-evidence retrieval and honest bounded evidence reporting. It is a bounded patch on top of the v1.10.0 baseline and does not replace, reduce, reorder, or postpone any scope assigned to v1.11.0, v1.12.0, v1.13.0, v1.14.0, or v2.0.0.

### Goal

Architecture context is normally retrieved before behavior and implementation planning. Production code can change after that retrieval, making the initial packet stale for implementation or test writing. Architecture planning, production implementation, and test implementation also require materially different evidence; one broad packet either omits critical contracts or includes too much unrelated repository content.

The v1.10.1 goal is to let callers refresh role-specific context while preserving existing behavior:

- **architecture** asks where behavior should live and retrieves owners, extension points, public contracts, structural neighbors, and architecture tests;
- **implementation** asks what exact current code must change or be preserved and retrieves owners, callers/callees, validators, constants, defaults, limits, errors, serializers, schemas, compatibility surfaces, and closest tests;
- **test-implementation** asks how approved test responsibilities should be implemented against final production code and retrieves changed production files/symbols, graph-diff evidence, branches and side-effect boundaries where statically represented, existing tests, fixtures, factories, mocks, setup, configuration, commands, and responsibility mappings.

The result must avoid both context extremes: generic instructions without repository/test evidence, and repository-wide dumps, unbounded graph output, whole libraries, or unrelated artifacts. Output must be role-specific, fresh when provable, bounded, deterministic, inspectable, auditable, and explicit when required evidence is inadequate.

### Current architecture extended

The plan extends current owners rather than creating parallel systems:

- `src/commands/contextCommand.ts` owns context CLI parsing and coordinates search, focus, graph, source, capsule, and audit output.
- `src/context/types.ts` owns the context capsule request contract, extended with role, structured request, changed surface, before/after index, and test-responsibility references.
- `src/context/candidateRanking.ts` and `src/search/rankSearchResults.ts` own deterministic ranking and stable ties; no separate candidate-provider registry is introduced.
- `src/context/graphFocus.ts`, `src/context/graphSelection.ts`, and `src/graph/sliceGraph.ts` own focus ambiguity and capped deterministic graph expansion.
- `src/context/sourceSelection.ts` and `src/context/sourceBundles.ts` own bounded source ranges, continuation, dependency bundles, and skipped-source warnings.
- Budgets are count, graph-cap, source-line, and bundle based. Exact model-token budgeting is not part of this plan and must not be claimed.
- `src/context/contextCapsule.ts` and `src/context/retrievalAuditRecord.ts` own capsule/audit serialization on a stable additive schema.
- `src/graph-diff/buildSymbolIndexDiff.ts` returns sorted added/removed/changed files and symbols and is the preferred before/after changed-surface source.
- Existing indexing, manifest, cache-metadata, and partial-rebuild owners remain authoritative. v1.10.1 does not create a second context index.

Test files receive general test/fixture classification; fixtures, factories, mocks, setup files, and package scripts are separately modeled by this plan through bounded discovery over existing classifications, paths, imports/graph evidence, package configuration, and test configuration. A major index schema change is not part of this patch.

### Planned capabilities

#### Request and role contracts

- `ContextRole` (`architecture`/`implementation`/`test-implementation`), orthogonal to the existing `general`/`feature-add`/`subsystem` modes: neither overwrites the other
- a structured, schema-versioned `ContextRequest` JSON contract, supplied via `context --request <path>` and validated before any capsule or audit file is written
- `context --role <role>` as the CLI-equivalent shorthand for the request file's `role` field
- deterministic CLI/request-file normalization: when the same field is supplied on both the CLI and in a request file, equivalent normalized values are accepted and conflicting values fail with a diagnostic naming both sources
- structural validation of every optional field (`focusFiles`, `focusSymbols`, `changedFiles`/`changedSymbols`, `beforeIndex`/`afterIndex`, `testResponsibilityRefs`, `requestedEvidenceKinds`, `limits`), rejecting malformed JSON, unsupported schema majors, unknown roles/evidence kinds, conflicting values, missing required index pairs, and invalid limits/paths
- full legacy compatibility: every pre-1.10.1 `context` invocation continues to work identically without `--request`/`--role`

#### Role-aware evidence retrieval

- role changes candidate priorities: architecture favors owner-like candidates (command handlers, registries/dispatchers, adapters, analyzers, builders) and public contracts; implementation favors an exact focus symbol, its direct dependencies, and validator/schema/error/constant contracts; test-implementation favors changed production files/symbols and their closest tests
- `focusFiles`/`focusSymbols` resolve against the active index; an unresolved focus is reported rather than invented, and an ambiguous simple-name match is reported as ambiguous rather than guessed
- `changedFiles`/`changedSymbols` (caller-supplied) and `beforeIndex`/`afterIndex` (graph-diff evidence, reusing the existing symbol-index diff rather than a second comparison) merge into one deterministic changed-surface model with a status (added/modified/removed/unknown) and provenance (caller/graph-diff/both) per entry; removed symbols are preserved as changed-surface evidence, never discarded
- `requestedEvidenceKinds` constrains and prioritizes the evidence categories a role surfaces from a fixed, documented set (owner, dependencies, contracts, validators, constants, errors, schemas, callers, callees, closest-tests, test-infrastructure, test-commands, changed-surface, responsibility-mappings); an unrecognized entry fails validation rather than being silently accepted
- ranking stays deterministic and bounded: role/focus/changed-surface adjustments never bypass the existing candidate/graph/source caps, and ties always break on stable candidate ID/path

#### Evidence groups and test infrastructure

- role-ranked evidence organizes into deterministic, bounded, named groups: architecture groups owners, extension points, contracts, the graph neighborhood, and architecture tests; implementation groups owners, dependencies, callers/callees, contracts, validators/constants, errors, schemas/serializers, compatibility surfaces, and closest tests; test-implementation groups the changed surface, production symbols, validators/boundaries, errors/side-effects, related tests, fixtures, factories, mocks, setup/configuration, and test commands
- each group carries a fixed internal capacity, an available/used/dropped count, and a truncated flag for auditable, deterministic (sort-before-truncate) caps; a request with no role keeps evidence groups empty, matching legacy behavior exactly
- cross-group rollups (selected owners, selected contracts, selected tests) deduplicate evidence that appears in more than one group
- because the indexer excludes test-path files from the core symbol index/code graph by default, related-test discovery performs a bounded, read-only directory walk plus a lightweight, bounded, regex-based import-specifier scan — never a second index and never an execution of the scanned file; a test file becomes "related" only when it imports a file or named symbol of interest, and a fixture/factory/mock is only reported when a discovered related test actually imports it
- a naming-convention match alone (for example a file merely named like a "builder" or "factory") is never treated as selected evidence without backing graph, import, or classification evidence — this conservative evidence boundary is intentional, not a gap to close later
- supported test configuration files (Vitest/Vite `test:` blocks) are parsed for `include`/`exclude`/`setupFiles`/`testTimeout`/`hookTimeout`/`maxWorkers`/`environment` via bounded regex extraction, never evaluated as code; other detected configuration formats are reported as unsupported rather than silently treated as understood, and multiple detected configuration files are all reported rather than arbitrarily narrowed to one
- package scripts matching a test/verification-relevant naming convention are surfaced, and an exact test command is derived only when a supported runner invocation and at least one related test are both available; otherwise the gap is reported as unresolved rather than an invented command

#### Test-responsibility mapping and oracle evidence

- callers provide stable responsibility references; free-form prose is never reported as fully mapped
- each mapping connects a responsibility to grounded static evidence only (changed/focus symbols, evidence-group membership, bounded test-infrastructure discovery) — never LLM reasoning, embedding similarity, or fuzzy filename matching
- mapping status is mapped, partially mapped, unmapped, or not-applicable (not-applicable only ever from an explicit caller flag, never inferred)
- duplicate responsibility references are rejected with the first occurrence winning; unknown/unresolvable references are reported rather than silently dropped
- criticality is caller-supplied per responsibility and defaults to noncritical when the request contract cannot express it; a critical, unmapped responsibility always makes the role inadequate, while a noncritical gap only warns
- test-focused evidence supports exact return/final/persisted state, error type/diagnostic/exit code, required and forbidden side effects, cleanup/rollback, idempotency/retry, and artifact-shape assertions; `my-dev-kit` retrieves evidence and does not write tests or use LLM reasoning to decide assertions

#### Role adequacy

- role adequacy extends, rather than replaces, the existing context-adequacy verdict
- nonempty evidence is never automatically treated as adequate: architecture requires a plausible owner and relevant contract/extension-point evidence; implementation additionally requires contract evidence and no critical unresolved requirement; test-implementation additionally requires changed-surface evidence, a related-test-or-explicit-missing-test state, and every critical responsibility mapped
- a request with no role carries the existing adequacy verdict forward unchanged and reports role adequacy as not applicable

#### Freshness

- freshness classifies as fresh, stale, or unknown; an index directory existing is never treated as proof of freshness by itself
- fresh only when the active index matches a supplied `afterIndex`; stale only when it matches a supplied `beforeIndex` while relevant changed-surface evidence exists; otherwise unknown
- repository state evidence (for example a repository commit identity) is read read-only and optionally, wrapped so a missing or absent source control system never throws, and recorded as informational evidence only
- before/after indexes and changed files/symbols remain the primary supported freshness evidence; no unsupported freshness claim is made

#### Boundedness and reporting

- candidate limits, graph depth/node/edge limits, file/symbol limits, source-range and source-line limits, character limits, evidence-group-entry limits, full-file-fallback limits, and responsibility-mapping limits are all declared and reported alongside their used/available/dropped counts
- `limits.responsibilityMappings` is an enforcing limit: it actually caps how many responsibility mappings are produced, truncating deterministically critical-first (a critical responsibility can only be dropped once every critical one already exceeds the limit)
- `limits.evidenceGroupEntries` is an enforcing positive per-group limit. When absent, historical group defaults apply; when present, its normalized value replaces every applicable bounded group's default and is reported with the applied group limits.
- truncation is always reported with dropped counts, whether required evidence was lost, and the resulting adequacy impact
- full-file fallback remains exceptional: it is attempted only for contract/validator/error evidence a responsibility mapping needed but no selected source slice covered, it records line/character counts rather than the file content itself, a fallback limit of zero disables it entirely while still reporting the disallowed need honestly, and a positive limit deterministically caps the fallback count

#### Provenance and audit agreement

- the capsule and the retrieval audit share consistent selection facts: included and excluded evidence are both explained, fallback use is audited, truncation is audited, and unresolved evidence is explicit
- every owner/contract/test/changed-surface/responsibility-mapping evidence item is classified into a stable provenance category (for example caller-changed-file, graph-diff, code-graph, import-scan, test-configuration, package-json) with a deterministic ID; evidence reachable through more than one source merges its provenance rather than duplicating the evidence item

#### Determinism

- identical index, request, role, mode, limits, focus, changed surface, and source state produce identical selection, ranking, groups, warnings, adequacy, truncation, capsule, and audit output, excluding only normalized existing nondeterministic metadata (such as generation timestamps)
- stable ties, normalized paths, stable serialization, and no filesystem-order dependence apply throughout
- before/after graph-diff evidence stays consistent with `graph-diff`'s own comparison behavior
- capsule and audit JSON remain safe for stdout parsing

### Architecture and compatibility constraints

- no second search engine, no second graph engine, no second index
- no workflow-catalog ownership, no native orchestrator execution, no lab runtime, no LLM ranking
- no automatic source editing, no automatic test writing
- no security or release responsibility
- existing context usage remains compatible without new options; new capsule/audit fields are additive
- `my-dev-kit-orchestrator` owns workflow/stage/command/rule/report-contract IDs, workflow selection and dependency resolution, prompt assembly, stage order and lifecycle, correction/judge handling, and publication authorization; its integration with role-specific context remains manual/prompt-guided rather than a native automatic execution path
- `my-dev-kit-lab` owns controlled strategy experiments, context-quality evaluation, security validation, and code-rot auditing, and is not a production context runtime
- `ContextRequest`, context capsules, and retrieval audits are `my-dev-kit` contracts; the orchestrator's workflow instruction packet and stage context bundle are separate contracts; no shared package is required between the two projects

### Explicit exclusions

v1.10.1 does not implement workflow catalog semantics/selection, stage order, orchestrator instruction packets, prompt assembly, native orchestrator stages/execution, artifact lifecycle, judge routing, publication authorization, automatic source/test editing, LLM ranking/mapping, subjective grading, complete semantic fixture/mock/factory indexing, exact model tokenization, shared schemas, a public plugin architecture, security validation, runtime Android behavior, or release actions.

### Validation expectations

Behavior-derived validation covers: request normalization and error handling; role/mode independence; owner selection and ambiguity; candidate ranking and stable ties; changed files/symbols and graph-diff intake; evidence groups and missing-evidence handling; responsibility states and critical inadequacy; role adequacy, including nonempty-but-inadequate output; fresh/stale/unknown evidence; every cap/truncation/fallback path; existing command/artifact/index compatibility; repeated deterministic output; and cross-platform path behavior (Windows/Linux/macOS).

Relevant validation commands include typecheck, the focused context test suite, the broader test suite, the documentation checks, the retrieval regression benchmark, and a package dry run. Request-file, per-role, JSON-output, capsule/audit inspection, before/after-index, missing-evidence, tiny-budget, and stale-context scenarios all warrant smoke-level coverage. A validation command that does not exist yet must not be documented as available.

### Dependencies and ordering

1. establish request and role contracts
2. apply role-aware candidate selection and ranking
3. assemble evidence groups and test infrastructure discovery
4. derive responsibility mappings, adequacy, freshness, and provenance
5. validate compatibility, determinism, and regression behavior
6. reconcile documentation before release work

### Acceptance criteria

- Existing context behavior remains compatible without new options.
- All three roles produce deterministic, bounded, inspectable evidence using existing search/graph/source/index owners.
- Changed files/symbols and before/after graph-diff evidence are accepted without a second diff/index system.
- Required missing evidence, truncation, full-file fallback, and fresh/stale/unknown state are explicit and affect adequacy honestly.
- Structured responsibility mappings never claim unsupported completeness.
- Capsule/audit evolution is additive and existing consumers remain readable.
- No workflow-catalog, orchestrator runtime, lab runtime, LLM, security, editing, or publication responsibility enters `my-dev-kit`.
- Compatibility, determinism, boundedness, incremental, benchmark, package, documentation, and cross-platform validation pass.
- v1.11.0 through v2.0.0 remain present and retain their existing scope.

### Stop conditions

Architecture approval should be sought before implementing any of: breaking CLI defaults, a major capsule/audit/manifest schema change, a second search/graph/index engine, unprovable freshness presented as fact, evidence-free responsibility completeness, native orchestrator execution, a shared package, or movement of later roadmap scope.

## Version 1.10.2

**Status: published.**

Version 1.10.2 is a documentation-only corrective patch. It replaces stale v1.10.1 release-state wording and strengthens the release guide's final-document-state checks. It does not change runtime, CLI, artifact, schema, or retrieval behavior.

## Version 1.10.3

**Status: published.**

### Goal

Correct implementation-role context readiness so structurally credible owners are retained, false owners are rejected, required evidence uses available bounded capacity before truncation, duplicate responsibility IDs remain observable, and directed file-level dependency/caller evidence is classified correctly without changing schema major 1 or weakening genuine readiness blockers.

### Compatibility boundaries

- `ContextRequest`, context capsules, and retrieval-audit records remain schema major `1`; the current artifact schema version remains `"1.0.0"`.
- Existing `context` syntax, modes, roles, requested-evidence kinds, and legacy no-role behavior remain unchanged.
- `limits.evidenceGroupEntries` is enforced per applicable group; the historical implementation required-evidence bound remains the default only when the field is absent.
- Responsibility criticality remains outside the string-only `testResponsibilityRefs` request field; this patch does not add a new criticality contract.
- my-dev-kit remains a local, read-only, deterministic static-evidence producer. The current orchestrator does not automatically invoke it.

### Exclusions and deferred ecosystem work

Version 1.10.3 does not add runtime proof, LLM-based owner selection, automatic source or test editing, automatic orchestrator integration, orchestrator contradiction/identity enforcement, supplemental packet/report reconciliation, lab owner/allocation/readiness metrics, or release actions. Separate orchestrator and lab corrective patches remain ecosystem work and are not my-dev-kit features.

### Validation expectations

Behavior-derived validation covers neutral and false-owner cases, deterministic multiple-owner ordering, required-first allocation and spillover, finite aggregate bounds and genuine overflow, additive allocation diagnostics, duplicate/unknown responsibility diagnostics and first-occurrence mapping order, directed file-level dependency/caller identity, capsule/audit parity, legacy schema-major-1 compatibility, deterministic output, focused context regression suites, full tests, typecheck, build, documentation checks, retrieval benchmarks, and package verification.

## Version 1.10.4

**Status: published.**

Version 1.10.4 corrects false-negative implementation-role adequacy by adding deterministic required-condition witness coverage and separating optional surplus omission from allocation-caused loss of required evidence. It preserves the existing bounded allocation, group reservations, deterministic spillover, ranking, command syntax, and schema major `1`.

The patch is limited to the my-dev-kit producer contract, condition-aware omission/truncation diagnostics, role adequacy, capsule/audit agreement, legacy compatibility, and permanent producer regression coverage. It does not implement orchestrator readiness/recovery/lifecycle enforcement, judge or final-report enforcement, lab cross-system agreement validation, Compose retrieval, release actions, or publication.

## Version 1.11.0

**Status: published.**

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

**Status: published.**

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

## Version 1.12.1

**Status: published.**

Version 1.12.1 is a bounded corrective patch for architecture evidence allocation and required-witness adequacy. It makes a positive explicit `limits.evidenceGroupEntries` value enforce the maximum retained entries per applicable bounded evidence group while preserving historical defaults when absent, distinguishes optional or redundant omission from allocation-caused loss of the final required witness, and keeps capsule/audit limit and condition evidence in schema-major-1 parity.

The patch adds no command, flag, role, artifact family, runtime analysis, freshness behavior, closest-test behavior, or v1.13.0 benchmark scope. Genuine missing evidence, final-witness loss, unpreserved material ambiguity, missing provenance, unresolved material conflict, and capsule/audit disagreement remain fail-closed.

## Version 1.12.2

**Status: published.**

Version 1.12.2 is a bounded corrective patch enabling NodeNext/Node16-style relative `.js` test imports to resolve to corresponding `.ts` / `.tsx` production sources for related-test discovery (`.jsx` → `.tsx`). Literal real `.js`/`.jsx` files retain precedence when present. Unsupported `.mjs`/`.cjs` families remain unmapped. Extensionless, index, and bare package import behavior is unchanged. This is a backward-compatible defect correction; no new public command, artifact schema major, or v1.13.0 capability. v1.13.0 remains separate planned scope.

## Version 1.12.3

**Status: published.**

Version 1.12.3 is a bounded corrective patch for false context-readiness blockers in the existing role-specific `context` workflow. It addresses cases where a low-level retrieval or classification limitation is treated as proof that the repository lacks required context even after stronger, grounded role evidence has satisfied the actual requirements for the current stage.

The goal is to make final role readiness depend on the evidence genuinely required for that role while preserving conservative failure when required evidence is actually missing. The patch must not weaken real blockers or pull v1.13.0 Android benchmark, example, or workflow-documentation scope forward.

### Shipped corrections

#### Recoverable role adequacy

- preserve base context-adequacy diagnostics, including failed source selection, without making every base failure an irreversible floor for role-specific readiness
- derive the final role status from the role's required conditions and critical unresolved evidence rather than from downgrade-only inheritance
- allow an implementation role to become sufficient when the retained evidence independently satisfies the required owner, contract, source/evidence, freshness, and unresolved-requirement conditions even if the initially selected primary focus produced no source slice
- keep genuinely required missing source evidence, required-evidence truncation, unresolved material conflict, and other real role-condition failures blocking
- preserve supported `--no-source` behavior and do not treat zero source slices as inherently incompatible with sufficient role context
- when source evidence is required, evaluate primary-focus selection together with source retrievability so an unsuitable top-ranked focus can be reported, skipped for source purposes, or followed by another suitable retained candidate rather than converted automatically into a global readiness failure

#### Structure-aware contract evidence

- correct implementation-contract discovery so grounded contract, validator, result-shape, case-definition, error, schema, or equivalent evidence is not rejected solely because the owning filename lacks words such as `type`, `schema`, `valid`, `constant`, or `error`
- use indexed symbols, graph relationships, classification/evidence-group information, source evidence, and other existing grounded signals before filename hints
- retain conservative behavior: neutral filenames alone do not prove contract ownership, fuzzy filename similarity does not become evidence, and ambiguity remains explicit
- add Python regression coverage with legitimate neutral owners such as `result.py` and `cases.py` so fake compatibility files or artificial witness files are never required to make real contracts selectable

#### Test-responsibility mapping semantics

- distinguish core evidence needed to understand and implement a test responsibility from supplemental execution metadata
- for the existing `test-implementation` role, treat grounded production-symbol evidence, contract/validator/error evidence, related or proposed test evidence, and oracle/assertion evidence as the core mapping requirements
- do not make `testCommands` universally mandatory when the core responsibility evidence is already present and the request does not specifically require test-command evidence
- when core evidence is complete but no test command is discovered, keep the responsibility sufficiently mapped and report an explicit warning that the execution command was not discovered
- when core production, contract, test, or oracle evidence is genuinely absent, keep the responsibility partially mapped or unmapped and preserve the existing fail-closed behavior for critical responsibilities
- preserve test-command evidence as useful supporting execution evidence and as required evidence when the request explicitly asks for the `test-commands` evidence kind

#### Python test-command discovery audit

- audit the existing `testInfrastructure.testCommands` discovery path for Python repositories instead of assuming that pytest support is absent
- evaluate grounded command evidence from supported repository metadata and execution surfaces such as `pyproject.toml`, `pytest.ini`, `tox.ini`, `noxfile.py`, `Makefile`, CI configuration, verifier/task scripts, Docker or shell entry points, and documented runner scripts where the existing architecture can consume them safely
- implement only confirmed discovery gaps needed to support real repositories and the new regression fixtures
- preserve provenance for every discovered command and never fabricate a command merely to satisfy readiness
- do not add a caller-injected command escape hatch in this patch unless it can be represented through the existing schema without weakening provenance or trust boundaries

#### Readiness consistency

- prevent contradictory output where role adequacy is sufficient with no missing or blocking conditions while every critical responsibility remains incomplete solely because optional metadata is absent
- keep `roleAdequacy.status`, `missingConditions`, `blockingConditions`, responsibility mappings, truncation impact, capsule output, retrieval-audit output, and downstream-consumer readiness evidence mutually consistent
- distinguish "my-dev-kit failed to classify or discover one evidence form" from "the repository lacks evidence required to perform the current task safely"
- surface classifier or discovery limitations as warnings or targeted evidence gaps unless the missing evidence is actually required for the current role

### Implementation sequence

1. freeze direct regressions for the zero-source primary-focus failure, neutral-filename contract false negative, and four-of-five responsibility-mapping failure
2. correct final role-adequacy evaluation so later grounded role evidence can recover from non-material base-layer failures
3. correct contract evidence selection so structural evidence can establish legitimate neutral-named owners without broad fuzzy matching
4. separate core responsibility evidence from supplemental test-command metadata and make requested evidence requirements explicit
5. audit Python test-command discovery and add only confirmed, provenance-preserving coverage gaps
6. enforce consistency across role adequacy, responsibility mappings, capsule/audit output, and downstream readiness inputs
7. extend focused context tests and `benchmark:retrieval` coverage, then reconcile documentation before release work

### Required regression coverage

- primary ranked focus cannot produce a source slice, another retained owner/source satisfies the role, all required implementation conditions are satisfied, freshness is fresh: role readiness is sufficient
- genuinely required source evidence is missing: readiness remains insufficient
- `--no-source` remains supported
- real required-evidence truncation still blocks when the final required witness is lost
- legitimate Python contract owners use neutral filenames such as `result.py` and `cases.py`: contract evidence is still found through grounded structure
- critical test responsibility has production, contract/validator, related-test, and oracle evidence but no discovered test command: mapping is sufficient with an explicit warning when test-command evidence was not requested
- a real pytest command is discoverable: command evidence is populated with provenance and the responsibility remains mapped
- production, test, contract, or oracle evidence is genuinely missing: critical responsibility remains incomplete and readiness blocks
- role adequacy, missing/blocking conditions, responsibility status, capsule, and audit do not report mutually contradictory readiness
- repeated runs remain deterministic and schema-major-1 compatible

### Compatibility boundaries

- no new public command, flag, role, artifact family, or artifact schema major
- existing `ContextRequest`, context-capsule, and retrieval-audit schema-major-1 compatibility remains intact
- no weakening of genuine missing-evidence, ambiguity, conflict, freshness, truncation, or critical-responsibility blockers
- no automatic test execution, runtime proof, LLM reasoning, source editing, or orchestrator execution enters `my-dev-kit`
- broad Python language/framework improvements remain assigned to v1.14.0; this patch may only improve test-command discovery where a concrete existing-workflow defect is confirmed
- v1.13.0 remains the separate Android retrieval benchmark, examples, and workflow-documentation milestone and retains its existing scope

### Acceptance criteria

- the reproduced FULL_STAGE_CONTEXT false blockers no longer occur when all role-required grounded evidence is present
- a failed helper classifier or source-selection attempt cannot by itself override stronger role evidence unless the missing evidence is required for that role
- critical responsibility mapping no longer depends universally on a statically discovered test-command string
- missing optional execution metadata produces a clear warning rather than a false hard blocker
- genuinely missing critical evidence continues to fail closed
- neutral-named Python contract owners are discoverable from grounded structural evidence without fake files, renaming, or fuzzy guessing
- capsule and retrieval-audit readiness facts remain in parity and deterministic across repeated runs
- focused context tests, the full test suite, typecheck, build, documentation checks, retrieval regression benchmarks, package verification, and cross-platform validation pass before release preparation

## Version 1.12.4

**Status: published.**

Version 1.12.4 is a bounded corrective patch for core test-file indexing and retrieval. Supported `.test.` / `.spec.` files beneath explicitly selected `--src` roots now participate in the ordinary core indexing and retrieval surfaces instead of being dropped by a default filename-pattern exclusion. Earlier roadmap text that describes test-path files as excluded from the core symbol index/code graph (for example the v1.10.1 test-infrastructure design) records the behavior of those versions.

### Corrected behavior

- supported test-shaped files (`.test.` / `.spec.` with `.ts`, `.tsx`, `.js`, `.jsx`, or another registry-supported extension) beneath a selected source root are core-index eligible; only `.d.ts` declaration files remain excluded by default filename pattern
- indexed test files receive ordinary `file:<path>` nodes, symbols, and import edges in the existing symbol index and code graph, with no test-specific namespace or second graph
- `search` consumes that normal indexed evidence (file paths, declared symbols, and existing frontend-test titles) through its existing relevance ranking
- exact `source --contains "<literal>" --path "<test-path-prefix>"` matches text in indexed test files
- `lookup --node file:<test-path>` and `slice --node file:<test-path>` operate through the existing graph
- the incremental configuration fingerprint includes the default file-exclusion policy, so a cache written under the earlier policy is rebuilt as a configuration change rather than reused as equivalent
- frontend-test semantic extraction (`describe`/`it`/`test` titles, UI strings, locators) runs over the newly indexed test files once per file, as enrichment rather than as the admission mechanism
- the bounded `testInfrastructureDiscovery` directory walk remains available as compatibility/additional discovery for test infrastructure and related-test evidence

### Compatibility boundaries

- user `--exclude` values and default ignored directories remain authoritative; no scanning outside the selected roots
- no new command, flag, artifact family, graph, or artifact schema major; existing artifact types gain a broader producer file set
- no search ranking redesign, production-first raw-search preference, or arbitrary raw full-text search engine; raw search rank remains relevance evidence, not edit ownership
- no context role, owner-selection, or adequacy redesign
- indexing a test file is static evidence only; no test execution, runtime proof, or coverage claim
- no v1.13.0 Android benchmark, example, or workflow-documentation work and no v1.14.0 Python classifier expansion

### Acceptance criteria

- test files beneath a selected root appear in `symbol-index.json` and as `file:<path>` code-graph nodes; `.d.ts`, user-excluded, and default-ignored files do not
- `source --contains --path`, `lookup`, `slice`, and `search` return evidence for indexed test files, while production-file results remain unchanged
- a cache built under the earlier exclusion policy triggers a full configuration-changed rebuild, followed by a no-change run
- frontend-test semantic entries and graph node identities remain unique; context test-implementation output remains grounded in the changed production surface
- an external five-file reproduction against a real multi-root repository passes indexing, lookup, slice, exact-text, and file-source checks for all five previously unreachable test files
- focused tests, the full test suite, typecheck, build, documentation checks, and retrieval regression benchmarks pass before release preparation

## Version 1.12.5

**Status: published.**

Version 1.12.5 adds affected-neighborhood incremental refresh to the existing incremental-indexing pipeline without moving or changing the scope of v1.13.0 or any later roadmap version. The released capability includes trusted baseline identity and selection, forced neighbor re-extraction, the public `--refresh-scope` selector, runtime orchestration, and truthful execution evidence. See [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md#shipped-v1125) for current release status.

The goal is to let an incremental run conservatively re-extract otherwise-unchanged files that lie in the trusted previous index's one-hop affected neighborhood, while preserving the current merged-index, global graph rebuild, semantic-analyzer, managed-artifact, and call-graph fallback architecture.

### Planned command contract

- add `index --incremental --refresh-scope changed-files`
- add `index --incremental --refresh-scope affected-neighborhood`
- keep plain `index --incremental` backward-compatible with the current changed-files behavior
- reject `--refresh-scope` when `--incremental` is not active
- keep ordinary full indexing as the full-refresh path; do not add a separate full-refresh scope value

### Planned affected-neighborhood semantics

- use the previous accepted index as the baseline; never compute the selection from a graph already refreshed by the current invocation
- seed the baseline neighborhood from modified and removed indexed file nodes and the baseline symbol nodes owned by those files
- freshly extract added files, but do not fabricate baseline graph nodes for files that did not exist in the baseline
- traverse exactly one graph hop in both directions over every structurally valid retained code-graph edge kind
- include the seeds plus opposite endpoints of edges incident to the seeds; do not recurse through neighbors-of-neighbors
- map affected nodes back to grounded surviving current files; selected otherwise-unchanged files are freshly extracted
- reuse cached per-file extraction evidence for the remaining unchanged files
- keep removed files absent from current output even though their baseline nodes may seed surviving neighbors

### Baseline identity and fail-closed behavior

- neighborhood selection must establish that the previous cache metadata, `manifest.json`, `symbol-index.json`, and `code-graph.json` belong to one compatible baseline index for the same normalized project/source-root/configuration contract
- strengthen internal cache identity as needed rather than treating cache metadata as a replacement for public manifest authority
- an older or incompatible cache may trigger one full rebuild to establish a trustworthy new baseline
- missing, unreadable, incompatible, mixed, or otherwise untrustworthy baseline evidence causes an explicit full rebuild
- an explicit affected-neighborhood request must never silently degrade to changed-files-only reuse

### Planned execution evidence

Incremental results must make requested versus applied behavior distinguishable. Planned evidence includes:

- requested refresh scope
- applied refresh scope
- whether no refresh was needed
- whether a full fallback occurred and why
- baseline seed file/symbol counts when applicable
- affected node/edge counts when applicable
- count and bounded sample of otherwise-unchanged files forced to fresh extraction
- fresh-extraction and reused-file counts

A no-change incremental invocation remains a no-op over the existing index rather than rewriting artifacts merely to record the request.

### Architecture and compatibility boundaries

- extend the existing `runIncrementalIndex` / partial-rebuild path rather than create a second index or graph engine
- change file extraction/reuse selection only; preserve the existing complete merged symbol-index construction, global graph/code-graph rebuild, semantic-analyzer pipeline, managed-artifact refresh, and deterministic ordering
- preserve current call-graph semantics: when requested during a partial rebuild, the call graph is fully regenerated and reported separately as an artifact fallback
- preserve manifest authority, stable forward-slash file/symbol identities, existing source-root/exclusion behavior, and fail-closed cache compatibility
- successful changed-files and affected-neighborhood partial runs should converge with an ordinary full build on equivalent final semantic artifacts for the same final source tree
- materially different final artifacts between successful refresh scopes are treated as a correctness issue to investigate, not as an expected treatment difference

### Downstream Lab dependency

my-dev-kit-lab v0.6.3 may consume the real upstream capability for its planned four-treatment partial-refresh experiment:

- no refresh -> retain the prepared baseline index
- changed-files refresh -> `index --incremental --refresh-scope changed-files`
- affected-neighborhood refresh -> `index --incremental --refresh-scope affected-neighborhood`
- full refresh -> ordinary full index

Lab must record requested treatment and actual upstream execution/fallback. It must not claim an affected-neighborhood partial run when Kit fell back to full rebuild, and it must not simulate the upstream refresh by hand-editing index artifacts.

### Acceptance criteria

- plain `--incremental` remains backward-compatible
- explicit changed-files scope reproduces current incremental behavior
- affected-neighborhood traversal is exactly one hop, bidirectional, edge-kind agnostic over structurally valid retained edges, and non-recursive
- modified and removed baseline files seed the neighborhood; added files are freshly extracted without fabricated baseline seeds
- selected unchanged neighbors are freshly extracted and unrelated unchanged files remain reused
- untrustworthy baseline evidence produces a truthful full rebuild rather than a changed-files-only downgrade
- requested and applied refresh behavior is observable in command/result evidence
- no-change behavior and current call-graph fallback semantics remain intact
- full, changed-files, and affected-neighborhood builds converge on equivalent final semantic artifacts when their respective partial paths complete successfully
- repeated runs remain deterministic and path normalization remains portable across Windows, macOS, and Linux
- existing incremental tests, full tests, typecheck, build, documentation checks, retrieval regression, package validation, and cross-platform readiness pass before release preparation

### Explicit non-goals

- no recursive or multi-hop affected neighborhood
- no graph-diff dependency
- no true semantic symbol-diff redesign
- no graph artifact hand-editing or selective graph-node mutation
- no second partial-index implementation
- no automatic claim that one refresh treatment is safest or best
- no Lab-side simulation of upstream refresh
- no orchestrator/workflow ownership
- no v1.13.0 Android proof/example/documentation work
- no v1.14.0 framework expansion, KIT-API-01, KIT-OPS-01, or v2.0.0 plugin work

## Version 1.12.6

**Status: published.**

Version 1.12.6 is a bounded retrieval precision patch over the published v1.12.5 baseline. It improves two generic stages of the existing graph-guided retrieval workflow without changing the scope of v1.13.0 or any later roadmap version:

- ownership-oriented discovery for natural-language implementation queries; and
- trustworthy generic symbol end-line evidence for more complete bounded source retrieval.

The goal is to use static evidence that my-dev-kit already has, or can derive reliably from its existing language extractors, so coding agents are less likely to miss a production owner during search or require unnecessary source continuation after the correct symbol is known.

The core workflow remains:

```text
index -> manifest -> artifacts -> search -> lookup -> slice -> source -> view
```

### Ownership-oriented search

Raw `search --query` remains relevance-ranked and backward-compatible. Indexed tests remain ordinary searchable evidence and may continue to outrank production files under raw relevance search.

Add an explicit ownership-oriented search mode for implementation-ownership discovery. The exact public option spelling is an implementation-plan decision; the semantic contract is fixed here.

The ownership mode must:

- reuse the existing search candidate pool, classification metadata, code graph, and deterministic ranking infrastructure rather than introduce a second search engine;
- preserve the ordinary lexical relevance score and expose deterministic ownership adjustments separately;
- prefer grounded production-owner evidence such as production symbols, producer relationships, and suitable classification/edit-guidance evidence;
- avoid selecting test-only, test-fixture, generated, docs-only, or projection-only evidence as the primary production owner when a stronger grounded owner is available;
- retain relevant tests and other supporting evidence rather than removing them from results;
- permit bounded graph-supported promotion of a plausible production owner when a strongly matching test or usage candidate references that owner, so a weak direct lexical match does not make the owner disappear behind the result limit;
- preserve ambiguity when multiple production owners remain plausible;
- remain deterministic, inspectable, local, and static.

The ownership mode must not use embeddings, semantic-similarity services, LLM ranking, network calls, or automatic edit authorization.

### Trustworthy symbol end-line evidence

Extend the existing generic symbol-location contract additively with an optional inclusive `endLine`.

`line` remains the existing inclusive 1-based declaration start line. `endLine`, when present, means that the current language extractor can establish a trustworthy inclusive declaration end line. When it cannot, the field remains absent.

Initial supported boundary producers:

- TypeScript, TSX, JavaScript, and JSX: derive boundaries from the existing TypeScript compiler AST used by the current extractor;
- Python: preserve `ast` `end_lineno` evidence already produced by the current Python extraction path when available and valid;
- Kotlin and Java: retain unknown generic symbol boundaries under the current conservative line/brace scanners rather than claim exactness they cannot guarantee.

Future language extractors may begin supplying `endLine` through the same optional contract when they gain trustworthy boundary evidence.

The optional boundary may be projected into the existing compact graph symbol/node representation so symbol-index and code-graph structural evidence remain consistent. No second range artifact or source-location system is introduced.

### Bounded source retrieval with known symbol boundaries

`source --file <path> --symbol <name>` and symbol-node `source --node` must consume the same symbol boundary evidence.

When a trustworthy symbol end line is available:

- return the complete symbol on the initial request when it fits within `--max-lines`;
- never apply the historical 20-line unknown-boundary preview solely because the target is a generic symbol;
- when the symbol exceeds `--max-lines`, return only the allowed window and expose bounded continuation with `symbolBoundaryKnown: true`;
- continuation must stop at the recorded symbol end and must not spill into the following declaration;
- once the complete known symbol has been returned, no continuation cursor is required.

When a trustworthy symbol end line is unavailable:

- preserve the current conservative small initial preview;
- preserve `symbolBoundaryKnown: false`;
- preserve continuation reason `symbol-end-unknown`;
- preserve explicit continuation and bounded line-range retrieval as the fallback.

An old compatible index that does not contain `endLine` remains readable and follows the same unknown-boundary fallback rather than being rejected or assigned a fabricated boundary.

### Artifact and compatibility boundaries

- keep the current symbol-index and code-graph architecture;
- add only optional range metadata; do not replace the existing `line` field;
- do not require a public schema-major bump solely for the additive optional `endLine`;
- do not create a second symbol index, range artifact, source engine, parser pipeline, search engine, or graph engine;
- preserve current node and symbol identities;
- preserve current source-root, exclusion, incremental-indexing, graph-diff, and managed-artifact behavior;
- preserve `--max-lines` as an absolute output bound;
- preserve source continuation as the fallback whenever an exact boundary is unavailable or a known symbol exceeds the requested bound;
- preserve raw `search --query` behavior unless the ownership mode is explicitly selected;
- preserve existing `context` roles and adequacy contracts; v1.12.6 may share conservative owner-policy helpers where appropriate but must not redesign the context pipeline.

### Incremental-index compatibility

Fresh and partial builds must preserve equivalent end-line evidence for the same final source tree.

Unchanged symbols reused by a partial rebuild must retain any previously extracted `endLine`. Changed files must receive freshly extracted boundary evidence.

Existing package-version cache compatibility already causes an index cache written by an older published my-dev-kit version to rebuild after an upgrade. Do not bump the internal cache schema solely to introduce the optional symbol `endLine`.

### Retrieval-regression coverage

Extend the existing my-dev-kit-owned retrieval regression suite with permanent scenarios covering both v1.12.6 corrections.

Ownership regression:

- a natural-language behavior/ownership query has strongly matching indexed test evidence and a grounded production owner;
- raw relevance search remains backward-compatible;
- ownership-oriented search retains the production owner within a small bounded top-K result set while preserving the relevant tests;
- generated, docs-only, or test-only evidence does not become the primary production owner when a stronger grounded owner exists.

Symbol-boundary regression:

- a known multiline symbol whose trustworthy end is within `--max-lines` is returned completely without unnecessary continuation;
- a known symbol larger than `--max-lines` is truncated only by the requested bound and continues only within its own exact range;
- an unknown-boundary symbol retains `symbol-end-unknown` behavior;
- old indexes without `endLine` retain the conservative fallback;
- symbol-node and file-plus-symbol retrieval remain equivalent.

### Dependencies and ordering

1. define the additive ownership-search and optional symbol-boundary contracts;
2. implement deterministic ownership-oriented ranking and bounded owner recovery;
3. add trustworthy TypeScript/JavaScript and Python symbol end-line production;
4. consume known boundaries in generic source and continuation handling;
5. add permanent search and source retrieval regression coverage;
6. validate backward compatibility, determinism, incremental behavior, old-index fallback, and documentation before release work.

### Planned implementation batches

1. ownership-oriented search contract and backward-compatible ranking mode;
2. bounded graph-supported owner recovery and production-versus-test regression hardening;
3. trustworthy generic symbol boundaries and symbol-aware source continuation;
4. integrated retrieval hardening, compatibility validation, and documentation reconciliation.

### Acceptance criteria

- ordinary raw search ranking remains backward-compatible;
- ownership-oriented search makes a grounded production owner discoverable within a small bounded result set for the reproduced production-versus-test query while retaining relevant test evidence;
- ownership ranking remains deterministic and its adjustments are inspectable;
- no LLM, embeddings, fuzzy semantic engine, or second retrieval system is introduced;
- TypeScript/TSX/JavaScript/JSX generic symbols carry trustworthy parser-derived end lines where available;
- Python generic symbols preserve trustworthy AST `end_lineno` evidence where available;
- Kotlin, Java, old-index, malformed, and otherwise uncertain cases do not fabricate exact boundaries;
- a known symbol that fits within `--max-lines` is returned completely on the initial source request;
- a known symbol larger than `--max-lines` never causes source retrieval to spill into the next symbol;
- unknown-boundary symbols retain the existing conservative 20-line preview and `symbol-end-unknown` continuation behavior;
- `source --node` and `source --file --symbol` use one consistent boundary contract;
- full and incremental builds converge on equivalent end-line and retrieval evidence for the same final source tree;
- retrieval regression, focused source/search tests, the full test suite, typecheck, build, documentation checks, package validation, and cross-platform readiness pass before release preparation.

### Explicit non-goals

- no global production-first behavior for ordinary search;
- no removal or down-ranking of test evidence outside the explicit ownership mode;
- no embedding or LLM search;
- no generic fuzzy-search redesign;
- no general search/lookup/slice node-kind filtering from the older deferred v1.8.0 scope;
- no Kotlin or Java parser/compiler replacement merely to obtain end lines;
- no inference of a symbol end from the next declaration when the extractor cannot prove the boundary;
- no change to unrelated exact source modes, React-region ranges, or Android artifact-backed source ranges that already carry their own boundary evidence;
- no v1.13.0 Android benchmark/example/workflow scope;
- no v1.14.0 framework/language expansion;
- no KIT-API-01, KIT-OPS-01, or v2.0.0 plugin/schema redesign.

## Version 1.13.0

**Status: published.**

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

**Status: published.**

Version 1.14.0 broadens non-Android language and framework coverage after the Android foundation is in place.

The goal is to expand support while keeping static analysis conservative and adapter-based.

**Release scope.** v1.14.0 includes the Python, JavaScript, framework, configured-import and Rust structural capabilities below. Optional Rust direct-call evidence (R7) and Prisma remain deferred. Persisted schemas are symbol index `3`, code graph `1.1.0` and internal cache `1.3.0`; legacy duplicate-ID ambiguity can require a full index rebuild (see [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md#v1140-additive-schema)). The lists below preserve the approved scope and acceptance criteria.

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


#### Configured TypeScript/JavaScript import resolution — v1.14.0 correction

**Release scope.** Included in v1.14.0. Configured `paths` aliases from `tsconfig.json`/`jsconfig.json` (including bounded local `extends`, nested configurations and configurations without `baseUrl`) now produce the existing file-dependency edges, with configuration-aware incremental invalidation. Ambiguous, excluded, external or unsafe targets still produce no edge. The contract below is retained as the approved scope record; the current behavior is described in the architecture, contracts and graph-schema documents.

**Placement.** The October 20, 2026 iworkhere.space v0.4.3 discovery using published my-dev-kit 1.13.0 exposed missing dependencies for configured `@/` imports. The bounded correction belongs to v1.14.0 and does not create a separate release, change the Python/JavaScript/framework scope, or renumber the approved Rust subtrack.

**Historical boundary and architectural owners.** The pre-correction TypeScript adapter rejected non-relative imports. The released index-time configured-import resolver supplies supported aliases to the existing `symbolIndex.graph.fileDeps` producer and ordinary `imports`/`depends-on` edges. The query-time relative-specifier helper remains a separate consumer; changing it alone cannot repair persisted graph dependencies.

**Frozen bounded correction contract:**

1. **Config selection and safety.** Identify applicable project-local `tsconfig.json`/`jsconfig.json` for each selected TypeScript/JavaScript source file, including bounded local `extends` inheritance, nested configurations and config-file changes. Use TypeScript configuration parsing semantics for supported configuration forms; never execute target configuration code, import project modules, fetch dependencies, follow symlinks outside the approved repository or expand indexed source roots. For conflicting or unverified applicable configs, report the ambiguity instead of choosing arbitrarily. Only authorized in-repository config files may supply static resolution evidence.
2. **Mapping semantics.** Resolve supported literal `compilerOptions.paths` exact and single-wildcard mappings with documented specificity and ordered target substitution. With `baseUrl`, mapping targets are relative to it; **without `baseUrl`**, targets are relative to the configuration file defining that mapping. Preserve nested/inherited configuration origins and ordinary relative/NodeNext imports. The source file must already be in the selected index inventory. Honor B05's conservative explicit-extension and ambiguous JS/TS candidate behavior; do not resolve unrelated bare packages or assume bundler runtime reachability.
3. **One producer of dependency evidence.** Extend the existing TypeScript adapter and shared index-time dependency builder, passing only needed project/config context through their existing contracts. A uniquely established local alias target becomes a `FileDependencyEdge` and the usual existing `file:<path>` → `file:<path>` graph edge. A missing, ambiguous, external, excluded, unsupported or unsafe target yields **no fabricated edge** and bounded diagnostic evidence. Do not introduce a second graph, alias-specific artifact, CLI family or independently guessed import resolver.
4. **Incremental correctness.** Fingerprint relevant config contents, local inheritance and per-file config association when they affect resolution, independently of source-file hashes. Changing `tsconfig.json`/`jsconfig.json`, a supported inherited config, an importer or a selected target must invalidate the appropriate dependency evidence. Full and incremental index outputs must agree after normalizing timestamps, and stale edges must disappear. When sound partial reuse cannot be established, use a truthful full rebuild. Preserve manifest/cache checksum trust and unrelated language behavior.
5. **Consumer tests before consumer edits.** Once the persisted `fileDeps` edges are correct, compare default relevance search, `--intent ownership`, exact lookup, depth-bounded slice, related-test discovery and role-aware context on identical fixtures. Patch `src/search/`, `src/context/` or the shared query-time helper only for **reproduced** residual failures, preserving existing test-discovery semantics. Do not add a new ranking algorithm or globally demote tests.
6. **Measure fallback burden.** Compare the number of searches, lookups, graph slices and bounded source reads needed to establish the same known relationships before and after the fix. Correctness, complete source evidence and conservative uncertainty are primary; fewer reads are a secondary observation, not an arbitrary pass threshold.

**Planned numbered correction steps and required proof:**

1. **Step 1 — Reproduce and freeze resolution contracts.** Independently reproduce the `@/*` → `./src/*` failure (with `moduleResolution: "bundler"` and no `baseUrl`) using a pinned released-tool baseline, then check the current local v1.14 branch. Inspect actual index-time adapter/builder, configuration and cache owners; freeze the exact source/test/output paths and before/after CLI oracle. Record what is a new capability versus an actual failing existing contract.
2. **Step 2 — Implement configured dependency resolution.** Implement the bounded static `paths` resolver in existing language/indexing owners; ensure selected-root containment, correct config precedence, no guessed imports, deterministic file dependency and code-graph projection, config-dependent incremental invalidation and old-reader compatibility. Do not change public schema versions or introduce new persistent fields without a separately approved migration.
3. **Step 3 — Verify retrieval and finalize.** Validate query-time owner/related-test consumption against real new edges, fix only proven residual issues, and run the old/new fixture comparison plus full/incremental, graph, context, security, packaging and existing core/Android retrieval-regression suites. Perform cross-platform acceptance at the existing pre-release gate. Do not claim publication or update current-state contracts until implementation passes.

**Planner-owned test locations:** Extend `tests/index/` import/index/incremental tests, `tests/search/` ownership results, `tests/context/` related-test/owner selection, and existing `tests/graph/`/CLI retrieval tests. Use a deliberately scoped fixture rooted at `tests/fixtures/v114-path-alias/`; reserve `tsconfig.json`, `src/app/tool/[slug]/page.tsx`, `src/component/tool/ToolPageTemplate.tsx`, and `src/module/tool/registry.ts` for the incident reproduction. Additional nested-config/ambiguous/relative-import fixtures need exact paths frozen at Step 1 before writes. Required cases: multiple aliases, literal/extensionless/index/NodeNext relative imports, conflicting selected candidates, missing/out-of-root targets, no-`baseUrl` and `baseUrl` configs, `jsconfig` and bounded `extends`, config-only changes, target edits/moves, stale-edge removal and complete CLI ownership/slice/source/context evidence. Expected incident edges are `file:src/app/tool/[slug]/page.tsx` → `file:src/component/tool/ToolPageTemplate.tsx` and → `file:src/module/tool/registry.ts`, both `imports` when uniquely selected.

**Explicit exclusions and follow-up classifications.** No generic CSS, YAML, Dockerfile, JSON or Markdown symbol parser is part of this correction: lack of symbol-level retrieval for those inputs is a capability boundary, not a broken TypeScript index. Search noise/test-heavy results are an investigation, not a confirmed ranking defect; retain relevant test retrieval. Approximately 60 bounded source reads in the incident are not by themselves a failure. Do not modify iworkhere.space, add network services, execute target code, or rewrite Android/other language analyzers. After implementation, reconcile shipped behavior in `ARCHITECTURE.md`, `CONTRACTS.md`, `GRAPH_SCHEMA.md`, `COMMANDS.md`, `DEVELOPMENT.md` and regression/testing owners under the existing documentation-preservation policy; until then these remain planned requirements.

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
- Rust — structural language intelligence included in v1.14.0 as detailed below (optional call evidence R7 deferred)
- Java beyond Android use cases
- C#
- Kotlin beyond Android use cases

Additional language support should be added through language adapters rather than hardcoded into one scanner.

### Rust language intelligence — v1.14.0 subtrack

**Release scope.** Rust structural intelligence ships in v1.14.0; optional conservative direct-call evidence (R7) remains deferred for separate authorization. The packaged checksum-verified Tree-sitter WebAssembly grammar, generic qualified identity and additive Rust owner nodes, in-process Cargo parsing and extension-based `.rs` discovery are the resolved choices. The following historical plan and acceptance requirements preserve the agreed scope; current contracts are in the architecture and graph-schema documents.

**Original decision and scope (historical planning decision).** Rust was promoted from an additional-language candidate to a **planned first-class static retrieval subtrack inside v1.14.0**, without moving or narrowing the Python, JavaScript, framework, Go, Java, C#, Kotlin, v1.15.0–v1.17.0, or v2.0.0 commitments. This is a planning/design decision, **not evidence of implementation, a parser selection, a finalized additive JSON contract, or release authorization**. Rust should work for general Cargo projects and mixed-language repositories, not for one consumer application. The [architecture](ARCHITECTURE.md), [cross-cutting contracts](CONTRACTS.md), and [artifact schema](GRAPH_SCHEMA.md) identify the present owners and distinguish this planned work from published behavior.

**Completion definition.** The existing `index → search → lookup → slice → source → context → graph-diff` loop must retrieve exact, noncolliding crate/module/trait/impl/function/test ownership and bounded source ranges for supported Rust syntax, including multiple same-named methods. Cargo metadata and code graph edges must be conservative; unknown feature activation, unresolved imports, macro expansion, trait dispatch, runtime behavior, and excluded roots must remain explicit unknowns. An indexed `.rs` file count alone is **not** evidence of completed Rust support.

#### Frozen responsibility and trust boundaries

- Extend the **existing** language registry/adapter (`src/languages/`), generic symbol builder/types (`src/symbol-index/`), code graph (`src/graph/`), index/discovery/cache/partial refresh (`src/indexing/`), and search/lookup/source/slice/context/diff readers. Reuse `symbol-index.json`, `code-graph.json`, existing `manifest.json`, and the current nine CLI command families. No Rust-specific second index/search engine, parallel graph, `rust-index` command, or Orchestrator runtime.
- `index` is local, deterministic and read-only **toward the target**; it never executes `cargo`, `rustc`, `rust-analyzer`, `build.rs`, procedural/ordinary macros, Rust binaries/tests, downloads, or user scripts. Build, Clippy, test and runtime verification belong to the target-project workflow or separate Lab/CI validation. Observer owns browser evidence, not Rust parsing.
- The existing `--root`/repeated `--src`/exclude/ignore rules govern selected source. Cargo manifest inspection must not silently expand source roots, fetch dependency bodies, traverse outside the approved repository, or equate observed `cfg` branches with activated configurations.
- Preserve all existing TypeScript/JavaScript/Python/Kotlin/Java graph IDs, saved artifact readers, context semantics, Android/frontend evidence, schema-version interpretation, deterministic ordering, bounded output, and safe incremental fallbacks. Any unavoidable incompatible change requires a separately approved migration and reader tests.
- No new generic semantic claims: distinguish (1) parsed syntax, (2) uniquely resolved local structure, (3) narrowly justified static source relationships, and (4) compiler/runtime truth. Only the first three are candidates for `index`, with explicit provenance and uncertainty; the fourth is out of scope.

#### Identity, node, and edge design requirements — unresolved until R0/R1

The current generic graph helper constructs `symbol:<file>#<simpleName>`. Two `run` methods in distinct `impl` blocks in one file therefore collide, and the current `SymbolKind` and `SourceLanguage` unions lack Rust-specific coverage. **Qualified identity and backwards-compatible readers are mandatory before nested Rust extraction.** Proposed additive representation, subject to exact type/field/schema review:

- Keep each declaration's simple `name` for display/search, plus its crate/target, inline/external module path, owner trait/type/impl, optional qualified display path, and parser-grounded 1-based source range. Define a deterministic, collision-free disambiguator for distinct declarations that share a qualified display path; do not assert stable identity after arbitrary source moves.
- Represent an indexed file, Cargo package/crate target, module, trait/type/impl owner and symbol **in the existing generic code graph** as nodes or additive ownership fields according to the R1 compatibility decision. A Rust module nested within one file is a distinct scope; different targets with the same crate name are not one identity.
- Candidate relationships include crate→target, target→root file, module containment/source, declaration/impl ownership, exact external `mod`→selected file, unique `use` and `pub use` resolution, unique trait/type impl ownership, and demonstrably grounded direct local calls. Reuse existing edge vocabulary when semantically equivalent and add edge kinds only with type/reader/version decisions. Never use `related-to` to disguise unknowns or create target nodes outside the index.
- Distinguish Rust `pub`, `pub(crate)`, `pub(super)`, `pub(in ...)` and private syntax. The current generic `exported` boolean must not be treated as complete crate-public reachability. Trait method declaration and implementing method remain different.
- Use explicit resolution outcomes wherever the existing evidence contracts permit: `RESOLVED`, `AMBIGUOUS`, `UNRESOLVED_EXTERNAL`, `UNRESOLVED_SELECTED_ROOTS`, `CONDITIONAL`, `UNSUPPORTED_SYNTAX`, `MALFORMED`. Report bounded exact candidates when a name is ambiguous; never silently select the first matching `run` or an arbitrary module file.
- Before freezing fields or paths, inspect `src/symbol-index/types.ts`, `src/graph/buildCodeGraph.ts`, existing graph ID consumers, source selectors, search/lookup/context/diff and incremental merge code. Decide how old readers handle missing new fields. The public `GRAPH_SCHEMA.md` remains an **implemented schema reference**, not permission to publish proposed fields as current.

#### Parser and Cargo architectural gates

- **Parser decision D02 is pending R0 evidence.** Compare (A) a Node-native Tree-sitter binding with the maintained Rust grammar and (B) `web-tree-sitter` with a pinned packaged Rust grammar WASM. Do not use regex-only brace/line extraction for nested Rust semantics; do not require rustc/rust-analyzer as the installed indexer's backend. Measure actual clean installed-package startup, parse accuracy, memory, throughput, binary assets/licensing, Node ABI/OS support, and package sizes on the supported Windows/Linux/macOS matrix. Select **one** production backend after the spike; no runtime downloading, grammar compilation or mandatory Rust toolchain.
- Parse Rust 2015, 2018, 2021 and 2024 samples, malformed/recovery cases, Unicode and raw identifiers, doc comments, raw strings, macros and attributes. A parser-error-contaminated declaration cannot receive a supposedly trustworthy `endLine`. Preserve established 1-based inclusive lines and explicitly define any additional byte/column coordinate unit before a schema change.
- Parse `Cargo.toml` conservatively **in-process** using a reviewed TOML parser. Represent ordinary/virtual workspaces, glob/exclude/default members, package/edition/target metadata, lib/bin/tests/examples/benches, `build.rs` as a file, proc-macro targets, local path dependencies/renames, nonstandard target roots, and malformed manifests. `Cargo.lock` is dependency metadata, not proof of source relationships.
- Support inline/external `mod`, `foo.rs` and `foo/mod.rs`, literal `#[path]`, grouped/aliased/glob `use`, `self/super/crate`, `pub use`, visibility syntax, and exact locally provable module targets. `cfg`, `cfg_attr`, optional features, target-dependent alternatives, `include!` and generated code must stay conditional/unresolved; no module/trait/method resolution based only on filename resemblance.

#### Planned declaration and retrieval contract

- Extract free/async/const/unsafe/extern functions, generics/where clauses, structs (named/tuple/unit), enum variants, unions, traits and trait aliases if grammar permits, aliases, const/static, externally declared FFI items, supported macro declarations and **observed** invocations/derives/attributes.
- Extract **associated methods/types/constants inside traits and inherent/trait `impl` blocks** in the first substantive Rust release. Preserve receiver syntax, trait/type owner, required declaration versus implementation body, and parser-grounded complete source spans. Four methods named `start` plus a trait declaration must remain independently addressable across module and impl ownership contexts.
- Index `#[test]`, observed framework-specific test attributes, `#[cfg(test)]` modules, test target roots, fixtures/examples, errors, constants, validators and nearby tests for the existing role-aware `context` pipeline. A recognized test annotation does not prove a test was executed.
- Make existing `search` and ownership intent recognize qualified Rust owners where grounded; `lookup`/`slice` expose bounded owner relationships; `source --node` and `source --file --symbol` use verified symbol spans and explicit ambiguity/continuation. Optional `--language rust` is **undecided** because the current CLI language selector does not follow Kotlin/Java extension detection uniformly. Do not document any Rust flag as shipped before parser/help tests.
- Never assert method dispatch, generic trait coherence, runtime feature activation, cross-language FFI/WASM/native messaging targets, or complete Cargo namespace resolution. Reserve conservative direct-call edges for a separate optional batch.

#### Incremental index, compatibility, and measurement gates

- Treat the selected parser/grammar version, relevant Cargo manifests/workspace membership, `mod` path relations, `cfg` interpretation and approved source roots as dependency/fingerprint inputs **when they affect extracted semantics**. A Cargo-only edit or module rename must invalidate affected ownership; no stale module edge or dangling symbol survives.
- Prove full-versus-`--incremental` parity after method edits, external module moves, Cargo workspace changes, cfg changes and parser changes. Preserve existing `changed-files`/`affected-neighborhood`/truthful `fallback-full`, manifest/cache checksum verification, frozen before/after snapshots and `graph-diff` identities.
- Establish baseline cold/warm indexing latency, memory, index/artifact size, clean tarball/install/startup, selected source retrieval and context budgets on current TS/Python/Android cases **before** setting numeric Rust performance thresholds. A backend parsing fast on Linux but not installing on Windows is not releasable.
- Run a small, legally redistributable, pinned-attribution Rust corpus (layered async service, CLI, multi-crate library) in addition to synthetic fixtures. No consumer-specific private repository content, dependency downloads, package install hooks executing target code, or source/test modification in the index path.

#### R0–R10 planned implementation batches and acceptance gates

These are **Rust workstream batches within v1.14.0**, not eleven new release versions. Each starts only after required earlier evidence and a planner-authored exact source/test/output path contract. Before R1, freeze the identity/schema design and choose the parser after measurements.

- **R0 — Preflight and feasibility.** Verify source/release state, manifest, adapter/symbol/graph/cache contracts and old readers; demonstrate same-file/simple-name collision; compare native Tree-sitter against packaged WASM on a controlled, project-owned, nonproduction spike. **Gate:** planner-approved parser, collision-free qualified identity design, schema/backward-reader migration strategy, fixture oracle, and exact output paths.
- **R1 — Qualified identity foundation.** Add additive owner/qualified declaration identity and deterministic Rust symbol IDs with explicit same-name ambiguity. **Gate:** same-named trait/inherent methods do not collide; existing TS/Python/Kotlin/Java ID/reader tests remain unchanged.
- **R2 — Rust adapter and syntax.** Register the chosen AST-backed Rust adapter; recognize declarations, associated items and trustworthy spans; handle malformed text safely. **Gate:** F01/F04/F05/F08 syntax fixtures, parser asset/diagnostic, and nonexecution tests pass.
- **R3 — Cargo and module graph.** Parse allowed local Cargo manifest facts and selected `mod` layouts without source-root expansion. **Gate:** F02/F06/F07/F09 fixtures, conditional states and symlink/path boundaries pass.
- **R4 — Imports/reexports and graph.** Map uniquely resolved module and `use` paths into existing graph nodes/edges with explicit provenance. **Gate:** F03 exact-target oracle, no invented edges, no duplicate IDs and old reader compatibility.
- **R5 — End-to-end retrieval.** Extend existing search/lookup/slice/source/context for qualified Rust identity, precise method source and related test evidence. **Gate:** F10/F13 mixed-language retrieval and exact ambiguity/source/capsule tests pass.
- **R6 — Incremental and diff correctness.** Add Rust parser/Cargo/module/config fingerprints, dependency invalidation, trusted partial refresh and graph-diff parity. **Gate:** F11 semantic full/incremental equivalence under controlled source, manifest and grammar changes.
- **R7 — Optional conservative call evidence.** Allow exact local direct-call links only when uniquely justified; leave method dispatch and generics unresolved. **Gate:** no false-positive edges on F04/F05/F06; may follow the core structural release if separately approved, rather than blocking it. **Status: deferred for separate future authorization; not implemented.**
- **R8 — Retrieval regressions and real-world validation.** Exercise ownership-intent retrieval, test mapping, source/continuation, mixed-language noninterference and independently checked licensed Rust fixtures. **Gate:** F13/F14 and inherited retrieval/Android/frontend regressions pass; downstream Orchestrator consumes real emitted existing-schema context without a new mode.
- **R9 — Packaging, performance and security qualification.** Test the exact packed CLI on supported Node and Windows/Linux/macOS; parser assets shipped, clean consumer requires no Rust toolchain and no runtime download, bounded malformed-input/path/security cases, benchmark budget. **Gate:** actual installed-package acceptance plus matrix CI, no hidden target execution or broken binary/WASM assets.
- **R10 — Documentation and separate release transitions.** Reconcile implementation against planned scope, examples and the existing public docs, schemas and preservation manifest. **Gate:** docs checks and protected-plan inventory pass, implementation-completeness validates what shipped; pre-release audit, release preparation and publication remain **separate user-authorized procedures**.

#### Fixture and proof inventory (planned, exact filenames awaiting planner path freeze)

Use existing `tests/fixtures/`, tests under their owning `tests/index/`, `tests/graph/`, `tests/source/`, `tests/lookup/`, `tests/search/`, `tests/slice/`, `tests/context/`, `tests/retrievalRegression/`, and the existing `examples/` owner; no new parallel testing infrastructure. R0 freezes exact new filenames and any additional `src/languages/rust/` children before implementation.

- **F01–F04:** foundational syntax, module layouts, import trees, traits/`impl` including identical method names.
- **F05–F08:** macros/raw strings, conditional compilation, Cargo multi-crate workspaces, parser errors/Unicode/CRLF/oversized cases.
- **F09–F11:** source-root/symlink/nonexecution security, mixed Rust/TS/Python/Kotlin/Java, Cargo/config/module incremental invalidation.
- **F12–F14:** packed consumer on the supported OS/Node matrix, the whole bounded retrieval loop, independent Rust/Cargo reference-oracle fixtures and licensed real-project corpus.

**Acceptance invariants:** zero silently dropped duplicate-named declarations; zero identity collisions; all `RESOLVED` graph edges grounded in unique local selected targets; every `AMBIGUOUS` source/lookup preserving bounded candidates; precise or honestly unknown method boundaries; frozen snapshots never overwritten; equivalent timestamp-normalized full/incremental graphs; no regressions in existing language/Android/frontend consumers; bounded performance and deterministic portable packaging.

#### Historical planner decision ledger and prerequisites

- **D01 placement:** **planned** v1.14.0 Rust subtrack; existing scope in every other v1.14 section and future version remains intact. **Not** an implementation-complete or released commitment. *Release status: the structural subtrack ships in v1.14.0; R7 remains deferred. The original planning decision text is retained.*
- **D02 parser:** Tree-sitter grammar as design direction; native Node vs packaged WASM is **UNRESOLVED until R0 cross-platform installed-package evidence**.
- **D03 identity:** reuse generic symbol/graph with qualified Rust ownership and deterministic collision-free IDs; **exact field names, disambiguation algorithm, schema version and reader migration are UNRESOLVED until R0/R1**.
- **D04 declarations:** nested trait/`impl` associated items are required for first substantive support; no regex-only top-level substitute.
- **D05 Cargo:** local in-process TOML/source static metadata, no Cargo execution by default; decide artifact placement only after existing-owner review.
- **D06 graph:** crate/target/module/trait/impl/symbol concepts and evidence-backed edges required; exact additive node/edge type shapes **UNRESOLVED**.
- **D07 uncertainty:** explicit resolved/ambiguous/external/excluded/cfg/unsupported/malformed states; map onto existing diagnostics where possible.
- **D08 CLI:** existing command families only; whether `--language rust` is appropriate is **UNRESOLVED**, not an advertised flag.
- **D09 fixtures:** F01–F14 as above; independent reference facts, no oracle derived solely from the new parser.
- **D10 performance/security:** freeze measured thresholds after parser spike; cross-platform packed CLI, bounded reads and no user-code execution required.
- **D11 call graph:** conservative direct references optionally later; trait/method dispatch not required for core structural completeness.
- **D12 downstream:** Orchestrator receives existing context; Lab Rust audit work, if any, is separately planned; Observer unchanged. **No automatic cross-repository implementation**.
- **D13 governance:** planner freezes exact structural directories/new filenames/generated locations and acceptance before each batch; no automatic implementation, Git mutation, tag or package release from these roadmap notes.


## Version 1.15.0

**Status: planned.**

Version 1.15.0 is reserved as **KIT-API-01**.

The goal is to add conservative static evidence for supported UI/client/API/schema/data relationships and contract-oriented change evidence after the broader framework evidence introduced in v1.14.0.

Planned boundaries:

- extend existing adapter/artifact/retrieval architecture rather than introduce a second graph system
- expose evidence-backed relationships and uncertainty, not runtime authorization claims
- do not execute APIs, databases, migrations, browsers, or deployment systems
- do not treat a static relationship as proof that a runtime path is reachable or authorized
- preserve compatibility with the bounded retrieval and context architecture

This milestone supports later full-stack contract assurance but is not required for Android v1.13.0 work.

## Version 1.16.0

**Status: planned.**

Version 1.16.0 is reserved as **KIT-OPS-01**.

The goal is bounded static evidence for configuration, instrumentation, and deployment-source relationships when real downstream assurance workflows demonstrate a need for them.

Planned boundaries:

- configuration and source evidence only
- no hosted monitoring, deployment execution, cloud control plane, or secret collection
- no claim that static configuration proves runtime operational state
- implement only evidence families justified by concrete consumers and fixtures

This milestone is optional for the first ECO-01 executable-evidence integration.


## Version 1.17.0

**Status: planned.**

Version 1.17.0 completes bounded frontend-source retrieval gaps recorded in the four historical Area of Improvements notes. This repository-local milestone follows the existing v1.13.0–v1.16.0 reservations and precedes the separate v2.0.0 artifact/plugin redesign. It does not move or expand any existing milestone.

The goal is to make indexed TypeScript/JavaScript/TSX and frontend-test evidence usable for targeted changes to long, interdependent UI files. Reuse existing symbol index, frontend semantic/reachability artifacts, local component-tree/source bundle, and search/lookup/slice/source owners. Preserve static-analysis uncertainty and avoid a second frontend index or retrieval engine.

### Exact test-block retrieval

- Add bounded source selection by an exact indexed describe/test/it title, with optional file/path scoping, stable existing test-block IDs, parent relationships and precise ranges. Report duplicate titles as ambiguous and unsupported/dynamic titles as unresolved; never choose one silently.
- Retain supported setup/teardown, helper, locator and assertion context as bounded evidence when already available. Do not imply arbitrary locator-chain comprehension, test execution or passing coverage.
- Preserve the existing exact-literal source search as a fallback instead of replacing it.

### Large React component and render-region precision

- Extend existing React-region retrieval to cover supported imports, state/derived-state blocks, handlers, render helpers, returned JSX, conditional branches and tab/panel regions where the frontend extractor can establish source ranges. Do not guess full-component boundaries.
- Extend existing local component-tree bundles with statically grounded parent/child props, callback forwarding and invocation, relevant event handlers, local state-setter usage and directly referenced helpers.
- Provide bounded occurrences of modified/removed props within the selected same-file component tree to help discover remaining edit sites. Missing static matches never prove absence of dynamic or external references.
- Preserve caps, deterministic ordering, source locations, confidence, warnings and ambiguity. Broad trace-props/trace-events command families remain v2.0.0 candidates, not new v1.17.0 standalone commands.

### Scoped literal and reference occurrence tracing

- Extend existing exact source-text and frontend literal evidence to return a bounded, complete-within-selected-scope occurrence inventory for repeated exact literals and supported local enum/union values, optionally narrowed to one file or an explicit indexed source-path prefix.
- Expose occurrence path, line/range, syntactic role and symbol reference only when established, plus available/returned/dropped counts and unresolved reference cases.
- Distinguish textual co-occurrence from a resolved reference. General cross-project type-aware references and a standalone refs command remain v2.0.0 candidates.

### Browser-state and route evidence refinement

- For statically supported storage calls, distinguish read (getItem), write (setItem), remove (removeItem), and whole-store clear (clear). Never model a no-key clear call as a named-key usage.
- Associate storage-key sites with grounded component/route and directly linked data/serialization type evidence where the source supports it; preserve ambiguous or missing links.
- Extend v1.3.0 route/component/test/UI relationships with directly grounded route-to-handler and explicit guard/policy reference candidates when supported by the existing v1.15.0 API relationship contracts. A route-name match is not proof of authorization.
- Add bounded UI-marker ownership evidence for supported local sub-components where indexed facts support it. Do not claim runtime visibility.

### Workflow documentation and tests

- Update the existing workflow documentation with patch-first retrieval/edit guidance: retrieve exact target and needed local imports/types/helpers; prefer minimal changes; record changed ranges and justified full-file fallbacks. Do not create another report engine or hard-code a universal file-length threshold.
- Explain that application startup, database/test setup, targeted E2E execution, cleanup-on-failure and fresh-session visible-result verification are owned by project tests and coding-agent/Orchestrator workflows, with my-frontend-observer providing browser evidence. Kit does not execute those activities.
- Extend existing frontend, source, search, reachability and retrieval-regression test owners. Cover exact duplicate/dynamic test titles, long render helpers, local prop/callback/event chains, removed-prop occurrence retrieval, repeated literal/enum references, storage operation kinds, route/policy uncertainty, caps, deterministic results, and compatibility.

### Acceptance criteria

- Supported exact test titles retrieve bounded source; duplicate or dynamic cases preserve ambiguity/uncertainty.
- Supported long component regions and intra-file prop/event/state/helper relationships can be retrieved without default whole-file reads; all omissions and caps are explained.
- Scoped literal and supported value occurrences are complete within the declared searched scope when not truncated; no unsupported reference identity is fabricated.
- Storage read/write/remove/clear kinds and route/guard associations are faithful to explicit evidence, never runtime visibility or authentication proof.
- Existing search, source exact-text, React-region, local-component-tree and artifact consumers remain backward-compatible.
- Focused and full regression, deterministic retrieval benchmark, documentation, package and cross-platform readiness gates pass before release preparation.

### Dependencies and exclusions

- v1.17.0 follows, but does not change, the reserved v1.13.0 Android, v1.14.0 language/framework, v1.15.0 API/data and v1.16.0 operational evidence work.
- No automatic browser, server, database, test execution, deployment or real-user visibility proof in Kit. Those belong to project workflows, Orchestrator and Observer.
- No broad cross-file dependency closure, universal authorization inference, general runtime control flow, second graph/index engine or v2.0.0 plugin/command redesign.

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
## Historical frontend improvement coverage and disposition

The four historical Area-of-improvements-1.txt through Area-of-improvements-4.txt notes were reconciled on 2026-10-10. The nineteen numbered entries below preserve the original requested problem/capability and identify implemented foundations, remaining planned scope, or the tool responsible for runtime/workflow behavior. Historical versions retain their original meaning; illustrative command names in the original notes are not considered shipped unless documented in COMMANDS.md.

### Area of Improvements 1 (15 entries)

1. **Fine-grained React/TSX components, hooks, props and JSX** — v1.2.0 introduced frontend semantic indexing/regions; v1.17.0 targets incomplete large-file regions and relationships; broader first-class nodes remain v2.0.0 candidates.
2. **Vitest/Playwright describe/test/setup/helper blocks and direct test-title source** — v1.2.0 indexed test facts and v1.12.4 made supported test files core indexed; v1.17.0 plans bounded exact title-to-block retrieval with ambiguity reporting.
3. **Exact UI text, routes, test IDs, ARIA/locator evidence** — v1.2.0 exact source-text search/frontend-test facts and v1.3.0 UI/route selectors cover literal lookup; v1.17.0 improves supported test-region/locator context.
4. **Symbol source with imports, local types, props and helpers** — v1.4.0 supports continuation and local bundles; v1.12.6 supplies trustworthy generic symbol-end evidence. Arbitrary cross-file closure is not claimed.
5. **Search→lookup→slice→source execution visibility** — v1.0.x reporting and v1.6.0 capsules/audits cover product evidence; recording commands actually invoked, including slices and reasoned selections, belongs to the coding-agent/Orchestrator workflow.
6. **Justified full-file reads, including large E2E specs** — v1.0.x and v1.6.0 require fallback reasons; root agent/manifest and bounded retrieval workflows control full-file access. No arbitrary 250-line hard limit is promised as Kit functionality.
7. **Patch-first edits and exact changed ranges instead of whole-file rewrites** — coding-agent/Orchestrator execution responsibility; v1.17.0 adds the corresponding documented exact-range retrieval/edit procedure, not a source-mutating CLI.
8. **Large Next.js page imports/state/handlers/tab panels/JSX regions** — v1.2.0 introduced named React regions; v1.17.0 addresses more complete large-file partitions; broader v2.0.0 render-region nodes remain candidates.
9. **Route-to-page, navigation, E2E, API and access-policy links** — v1.3.0 provides route/component/test/UI evidence; v1.15.0 reserves API/data relationship facts; v1.17.0 plans exact grounded handler/guard references with unresolved cases rather than runtime authorization claims.
10. **Session/local storage key reads/writes/clear and associated artifact shapes** — v1.3.0 records keys and components; v1.17.0 plans distinct operations, scoped usage locations and grounded type links.
11. **UI conditional reachability and hidden-state visibility** — v1.3.0 provides static conditions and route links only. Real user-action reachability and what appeared in the browser require project tests and my-frontend-observer.
12. **E2E service start, test/data preparation, selected tests and cleanup in prompts** — project-native test and coding-agent/Orchestrator workflow responsibility; covered by the ecosystem web vertical-slice workflow, not Kit indexing.
13. **Original schema/type versus projection/view model/fixture/editable owner** — v1.5.0 classification and role-aware context provide conservative edit-layer guidance; not automatic edit authorization.
14. **Actionable context readiness, safe/avoid files, assumptions, guest/auth differences** — v1.6.0 capsules and v1.10.1 role-specific context support static owner/readiness and risks. Runtime guest/auth conditions require application/Observer verification.
15. **Visible frontend-change acceptance including fresh-session empty state** — application E2E/browser checks plus my-frontend-observer and coding-agent/Orchestrator verification, not static Kit assertions.

### Area of Improvements 2 (1 entry)

1. **Continue oversized symbols and include imports/types/props/local components/helpers** — v1.4.0 supplies source continuation, local dependencies and source bundles; v1.12.6 supplies trustworthy optional end lines to avoid unnecessary unknown-boundary previews.

### Area of Improvements 3 (2 entries)

1. **All repeated exact literal and enum-value references in a file/subsystem** — v1.2.0 exact source search is the current bounded fallback; v1.17.0 plans scoped occurrence evidence; general type-aware refs remains a v2.0.0 candidate.
2. **Interleaved React state/renderLeft/renderRight/handlers/JSX flow regions** — v1.2.0 regions and v1.4.0 local expansion provide foundations; v1.17.0 addresses large-file completeness; broader render-flow API remains v2.0.0 candidate.

### Area of Improvements 4 (1 entry)

1. **Intra-file nested React prop/callback/event/state-setter/helper and removed-prop tracing** — v1.2.0 local component-tree and prop/event-flow indexing provide a foundation; v1.17.0 plans bounded edit-oriented closure; general trace-props/trace-events remain v2.0.0 candidates.

### Runtime and workflow ownership boundary

Kit remains a local static index, graph and bounded-retrieval producer. Application startup, authenticated session/data setup, targeted E2E commands, cleanup and browser-visible acceptance belong to project-native tests and coding-agent/Orchestrator workflows; my-frontend-observer owns actual observed frontend state. The current ecosystem workflow guide describes their composition without moving browser execution into Kit.

