# Roadmap

## Overview

`my-dev-kit` is a CLI-first development context kit for indexing codebases, building graph artifacts, searching project structure, slicing relevant neighborhoods, and retrieving bounded source context for LLM-assisted development.

The product goal is simple: help developers understand large projects without reading whole files, broad folders, or unfiltered documentation — and to support downstream tools and LLM-assisted workflows with deterministic, bounded local artifacts.

The current release focuses on deterministic local artifacts:

- `symbol-index.json`
- `code-graph.json`
- optional call graph artifacts
- bounded source retrieval
- graph slices
- DOT, SVG, and PNG graph views
- deterministic keyword search over index artifacts

Future releases improve data-model understanding, frontend workflows, route and browser-state retrieval, source expansion, precision, scale, language coverage, and retrieval quality.

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

Planned improvements:

- default ignore rules for common generated folders
- `--exclude` support where missing
- `--dry-run` support for expensive commands
- progress reporting during indexing
- clearer output when a repository is large
- safer behavior when a command would scan too many files
- documentation for indexing large monorepos

### Retrieval workflow reporting

Planned improvements:

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

### Documentation and examples

Planned improvements:

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

- `index` now runs semantic analyzers as part of the index run
- `manifest.json` is the authoritative artifact registry; it records all current artifact paths and analyzer status
- Stale artifacts from previous runs are removed when `index` refreshes the artifact directory
- Analyzer registry (`analyzers` array) in `manifest.json` records status, version, and artifact refs per analyzer

#### Semantic metadata contracts

- `semanticRoles` and `artifactRefs` arrays on symbols in `symbol-index.json`
- `semanticRoles` and `artifactRefs` arrays on symbol nodes in `code-graph.json`
- `evidenceRefs` collected from semantic roles for use in lookup output
- Semantic schema version `1.0.0` with defined role names

#### Data-model artifacts linked from index

- `data-model.json` and `data-model-graph.json` written by `index` when the TypeScript model analyzer produces output
- Artifact paths recorded in `manifest.json` under `semanticArtifacts`
- Compact `data-entity` and `data-field` roles embedded on qualifying symbols in index artifacts

#### Data-model extraction and inspection

- Conservative TypeScript model extraction for exported interfaces, type aliases, and classes
- Exact entity lookup by name or stable ID
- Exact field lookup by `Entity.field`
- `data-model.json`, `data-model-graph.json` as separate artifacts
- `data-model` command for focused inspection and regeneration

#### Conservative model-to-view lineage

- `model-view-lineage.json` produced in `data-model --trace-view` mode
- Conservative static lineage for supported transformation, view-model, component prop, and JSX rendering patterns
- `trace-view` mode for entity and field-level lineage

#### Semantic-aware commands

- `search`: indexes `semanticRole`, `semanticSubtype`, `semanticSource`, and `semanticArtifactRef` fields; returns semantic metadata on matched items
- `lookup`: returns `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the focus node
- `slice`: preserves `semanticRoles` and `artifactRefs` on nodes in the slice output
- `source`: propagates `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the symbol target

### Future work in this area

- Broader semantic role coverage: `route-handler`, `react-component`, `view-model`, `ui-only-state`, and others
- React and TSX semantic roles
- Browser storage and route roles
- Broader ORM and schema extractors (Prisma, SQL, TypeORM, Sequelize)
- Source retrieval expansion for semantic targets
- Graph visualization for data-model and lineage artifacts (DOT, SVG, PNG for `data-model-graph.json`)
- Analyzer profiles and selective analyzer runs
- Incremental indexing and scalability

## Version 1.2.0

Version 1.2.0 adds React/TSX and frontend-test indexing, exact source string retrieval and repeated literal reporting, React region retrieval, local component-tree prop/event-flow retrieval, and four new frontend semantic graph views.

### Implemented

#### TSX and React indexing

