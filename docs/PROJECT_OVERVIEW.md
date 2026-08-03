# Project Overview

## What this project is

my-dev-kit is a local, deterministic command-line tool for indexing TypeScript, JavaScript, Python, Kotlin, Java, and supported Android projects; inspecting their structure; retrieving bounded source context; generating semantic and data-model artifacts; tracing supported static model-to-view lineage; and producing conservative Android Gradle, manifest, resource, navigation, and graph relationship evidence.

It runs offline and works through file-based JSON artifacts. It does not require a server, does not call external APIs, does not call language models, and does not modify source files.

## Purpose

Large codebases are difficult to inspect manually and too expensive to paste into coding-agent workflows without filtering. Developers usually need a smaller set of facts:

- where a file or symbol is located
- what a file imports or exports
- which symbols are defined in a file
- how graph nodes relate to one another
- what semantic role a symbol plays (data entity, data field, etc.)
- which source excerpt is relevant to a task
- which entities and fields exist in a supported model layer
- where a supported model field is statically transformed or rendered

my-dev-kit provides this structural and semantic view through deterministic local artifacts that can be searched, inspected, sliced, rendered, and reused by humans or downstream tools.

## Current release scope

Version 1.12.0 is the latest published release. It retains the stage-specific bounded context work through v1.10.4, the Compose semantic retrieval, Android test semantic indexing, and bounded Compose/Android-test graph views shipped in v1.11.0, and adds Android architecture classification, static Android ownership/data-flow relationships, exact Android-role retrieval, bounded data-flow/related-test slicing, and Android-aware context owner selection.

The current repository and package metadata contain these shipped implementation capabilities:

