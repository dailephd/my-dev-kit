# Commands

This is the installed CLI reference for `@dailephd/my-dev-kit`. The reviewed public surface is `1.12.3`: nine commands, with the v1.12.1 evidence-limit corrections and v1.12.3 context-readiness and responsibility-mapping corrections. Package versions and artifact schema versions are separate.

Use [WORKFLOWS.md](WORKFLOWS.md) for ordered my-dev-kit usage and [ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md) for workflows combining Orchestrator, Lab, Observer, project tests, and coding-agent execution. This file does not redefine companion CLIs.

Detailed artifact fields, node/edge kinds, classification metadata, and compatibility contracts remain in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md). Implementation ownership is in [ARCHITECTURE.md](ARCHITECTURE.md). Maintainer npm scripts belong in [DEVELOPMENT.md](DEVELOPMENT.md), and future commands remain in [ROADMAP.md](ROADMAP.md).

## Installation

```powershell
npx @dailephd/my-dev-kit --help
npx @dailephd/my-dev-kit --version
npm install -g @dailephd/my-dev-kit
my-dev-kit --help
```

Use either the installed binary or `npx`, not both as different product surfaces. A source checkout may instead use `npm ci`, `npm run build`, and `node dist/cli.js`. Do not require a checkout for the nine public commands. Record the resolved package version for reproducibility. A local installation can determine what `npx` resolves.

The commands are `index`, `search`, `lookup`, `source`, `slice`, `view`, `data-model`, `context`, and `graph-diff`. Use `<command> --help` against the actual installation before composing commands from different versions.

## Path conventions

Run examples from the target project root unless another root is explicit. Replace placeholders before execution. One-line examples work in PowerShell and common Unix shells. Shell redirection, process management, and cleanup remain shell-specific.

- `index --root` defines the project root. Repeated `--src` paths and relative `--out` are resolved against that root.
- Retrieval commands use `--index` to locate an existing artifact directory. Most default it to `.my-dev-kit`; `data-model` requires it explicitly.
- Output paths on other commands are operational filesystem paths. Do not reuse the `index --root` rule for every command.
- Node IDs and artifact-relative paths are identities, not arbitrary absolute file paths. Discover IDs with `search` before exact lookup/source/slicing.
- `manifest.json` is the index identity and artifact registry. Do not infer available current artifacts from stray filenames left in a directory.
- Refresh the normal working index in place. Keep before/after snapshots separate and immutable when a comparison needs them.
- `source` reads the indexed project's source. A graph snapshot alone is not a complete historical source checkout. Preserve a matching checkout when retrieving historical code.

```powershell
npx @dailephd/my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "service" --limit 20 --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "<returned-node-id>" --depth 1 --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --node "<returned-source-node-id>" --format numbered
```

## Result and safety rules

my-dev-kit is local-first and read-only toward target source. It does not call an LLM, execute the target application or its tests, connect to a database, perform browser verification, or run security validation. It writes its own requested artifacts and uses supported local tools for analysis/rendering. Python parsing and Graphviz rendering are not target-program execution.

A successful command invocation is not necessarily useful or sufficient evidence. Inspect statuses, warnings, ambiguity, omissions, freshness, and adequacy. A valid empty graph, missing optional artifact, exact selector with no match, or graph difference may be a normal result. Do not convert exit 0 into a blanket feature PASS.

The top-level asynchronous error handler reports errors and sets exit code 2. Parser failures may have their own nonzero status. Do not assume every error is exit 1. `graph-diff` is reporting-only and returns success for valid comparisons with or without differences. It is not a regression gate by itself.

`--json` selects structured stdout where supported. Index progress uses stderr. Keep shell/package-manager diagnostics separate from saved JSON. Do not hand-edit generated context capsules or audits to change their meaning.

## index

Build or refresh an index and its applicable artifacts.

```powershell
npx @dailephd/my-dev-kit index --root <project-root> --src <source-root> --out <artifact-dir> --json
```

### Flags