- exported component indexing (function and arrow-function forms)
- local component indexing
- prop type indexing
- hook block indexing (`useState`, `useEffect`, and others)
- event-handler indexing (named and inline)
- JSX region indexing
- frontend semantic artifact (`frontend-semantic.json`) written and registered in `manifest.json`

#### Frontend-test indexing

- `describe`, `test`, and `it` block indexing with titles
- `beforeEach` and `afterEach` setup/teardown indexing
- locator indexing (visible text, test ID, ARIA, locator chains)
- route-like string indexing
- test helper indexing

#### Exact string and repeated literal retrieval

- `source --contains <string>` — exact string search across all indexed source files
- `source --context <n>` — context lines around each match
- `source --path <prefix>` — path prefix filter for `--contains`
- match classification (`declaration-like`, `usage-like`, `unknown`) based on static heuristics
- frontend value context enrichment when the string is a frontend-indexed literal

#### React region retrieval

- `source --react-region <region> --file <path>` — retrieve a named React component, hook, handler, JSX region, or prop type by name
- case-insensitive region name matching with priority ordering
- JSON output includes `reactRegion` metadata block

#### Local component-tree prop/event-flow retrieval

- statically extracted flow relationships: `react-passes-prop`, `react-fires-event`, `react-handles-event`, `react-receives-prop`, `react-renders-local-component`, `react-handler-sets-state`, `react-handler-reads-state`
- `source --symbol <component> --file <path> --include-local-component-tree` — retrieve component and its local children as connected source blocks
- `source --prop <name>` — filter to a specific prop name

#### Frontend graph views

- `view --graph react-component` — static React component structure graph (file, component, local-component, prop-type nodes)
- `view --graph react-flow` — all frontend flow facts and relationships
- `view --graph react-prop-event-flow` — filtered to prop and event flow relationships only
- `view --graph frontend-test` — frontend test structure (test files, describe/test/it blocks, locators, route strings)

All four views are backed by `frontend-semantic.json` and render static artifact-backed graphs. They do not claim runtime React behavior, route reachability, or browser-state behavior.

### Future work for this area

- Route-aware retrieval shipped in v1.3
- Browser-storage tracing shipped in v1.3
- UI reachability analysis shipped in v1.3
- Source continuation and expansion are planned for v1.4

## Version 1.3.0

Version 1.3.0 adds route-aware, browser-storage-aware, and UI-reachability retrieval.

The goal is to help developers answer a practical frontend question: what route, component, UI marker, storage key, state gate, and test evidence are involved in a piece of UI?

All v1.3.0 facts are conservative static evidence. The tool records what the source text contains. It does not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

### Implemented

#### Frontend reachability artifact

- `frontend-reachability.json` written by `index` and registered in `manifest.json` (`semanticArtifacts.frontendReachability`) when the frontend analyzer runs on `.tsx`/`.jsx` files
- `frontend-reachability` analyzer registered in the `analyzers` array with `complete`/`partial`/`skipped` status and a summary of route/storage/UI/edge counts
- artifact kind `my-dev-kit-v1-frontend-reachability`, schema version `1.0.0`, deterministically ordered arrays

#### Route fact extraction (static)

- static route path strings from React Router `path`/`to`/`href` literals, the Next.js `pages/` file convention, and route strings mentioned in tests
- route path to owning component association
- `high`/`medium`/`low` confidence with `dynamic-route` warnings for non-literal segments

#### Browser storage key extraction (static)

- `localStorage`/`sessionStorage` static string keys from `getItem`/`setItem`/`removeItem`/`clear` calls
- storage key to component association and `useState` state-variable linkage in the same component scope
- `high`/`medium`/`low` confidence with `dynamic-storage-key` warnings for computed or template-literal keys

#### UI marker / reachability fact extraction (static)

