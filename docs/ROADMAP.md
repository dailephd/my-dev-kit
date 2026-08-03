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
- `limits.evidenceGroupEntries` is a reporting-only budget: it is recorded as a declared value alongside the real usage/availability/drop counts, but the actual per-group caps that shape evidence-group truncation are the fixed internal limits each group defines (for example 3 or 5 for owners, 10 for contracts); the declared field does not override those internal caps. This is a deliberate reporting boundary, not an unresolved implementation gap.
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
- `limits.evidenceGroupEntries` remains diagnostic/reporting-only. The finite implementation required-evidence bound is the sum of the participating groups' internal reservations.
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