- `--root <path>`: project root.
- `--src <path>`: required source root relative to the project root. Repeat for additional source/test roots.
- `--language <language>`: `typescript`, `javascript`, or `python`. Kotlin and Java are discovered by extension, not `--language kotlin` or `--language java`.
- `--out <dir>`: output directory, default `.my-dev-kit`, relative to `--root` when not absolute.
- `--exclude <path-or-name>`: additional directory name or relative path prefix. Repeat as needed. This is not a glob expression.
- `--dry-run`: discover/report inputs without writing index artifacts.
- `--progress`: bounded progress diagnostics on stderr.
- `--call-graph`: produce conservative static call-graph evidence for supported languages.
- `--incremental`: use eligible cached per-file analysis and report reuse/fallback.
- `--reset-cache`: clear internal cache metadata before running. It does not delete ordinary public artifacts by itself.
- `--json`: structured command result.

### Languages and source-root boundaries

Supported extensions are `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.kt`, and `.java`. Python analysis requires an available supported Python interpreter. Missing interpreter evidence is reported rather than treated as successfully analyzed Python.

Kotlin and Java structural extraction is conservative and line/regular-expression based, not compiler parsing. It records supported top-level declarations, imports, and signatures. It does not create general member-symbol or type/classpath resolution, execute Gradle/Maven, or resolve dynamic calls. Kotlin/Java files do not acquire a complete call graph from `--call-graph`. Other supported languages in the same run retain their call-graph behavior.

Android detection examines project evidence under `--root`, but does not expand the user's explicitly selected structural `--src` roots. Android test evidence uses detected `test` and `androidTest` roots under its documented analyzer contract.

### Default ignored directories

Common dependency/output/cache directories are skipped, including `node_modules`, `.next`, `dist`, `build`, `coverage`, `playwright-report`, `test-results`, `output`, `out`, `.cache`, `.turbo`, `.vercel`, `.git`, `.pytest_cache`, `__pycache__`, `.venv`, `venv`, `.gradle`, `.my-dev-kit`, and directory names beginning `.my-dev-kit-`. Directory-name rules apply at nested depths too.

Use explicit source roots rather than scan an entire monorepo by default. Add project-specific exclusions, not broad exclusions that silently remove required code or tests.

### Indexing large monorepos

```powershell
npx @dailephd/my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --dry-run --json
npx @dailephd/my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --progress --json
npx @dailephd/my-dev-kit index --root . --src apps/web/tests --src apps/web/e2e --out .my-dev-kit-web-tests --json
```

Separate indexes can bound unrelated domains, but do not pretend relationships absent from an index were analyzed. Record which roots each index covers.

### Large-repo preflight warnings (v1.8.0)

Preflight reports deterministic advisories such as `large-file-count` above 5000 eligible files and `broad-source-root` when a selected source root is the project root and exceeds 1000 discovered files. These are warnings, not failure or a guarantee that a run will succeed. Inspect the counts and select narrower roots when appropriate.

### Incremental indexing (v1.8.0)

Partial rebuild reuses unchanged per-file structural analysis, reanalyzes added/changed files, drops removed files, and recomputes global import/graph relationships over the merged current set. It is not a promise to reuse every artifact.

`call-graph.json` is fully regenerated when requested during a partial rebuild. Data-model, frontend, reachability, and classification analyzers regenerate their artifacts from current merged evidence. Android evidence and configuration can invalidate reuse under their own fingerprint rules. Inspect reported fallback rather than label all output cached.

Internal `cache-metadata.json` records fingerprints and per-file reuse data. It is not a public semantic artifact or a replacement for manifest identity.

Reported cache modes are:

- `incremental-full-initial`: no usable cache, full build and cache creation.
- `incremental-full-cache-incompatible`: incompatible/unreadable cache or required prior data, full rebuild.
- `incremental-full-config-changed`: changed configuration fingerprint, full rebuild.
- `incremental-no-change`: reuse of existing artifacts without rewriting them.
- `incremental-partial`: eligible structural partial rebuild.
- `incremental-partial-with-artifact-fallback`: partial structural rebuild plus reported full artifact regeneration.
- `incremental-change-detected-full-rebuild`: changed inputs with unsafe partial reuse, full rebuild and explicit reason.