- UI markers (`data-testid`, `aria-label`, visible text, `placeholder`, `aria-labelledby`) with component and JSX-region context
- JSX condition gates, state-gate linkage to storage keys, and route linkage through component membership
- test evidence linked by exact locator-value match (`getByTestId`/`getByLabel`/`getByText`/`getByPlaceholder`)
- `high`/`medium`/`low` confidence with `missing-test-evidence`, `dynamic-condition`, and `truncated-value` warnings

#### Cross-domain reachability edges

- `route-serves-component`, `component-uses-storage`, `component-renders-ui`, `storage-gates-ui`, `route-reaches-ui` (transitive), `test-covers-ui`, and `ui-in-gated-region`

#### Reachability-aware commands

- `search --route <path>`, `search --storage-key <key>`, `search --ui <value>`
- `lookup --route`, `lookup --storage-key`, `lookup --ui` (matching fact plus depth-1 neighbors)
- `slice --route`, `slice --storage-key`, `slice --ui` with `--include-tests`, `--include-storage`, and `--include-ui` modifiers
- `source --route`, `source --storage-key`, `source --ui` (bounded source at the defining lines)
- `view --graph route`, `view --graph browser-storage`, `view --graph ui-reachability`

Missing-artifact behavior: `search`/`lookup`/`slice`/`source` return a graceful empty/missing-artifact response at exit 0; `view` reports an error and exits non-zero. Each new selector is mutually exclusive with the others and with the legacy primary flag of the command.

### Future work for this area

- producer support for UI markers defined in local sub-components
- route-to-API-handler and access-policy relationships
- cookie storage key extraction

## Version 1.4.0

Version 1.4.0 adds source continuation and bounded local dependency expansion.

The goal is to reduce full-file reads when the correct file, symbol, or component is already known: "I found the right thing. Now give me the missing surrounding context without making me read the whole file."

### Implemented

#### Source continuation

- `source --file <path> --continue-from <n>` — reads from explicit line, returns `SourceSlice` with `ContinuationCursor`
- `source --file <path> --symbol <name> --continue` — continues from the end of the symbol's initial 20-line preview
- `source --node <id> --continue` — continues from the end of the node's initial preview window
- `source --file <path> --symbol <name> --continue-from <n>` — reads from explicit line with symbol metadata attached
- `ContinuationCursor` in all JSON responses: `nextStartLine`, `previousEndLine`, `exhausted`, `reason`, `symbolBoundaryKnown`
- `[CONTINUE: <file> from line N (reason: ...)]` and `[EOF: <file> (N lines total)]` footers in numbered output
- When symbol end line is unknown (symbol-index.json stores start line only): `reason = 'symbol-end-unknown'`, warning included

#### Local dependency expansion (source bundles)

- `--include-local-types` — same-file interface/type/enum definitions referenced in the primary window
- `--include-props` — same-file prop type definitions (exact end line from `frontend-semantic.json` when available)
- `--include-local-components` — same-file local React child components (requires `frontend-semantic.json`)
- `--include-local-deps` — composite: prop types + local types + constants above primary symbol + directly called helpers
- `--expand-to-local-dependencies` — alias for `--include-local-deps`
- `--include-imports` — local import-site lines; external packages and dynamic imports go to `skippedBlocks`
- `--max-bundle-lines <n>` — caps total bundle line count (default 300)
- `--max-blocks <n>` — caps total block count (default 20)
- `SourceBundle` output type: `primaryBlock`, `expansionBlocks`, `skippedBlocks`, `limits`, `stats`, `continuationCursors`, `warnings`
- Each block has `expansionReasons`, `confidence` (`high`/`medium`/`low`), `dedupeKey`, `targetRelationship`, optional `fallbackReason`
- Overlapping same-file blocks merged; both expansion reasons preserved
- Numbered output: block headers `=== [<kind>] <file>:<start>-<end> (<N> lines) — <reasons> ===`, skipped section, warnings section
- Skipped candidates: `skippedBlocks` with `reasonCode` (`external-package`, `dynamic-import`, `max-lines-reached`, `max-blocks-reached`, `artifact-unavailable`, `inside-primary-window`, etc.)