- indexing TypeScript, JavaScript, Python, Kotlin, and Java source roots
- extracting per-file symbol tables, imports, exports, dependencies, and source locations
- building a typed code graph of file and symbol nodes
- generating an optional static call graph
- running semantic analyzers as part of the index run
- embedding compact `semanticRoles` and `artifactRefs` on symbols and code-graph nodes
- recording analyzer status and artifact paths in `manifest.json` as the authoritative artifact registry
- searching indexed files, symbols, edges, and semantic roles by keyword
- looking up exact graph nodes with bounded neighbor expansion and semantic metadata
- retrieving bounded source by line range, symbol name, or node ID with semantic metadata propagation
- slicing a bounded graph neighborhood around a focus node with semantic metadata preserved
- rendering the code graph as DOT, SVG, or PNG
- generating `data-model.json` and `data-model-graph.json` as part of the index run
- conservative TypeScript model extraction for supported static model patterns
- exact entity and field inspection from data-model artifacts
- generating `model-view-lineage.json` in `trace-view` mode
- conservative static model-to-view lineage tracing for supported TypeScript and TSX cases
- generating `frontend-semantic.json` for supported TSX/JSX frontend structures
- generating `frontend-reachability.json` for static route, browser-storage, UI-marker, and cross-domain reachability evidence
- querying exact route, storage-key, and UI-marker facts through `search`, `lookup`, `slice`, and `source`
- rendering route, browser-storage, and UI-reachability graph views
- continuing bounded source retrieval past an initial preview window, and expanding to same-file local dependencies (types, props, local components, imports, helpers), with reasons for every included block (v1.4.0)
- running a conservative static classification analyzer that assigns files and symbols a schema/layer category, edit guidance, readiness, additive risk labels, evidence, and an uncertainty tier
- generating `classification.json` and embedding compact `classificationRoles`/`classificationRefs` on symbols and code-graph nodes
- surfacing classification metadata through `search`, `lookup` (including an opt-in `--resolve-classification` flag for full detail), `slice`, and `source` (v1.5.0)
- generating bounded `context-capsule.json` artifacts and optional `retrieval-audit-record.json` artifacts for query-focused downstream planning
- ranking context candidates deterministically with bounded `general`, `feature-add`, and `subsystem` mode behavior
- selecting bounded graph and source evidence for context capsules, with conservative static conflict detection and `--no-source` source suppression
- deterministic large-repo preflight warnings on `index` and `index --dry-run`
- default self-ignore of `.my-dev-kit` and `.my-dev-kit-*` output directories during indexing
- `index --incremental` with internal cache metadata, deterministic changed-file detection, and true no-change reuse
- `index --reset-cache` for clearing only incremental cache metadata
- partial incremental rebuild for `symbol-index.json` and `code-graph.json`, with stable unchanged file/symbol IDs and honest `call-graph.json` full-regeneration fallback
- `graph-diff` for deterministic, read-only comparison of two existing index directories
- static Android/Gradle project, module, and source-set detection, written to `android-project.json` (v1.9.0 Batch 1)
- conservative static Kotlin and Java structural indexing for `.kt`/`.java` files under indexed source roots, participating in `symbol-index.json`/`code-graph.json` like any other language (v1.9.0 Batch 2/3)
- conservative static Android component-role detection (Activity, Fragment, ViewModel, Service, BroadcastReceiver, ContentProvider, Worker, Repository, UseCase, Room Entity, Room DAO, Room Database, Retrofit service, Hilt/Dagger module), written to `android-components.json` (v1.9.0 Batch 4)
- Android component-role metadata surfaced through `search`, `lookup`, `source`, `slice`, `context`, and `graph-diff`, with `--incremental` compatibility (v1.9.0 Batch 5)
- static Android Gradle evidence for settings, modules, plugins, dependencies, SDK/configuration, source sets, and version catalogs in `android-gradle.json`
- static Android manifest evidence for application/components/permissions/features/intent filters/metadata and launcher/deep-link candidates in `android-manifest.json`
- static Android resource evidence for source sets, qualifiers, values/layout/file resources, IDs, references, and FileProvider/network-security records in `android-resources.json`
- static Android XML navigation and narrow Compose route evidence in `android-navigation.json`
- compact Android artifact-backed nodes and conservative candidate edges in the unified `code-graph.json`, with no parallel graph or `android-relationships.json`
- exact Android route, permission, resource, and component selectors through existing `search`, `lookup`, `source`, `slice`, context, and Android module/manifest/navigation graph views
- structured `ContextRequest` files and the `architecture`, `implementation`, and `test-implementation` context roles
- role-aware evidence groups, changed-surface intake, responsibility mapping, adequacy, freshness, bounded fallback and truncation reporting, and provenance
- `android-compose-semantic.json` schema `1.2.0`, covering supported composable declarations/structure plus conservative static state, effect, ViewModel, UI-marker, click, and navigation-call facts
- exact Compose retrieval through `--composable`, `--android-ui`, `--test-tag`, `--include-compose-tree`, `--include-viewmodel`, and `--include-navigation`
- `android-test-semantic.json` schema `1.0.0`, covering Android unit/instrumented test structure plus supported JUnit, Compose UI, Espresso, Robolectric, assertion, route, and test-double facts
- compact Compose and Android-test nodes and exact/ambiguity-preserving relationships projected into the existing `code-graph.json`, available through generic retrieval, context, and graph-diff
- bounded `compose-ui`, `compose-navigation`, and `android-test` code-graph views
- a complete Android classification vocabulary in `classification.json` (schema `1.1.0`): Android project/module, manifest/manifest-component, navigation-route, resource-file/xml-layout, Compose screen/UI-component, ViewModel, UI-only-state/UI-event, the reused Android component-role vocabulary (repository, use-case, Room entity/DAO/database, Retrofit service, Hilt module, Worker, broadcast-receiver, service, content-provider, Activity, Fragment), Android unit/instrumented/Compose-UI test categories, and a generated-build-path category — each with edit guidance, readiness, uncertainty, and up to seven advisory risk labels (`wrong-layer-risk`, `manifest-security-risk`, `generated-build-file-risk`, `resource-contract-risk`, `navigation-contract-risk`, `emulator-validation-required`, `instrumented-test-required`) (v1.12.0)
- `android-components.json` (schema `1.1.0`) additive `dependencyFacts[]`: five exact static component-dependency relationships (`viewmodel-uses-repository`, `repository-uses-dao`, `repository-uses-service`, `dao-uses-entity`, `room-database-exposes-dao`), projected into `code-graph.json` as new edges connecting existing symbol nodes, with resolved/ambiguous/unresolved candidate matching and no fabricated winner (v1.12.0)
- `android-compose-semantic.json` (schema `1.3.0`) additive Compose state-ownership fields and `activityHostFacts[]`, projected as `compose-state-reads-viewmodel` and `activity-hosts-composable` edges, with classification refinement for ViewModel-owned collected state (v1.12.0)
- `search --android-role <role>` — an exact 31-value Android classification-role selector reusing the existing `SearchIndexResult` artifact, Android-provenance filtered, mutually exclusive with every other search selector (v1.12.0)
- `slice --include-data-flow` — a bounded bidirectional secondary traversal over a fixed Android ownership/data-flow edge allowlist (Activity/Compose/ViewModel/Repository/DAO/Entity/Retrofit/Room/route-to-screen), and an Android-aware extension of the existing `slice --include-tests` modifier pulling bounded related Android test evidence — both additive summary objects (`androidDataFlow`, `androidTests`), no new option (v1.12.0)
- Android-aware `context` (`architecture`/`implementation`/`test-implementation`): an internal deterministic ten-intent Android task classifier, a fixed intent-to-owner-category preference matrix, generated/test-only production-owner exclusion, usage-versus-owner suppression (a projected usage node never outranks its exact stronger owner once both are candidates), a bounded Android ownership/data-flow owner-support traversal reusing the `slice --include-data-flow` allowlist, and six wrong-layer conflict kinds (`android-generated-primary-target`, `android-test-primary-target`, `android-usage-selected-over-owner`, `android-ambiguous-owner`, `android-unresolved-owner`, `android-classification-graph-disagreement`) added to the existing conflict record via an additive `kind` field — `context-capsule.json`/`retrieval-audit-record.json` remain schema `"1.0.0"`, with no new role, request field, or public flag (v1.12.0)
- full-versus-incremental artifact equivalence and deterministic ordering across the complete classification/component/Compose artifact family, including stale-evidence removal and generic `graph-diff` coverage (v1.12.0)

