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

Planned and incremental improvements:

- default ignore rules for common generated folders
- `--exclude` support where missing
- `--dry-run` support for expensive commands
- progress reporting during indexing
- clearer output when a repository is large
- safer behavior when a command would scan too many files
- documentation for indexing large monorepos

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

Version 1.7.0 focuses on retrieval-quality regression benchmarks.

The goal is to make bounded-context quality testable and to confirm that retrieval selects the right context for representative coding tasks.

### Benchmark coverage

Planned benchmark task types:

- add a sibling implementation in a known subsystem
- modify a registry-driven feature
- update a route-level UI
- update a Playwright or Vitest test by route or locator
- modify a React component prop flow
- retrieve a session-storage workflow
- locate a hidden conditional render branch
- trace a repeated literal across a file or subsystem
- update a repeated tab value or enum-like string without reading the full file
- retrieve React render-flow regions without reading the full component file
- trace prop and event flow across a local React component tree
- trace a data model field into a generated view model or rendered UI element
- distinguish canonical data-model usage from view-model or UI-only usage
- update a large component without full-file retrieval

### Assertions

Planned assertions:

- top-K retrieval quality
- graph-focus correctness
- context packet size limits
- absence of unrelated generic files in top ranks
- source expansion correctness
- source continuation correctness
- exact string and reference tracing correctness
- React render-flow retrieval correctness
- local component-tree retrieval correctness
- model-to-view lineage correctness
- canonical model versus view-model classification correctness
- no unnecessary full-file reads
- route, UI, and test coverage

### Metrics

Planned metrics:

- selected file count
- selected source slice count
- selected graph node count
- selected graph edge count
- reference match count
- render-region retrieval coverage
- local component-tree retrieval coverage
- model-to-view lineage edge count
- full-file reads avoided
- full-file reads allowed
- full-file reads unjustified
- fallback reason counts
- prompt-size reduction from graph-guided retrieval

## Version 1.8.0

Version 1.8.0 focuses on scalability and indexing ergonomics.

The goal is to make `my-dev-kit` more practical for larger repositories before expanding into heavier multi-language and Android projects.

### Planned capabilities

#### Incremental indexing

- changed-file detection
- cache reuse
- partial index rebuild
- stable artifact IDs across rebuilds
- invalidation when configuration changes
- clear cache reset command

#### Watch mode

- watch source roots
- rebuild changed files
- update affected graph artifacts
- report changed nodes and edges
- keep output deterministic

#### Graph diff

- compare two index runs
- report added nodes
- report removed nodes
- report changed nodes
- report added edges
- report removed edges
- report changed edge metadata

#### Search and lookup filtering

- filter search by node kind
- filter search by symbol kind
- filter search by edge kind
- filter lookup output by edge kind
- filter graph slices by node and edge kinds

## Version 1.9.0

Version 1.9.0 starts Android support with Android project detection and Kotlin/Java structural indexing.

The goal is to let `my-dev-kit` recognize Android project structure and retrieve useful Kotlin/Java source context without rewriting the existing artifact model.

### Planned capabilities

#### Android project detection

- detect Android projects from Gradle files and Android manifests
- detect Gradle modules
- distinguish app modules and library modules
- detect source sets such as `main`, `test`, and `androidTest`
- detect Kotlin source roots
- detect Java source roots
- detect generated/build directories that should be ignored

Candidate artifacts:

- `android-project.json`
- `android-modules.json`

#### Kotlin structural indexing

- `.kt` file discovery
- package declarations
- imports
- classes
- interfaces
- objects
- data classes
- sealed classes
- enums
- functions
- extension functions
- properties
- constructors
- annotations
- `suspend` functions
- basic coroutine and `Flow`/`StateFlow` usage markers

#### Java structural indexing

- `.java` file discovery
- package declarations
- imports
- classes
- interfaces
- enums
- methods
- fields
- annotations
- `extends` and `implements` relationships

#### Android component detection

Static detection for common Android classes and patterns:

- `Activity`
- `Fragment`
- `ViewModel`
- `Service`
- `BroadcastReceiver`
- `ContentProvider`
- `Worker`
- repository classes
- use-case classes
- Room entities and DAOs when detectable by annotations
- Retrofit services when detectable by annotations
- Hilt/Dagger modules when detectable by annotations

#### Command integration

- include Kotlin/Java symbols in `symbol-index.json`
- include Kotlin/Java file and symbol nodes in `code-graph.json`
- preserve existing TypeScript/JavaScript/Python behavior
- keep Android artifacts registered in `manifest.json`
- keep static-analysis boundaries explicit

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

Static parsing for:

- `settings.gradle`
- `settings.gradle.kts`
- `build.gradle`
- `build.gradle.kts`
- `gradle/libs.versions.toml`

Extract where practical:

- included modules
- Android Gradle plugin usage
- application/library module type
- namespace
- application ID
- min SDK
- target SDK
- compile SDK
- build types
- product flavors
- dependencies
- plugins
- source sets

Candidate artifact:

- `android-gradle.json`

#### Manifest artifact

Static parsing for `AndroidManifest.xml`:

- package/namespace information where available
- permissions
- activities
- services
- receivers
- providers
- exported components
- intent filters
- launcher activity
- deep links
- application metadata

Candidate artifact:

- `android-manifest.json`

#### Resource artifact

Static resource indexing for:

- `res/values/strings.xml`
- `res/values/colors.xml`
- `res/values/themes.xml`
- `res/drawable/`
- `res/mipmap/`
- `res/xml/`
- `res/layout/` when XML views are used

Extract where practical:

- string resource keys
- style/theme names
- color names
- drawable names
- layout IDs
- view IDs
- navigation XML references

Candidate artifact:

- `android-resources.json`

#### Navigation artifact

Static parsing for Android navigation evidence:

- XML navigation graph destinations when present
- Compose route string constants when detectable
- deep-link mappings from manifest/navigation resources
- screen-to-route relationships when statically visible

Candidate artifact:

- `android-navigation.json`

### Command integration

Candidate selectors:

- `search --android-route <route>`
- `search --permission <permission>`
- `search --resource <name>`
- `lookup --android-component <name>`
- `source --android-route <route>`
- `slice --android-route <route>`
- `view --graph android-module`
- `view --graph android-manifest`
- `view --graph android-navigation`

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