#### Static boundaries

- Direct, same-file dependency resolution only — no cross-file closure
- No runtime tracing, no browser execution
- Pattern-matching on source text for local type and helper detection — not semantic type-checking
- When `frontend-semantic.json` is absent: local component and prop expansion degraded or skipped with warnings
- `confidence: 'low'` blocks have estimated end lines (no FrontendSourceRef available)

### Future work for this area

- Cross-file dependency closure (v1.5+)
- Runtime component tree integration (future)
- Semantic type-checking for dependency detection (future)

## Version 1.5.0

Version 1.5.0 focuses on schema and layer classification and prepares the context-report foundation that the future orchestration layer will use.

The goal is to help developers avoid editing the wrong layer by classifying symbols, types, and files by their role in the project. The classifications, edit/avoid/readiness categories, and risk labels produced here form the schema that the v1.6 orchestrator will use to assemble task-specific context capsules.

### Symbol and type classification

Planned classifications:

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

### Context report improvements

Planned report fields:

- what is reachable today
- what is defined but unused
- what is read-only
- what is editable
- what is guest-safe
- what is authenticated-only
- what is canonical state
- what is projection state
- what route or user action reaches each component
- files that are safe to modify first
- files that should be avoided for the task

### Readiness categories

Planned categories:

- `ready`
- `needs-more-context`
- `risky-assumption`
- `wrong-layer-risk`
- `unreachable-ui-risk`
- `requires-test-validation`
- `requires-browser-validation`

## Version 1.6.0: Orchestrator / Graph-Guided Planner Packets

Version 1.6.0 introduces the orchestration layer that turns search, lookup, slice, source, semantic artifacts, and source bundles into compact task-specific context capsules and retrieval audit records.

The goal is to make graph locality directly affect what context is retained for a coding task. The orchestrator selects, prunes, and packages retrieval results into bounded planner packets that downstream tools and developers can use without reading broad unrelated context.

```mermaid
flowchart TD
  A[search] --> E[Orchestrator]
  B[lookup] --> E
  C[slice] --> E
  D[source] --> E
  E --> F[Context capsule / Planner packet]
  F --> G[Retrieval audit record]
```

### Graph-focused retrieval

Planned features:

- focus-node selection from ranked retrieval winners
- multi-seed graph focus when confidence is low
- subsystem-aware retrieval mode
- feature-add retrieval mode
- stronger ranking for sibling implementations
- stronger ranking for subsystem contracts
- stronger ranking for registries
- stronger ranking for local tests
- penalties for unrelated top-level files

### Planner packet pruning

Planned features:

- hard caps on candidate files
- hard caps on doc sections
- hard caps on source slices
- hard caps on graph nodes and edges
- graph-local file retention
- graph-local doc retention
- graph-local source-slice retention
- explicit explanation for retained and dropped entries

### Graph-first prompt packing

Planned features:

- prioritize graph-local code blocks
- prioritize graph-local doc sections
- prioritize graph-local source slices
- compress broad retrieval summaries when graph confidence is high
- omit broad context blocks when graph-local context is enough
- keep fallback behavior for low-confidence graph focus

## Version 1.7.0

Version 1.7.0 focuses on retrieval-quality regression benchmarks for validating the orchestrator and planner packets introduced in v1.6.

The goal is to make bounded-context quality testable and to confirm that the orchestrator selects the right context for representative coding tasks.

### Benchmark coverage

Planned benchmark task types:

- add a sibling implementation in a known subsystem
- modify a registry-driven feature
- update a route-level UI
- update a Playwright test by route
- modify a React component prop flow
- retrieve a session-storage workflow
- locate a hidden conditional render branch
- trace a repeated literal across a file or subsystem
- update a repeated tab value or enum-like string without reading the full file
- retrieve React render-flow regions without reading the full component file
- trace prop and event flow across a local React component tree
- remove a prop across local React child components without leaving orphaned references
- trace a data model field into a generated view model or rendered UI element
- distinguish canonical data-model usage from view-model or UI-only usage
- update a large TSX component without full-file retrieval
- distinguish canonical schema from projection schema
- retrieve data-model relationships for a schema-heavy project