Static-analysis boundaries remain identical to every earlier Android batch: no Gradle/Kotlin/Compose/test execution, no dependency-injection resolution, no database or network inspection, no emulator, and no runtime UI/navigation/reachability proof. Android architecture classification is advisory evidence, not an automatic edit decision. See [ROADMAP.md](ROADMAP.md) for the full v1.13.0 plan, [COMMANDS.md](COMMANDS.md) for the exact command/flag contracts, [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) for artifact schemas, and [ARCHITECTURE.md](ARCHITECTURE.md) for subsystem ownership.

## Public commands

my-dev-kit provides nine public commands.

| Command | Purpose |
| --- | --- |
| `index` | Index source roots, run semantic analyzers, and write all artifacts |
| `search` | Search indexed files, symbols, edges, and semantic roles by keyword |
| `lookup` | Look up a graph node by exact node ID, including semantic metadata |
| `source` | Retrieve bounded source by line range, symbol name, or node ID |
| `slice` | Build a bounded graph neighborhood around a focus node |
| `view` | Render the code graph as DOT, SVG, or PNG |
| `data-model` | Inspect exact entities or fields, regenerate data-model artifacts, and trace supported static view usage |
| `context` | Build a bounded context capsule and optional retrieval audit for a task query against an existing index |
| `graph-diff` | Compare two existing index directories and report added, removed, and changed graph and artifact metadata |

## Generated artifacts

The `index` command writes:

