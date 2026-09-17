# Workflows

This guide contains ordered workflows for **my-dev-kit itself**. [COMMANDS.md](COMMANDS.md) owns exact syntax, selectors, defaults, outputs, and command limitations. [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) owns detailed artifact contracts.

For coding-agent execution, full-stack features, runtime verification, Orchestrator stages, Lab assurance, release coordination, recovery, and ecosystem feedback, use the single [Ecosystem development workflows](ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md) guide in this repository. Companion repositories link there rather than keep another copy. No private local ecosystem text file or undocumented synchronization command is required.

## Overview

Use an existing valid current index or build one with explicit source roots. Narrow an actual question through search, exact lookup, a relevant slice, and bounded source. Use continuation or same-file expansion for missing context. Refresh evidence after source changes. Keep separate snapshots only when a before/after comparison requires them.

Static evidence is not application execution. A valid command result can still be empty, ambiguous, missing an optional artifact, or inadequate for the task. Inspect semantic results and warnings, not only exit status.

## Workflow 1: Index a TypeScript or JavaScript project

From the target project root:

```powershell
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src src --src tests --out .my-dev-kit --call-graph --json
```

The second command refreshes the same index with an explicitly expanded source contract. `--src` and relative `--out` are relative to `--root`. Do not repeat the root inside a relative output path accidentally.

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

Record the selected owner, extension point, contract, relevant test, and uncertainty. A top-ranked result is not automatic authorization to edit it. A missing relationship is a retrieval limitation until checked, not proof that no caller exists.

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

Use the returned continuation cursor rather than assume a complete symbol. Local imports, types, props, components, and dependency expansion are same-file static context, not cross-file closure. Follow cross-file dependencies with additional lookup/source calls.

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