The result reports changed-file counts/samples where a comparable prior baseline exists. A no-change invocation leaves the existing manifest describing the earlier build that produced it. Read the invocation's `cache` result for the current action.

```powershell
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --incremental --json
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --reset-cache --incremental --json
```

Do not delete the baseline required by a pending comparison. Watch mode and universal artifact-specific partial reuse are not implied by incremental indexing.

### Artifacts and Android evidence

`manifest.json`, `symbol-index.json`, and `code-graph.json` define the normal structural index. Applicable optional/derived families include `call-graph.json`, `data-model.json`, `data-model-graph.json`, `model-view-lineage.json`, `frontend-semantic.json`, `frontend-reachability.json`, and `classification.json`. Inspect the manifest for the current run and use `data-model` when additional model/lineage generation is needed.

Android families include `android-project.json`, `android-components.json`, `android-gradle.json`, `android-manifest.json`, `android-resources.json`, `android-navigation.json`, `android-compose-semantic.json`, and `android-test-semantic.json`. Applicable analyzers project their nodes/relationships into the existing code graph. There is no separate `android-relationships.json` command prerequisite.

Static project/module/source-set, plugin/dependency declarations, manifest permissions/components/intent filters/deep links, resource definitions/references, navigation candidates, Compose facts, component roles, state-owner relationships, and test facts retain their documented uncertainty. They do not prove Gradle resolution, manifest merging, runtime resource selection, dependency injection, rendering, navigation, test execution, network/database behavior, or security posture. Binary resources are not decoded into invented text.

For complete artifact schemas, stable identities, supported fact categories, and analyzer-specific limitations, use [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) and [ARCHITECTURE.md](ARCHITECTURE.md). These are artifact contracts, not additional CLI commands.

## search

Discover files, symbols, graph evidence, and specialized static facts.

```powershell
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "UserService" --limit 20 --json
```

### Flags and selectors

- `--index <dir>`: default `.my-dev-kit`.
- `--query <text>`: ranked general search.
- Web selectors: `--route <path>`, `--storage-key <key>`, `--ui <value>`.
- Android selectors: `--android-route <route>`, `--permission <name>`, `--resource <name>`, `--android-component <name>`, `--composable <name>`, `--test-tag <tag>`, `--android-ui <value>`.
- `--android-role <role>`: one exact supported Android classification role.
- `--limit <n>`: general/role result limit, integer 1 through 100, default 20. Do not assume this changes every specialized selector's own candidate contract.
- `--json`: structured result.

Use one selector family per request. Do not combine `--query` with a web/Android selector. `--android-role` is mutually exclusive with `--query` and every other selector. Exact selectors preserve all ambiguous candidates instead of selecting a fuzzy winner.

Android resources accept documented forms such as `string/app_name`, `@string/app_name`, or a bare name. Manifest components support exact fully qualified name, raw manifest name, or simple name. A simple name may be ambiguous. Composable selection supports its documented name/stable declaration identity. Test-tag selection uses the resolved literal, not an arbitrary Kotlin constant identifier.

```powershell
npx @dailephd/my-dev-kit search --index .my-dev-kit --route "/settings" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --storage-key "draft.v1" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --ui "save-button" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --composable "HomeScreen" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --test-tag "login_button" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-role view-model --json
```

Use the installed help's closed Android role vocabulary. `compose-ui-component` is a role, not an invented `compose-screen` selector value. An accepted role with no matches can return `status: ok` and an empty result set. A missing optional artifact is not evidence that the application lacks that behavior.

General results expose IDs, kinds, scores/match reasons, paths, and supported semantic/classification/Android metadata. Ranking helps discovery. It does not grant edit authority or prove a unique owner.

## lookup

Inspect an exact graph node or a supported exact fact selector.

```powershell
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --resolve-classification --json
```

### Flags

- `--index <dir>`: default `.my-dev-kit`.
- `--node <node-id>`: exact graph identity.
- Alternative web selectors: `--route <path>`, `--storage-key <key>`, `--ui <value>`.
- Alternative Android selector: `--android-component <name>`.
- `--depth <n>`: graph traversal depth, default 1.
- `--resolve-classification`: resolve the full available classification entry for node lookup.
- `--json`: structured result.