- `manifest.json` — artifact registry, analyzer registry, project metadata, and summary counts
- `symbol-index.json` — per-file symbol tables with compact semantic roles per symbol
- `code-graph.json` — graph of file and symbol nodes with compact semantic roles on symbol nodes
- `call-graph.json` — optional static call graph, when `--call-graph` is requested
- `data-model.json` — data entities, fields, relationships, and source evidence, when the TypeScript model analyzer runs
- `data-model-graph.json` — derived semantic graph of data-model entities and fields, when the TypeScript model analyzer runs
- `frontend-semantic.json` — React component, prop, hook, handler, JSX, and test facts, when the frontend analyzer runs on TSX/JSX files
- `frontend-reachability.json` — static route, browser-storage, and UI-marker reachability facts, when the frontend analyzer runs on TSX/JSX files
- `classification.json` — conservative static schema/layer classification of files and symbols, whenever the classification analyzer runs (v1.5.0)
- `android-project.json` — static Android/Gradle project, module, and source-set detection (detection only — Kotlin/Java symbol data lives in `symbol-index.json`/`code-graph.json` instead, as of Batch 2/Batch 3), whenever Android evidence is found under `--root` (v1.9.0 Batch 1)
- `android-components.json` — conservative static Android component-role detection (Activity/Fragment/ViewModel/Service/BroadcastReceiver/ContentProvider/Worker/Repository/UseCase/Room-Entity/Room-DAO/Room-Database/Retrofit-service/Hilt-module) over already-indexed Kotlin/Java top-level symbols, whenever at least one role is detected in an Android project (v1.9.0 Batch 4)
- `android-gradle.json` — static Gradle project, module, plugin, dependency, source-set, and version-catalog evidence when applicable
- `android-manifest.json` — static manifest declarations and candidates without manifest merging
- `android-resources.json` — static resource definitions, references, qualifiers, and security-related resource records without runtime overlay selection
- `android-navigation.json` — static XML navigation and bounded Compose route evidence without runtime reachability proof

- `android-compose-semantic.json` - v1.11.0 conservative static Compose declaration, structure, state/effect/ViewModel/UI/click/navigation evidence when supported Compose source is detected
- `android-test-semantic.json` - v1.11.0 Android `test`/`androidTest` structure and static JUnit/Compose/Espresso/Robolectric/assertion/route/test-double evidence when detected

The `context` command writes `context-capsule.json` and, when requested, `retrieval-audit-record.json`. These are bounded retrieval outputs, not index artifacts registered in `manifest.json`.

The `data-model` command additionally writes:

- `model-view-lineage.json` — conservative static lineage, in `trace-view` mode

The recommended local artifact directory is:

```sh
.my-dev-kit
```

Re-run `index` to refresh the artifact directory when source changes. Stale artifacts are removed automatically. `manifest.json` always reflects the current artifact state.

The data-model and lineage artifacts are separate from `code-graph.json` and use their own node and edge ID space.

## Typical user workflow

Install the package globally:

```sh
npm install -g @dailephd/my-dev-kit
```

Index a project:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

Re-run `index` to refresh when source changes:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

Search to discover relevant node IDs, including by semantic role:

```sh
my-dev-kit search --index .my-dev-kit --query "<term>" --limit 20 --json
```

Look up a selected node with semantic metadata:

```sh
my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json
```

Build a graph slice around the selected node:

```sh
my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
```

Retrieve source context:

```sh
my-dev-kit source --index .my-dev-kit --file "<path>" --start <n> --end <n> --format numbered
```

Inspect a generated entity or field:

```sh
my-dev-kit data-model --index .my-dev-kit --entity User --json
my-dev-kit data-model --index .my-dev-kit --field User.email --json
```

Trace supported static view usage:

```sh
my-dev-kit data-model --index .my-dev-kit --trace-view User --json
my-dev-kit data-model --index .my-dev-kit --field User.email --trace-view --json
```

## Conservative static analysis stance

The semantic and data-model layers build on the existing artifact model and remain deliberately narrow.

Current repository scope (published through v1.12.0):