### Assertions

Planned assertions:

- top-K retrieval quality
- graph-focus correctness
- planner packet size limits
- absence of unrelated generic files in top ranks
- source expansion correctness
- source continuation correctness
- exact string and reference tracing correctness
- React render-flow retrieval correctness
- intra-file prop and event-flow tracing correctness
- model-to-view lineage correctness
- canonical model versus view-model classification correctness
- no unnecessary full-file reads
- route, UI, and test coverage
- data-model graph correctness where applicable

### Metrics

Planned metrics:

- selected file count
- selected doc section count
- selected source slice count
- selected graph node count
- selected graph edge count
- reference match count
- React render-region retrieval coverage
- local component-tree retrieval coverage
- prop-flow and event-flow match count
- model-to-view lineage edge count
- rendered field usage count
- full-file reads avoided
- full-file reads allowed
- full-file reads unjustified
- fallback reason counts
- prompt-size reduction from graph-guided retrieval

## Version 1.8.0

Version 1.8.0 focuses on scalability and indexing ergonomics.

The goal is to make `my-dev-kit` more practical for larger repositories.

### Incremental indexing

Planned features:

- changed-file detection
- cache reuse
- partial index rebuild
- stable artifact IDs across rebuilds
- invalidation when configuration changes
- clear cache reset command

### Watch mode

Planned features:

- watch source roots
- rebuild changed files
- update affected graph artifacts
- report changed nodes and edges
- keep output deterministic

### Graph diff

Planned features:

- compare two index runs
- report added nodes
- report removed nodes
- report changed nodes
- report added edges
- report removed edges
- report changed edge metadata

### Search and lookup filtering

Planned features:

- filter search by node kind
- filter search by symbol kind
- filter search by edge kind
- filter lookup output by edge kind
- filter graph slices by node and edge kinds

## Version 1.9.0

Version 1.9.0 focuses on language and framework coverage.

The goal is to expand support while keeping static analysis conservative.

### Python improvements

Planned features:

- richer alias handling
- better cross-module call resolution
- better method-call resolution
- better class-member extraction
- better decorator metadata extraction
- better Django model extraction
- better SQLAlchemy model extraction

### JavaScript improvements

Planned features:

- improved JSDoc type extraction
- better CommonJS handling where practical
- better mixed JavaScript and TypeScript project support

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

### Additional language support

Candidate future languages:

- Go
- Rust
- Java
- C#
- Kotlin

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

### Plugin architecture

Candidate plugin categories:

- language plugins
- framework plugins
- test-framework plugins
- ORM plugins
- schema plugins
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

### Compatibility

Version 2.0.0 includes a compatibility plan for v1 artifacts.

If artifact formats change, the release provides one of the following:

- a migration command
- a compatibility reader
- a documented version boundary
- a clear artifact regeneration path

## Long-term direction

`my-dev-kit` should remain local-first, deterministic, and inspectable.

The core product direction is:

- compact structural artifacts instead of raw context dumps
- graph-guided retrieval instead of full-file reads
- bounded source context instead of broad source injection
- model-to-view lineage instead of manual tracing from schemas to generated UI
- literal and reference tracing instead of full-file string hunting
- React render-flow retrieval instead of full-component reading
- local React prop and event-flow tracing instead of full-file component-tree reading
- explicit fallback reporting instead of hidden assumptions
- conservative static analysis instead of overclaimed runtime understanding
- framework-aware retrieval where it improves real development workflows
- clear artifacts that can be inspected, versioned, and reused by humans or coding agents

The product should continue to work as a standalone CLI. Any future UI, hosted service, or agent integration should build on the same artifact model rather than replacing it.