Do not combine a fact selector with `--node`. Do not assume every `search` selector is also a `lookup` flag. For example, find a composable/resource/test fact with `search`, then pass its exact returned node ID to `lookup`.

Node lookup reports the node, incoming/outgoing edges, neighbors, and available semantic/classification/Android metadata. Component lookup reports explicit found/not-found/ambiguous outcomes and related manifest/source evidence. Preserve ambiguous candidates. Neither a classification role nor a unique textual label proves runtime ownership.

## source

Retrieve bounded current source corresponding to indexed identity or a supported source selector.

### Primary modes

```powershell
npx @dailephd/my-dev-kit source --index .my-dev-kit --node "<source-node-id>" --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --symbol EditorShell --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --start 20 --end 80 --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --contains "save-button" --path src --context 5 --format json
npx @dailephd/my-dev-kit source --index .my-dev-kit --react-region "<indexed-region-name>" --format numbered
```

### Flags

- `--index <dir>`: default `.my-dev-kit`.
- `--node <node-id>`: source-capable graph node.
- `--file <path>` with `--symbol <name>`: exact symbol in a file.
- `--file <path>` with `--start <n>` and `--end <n>`: bounded numbered range.
- `--contains <string>`: exact text matches across indexed source files.
- `--context <n>`: bounded context around exact matches. Use installed help for its documented default and maximum.
- `--path <prefix>`: source-path prefix filter for `--contains`.
- `--react-region <region>`: indexed React component/hook/JSX/prop-type region name, not a new arbitrary region taxonomy.
- Web selectors: `--route <path>`, `--storage-key <key>`, `--ui <value>`.
- Android selectors: `--android-route <route>`, `--resource <name>`, `--composable <name>`, `--android-ui <value>`, `--test-tag <tag>`.
- `--max-lines <n>`: maximum returned lines, default 160.
- `--continue-from <n>`: continue a file from an explicit line, requires `--file`.
- `--continue`: continue the preview window for `--node` or `--file --symbol`.
- `--include-imports`: include local import declarations.
- `--include-local-types`: include local type/interface/enum definitions.
- `--include-props`: include prop types.
- `--include-local-components`: include locally rendered child components.
- `--include-local-deps`: include supported local types, props, constants, and helpers.
- `--expand-to-local-dependencies`: alias for `--include-local-deps`.
- `--include-local-component-tree`: bounded local React component-tree bundle for symbol mode.
- `--prop <name>`: highlight a prop within that local-component-tree output.
- `--include-compose-tree`: bounded Compose child-composable bundle, requires `--composable`.
- `--max-bundle-lines <n>`: total bundle line cap, default 300.
- `--max-blocks <n>`: bundle block cap, default 20.
- `--format <json|plain|numbered>`: output format.
- `--out <path>`: write the selected output.
- `--json`: alias for JSON format.

Select one coherent source mode. Do not combine unrelated web/Android selectors or invent source flags from another command. `--android-component` and `--permission` are not direct `source` selectors in this surface. Retrieve a supported exact node instead. Paths remain contained by the indexed project root.

### Source continuation and local dependency expansion (v1.4.0)

```powershell
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --symbol EditorShell --continue --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --continue-from 161 --max-lines 160 --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --symbol EditorShell --include-local-deps --max-bundle-lines 300 --max-blocks 20 --format json
```

Inspect `continuationCursor` and its next line/exhaustion/reason rather than assume complete symbol coverage. Numbered output can report continuation/EOF markers. Symbol end bounds are not universally compiler-exact. An incomplete preview is not permission to infer missing code.

Local expansion is direct, same-file evidence, not cross-file dependency closure or runtime tracing. Follow cross-file graph candidates with separate source calls. Bundle metadata and omission/cap warnings remain visible. Record a justified whole-file fallback when the bounded path cannot establish a required invariant.

### Local React tree, prop and event context

```powershell
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --symbol EditorShell --include-local-component-tree --prop onSave --max-bundle-lines 300 --format json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<react-component-node-id>" --include-prop-flow --include-event-handlers --depth 2 --json
```