- conservative TypeScript model extraction producing `data-entity` and `data-field` semantic roles
- compact semantic metadata embedded in structural artifacts, linked to detailed artifacts via `artifactRefs`
- conservative same-project static lineage where field identity remains explicit
- React/TSX frontend analysis producing `frontend-semantic.json` with components, hooks, handlers, JSX regions, and UI strings
- exact source string retrieval with context, classification, and repeated literal reporting
- React region and local component-tree prop/event-flow retrieval
- frontend semantic graph views: react-component, react-flow, react-prop-event-flow, frontend-test
- static frontend reachability analysis producing `frontend-reachability.json`
- exact route, storage-key, and UI-marker retrieval with bounded source and graph views
- bounded source continuation and same-file local dependency expansion (v1.4.0)
- conservative static schema/layer classification of files and symbols, producing `classification.json` and compact `classificationRoles`/`classificationRefs` (v1.5.0)
- bounded context capsules and retrieval audit records with deterministic query planning, candidate ranking, graph/source selection, retention, adequacy assessment, conservative static conflict detection, and optional source suppression (v1.6.0)
- deterministic large-repo preflight warnings and indexing self-ignore for `.my-dev-kit` outputs (v1.8.0 Batch 1)
- incremental indexing cache metadata, changed-file detection, and `--reset-cache` (v1.8.0 Batch 2)
- partial incremental rebuild for `symbol-index.json`/`code-graph.json`, with honest `call-graph.json` artifact fallback (v1.8.0 Batch 3)
- deterministic read-only `graph-diff` comparison of two index directories (v1.8.0 Batch 4)
- static Android/Gradle project, module, and source-set detection producing `android-project.json` — detection only, no Java structural indexing (v1.9.0 Batch 1)
- conservative static Kotlin structural indexing (`.kt` files under `--src`): package/imports, top-level classes/interfaces/objects/data classes/sealed classes/enums/functions/extension functions/properties, surfaced in `symbol-index.json`/`code-graph.json` — no class-member symbols, no call-graph edges, no Kotlin compiler execution (v1.9.0 Batch 2)
- conservative static Java structural indexing (`.java` files under `--src`): package/imports (including `static` and wildcard forms), top-level classes/interfaces/enums/records/annotation-type declarations, surfaced in `symbol-index.json`/`code-graph.json` — no method/field/constructor symbols, no call-graph edges, no `javac`/Maven/Gradle execution (v1.9.0 Batch 3)
- conservative static Android component-role detection over already-indexed Kotlin/Java top-level symbols (14 roles: Activity/Fragment/ViewModel/Service/BroadcastReceiver/ContentProvider/Worker/Repository/UseCase/Room-Entity/Room-DAO/Room-Database/Retrofit-service/Hilt-module), producing `android-components.json` plus compact role metadata on the matching `symbol-index.json`/`code-graph.json` symbols — evidence-tiered confidence (annotation/superclass > import > path > name-suffix), never claims manifest declaration or runtime DI/navigation correctness (v1.9.0 Batch 4)
- hardened and tested retrieval/command compatibility for `index`/`search`/`lookup`/`source`/`slice`/`context`/`graph-diff`/`--incremental` when Android project facts, Kotlin symbols, Java symbols, and Android component roles coexist in one index — no new commands, flags, or artifacts (v1.9.0 Batch 5)
- static Android Gradle/manifest/resource/navigation artifacts, unified Android graph relationships, exact Android retrieval selectors, Android-aware context, and Android graph views (v1.10.0 Batches 1-7)
- conservative Compose semantic artifact production, code-graph projection, exact selectors/source bundles/slices, generic retrieval/context/graph-diff participation, and three bounded graph views (v1.11.0)
- conservative Android unit/instrumented test semantic artifact production and generic graph/retrieval participation without inserting test files into the core symbol index (v1.11.0)
- Android architecture classification, static Android ownership/data-flow relationships, exact Android-role retrieval, bounded data-flow/related-test slicing, and Android-aware context owner selection (v1.12.0)
- warnings for unsupported, ambiguous, or low-confidence patterns

Current scope does not claim:

- Android build/test/application/emulator execution, dependency resolution, manifest merging, runtime resource selection, runtime intent/deep-link/route/UI proof, runtime coverage proof, or Android security validation
- full ORM or schema coverage
- runtime database behavior
- runtime React rendering behavior
- runtime route reachability
- runtime browser-state tracing
- full React render-flow tracing
- semantic similarity search or embedding-based retrieval
- watch mode
- retrieval filtering for search/lookup/slice/source or graph-diff
- dedicated `call-graph.json` diff output
- partial non-fallback call-graph rebuild
- an automatic or authoritative "safe to edit" decision — classification edit guidance, readiness, and risk labels are advisory signals backed by static evidence, not a substitute for the developer's own judgment
- the v1.7.0 internal retrieval regression suite or a plugin architecture

## What my-dev-kit does not do

my-dev-kit does not provide:

- LLM calls
- external API integrations
- code editing or source modification
- autonomous agent execution
- semantic similarity search or embedding-based retrieval
- package publishing automation
- GitHub release automation

## Product boundary with my-dev-kit-lab

