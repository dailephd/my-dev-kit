# Workflows

This guide contains ordered workflows for **my-dev-kit itself**. [COMMANDS.md](COMMANDS.md) owns exact syntax, selectors, defaults, outputs, and command limitations. [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) owns detailed artifact contracts.

For coding-agent execution, full-stack features, runtime verification, Orchestrator stages, Lab assurance, release coordination, recovery, and ecosystem feedback, use the single [Ecosystem development workflows](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md) guide in this repository. Its [command-surface compatibility map](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#915-command-surface-compatibility-map) records additional cross-tool combinations discovered by matching actual command inputs/outputs, including combinations not named in the individual workflow guides. Companion repositories link there rather than keep another copy. No private local ecosystem text file or undocumented synchronization command is required.

## Overview

Use an existing valid current index or build one with explicit source roots. Narrow an actual question through search, exact lookup, a relevant slice, and bounded source. Use continuation or same-file expansion for missing context. Refresh evidence after source changes. Keep separate snapshots only when a before/after comparison requires them.

Static evidence is not application execution. A valid command result can still be empty, ambiguous, missing an optional artifact, or inadequate for the task. Inspect semantic results and warnings, not only exit status.

## Workflow 1: Index a TypeScript or JavaScript project

From the target project root:

```powershell
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src src --src tests --out .my-dev-kit --call-graph --json
```

The second command refreshes the same index with an explicitly expanded source contract. `--src` and relative `--out` are relative to `--root`. Do not repeat the root inside a relative output path accidentally. Supported `.test.`/`.spec.` files beneath a selected root, including colocated tests under `src`, are indexed as ordinary files. They are then reachable through `search`, `lookup`, `slice`, and `source`. `.d.ts` declaration files are not indexed.

For large projects, inspect discovery first and select meaningful roots:

```powershell
npx @dailephd/my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --dry-run --json
npx @dailephd/my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --progress --json
```

Dependencies, generated/build output, common caches, and my-dev-kit output directories are ignored by default. Additional `--exclude` values are directory names or relative prefixes, not globs. Avoid excluding tests or other required evidence accidentally.

Separate indexes may be useful for web source, web tests, a Python service, or scripts. Record root coverage and do not assume one index contains cross-domain relationships it never analyzed.

Completion: the manifest identifies the intended project/source roots, required analyzers/artifacts are present, and warnings or partial analysis are understood. An output directory existing is not sufficient.

## Workflow 2: Index a Python project

Python indexing requires an available supported `python` or `python3` interpreter. Missing interpreter support is reported as a warning/skip, not analyzed evidence.

```powershell
npx @dailephd/my-dev-kit index --root . --src src --language python --out .my-dev-kit --call-graph --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "greet" --limit 20 --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "<returned-node-id>" --depth 1 --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/main.py --symbol greet --format numbered
```

Select actual project roots, including tests when needed. Static call extraction is conservative and may omit dynamic calls. Source retrieval does not execute the Python program.

## Workflow 3: Graph-Guided Symbol Retrieval

Use this sequence to answer an ownership or implementation question without dumping the graph or source tree:

```powershell
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "<behavior or symbol>" --limit 20 --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "<returned-node-id>" --depth 1 --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<returned-node-id>" --depth 2 --direction both --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --node "<returned-source-node-id>" --format numbered
```

Review match reasons, semantic/classification metadata, callers/dependencies, and exact source. Prefer a symbol node for a specific function/type question. Exact lookup is not fuzzy search. Expand only the unresolved relationship or source region.

**Locating an implementation owner (v1.12.6).** When the question is "where does this behavior live in production code" for a natural-language query and indexed tests are likely to outrank the production owner, run the initial search with ownership intent instead of, or in addition to, the raw search:

```powershell
node dist/cli.js search --index .my-dev-kit --query "<behavior or symbol>" --intent ownership --limit 10 --json
```

Ownership intent is optional. Ordinary relevance search remains the default and needs no `--intent`; do not add `--intent ownership` to every search. Read each result's `ownership.tier` and `ownership.evidence`: `direct-owner` and `production-candidate` results are static production-owner evidence, `supporting-evidence` results (tests, fixtures, generated, docs) remain visible, and a recovered file with `score: 0` was promoted only by a direct relationship from a matching seed file. The ranking is advisory. Continue with exact lookup, a bounded slice, and symbol source for the returned candidate, and inspect the closest tests and the actual implementation before editing. A `direct-owner` tier is never edit authorization.

Record the selected owner, extension point, contract, relevant test, and uncertainty. A top-ranked result is not automatic authorization to edit it. When test roots are indexed, a matching test can outrank the production owner for a behavior-shaped query, because raw search ranks by relevance and not by production ownership. A missing relationship is a retrieval limitation until checked, not proof that no caller exists.

Indexed test files use the same sequence. Use `lookup`/`slice --node file:<test-path>` for a test's imports and neighborhood. Use exact text such as a test title or assertion literal to get bounded test source:

```powershell
npx @dailephd/my-dev-kit source --index .my-dev-kit --contains "<exact test literal>" --path tests --context 5 --format numbered
```

Test evidence retrieved this way is static source evidence. It does not show that the test runs or passes. Use `context` role-specific output and the bounded test-infrastructure discovery for related-test and test-command evidence. Report any full-file fallback explicitly.

## Workflow 4: Generate graph visualization

```powershell
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph code --format dot --out .my-dev-kit/code.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-prop-event-flow --format dot --out .my-dev-kit/react-flow.dot --edge-style labeled --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph model-view-lineage --format svg --allow-dot-fallback --out .my-dev-kit/lineage.svg --json
```

DOT needs no Graphviz. SVG/PNG require Graphviz unless fallback is enabled. Inspect the returned actual format and output path. Use distinct output filenames for different views.

Views render existing evidence, not the application UI. A valid empty Android/Compose view is possible. It is not a placeholder proof that the target has been analyzed completely.

## Workflow 5: Use my-dev-kit output with a coding agent

Provide the smallest evidence packet that answers the task: selected results, exact IDs, relevant relationships, source excerpts, required contracts/tests, and the current index/commit identity. Reference large artifacts by path instead of injecting whole graphs.

The normal sequence is `index -> search -> lookup -> slice -> source -> agent reasoning`. `context` can assemble bounded task evidence and an audit, but neither it nor a successful source command implements code or runs tests.

After source changes, refresh relevant evidence. For an unfamiliar project, follow Architecture Assimilation in the [ecosystem guide](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#6-existing-project-onboarding-workflow). For a known continuation, do not repeat an entire architecture audit unnecessarily.

If bounded retrieval is insufficient, record the exact gap and use a safe targeted fallback. Do not disguise manual source reading as successful automated recovery, or hand-edit readiness output to allow a staged run to proceed.

## Workflow 6: Source continuation and local dependency expansion

```powershell
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --symbol EditorShell --continue --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --continue-from 161 --max-lines 160 --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/editor.tsx --symbol EditorShell --include-local-deps --max-bundle-lines 300 --format json
```

Use the returned continuation cursor rather than assume a complete symbol. In v1.12.6, a symbol whose parser-derived end line is known is returned completely on the first request when it fits `--max-lines`, and the result then has no continuation cursor, so the `--continue` step is unnecessary. A known symbol larger than `--max-lines` continues only inside its own end line, and an unknown-boundary symbol (Kotlin, Java, an older index, or an uncertain case) keeps the 20-line preview with `symbolBoundaryKnown: false` and the `symbol-end-unknown` cursor. `--node symbol:<path>#<name>` and `--file <path> --symbol <name>` return the same boundaries. Local imports, types, props, components, and dependency expansion are same-file static context, not cross-file closure. Follow cross-file dependencies with additional lookup/source calls.

For connected local React components, use `--include-local-component-tree` and the appropriate prop/event slice flags. Do not invent standalone `trace-props`, `trace-events`, or general `refs` commands.

A whole-file read may be justified by a particular invariant or interleaved contract. Report the narrower retrieval attempted, missing information, file/line count, and how the full read changed the conclusion. Do not perform a broad file sweep merely because a preview was capped.

## Workflow 7: Data-model and model-to-view lineage inspection

```powershell
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --entity User --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --field User.email --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --trace-view User --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph model-view-lineage --format dot --out .my-dev-kit/lineage.dot --json
```

Generate required model artifacts first when they are absent. Model/lineage generation can write into the index by default, so do not use an immutable snapshot as a working output directory.

Trace-view follows supported explicit model identities through direct transformations, view-model/prop assignments, and JSX rendering. It does not validate a database migration, route-aware runtime reachability, browser state, or all API/service boundaries. Use the [API/data migration recipe](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#95-api-and-data-contract-migration) to combine this evidence with real project tests.

## Workflow 8: Context capsule and retrieval audit

```powershell
npx @dailephd/my-dev-kit context --index .my-dev-kit --query "<task description>" --mode feature-add --out .my-dev-kit/context-capsule.json --audit-out .my-dev-kit/retrieval-audit-record.json --json
```

Modes are `general`, `feature-add`, and `subsystem`. Use `--no-source` only when the task intentionally does not require source selection. The capsule contains bounded, reason-tagged evidence rather than raw source/artifact dumps.

Inspect candidate/focus relevance, selected graph/source evidence, warnings, conflicts, and adequacy. A generated capsule is not automatically ready for implementation. Use the command reference and graph schema for structured request fields and detailed result contracts.

## Workflow 9: Compare two index snapshots with graph-diff

```powershell
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit-before --json
```

After the authorized source change:

```powershell
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit-after --json
npx @dailephd/my-dev-kit graph-diff --before .my-dev-kit-before --after .my-dev-kit-after --json
```

Keep the before snapshot unchanged. `graph-diff` does not index, edit inputs, or fail because a valid difference exists. It is reporting-only. Inspect stable-identity changes, availability and warnings, and combine them with Git diffs and tests.

Graph equality does not prove runtime equivalence. For visible regressions, use the [commit-to-commit recipe](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#910-commit-to-commit-regression-localization) and preserve Observer comparability requirements.

## Workflow 10: Index and retrieve Android/Kotlin/Java projects

```powershell
npx @dailephd/my-dev-kit index --root . --src app/src/main/kotlin --src app/src/main/java --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-route home --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --permission android.permission.CAMERA --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --resource string/app_name --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --android-component com.example.MainActivity --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --android-route home --format numbered
npx @dailephd/my-dev-kit slice --index .my-dev-kit --android-component com.example.MainActivity --depth 2 --json
```

Use source roots that exist in the target. Kotlin/Java extensions are recognized without a new language flag. Android project/module/source-set, Gradle, component, manifest, resource, and navigation evidence is conditionally generated and registered in the manifest. Artifact-backed nodes enrich the existing code graph.

Exact selectors retain ambiguity. A manifest component is not automatically the same node as its source class. Static evidence does not prove dependency resolution, merged manifests, resource selection, dependency injection, runtime navigation, builds, or security. There is no `android-relationships.json` prerequisite.

### Public example: project root, source sets, and analyzer status

The public example (`examples/basic-android-kotlin`, packaged in v1.13.0) is the concrete reference for this workflow. From the repository root of a built checkout:

```powershell
node dist/cli.js index --root examples/basic-android-kotlin --src app/src/main --src app/src/test --src app/src/androidTest --out .my-dev-kit --json
node dist/cli.js index --root examples/basic-android-kotlin --src app/src/main --out .my-dev-kit --dry-run --json
```

- **Project root.** `--root` is the directory holding `settings.gradle.kts`, `build.gradle.kts`, and `app/`. Android detection reads Gradle settings/build files, `AndroidManifest.xml`, `res/`, and Compose navigation calls under that root. The `android-project` analyzer reports the detected modules and source sets (for the example: the root module `.` and the `app` module, whose source sets are `main`, `test`, and `androidTest`). Detection does not widen your `--src` choice.
- **Relative `--out`.** `.my-dev-kit` is resolved against `--root`, so the index is `examples/basic-android-kotlin/.my-dev-kit`. Do not write `--out examples/basic-android-kotlin/.my-dev-kit`.
- **Why list all three source sets.** The `--src` roots decide which files get `file:` and `symbol:` nodes, file-level imports, and `source --contains` coverage. For the example, `app/src/main` alone discovers 10 Kotlin files and all three roots discover 12. In a `main`-only index the Android test-semantic analyzer still detects the two test files from the project's test roots and `--android-role` and `--query` still return `android-test-*` nodes, but `lookup --node file:app/src/test/...` returns not found and `source --contains FakeUserDao` finds nothing. Pass `app/src/test` and `app/src/androidTest` so production, unit-test, and instrumented-test code are all reachable through the same index.
- **Artifacts depend on evidence.** The manifest, resource, and navigation artifacts are generated only from the matching files under the detected modules: `android-manifest` from `AndroidManifest.xml`, `android-resources` from `res/values`, `android-navigation` from `composable("...")` route calls, and the Compose and test artifacts from indexed or detected Kotlin sources. A missing artifact means that evidence was not found or not analyzed, not that the application lacks the behavior.
- **Analyzer statuses.** Read `analyzers[].status` in the `index --json` result or `manifest.json`. `complete` means the analyzer ran and found what it supports. `partial` means it produced output with per-item warnings. `skipped` and `not-run` mean it did not apply or was not requested. For the example, `android-gradle` is `partial` (four warnings that BOM-managed coordinates such as `androidx.compose.ui:ui` carry no version) and `classification` is `partial` (27 per-entry warnings such as "no static file-level pattern matched" and "Compose route has no exact static screen resolution"). `frontend-reachability` is `skipped` and `call-graph` and `model-view-lineage` are `not-run`, because the example has no web source and no `--call-graph`. Partial status is not by itself a correctness defect; retrieval from the other artifacts works. Read the warnings before deciding whether a missing fact matters.
- **Generated directories.** Default ignores skip `build`, `.gradle`, `out`, `output`, `.my-dev-kit`, and `.my-dev-kit-*` at any depth, so Gradle build output and previous indexes are not indexed. The example has no build output, so `search --android-role generated-file` correctly returns zero results; see the fixture-backed benchmark A11 in [DEVELOPMENT.md](DEVELOPMENT.md#v1130-android-retrieval-regression-suite) for the generated-output case.

The detailed per-file walkthrough is in the [example README](../examples/basic-android-kotlin/README.md).

## Workflow 11: Stage-role context refresh

Role and mode are independent. Refresh evidence at the point its owning stage needs it rather than reuse one early capsule forever.

```powershell
npx @dailephd/my-dev-kit context --index .my-dev-kit --query "Locate the extension point and contracts" --role architecture --out .my-dev-kit/architecture-context.json --json
npx @dailephd/my-dev-kit context --request context-request.json --json
```

### Architecture stage

Establish the owner, extension point or grounded no-extension conclusion, contract, and test evidence or explicit test gap. Inspect required condition witnesses and current repository/index identity. This answers where the behavior belongs.

### Implementation stage

Refresh immediately before editing. Retrieve exact owners, source, dependencies, callers/callees, validators, constants/defaults/limits, errors, serializers/schemas, command parsing, compatibility, and closest tests. This answers what must change and what must remain stable.

### Test-implementation stage

Refresh after actual production edits. Supply current changed files/symbols and planner-owned string responsibility IDs. Retrieve test locations, expected-result evidence, fixtures/mocks/setup, infrastructure, and commands. Preserve partial/unmapped status and missing metadata honestly. Do not fabricate a test command or compatibility file to satisfy a mapping.

### Readiness and recovery

Inspect freshness, role/context adequacy, provenance, capsule/audit agreement, condition coverage, and required-evidence loss. Optional overflow can coexist with sufficient context. A missing required condition, stale identity, or contradiction cannot be overridden by a prose statement or isolated lookup result.

The v1.12.1/v1.12.3 corrections remain part of the current producer contract. Use generated condition-aware results rather than older assumptions that every cap or focus-source failure is irreversibly blocking.

### Orchestrator and Lab boundary

Orchestrator does not automatically run my-dev-kit. Its native implementation/test stages consume explicitly supplied evidence through their supplemental contracts. They are not replaced by new context stages. Use its actual readiness and correction routing without bypassing `RunIntegrityGate`.

Lab may evaluate documented matched strategies or frozen compatibility fixtures in a separate experiment. It does not decide producer adequacy or make a fixed historical smoke into proof of every current live run. The [ecosystem guide](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md) owns these compositions.

## Workflow 12: Compose semantic retrieval

```powershell
npx @dailephd/my-dev-kit search --index .my-dev-kit --composable HomeScreen --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --test-tag login_button --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-ui "Welcome back" --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --composable HomeScreen --include-compose-tree --max-bundle-lines 200 --format json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --composable HomeScreen --include-viewmodel --include-navigation --depth 2 --json
```

Compose evidence includes supported declarations, state/effect/ViewModel facts, test tags, text/string resources, click handlers, navigation calls, and UI regions. Facts are associated with their supported enclosing composable and projected into the graph.

Selectors are exact and retain every ambiguous candidate. A test-tag query uses the resolved literal value. Compose-tree source is bounded and root-first. These commands do not run Compose or prove rendering, clicks, navigation, ViewModel scoping, or resource resolution.

## Workflow 13: Android test-evidence retrieval

```powershell
npx @dailephd/my-dev-kit search --index .my-dev-kit --query HomeScreenTest --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query login_button --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "<returned-android-test-node-id>" --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --node "<returned-android-test-method-id>" --format numbered
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<returned-android-test-method-id>" --depth 2 --direction both --json
```

The analyzer discovers supported test classes/methods/facts under detected unit/instrumented roots. JUnit/lifecycle, Compose rule, Espresso/Robolectric, assertion, route, and test-double evidence remain distinguishable where supported. Exact links can reference composables, routes, ViewModels, and doubles. No new test-specific selector flag is required.

A test reference is not coverage proof. No indexing or graph command executes the test, initializes a rule, launches an Activity, or verifies an assertion. Use actual project test commands separately.

### Public example: unit and instrumented tests

Index both test source sets first (`--src app/src/test --src app/src/androidTest`, see Workflow 10), then, from the repository root of a built checkout:

```powershell
node dist/cli.js search --index examples/basic-android-kotlin/.my-dev-kit --android-role android-unit-test --json
node dist/cli.js search --index examples/basic-android-kotlin/.my-dev-kit --android-role instrumented-test --json
node dist/cli.js search --index examples/basic-android-kotlin/.my-dev-kit --android-role compose-ui-test --json
node dist/cli.js lookup --index examples/basic-android-kotlin/.my-dev-kit --node "android-test-method:app/src/androidTest/kotlin/com/example/kitdemo/UserHomeScreenTest.kt#UserHomeScreenTest.refreshButtonIsClickable" --depth 1 --json
node dist/cli.js source --index examples/basic-android-kotlin/.my-dev-kit --node "android-test-method:app/src/androidTest/kotlin/com/example/kitdemo/UserHomeScreenTest.kt#UserHomeScreenTest.refreshButtonIsClickable" --format numbered
node dist/cli.js slice --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --include-tests --json
node dist/cli.js slice --index examples/basic-android-kotlin/.my-dev-kit --node "android-test-class:app/src/test/kotlin/com/example/kitdemo/UserViewModelTest.kt#UserViewModelTest" --depth 1 --json
```

What these return for the example:

- `android-unit-test` returns only `app/src/test/.../UserViewModelTest.kt` nodes: the file, the class, and its `setUp`, `tearDown`, and `refreshUsersPublishesRepositoryResult` methods. This is JVM unit-test source, run by `./gradlew test` in a real project.
- `instrumented-test` returns only `app/src/androidTest/.../UserHomeScreenTest.kt` nodes: the file, the class, and the `refreshButtonIsClickable` and `showsTitleAndRefreshButton` methods. This is Android instrumented source that needs a device or emulator in a real project. `compose-ui-test` returns the same four nodes, because the class uses a Compose test rule; the unit test does not carry that role.
- Every test node carries `test-only` edit guidance. Classification roles are static path and evidence labels.
- The `--composable UserHomeScreen --include-tests` slice adds the instrumented class, its methods, assertion facts, and two `android-test-references-composable` edges. The unit-test class slice shows `android-test-uses-double` edges to the two in-test fakes and its methods, but no edge to `UserViewModel` or `UserRepository`.
- Related-test expansion from a ViewModel or repository node (`slice --node symbol:...UserViewModel --include-data-flow --include-tests`) reached only the instrumented tests, through the composable that consumes the ViewModel. It did not add `UserViewModelTest`, even though that test constructs `UserViewModel`. Find the unit test with `--android-role android-unit-test` or `search --query UserViewModelTest`; do not infer from an empty related-test result that no unit test exists.

Test declarations and facts are indexed from source. They show what a test file declares and references, not that it compiles, was run, or passed. The benchmark that retrieves both source sets (A12) distinguishes them through the `src/test` and `src/androidTest` paths in node IDs, not through a separate source-set metadata field.

## Workflow 14: Compose and Android-test graph views

```powershell
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph compose-ui --format dot --out .my-dev-kit/compose-ui.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph compose-navigation --format dot --out .my-dev-kit/compose-navigation.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph android-test --format dot --out .my-dev-kit/android-test.dot --json
```

`compose-ui` shows existing composables/facts and supported source/resource/ViewModel links. `compose-navigation` narrows to the supported composable/click/navigation/route/screen chain. `android-test` shows the static test hierarchy and supported production references. Each view preserves ambiguity and uses already-projected graph evidence.

An empty view is a valid result when relevant evidence is absent. No view proves runtime reachability, rendering, navigation, or test success.

## Workflow 15: Android-role search and data-flow slicing

```powershell
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-role activity --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-role view-model --limit 5 --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<activity-node-id>" --depth 3 --include-data-flow --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<viewmodel-node-id>" --depth 2 --include-data-flow --include-tests --json
```

Use the actual closed Android role vocabulary. Role selection is exact. `--include-data-flow` expands the fixed Android ownership/data-flow edge family within the graph depth. Adding tests includes bounded related Android test evidence for reached supported nodes.

Do not use this as a generic web/full-stack data-flow flag. It is rejected with web route/storage/UI selectors and does not infer an arbitrary API/service/ORM chain.

## Workflow 16: Android-aware context ownership

```powershell
npx @dailephd/my-dev-kit context --index .my-dev-kit --role architecture --query "Locate the owner for changing the Home screen UI" --out .my-dev-kit/home-architecture.json --json
npx @dailephd/my-dev-kit context --index .my-dev-kit --role implementation --query "Change the loading state behavior shown by HomeScreen" --out .my-dev-kit/home-implementation.json --json
```

Supported intent and relationships can prefer Compose for UI work, ViewModel for state, and Repository for data-loading ownership. Generated/test primary targets and ambiguous/unresolved owners can produce explicit conflicts. `compose-ui-component`, not an invented `compose-screen` role, is the relevant vocabulary where classified.

Inspect actual required owner/contract evidence. No selected owner is edit authorization or a runtime guarantee. For test implementation, use current changed production and responsibility evidence.

### Wrong-layer edit examples (public example)

These are evidence-gathering examples for a person or coding agent, not automated editing instructions. They use the index from Workflow 10 (`examples/basic-android-kotlin/.my-dev-kit`) and `node dist/cli.js` from a built checkout. Paths below are relative to `examples/basic-android-kotlin/app/src/main/kotlin/com/example/kitdemo/` unless noted.

**W01 - UI presentation change.**

- Task: "Move the refresh button above the title on the user home screen."
- Responsibility: UI composition and layout, which belongs to the Compose screen.
- Primary owner: `UserHomeScreen.kt` (classified `compose-ui-component`, `safe-primary-edit-target`).
- Supporting files: `app/src/main/res/values/strings.xml` for label text, `AppNavigation.kt` for the route, and `app/src/androidTest/.../UserHomeScreenTest.kt` as the test that references the `refresh_users_button` tag.
- Evidence commands:

```powershell
node dist/cli.js search --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --json
node dist/cli.js source --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --include-compose-tree --format numbered
node dist/cli.js slice --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --include-tests --json
node dist/cli.js context --index examples/basic-android-kotlin/.my-dev-kit --role architecture --query "Locate the owner for changing the UserHomeScreen layout" --out examples/basic-android-kotlin/.my-dev-kit/home-architecture.json --json
```

- Wrong-layer choice: editing `UserHomeScreenTest.kt` because it matched the query as strongly as the screen, or editing `UserViewModel.kt` because the screen reads its state. The test is supporting evidence and carries `test-only` guidance; the ViewModel owns state, not placement.
- Still uncertain: whether the new layout renders as intended, and whether the existing test still passes. Neither is established by retrieval.

**W02 - ViewModel state or action change.**

- Task: "When refresh runs, keep the previous users visible and expose an error flag."
- Responsibility: state and action implementation, which belongs to the ViewModel.
- Primary owner: `UserViewModel.kt` (`UserViewModel`, `refreshUsers()`, and `UserUiState` in the same file).
- Supporting files: `UserHomeScreen.kt` as a downstream consumer that reads `uiState` through `collectAsState()`, `data/UserRepository.kt` as the called dependency, and `app/src/test/.../UserViewModelTest.kt` as the unit test.
- Evidence commands:

```powershell
node dist/cli.js lookup --index examples/basic-android-kotlin/.my-dev-kit --node "symbol:app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt#UserViewModel" --depth 1 --resolve-classification --json
node dist/cli.js source --index examples/basic-android-kotlin/.my-dev-kit --file app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt --symbol UserViewModel --format numbered
node dist/cli.js slice --index examples/basic-android-kotlin/.my-dev-kit --node "symbol:app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt#UserViewModel" --include-data-flow --include-tests --depth 2 --json
node dist/cli.js search --index examples/basic-android-kotlin/.my-dev-kit --android-role android-unit-test --json
```

- Wrong-layer choice: changing only the `onClick` lambda in `UserHomeScreen.kt`, which cannot change what `refreshUsers()` does, or changing `UserRepository.kt` for a purely presentational state decision.
- Still uncertain: the graph has no edge from the click handler to `refreshUsers()` or to a state mutation, and `uiState` is not an indexed member node, so confirm the path in the source. The related-test slice reached the instrumented Compose test but not `UserViewModelTest`; find that with the role search.

**W03 - Data-access behavior change.**

- Task: "Make refresh save the downloaded users before returning them."
- Responsibility: Repository-level data access, which combines the DAO and the Retrofit service.
- Primary owner: `data/UserRepository.kt` (`UserRepository.refreshUsers()`).
- Supporting files: `data/UserDao.kt` and `data/UserApiService.kt` as the interfaces it calls, `data/UserEntity.kt`, `data/AppDatabase.kt`, and `UserViewModel.kt` as its caller.
- Evidence commands:

```powershell
node dist/cli.js slice --index examples/basic-android-kotlin/.my-dev-kit --node "symbol:app/src/main/kotlin/com/example/kitdemo/data/UserRepository.kt#UserRepository" --depth 1 --json
node dist/cli.js source --index examples/basic-android-kotlin/.my-dev-kit --file app/src/main/kotlin/com/example/kitdemo/data/UserRepository.kt --symbol UserRepository --format numbered
node dist/cli.js source --index examples/basic-android-kotlin/.my-dev-kit --file app/src/main/kotlin/com/example/kitdemo/data/UserDao.kt --start 1 --end 12 --format numbered
```

- Wrong-layer choice: selecting `UserHomeScreen.kt` or `UserViewModel.kt` because the symptom is visible there, or editing only `UserApiService.kt` or `UserDao.kt`. Those interfaces define signatures; the behavior that combines them lives in the repository. The `repository-uses-dao` and `repository-uses-service` edges show the dependencies, not which one is wrong.
- Still uncertain: the example has no repository test, Room queries and network calls are never executed, and the DAO and Retrofit test doubles are not linked to their interfaces.

**Natural-language `context` remains query-sensitive.** The post-correction public-example checks show the intended screen, ViewModel, Repository, or Retrofit service as the focus for the tested single-layer requests, without false owner conflicts from supporting candidates. Requests that span UI and ViewModel state, name multiple plausible screens, or lack enough evidence remain ambiguous or unresolved. Check the focus, `selectedOwners`, role/context adequacy, and conflicts before editing; do not treat the first ranked candidate as automatic edit authority.

## Workflow 17: Choose an incremental refresh strategy (v1.12.5)

This workflow uses the installed `@dailephd/my-dev-kit@1.12.5` CLI.

### Default / changed-files

```powershell
node dist/cli.js index --root . --src src --out .my-dev-kit --incremental --json
node dist/cli.js index --root . --src src --out .my-dev-kit --incremental --refresh-scope changed-files --json
```

Use either form for the existing minimal fresh-extraction behavior: only added/changed files are freshly extracted, and every other unchanged file is reused. The two forms are equivalent.

### Affected-neighborhood

```powershell
node dist/cli.js index --root . --src src --out .my-dev-kit --incremental --refresh-scope affected-neighborhood --json
```

Use this when a more conservative one-hop fresh-extraction scope is desired: unchanged files exactly one graph hop from a modified or removed file are also freshly re-extracted, rather than only reused from the previous run.

Keep in mind:

- a first invocation, or one against an old/incompatible cache, may perform one full rebuild to establish a trustworthy baseline;
- a removed file can cause a surviving neighbor to be re-extracted, even though the removed file itself never reappears in current output;
- an added file is already freshly extracted, but it never seeds the baseline neighborhood itself;
- an unsafe or untrustworthy baseline selection falls back to a truthful full rebuild rather than silently narrowing to changed-files reuse;
- a no-change invocation remains a no-op regardless of the requested scope;
- this does not use graph-diff, and it does not recurse past one hop.

Inspect the command result's `incrementalRefresh` (or the printed `Refresh scope: ...` line) to see requested versus applied scope and the fallback reason, if any, rather than assuming the requested scope always ran. Neither scope is documented here as universally "safer" or "best" — pick based on how conservative the desired fresh-extraction boundary should be for the change being made.

## Workflow 18: Android coding-agent workflow (v1.13.0)

Use this ordered sequence when a coding agent is asked to modify the public Android example, or any Android project indexed the same way. It assumes the Workflow 10 index of `examples/basic-android-kotlin` and a built checkout (`node dist/cli.js`). The example request deliberately mixes two layers:

> "Show a progress indicator on the home screen while users are refreshing, and make the refreshing flag clear if the repository call fails."

The first half is UI work (`UserHomeScreen.kt` reads `isRefreshing`). The second half is state work (`UserViewModel.refreshUsers()` sets and clears it). Treat them as two edits with two owners and two sets of evidence.

1. **Establish the index identity.** Read `manifest.json` (`projectRoot`, `sourceRoots`, `createdAt`, analyzer statuses) and compare it with the current checkout. If source changed since `createdAt`, re-run the Workflow 10 index command first. A context capsule reports freshness as `unknown` when the manifest does not record a commit, so do not treat a directory name as proof of currency.
2. **Search for the named screen.** Use the exact selector, then the raw query to see what else competes:

```powershell
node dist/cli.js search --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --json
node dist/cli.js search --index examples/basic-android-kotlin/.my-dev-kit --query UserHomeScreen --limit 10 --json
```

   The exact selector returns one `android-composable` node. The raw query returns the `UserHomeScreenTest` symbol and the `UserHomeScreen` symbol with the same score, test first. That is ordinary relevance ranking, not a defect by itself, and it is not edit authority.
3. **Inspect production and test candidates.** Check each candidate's path and its `classificationRoles[].editGuidance`. `UserHomeScreen` is `compose-ui-component` with `safe-primary-edit-target`; `UserHomeScreenTest` is `instrumented-test` with `test-only`. `search --query UserHomeScreen --intent ownership` is optional here: it labels the production symbol `direct-owner` and keeps `UserHomeScreenTest` visible as `supporting-evidence`, because `src/test` and `src/androidTest` paths are test-scoped. (Before the v1.13.0 D2 correction the `androidTest` symbol was also labeled `direct-owner`.) Still read the path and classification, not only `ownership.tier`.
4. **Resolve the exact owner.** Pick the production candidate for the UI half and `UserViewModel` for the state half. If two production candidates remain plausible, keep both and decide from source, not from rank.
5. **Lookup the owner.** `lookup --node "android-compose-declaration:app/src/main/kotlin/com/example/kitdemo/UserHomeScreen.kt#UserHomeScreen" --depth 1 --resolve-classification --json`, and the same for `symbol:app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt#UserViewModel`.
6. **Slice the relevant dependencies.** Keep it bounded:

```powershell
node dist/cli.js slice --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --include-data-flow --json
node dist/cli.js slice --index examples/basic-android-kotlin/.my-dev-kit --node "symbol:app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt#UserViewModel" --include-data-flow --depth 2 --json
```

   Expect `composable-references-viewmodel`, `compose-state-reads-viewmodel`, and `viewmodel-uses-repository`. Expect no click-handler-to-state edge. `--include-data-flow` is a fixed Android edge family limited by `--depth`; check `androidDataFlow.truncated`.
7. **Retrieve bounded source.** `source --composable UserHomeScreen --format numbered` and `source --file app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt --symbol UserViewModel --format numbered`. Follow any `[CONTINUE: ...]` line with `--continue-from`. The Kotlin symbol end is not trusted, so a preview may stop early.
8. **Inspect related tests.** Run `slice ... --include-tests` for the composable and `search --android-role android-unit-test`. See Workflow 13: the related-test slice found the instrumented test, and the unit test was found only by role or name search.
9. **Check classification and conflict evidence.** Generate a role-specific capsule and read it; do not just accept it:

```powershell
node dist/cli.js context --index examples/basic-android-kotlin/.my-dev-kit --role implementation --query "Show a progress indicator on UserHomeScreen while UserViewModel is refreshing" --out examples/basic-android-kotlin/.my-dev-kit/progress-context.json --audit-out examples/basic-android-kotlin/.my-dev-kit/progress-audit.json --json
```

   Read `focus`, `selectedOwners`, `contextAdequacy`, `roleAdequacy`, and any conflict. For this single-sentence request that mentions both layers, the capsule selects `UserViewModel` as focus, keeps `UserHomeScreen` among the owners, and reports a conflict and an unresolved adequacy status instead of a single certain owner. Report that conflict. Do not delete one half of the request to make it go away.
10. **Decide whether the context is sufficient before editing.** Proceed only when, for each edit, you have: the exact production owner and its source, its immediate dependencies from a bounded slice, the closest test (or a stated test gap), and no unreported conflict. Otherwise retrieve more or ask. Success of every command above is not sufficient; a `context` capsule with a conflict, or a related-test slice that is empty, still requires a decision.

A search rank never authorizes an edit, and an instrumented test is never the production screen merely because it ranks first. Present ambiguous results and missing graph edges to whoever approves the change.

<a id="d2-context-owner-selection-is-unresolved"></a>

### D2: context owner selection and ambiguity boundaries

`context` chooses its focus from request wording plus a fixed Android task-intent model. The v1.13.0 D2 correction changed three things, all deterministic and bounded:

- Terms inside an exclusion clause (`without changing the ViewModel`, `while preserving ...`, `do not touch ...`) or a dependency clause (`from the DAO and Retrofit service`, `using ...`, `via ...`) no longer count as the layer being changed. They stay in the lexical query, the candidate list, graph neighborhoods, and dependency evidence; they just no longer earn the task-intent ranking boost.
- Bare `layout` and `presentation` count as UI terms. When no intent term matches at all, a CamelCase identifier ending in `Screen`, `ViewModel`, `Repository`, `Dao`, or `Entity` implies that layer.
- `src/androidTest` is test-scoped for `search --intent ownership`, so an instrumented test is `supporting-evidence`, never `direct-owner`. The test stays discoverable with its score and match reasons unchanged.

In the public example, "Change the UserHomeScreen layout without changing the ViewModel" and "Update UserHomeScreen presentation while preserving UserViewModel behavior" focus `UserHomeScreen` without treating its click-handler facts as competing owners. "Update UserHomeScreen presentation" keeps the screen as the production UI focus while navigation and related tests remain available as evidence. "Change UserRepository data-loading behavior without modifying UserApiService" and "Change how UserRepository refreshes users from the DAO and Retrofit service" focus `UserRepository`; the DAO and service remain supporting evidence. "Change the UserApiService Retrofit contract" focuses `UserApiService` while keeping the Repository available. "Update UserViewModel state handling" focuses `UserViewModel` without treating its consuming Compose screens as competing state owners. These results describe ownership/conflict selection, not a guarantee that every role-adequacy condition is satisfied. "Update the UserHomeScreenTest assertion" stays a test-oriented request, and under the `implementation` role it still reports the test-primary-target conflict.

Android ambiguous-owner conflicts compare candidates classified as primary for an active task intent. Supporting candidates, such as `ui-event` facts for a screen request or Compose consumers for a ViewModel-state request, stay in retrieval and graph evidence but do not compete solely because they are present. A source symbol and its Compose projection are one owner when the existing `defines-composable` graph edge establishes that relationship. Distinct primary production owners are not collapsed; a request that names two screens remains ambiguous, and a request spanning UI and ViewModel state retains a multi-responsibility conflict.

What is **not** solved, and stays a verification duty:

- Query sensitivity remains. The intent model is lexical: a request that genuinely names two layers (for example a screen and its ViewModel state) keeps both responsibilities visible and reports an ambiguous-owner conflict. The clause lists are fixed, so an unusual way of excluding or depending on a component is not recognized. Multiple distinct owners that are primary for the same requested responsibility also remain ambiguous; ranking alone does not prove unique edit ownership.
- The false `view-model` ambiguity between `MainActivity` and `UserViewModel` was caused by `android-components` assigning `view-model` to every class in a file that imports `androidx.lifecycle.ViewModel`; that component-role defect is corrected (D2-D). After a fresh index, `search --android-role view-model` returns `UserViewModel` only. Indexes built before D2-D must be rebuilt. The single-layer conflict correction uses current classification and graph evidence; it does not provide complete Kotlin parsing or runtime validation.
- `slice --include-tests` from a ViewModel or repository does not reach a unit test that only constructs the real class. That is a static-analysis limit, not a missing index: test-to-ViewModel edges exist only for a mock, fake, or stub whose referenced type resolves to an indexed class.
- The benchmark fixture phrasing noted in `benchmarks/retrieval/v1.13/README.md` (a "change the UserHomeScreen layout" request on `combined-app`) was not re-evaluated here.

Keep verifying the production owner with the exact selectors above, confirm the actual edit target from source, and treat a conflict or unresolved adequacy status as a decision for the person approving the change.

## Workflow 19: Python, JavaScript/TypeScript, framework and Rust retrieval (v1.14.0, unreleased)

These workflows use the unreleased v1.14.0 feature branch from a source checkout (`node dist/cli.js ...`); published v1.13.0 does not include them. They add no commands. Results are static source evidence: nothing is executed, and routes, models and tests are not proof of runtime behavior. Always take node IDs from `search` output.

**Python model and route ownership.** Index the Python source root, then search for the model or route and follow the result.

1. `index --root . --src app --out .my-dev-kit` (Python is analyzed with a local interpreter and `ast`; modules are never imported).
2. `search --index .my-dev-kit --query "Item model" --intent ownership --limit 5`. A Django or SQLAlchemy model appears as a normal symbol with model facts in the data-model artifacts; a FastAPI route appears as a `framework-route` node.
3. `lookup --node '<framework-route id>' --depth 1` shows the handler (`framework-route-handled-by-symbol`) and defining file; `source --node '<handler id>' --max-lines 40 --format numbered` reads the handler.

**JavaScript/TypeScript framework routes.** For Express or NestJS, search `"express GET /items"` or `"nestjs GET :id"`, then `lookup`/`slice` the `framework-route` node to reach the exact handler or controller method. Literal paths and mounts are reported; dynamic paths, inline handlers and unrecognized decorators stay marked unresolved. A route node does not mean the route is reachable or protected.

**Configured alias imports.** When `tsconfig.json` or `jsconfig.json` defines `paths` (for example `@/*` to `./src/*`), indexing adds ordinary file `imports` edges for uniquely resolved local targets. Use `lookup --node file:src/app/page.tsx --depth 1` or `slice` to inspect them. An alias that is ambiguous, excluded, external or outside the selected roots produces no edge. Editing the configuration invalidates the incremental cache.

**Rust crate, module and impl retrieval.** Select Rust roots explicitly (for example `--src crates/core/src --src crates/core/tests`), then use `search --intent ownership`, `lookup --node 'rust-package:...'` or a module ID, and `slice --depth 1` around a `rust-impl` node to see its type, trait and methods. See `examples/basic-rust-workspace/`.

**Exact Rust method and related test context.** Search with the impl wording (`"impl Runner for Worker run"`), then `source --node '<method id>' --max-lines 20 --format numbered`, and `context --query "..." --out <capsule>.json` for the architecture, implementation or test role. Tests are related by grounded static evidence only; a recognized test attribute does not mean the test ran.

**Mixed-language owner disambiguation.** When several languages define the same name (for example a `Worker` class in Python, TypeScript, Kotlin, Java and Rust), the search results keep one distinct node per file and language. Use the node's path and ID, not the bare name, for `lookup`, `source` and `slice`; no edge is created between files of different languages.

## Bundled examples

[examples/README.md](../examples/README.md) explains the repository examples. Normal npm users can run my-dev-kit against their own project without cloning this repository. Do not confuse maintainer benchmark fixtures with required installed-user input.

```powershell
npx @dailephd/my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index examples/basic-ts/.my-dev-kit --query service --limit 5 --json
npx @dailephd/my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --json
```

The output in these examples is under the example project root, not a doubly nested repository-relative path.

## Troubleshooting and feedback

Missing manifest: build the correct index or fix `--index`. Missing/partial analyzer output: inspect source roots, applicability, interpreter requirements and warnings. Unknown identity: search current evidence. Source truncation: continue or expand narrowly. Graphviz failure: use DOT or inspect fallback. Stale context: regenerate the matching capsule/audit pair after index refresh.

For a real workflow gap, retain the exact command, version, root/commit/index identity, expected versus observed result, safe fallback and cost. Use the [ecosystem failure record](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md#16-failure-feedback-and-improvement-planning). A successful feature workaround must not erase an ecosystem limitation.