The source bundle follows supported local component relationships. It is not a universal inter-file React tree, a guarantee that a component renders, or a standalone `trace-props`/`trace-events` command. Use exact source and tests for dynamic cases.

### Android source and Compose tree

```powershell
npx @dailephd/my-dev-kit source --index .my-dev-kit --composable "HomeScreen" --include-compose-tree --max-bundle-lines 200 --format json
npx @dailephd/my-dev-kit source --index .my-dev-kit --android-route "home" --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --resource "string/app_name" --format numbered
```

Exact selector ambiguity remains explicit. A resource or route may resolve to more than one candidate. The Compose tree is bounded and root-first. It does not execute Compose, navigation, ViewModel scoping, resource selection, or test actions.

## slice

Build a bounded neighborhood or a supported specialized fact slice.

```powershell
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
```

### Flags

- `--index <dir>`: default `.my-dev-kit`.
- `--node <node-id>`: exact focus node.
- Web selectors: `--route <path>`, `--storage-key <key>`, `--ui <value>`.
- Android selectors: `--android-route <route>`, `--android-component <name>`, `--composable <name>`.
- `--depth <n>`: graph depth, default 1.
- `--direction <both|incoming|outgoing>`: default `both` for graph traversal.
- `--include-prop-flow`: supported local React prop-flow edges.
- `--include-event-handlers`: supported local React event-flow edges.
- `--include-tests`: test references for web reachability, or bounded related Android test evidence for supported graph/Android selection.
- `--include-storage`: storage facts in a web reachability slice.
- `--include-ui`: UI facts in a web reachability slice.
- `--include-viewmodel`: directly resolved ViewModel candidates, requires `--composable`.
- `--include-navigation`: navigation-call/route candidates, requires `--composable`.
- `--include-data-flow`: the fixed Android ownership/data-flow edge family for `--node`, `--composable`, `--android-route`, or `--android-component`.
- `--out <path>`: output path for the normal graph-slice write path.
- `--json`: structured stdout.

### Selector boundaries

Do not combine `--node` with a specialized focus selector. `--include-storage` and `--include-ui` belong to web reachability selection. `--include-viewmodel` and `--include-navigation` require a composable.

**`--include-data-flow` is Android-specific.** It is rejected with web `--route`, `--storage-key`, and `--ui`. Do not document it as universal web API/service/Prisma tracing. Use actual static edges and bounded source to investigate missing web relationships.

Specialized web reachability results come from their own artifact contract rather than an arbitrary code-graph traversal. Do not assume generic graph options or `--out` control every specialized branch. Capture JSON stdout explicitly when a specialized command does not persist an output itself.

### Web reachability

```powershell
npx @dailephd/my-dev-kit slice --index .my-dev-kit --route "/settings" --include-storage --include-ui --include-tests --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --storage-key "draft.v1" --include-ui --include-tests --json
```

Route/storage/UI facts and referenced tests are static candidates. They do not prove that the route is visited, a storage condition holds, a UI target is visible, or a test passed. Missing dynamic relationships must not be treated as safe exclusion from regression testing.

### Android-role search and data-flow slicing (v1.12.0)

```powershell
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-role view-model --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --composable "HomeScreen" --include-viewmodel --include-navigation --depth 2 --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<viewmodel-node-id>" --include-data-flow --include-tests --depth 2 --json
```

The Android data-flow allowlist covers existing Activity/Compose/ViewModel/Repository/DAO/Entity/Retrofit/Room-database/route-to-screen relationships within depth bounds. Related tests expand bounded file/class/method/fact evidence for reached supported production nodes. Inspect `androidDataFlow` and `androidTests` summaries when present.

This remains static analysis. No dependency injection, database query, Retrofit request, test execution, or complete coverage is established.

## view

Render a selected graph artifact as DOT, SVG, or PNG.

```powershell
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph code --format dot --out .my-dev-kit/code.dot --json
```

### Flags and graph selections

- `--index <dir>`: default `.my-dev-kit`.
- `--graph <selection>`: default `code`.
- `--format <dot|svg|png>`: default `dot`.
- `--out <path>`: default a `graph.<format>` file under the index.
- `--edge-style <semantic|labeled|minimal>`: default `semantic`.
- `--allow-dot-fallback`: write DOT if Graphviz is unavailable for a requested SVG/PNG.
- `--json`: report artifact/output paths, actual/requested format, node/edge counts, Graphviz/fallback use, and warnings.