`my-dev-kit` owns product retrieval behavior. v1.7.0 provides an internal retrieval regression suite that checks whether deterministic fixtures still produce the right bounded context, source, classification, conflict, and audit behavior after product changes. `npm run benchmark:retrieval` runs six representative local tasks through the real index/context pipeline, evaluates stable expectations, captures capsule/audit/execution artifacts, and reports `PASS`, `REGRESSION`, or `BLOCKED`. It remains separate from `npm run verify` and is not a public command, performance benchmark, browser/runtime check, LLM evaluation, or exhaustive coverage claim.

`my-dev-kit-lab` owns release and security validation. It answers whether a release candidate is safe to ship, whether package contents and dependencies are acceptable, and whether external release gates passed. It should not replace product-specific retrieval-quality assertions inside `my-dev-kit`.

### v1.10.1 ecosystem boundary

For the implemented stage-role context patch, `my-dev-kit` continues to own only deterministic indexing and bounded repository-evidence retrieval: request validation, architecture/implementation/test-implementation roles, candidates/ranking/graph/source selection, repository-evidence budgets, changed-surface and graph-diff intake, test-infrastructure discovery, responsibility-to-evidence mapping, adequacy/freshness, capsules, audits, and deterministic serialization.

my-dev-kit-orchestrator v1.2.1 owns workflow catalogs and IDs, exact workflow dependency resolution, `WorkflowInstructionPacket`, TaskState, prompt assembly, stage order, lifecycle, manual freshness policy, correction/judge behavior, and publication authorization. The current orchestrator does not automatically run my-dev-kit; initial integration remains prompt-guided.

my-dev-kit-lab v0.4.3 owns controlled strategy evaluation, context size, explicit required-evidence recall, irrelevant inclusion, mapping/provenance/truncation/inadequacy/determinism evaluation, target immutability, reports/plots/screenshots, security validation, and code-rot auditing. It must not become a production context or workflow runtime.

my-dev-kit does not own workflow-stage progression, prompt assembly, judge interpretation, agent execution, publication, source/test editing, security validation, or workflow-catalog semantics in v1.10.1. Static repository evidence never proves runtime behavior.

## Current limitations

The v1.12.0 evidence is conservative static analysis. Dynamic or unsupported Compose/test expressions remain unresolved or omitted with warnings; exact-match ambiguity is preserved; resource values and runtime UI visibility are not inferred. Android benchmark expansion and public example coverage remain v1.13.0 responsibilities.

- Symbol records include start lines but not complete end-line bounds.
- Symbol-mode source retrieval returns a bounded preview from the symbol start line and may include a capped-preview warning.
- Use line-range retrieval when exact source bounds are required.
- Call graph extraction is best-effort static syntactic analysis.
- Data-model extraction is conservative and limited to supported TypeScript model patterns.
- Semantic roles currently produced: `data-entity` and `data-field` from `typescript-model-analyzer`. Other defined roles are planned.
- Unsupported dynamic or ambiguous lineage patterns are warned or omitted.
- Lookup requires exact node IDs, exact entity names or IDs, and exact `Entity.field` selectors.
- Route, browser-storage, and UI-reachability analysis remain conservative static evidence only and may omit dynamic or computed values.

## Support the project

my-dev-kit is independently developed and maintained by dailephd / dailephd LLC.

If the project helps your work, you can optionally support continued development through:

- GitHub Sponsors: https://github.com/sponsors/dailephd
- PayPal: https://paypal.me/daile88

Support is appreciated, but not required. The project remains usable under its published license.

## Documentation map

- [README.md](../README.md) - installation, quickstart, and release-level feature summary
- [QUICKSTART.md](QUICKSTART.md) - guided first-use workflow
- [COMMANDS.md](COMMANDS.md) - full command and flag reference
- [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) - artifact formats, node IDs, edge kinds, semantic roles, and downstream artifact structure
- [ARCHITECTURE.md](ARCHITECTURE.md) - internal subsystem structure and design boundaries
- [WORKFLOWS.md](WORKFLOWS.md) - practical usage workflows and graph-guided retrieval
- [SECURITY.md](SECURITY.md) - security model, path boundaries, subprocess behavior, and audit notes
- [DEVELOPMENT.md](DEVELOPMENT.md) - source-repository setup, tests, build, and local package testing
- [RELEASE.md](RELEASE.md) - manual npm release checklist
- [ROADMAP.md](ROADMAP.md) - version plans and explicit deferrals