Graph selections are exactly:

```text
code
data-model
model-view-lineage
react-component
react-flow
react-prop-event-flow
frontend-test
route
browser-storage
ui-reachability
android-module
android-manifest
android-navigation
compose-ui
compose-navigation
android-test
```

Use explicit distinct output paths when generating several views, otherwise the common default filename can be overwritten.

DOT needs no Graphviz. SVG/PNG require it unless fallback is enabled. Read the returned actual format and output path rather than assume a requested `.svg` was produced. Fallback can change the output extension to `.dot`.

```powershell
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-prop-event-flow --format dot --out .my-dev-kit/react-flow.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph model-view-lineage --format svg --allow-dot-fallback --out .my-dev-kit/lineage.svg --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph compose-navigation --format dot --out .my-dev-kit/compose-navigation.dot --json
```

Compose/Android views filter already-projected graph evidence. Empty applicable views can be valid. `compose-navigation` follows the supported composable/click/navigation/route/screen chain without adding unrelated facts. `android-test` distinguishes static test hierarchy and production references. A rendered graph is not application/browser rendering, causal explanation, or coverage proof.

## data-model

Generate/inspect data-model artifacts or build conservative model-to-view lineage.

```powershell
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --entity User --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --field User.email --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --trace-view User --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --field User.email --trace-view --json
```

### Flags

- `--index <dir>`: required existing index.
- `--out <dir>`: generated artifact directory, default the index. In entity/field inspection it also selects the artifact directory read by that mode.
- `--entity <name-or-id>`: exact entity inspection.
- `--field <entity.field>`: exact field inspection.
- `--trace-view [entity]`: lineage generation for a specified entity or selected field.
- `--json`: structured output.

Do not combine `--entity` with `--field` or with `--trace-view`. Generation writes model artifacts. Trace mode writes `model-view-lineage.json` and its supported registration/output evidence. This command is read-only toward application source but is not necessarily read-only toward the index directory. Preserve immutable snapshots before generating additional artifacts inside them.

Supported static lineage follows explicit model identity through direct transformations, view-model/prop assignments, and JSX rendered fields. It does not connect to a database, validate a migration, prove route-aware reachability, inspect browser state, or guarantee complete application-wide data flow. Keep canonical entities, projections, UI state, and persistence representations distinct.

## context

Generate a bounded context capsule and optional matching retrieval audit for a task-like query. Modes adjust ranking. Roles add stage-specific evidence responsibilities. They are independent dimensions.

```powershell
npx @dailephd/my-dev-kit context --index .my-dev-kit --query "Locate the owner and contracts for changing saved drafts" --mode feature-add --role architecture --out .my-dev-kit/architecture-context.json --audit-out .my-dev-kit/architecture-audit.json --json
npx @dailephd/my-dev-kit context --request context-request.json --json
```

### Flags

- `--index <dir>`: default `.my-dev-kit` unless supplied through structured input.
- `--query <text>`: task query, or use the structured request's query.
- `--out <path>`: capsule path, or structured request `output`.
- `--audit-out <path>`: audit path, or structured request `auditOutput`.
- `--mode <general|feature-add|subsystem>`: default `general`.
- `--role <architecture|implementation|test-implementation>`: optional stage role.
- `--request <path>`: structured `ContextRequest` JSON.
- `--max-candidate-files <n>`: positive retained-candidate-file cap.
- `--max-source-slices <n>`: positive source-slice cap.
- `--max-graph-nodes <n>`: positive graph-node cap.
- `--max-graph-edges <n>`: positive graph-edge cap.
- `--no-source`: suppress source-slice/bundle selection, not graph/metadata evidence.
- `--json`: structured command output.

### Structured requests and role boundaries

Use schema `1.0.0` and the exact current fields defined in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md). A small architecture request is:

```json
{
  "schemaVersion": "1.0.0",
  "role": "architecture",
  "query": "Locate the owner, extension point, contracts and tests for saved drafts",
  "index": ".my-dev-kit",
  "mode": "feature-add",
  "requestedEvidenceKinds": ["owner", "dependencies", "contracts", "closest-tests"],
  "output": ".my-dev-kit/architecture-context.json",
  "auditOutput": ".my-dev-kit/architecture-audit.json"
}
```

Structured input supports the documented root/index, focus files/symbols, changed files/symbols, coherent before/after index pair, upstream artifact references, test responsibility IDs, evidence kinds, limits, and output fields. Use only the actual schema. The CLI is not a one-flag-per-field interface. Explicit CLI/request disagreements follow normalization/validation and must not be assumed to silently override one another.

For test work, derive changed surfaces from actual edits or matching index differences, not a stale planned file list. `testResponsibilityRefs` contains string IDs. Responsibility criticality stays with the planner/consumer contract rather than being fabricated as extra producer fields.

### Context capsule and retrieval audit

The capsule identifies the request/index, ranking/focus, retained candidates, graph/source evidence, metadata summaries, warnings, and adequacy. It is not a raw graph or whole-source dump. Use `source` for the exact code needed after selection.

Role-aware evidence includes selected owners/contracts/tests, evidence groups, requested/applied limits, condition coverage, required/optional omission, full-file fallback information, freshness, responsibility mapping, and provenance. The audit records steps and the same material readiness/identity summaries. Generated capsule/audit parity is checked before successful writes. Do not repair a contradiction by editing either artifact manually.

Inspect `contextAdequacy`, `roleAdequacy`, `roleConditionCoverage`, freshness, unresolved evidence, and `truncation.requiredEvidenceLost` where applicable. Optional or redundant truncation does not automatically block. A required witness lost to allocation, a missing required condition, stale evidence, or a material conflict does.

Freshness is derived from the provided and active index identities. A directory named current, a reused version number, or two identical index paths is not an independent proof that the source worktree has not changed. Refresh required evidence against actual current source.

### v1.12.1 evidence limits and required witnesses

Architecture/implementation evidence groups distinguish per-group limits, final required-witness loss, optional omissions, and no-candidate absence. Do not treat every capped group as a required failure, and do not ignore the loss of a required condition merely because another group is populated. Inspect requested and applied limits plus condition coverage rather than only overall candidate count.

### v1.12.3 context and test-responsibility corrections

Role readiness distinguishes an early focus-source retrieval limitation from a genuinely missing role requirement. The implementation may recover from a narrowly supported base source-selection failure when the actual role conditions independently hold. This is not permission to relabel arbitrary insufficient output as sufficient.

Structure-aware Python contract evidence is not restricted to suggestive filenames alone. Test-responsibility mapping distinguishes behavior/test/expected-result evidence from execution-command metadata under the current contract. Consult the detailed fields and retained diagnostics in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md), and inspect the actual generated result rather than assume every Python project is now fully understood.

### Android-aware context ownership

No new Android context flag is needed. Supported intent/evidence can favor the Compose owner for UI work, ViewModel for linked state work, and Repository for data-loading work. Reported conflicts can include generated/test primary targets and ambiguous/unresolved ownership. `test-implementation` still requires current changed-production evidence and appropriate responsibility mapping.

This Android policy is not a universal web architecture policy. A frontend fact or unique candidate is not automatically a safe edit owner. Preserve unresolved alternatives and verify source contracts.

### Orchestrator and Lab integration

Orchestrator does not automatically run my-dev-kit. A coding agent supplies the generated raw evidence and the required supplemental packet/report through the consumer's exact current contract. These are not new native context stages. Producer adequacy, Orchestrator readiness, actual test results, and Lab findings remain separate authorities.

Do not assume Lab's fixed context-integrity smoke accepts an arbitrary capsule/run directory. Use the [ecosystem guide](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md) for validated command boundaries and explicitly manual/library integrations.

## graph-diff

Compare two existing index directories without running `index` or modifying either input.

```powershell
npx @dailephd/my-dev-kit graph-diff --before .my-dev-kit-before --after .my-dev-kit-after --json
```

Flags are exactly `--before <index-dir>`, `--after <index-dir>`, and `--json`. Both indexes are required. There is no `--out`, `--fail-on-change`, or source-edit mode in this command. Use appropriate shell redirection to save JSON.

The result reports added/removed/changed graph nodes and edges, supported symbol-index changes, manifest/analyzer metadata changes, classification changes where available, and warnings. Comparison uses existing stable identities, not fuzzy rename inference. A rename or incompatible identity may appear as removal/addition. It does not enumerate and recursively diff every arbitrary file in the directory.

Exit 0 means a valid comparison, including one with differences. Graph equality is not runtime equivalence. Dependency upgrades, configuration, dynamic behavior, or omitted source roots can change behavior without a useful graph delta. Use Git differences, project tests, and runtime evidence as required.

## Cross-tool command composition

The [ecosystem workflow guide](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md) is the sole home for cross-repository recipes. This section defines how to use this command reference without importing foreign syntax.

- Use my-dev-kit for static evidence. Use the target project's commands for builds, databases, test execution, browser actions, and application startup.
- Use `my-dev-kit-orchestrator` for its own eight-command lifecycle. `DIRECT_IMPLEMENTATION` and `FULL_STAGE_CONTEXT` are workflow policies, not its `--mode` values.
- Use installed `my-dev-kit-lab security validate` and `my-dev-kit-lab audit` where supported. Put its global `--workspace` before the command. Do not run Lab's source-checkout npm aliases in the target project.
- Use `my-frontend-observer` for its own local browser observations and evaluations. Its package is unscoped. Its bounded-context/correction functions are library APIs, not additional CLI subcommands.
- Do not pipe unrelated JSON artifacts together without a documented consumer. Runtime/static correlation needs explicit candidate evidence, not equal-looking names.
- Preserve semantic results. A graph-diff difference, partial observation, incomparable comparison, or not-evaluated fidelity result can accompany exit 0. Required acceptance must inspect the actual result.
- A complete full-stack task requires real backend/client/UI wiring, applicable use-case tests, protected behavior, and final-state runtime evidence. None of these is established by a context command alone.

Companion syntax and limitations are linked from the ecosystem guide. There is no requirement to find or synchronize private local ecosystem `.txt` files.

## Development and unsupported surfaces

`npm run build`, `npm test`, `npm run typecheck`, `npm run docs:check`, `npm run verify`, and `npm run benchmark:retrieval` are source-checkout maintainer commands. They are not extra installed CLI commands. In the reviewed package, `verify` runs typecheck/build/docs checks and does not replace `npm test`.

The v1.7 retrieval-regression suite is maintainer tooling. Local unreleased v1.13 work must not be documented as published command surface before release. Do not invent `benchmark:retrieval:android` in the reviewed published baseline.

There is no current standalone `refs`, `trace-props`, `trace-events`, web/full-stack execution, watch, deployment, browser-observation, security, or automatic workflow command in my-dev-kit. Use supported `source --contains`, local component-tree/flow options, and companion tools where appropriate. Future plugin/retrieval API work remains roadmap scope, not installed behavior.

## Troubleshooting

**Missing index manifest:** run `index` with the correct root/output or point `--index` at the existing matching directory.

**Missing optional analyzer artifact:** verify applicability, interpreter/tool availability, source roots, and manifest warnings. Do not invent evidence or assume target behavior is absent.

**Unknown or ambiguous identity:** discover current IDs with `search`, inspect candidates, and narrow exact selection. Do not pick an arbitrary winner.

**Stale or wrong-root context:** regenerate from the correct current index and request, then refresh downstream evidence. Do not rewrite readiness fields.

**Source preview incomplete:** use cursor/continuation, same-file expansion, or explicit bounded ranges. Preserve uncertainty and report a justified fallback.

**Graphviz unavailable:** use DOT, or `--allow-dot-fallback` and inspect actual output format/path.

**Unexpected zero-match or empty graph:** check the semantic result and required scope. A valid empty result is not proof of sufficient context or successful application behavior.

**Workflow needs a missing command:** verify the command's actual owner and installation. Record unsupported/manual/library-only boundaries in the ecosystem feedback report rather than invent a flag or secretly require a source checkout.
