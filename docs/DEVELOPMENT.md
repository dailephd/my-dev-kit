# Development

This document describes how to work with the my-dev-kit source repository.

For public CLI usage, see COMMANDS.md.
For release steps, see RELEASE.md.
For CI behavior, see CI_CD.md.

## Prerequisites

Required:

- Node.js 18 or later
- npm

Required only for Python indexing tests or manual Python indexing:

- Python 3.8 or later
- python or python3 available on PATH

Optional:

- Graphviz, required only when manually testing SVG or PNG graph rendering

DOT graph output does not require Graphviz.

## Setup

Install dependencies from the repository root:

    npm ci

Build the CLI:

    npm run build

Check the built CLI:

    node dist/cli.js --help
    node dist/cli.js --version

## Development mode

For development without rebuilding after every source change, run the CLI through tsx:

    npm run dev -- <command> <args>

Examples:

    npm run dev -- --help
    npm run dev -- index --root examples/basic-ts --src src --out .my-dev-kit-dev --json
    npm run dev -- search --index examples/basic-ts/.my-dev-kit-dev --query user --json

The development command runs src/cli.ts directly.

## v1.7.0 retrieval regression suite

v1.7.0 is adding a maintainer-facing retrieval regression suite for
`my-dev-kit`'s own retrieval behavior. It is local, deterministic, and
fixture-config-based.

Run it with:

```sh
npm run benchmark:retrieval
```

This runs directly from TypeScript source via `tsx` (no build step
required, the same mechanism `npm run dev` already uses). It loads
`benchmarks/retrieval/v1.7/core.json`, validates the config, and for each
non-skipped task: resolves the task's fixture and source roots, builds a
fresh local index under `.my-dev-kit/retrieval-regression/tasks/<task-id>/index/`
(never inside the fixture itself), runs the real v1.6 `context` command
against that index as a subprocess, and captures the resulting
`context-capsule.json`, `retrieval-audit-record.json`, and a
`task-execution.json` execution record. Suite-level
`retrieval-regression-report.json`/`.txt` are written summarizing every
task's status, assertion results, metrics, and verdict (never raw
capsule/audit/graph/source content).

As of Batch 3, each executed task's generated capsule and audit record are
evaluated against that task's configured `expectations` (candidate
files/nodes, focus, selected graph, source evidence, semantic/
classification summaries, artifact references, conflicts, mode effects,
audit steps, no-raw-content, cap compliance, and context adequacy - see
`src/retrievalRegression/assertions.ts`). A task's verdict is `REGRESSION`
when a required assertion fails, `BLOCKED` when execution or a required
assertion could not be evaluated (missing/unreadable evidence), and `PASS`
otherwise; the suite verdict follows the same precedence
(`BLOCKED` > `REGRESSION` > `PASS`). Deterministic suite metrics
(`src/retrievalRegression/metrics.ts`) report task/assertion counts and
per-category pass rates (`null` when a category has no applicable
assertions, never a fabricated rate).

`npm run benchmark:retrieval` passes `--fail-on-regression`, so it now
exits nonzero if the suite regresses or is blocked. Without that flag, the
runner still writes a `REGRESSION`/`BLOCKED` report but exits 0 (an
infra-level failure - invalid config, or a failure to write the report -
always exits nonzero regardless of the flag). `--max-failures <n>` stops
running remaining tasks once `n` blocked/regressed tasks have accumulated,
recording the rest as `planned` with a clear reason and setting
`options.maxFailuresReached` in the report.

The maintained core suite now runs six deterministic tasks covering
data-model feature-add, subsystem mode, no-source metadata retrieval,
React/TSX component retrieval, no-false-conflict behavior, and an
ambiguous service query. Coverage is representative rather than
exhaustive.

`benchmark:retrieval` remains separate from `npm run verify`. Although the
suite is deterministic and makes no network or LLM calls, it starts
multiple indexing/context subprocesses and the broader test suite has
shown unrelated heavy CLI timeout flakiness. Run it as a distinct
maintainer/pre-release local check.

It is not a public CLI command (there is no `retrieval-benchmark`,
`context-benchmark`, or `retrieval-regression` command registered in
`src/cli.ts`), it is not wired into `npm run verify` or CI, and it does
not call an LLM, make network requests, execute user application code, or
edit source files.

This suite is separate from release and security validation. `my-dev-kit`
owns retrieval regression checks; `my-dev-kit-lab` continues to own
release-readiness, dependency/package, and security validation workflows.

## Build

Build the distributable CLI:

    npm run build

Build output:

- dist/cli.js

The build uses tsup with the repository tsup configuration.

The built CLI should start with the Node shebang:

    #!/usr/bin/env node

## Type checking

Run TypeScript type checking:

    npm run typecheck

This runs tsc without emitting compiled files.

## Tests

Run the full test suite:

    npm run test

Tests are located in tests/ and are organized by subsystem.

Main test areas:

- CLI behavior
- indexing
- lookup
- source retrieval
- graph slicing
- graph viewing
- search
- security boundaries
- language adapters

Most integration tests invoke the CLI as a child process against fixture projects in examples/. Unit tests call exported functions directly.

## Full validation

Complete validation requires both commands, in order, before release-related changes or package publishing:

    npm run test
    npm run verify

`npm test` runs the complete Vitest suite. `npm run verify` runs the remaining non-test verification gates (typecheck, build, docs check) and intentionally excludes the test suite, so running both does not execute the suite twice. `npm run verify` on its own is not a substitute for `npm test`.

If a more explicit validation sequence is needed, run:

    npm run typecheck
    npm run test
    npm run build
    npm run docs:check

### v1.10.1 context validation

Use the repository's existing scripts and focused suites to validate the v1.10.1 context surface:

```sh
npm ci
npm run typecheck
npm test
npm run test:security
npm run build
npm run docs:check
npm run verify
npm run benchmark:retrieval
npm pack --dry-run
npm run dev -- --help
npm run dev -- context --help
npx vitest run tests/context
npx vitest run tests/graph-diff
npx vitest run tests/indexing
```

The context suites cover request-file normalization and validation, all three roles, role/mode independence, providers and stable ranking, before/after changed surfaces, evidence groups, responsibility mapping, role adequacy, freshness, caps, truncation, full-file fallback, compatibility, determinism, and cross-platform paths.

For the unreleased v1.10.3 corrective patch, keep these regression suites in the focused context run:

- `tests/context/contextEvidenceGroups.spec.ts` — structurally grounded neutral owners, false-owner exclusions, and deterministic owner ordering.
- `tests/context/contextRequiredAllocation.spec.ts` — required-first reservations, deterministic spillover, finite aggregate bounds, genuine required truncation, diagnostics, adequacy, legacy compatibility, and determinism.
- `tests/context/contextResponsibilityDuplicates.spec.ts` — duplicate and unknown/unmapped observability, first-occurrence mapping order, capsule/audit parity, and deterministic request handling.
- `tests/context/contextDirectedEvidence.spec.ts` — canonical file graph identity, dependency/caller direction, deduplication, and symbol/file parity.
- `tests/context/contextV1103IntegrationMatrix.spec.ts` — end-to-end producer coverage for the repository-owned historical context cases represented by permanent fixtures.

Do not depend on transient external fixture paths. Permanent regressions belong in repository-owned tests or fixtures, and generated capsule, audit, index, benchmark, and temporary request outputs must remain ignored and uncommitted.

Smoke-test the legacy command, each role, structured request input, JSON parsing, capsule and audit output, before/after indexes, missing evidence, a tiny budget, and stale or unknown context. The CLI reports deterministic character budgets rather than exact model-token counts. Focused context validation uses Vitest directly; there is no separate npm script for each scenario.

## Local CLI smoke test

After building, run a basic TypeScript smoke test:

    node dist/cli.js index --root examples/basic-ts --src src --out .my-dev-kit-dev --call-graph --json
    node dist/cli.js search --index examples/basic-ts/.my-dev-kit-dev --query user --limit 5 --json
    node dist/cli.js lookup --index examples/basic-ts/.my-dev-kit-dev --node file:src/index.ts --depth 1 --json
    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format dot --out examples/basic-ts/.my-dev-kit-dev/graph.dot --edge-style semantic --json

Run a Python smoke test when Python is available:

    node dist/cli.js index --root examples/basic-python --src src --language python --out .my-dev-kit-dev --json
    node dist/cli.js search --index examples/basic-python/.my-dev-kit-dev --query greet --limit 5 --json

Clean up local smoke-test artifacts:

    node -e "require('fs').rmSync('examples/basic-ts/.my-dev-kit-dev', { recursive: true, force: true })"
    node -e "require('fs').rmSync('examples/basic-python/.my-dev-kit-dev', { recursive: true, force: true })"

## Local tarball testing

Use local tarball testing to verify installed-package behavior before publishing.

Build and pack the package:

    npm run build
    npm pack

Install the tarball globally:

    npm install -g ./dailephd-my-dev-kit-<version>.tgz

Run installed CLI checks:

    my-dev-kit --help
    my-dev-kit --version

Run an installed CLI smoke test:

    my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit-release --call-graph --json
    my-dev-kit search --index examples/basic-ts/.my-dev-kit-release --query user --limit 5 --json
    my-dev-kit view --index examples/basic-ts/.my-dev-kit-release --format dot --out examples/basic-ts/.my-dev-kit-release/graph.dot --edge-style semantic --json

Clean up smoke-test artifacts:

    node -e "require('fs').rmSync('examples/basic-ts/.my-dev-kit-release', { recursive: true, force: true })"

Uninstall the local package after testing:

    npm uninstall -g @dailephd/my-dev-kit

## npm scripts

Common scripts:

- npm run build
  Builds src/cli.ts into dist/cli.js.

- npm run dev -- <args>
  Runs the CLI from source through tsx.

- npm run typecheck
  Runs TypeScript type checking without emitting files.

- npm run test
  Runs all tests with Vitest. This is the canonical complete test suite.

- npm run verify
  Runs the non-test verification chain (typecheck, build, docs check). It excludes the test suite; run npm run test separately for complete validation.

- npm run clean
  Removes dist/.

## Source layout

Main source directories:

- src/cli.ts
  CLI entry point.

- src/commands/
  One command module per public CLI command.

- src/indexing/
  Index orchestration, source discovery, artifact writing, and artifact loading.

- src/languages/
  Language adapter registry and language-specific adapters.

- src/languages/typescript/
  TypeScript, TSX, JavaScript, and JSX indexing support.

- src/languages/python/
  Python indexing support through Python AST extraction.

- src/symbol-index/
  Per-file symbol table construction.

- src/graph/
  Code graph types, graph slicing support, DOT generation, and Graphviz rendering.

- src/lookup/
  Node lookup, source target resolution, source slicing, and traversal behavior.

- src/search/
  Deterministic keyword search over index artifacts.

- src/source/
  Source output rendering.

- src/io/
  Shared file-system and JSON I/O helpers.

- src/version.ts
  CLI version constant.

## Test layout

Main test directories:

- tests/cli/
  Command registration and CLI behavior.

- tests/index/
  Indexing, manifest writing, artifact writing, and source discovery.

- tests/lookup/
  Lookup behavior, source retrieval, source rendering, and graph slice behavior.

- tests/view/
  DOT generation and graph view behavior.

- tests/search/
  Search behavior and search ranking.

- tests/security/
  Security boundary regression tests.

- tests/android/
  Android/Gradle detection and Gradle-evidence parsing (`src/android/`). Fixtures live under
  `tests/fixtures/android-gradle/`, one directory per scenario (Groovy vs. Kotlin DSL, multi-module,
  build types/product flavors, `gradle/libs.versions.toml` version catalogs, source-set overrides,
  dynamic/unsupported Gradle expressions, and a non-Android Gradle project). Deterministic-output
  tests build the same fixture twice and assert byte-identical results (module/plugin/dependency/
  warning ordering must never depend on file-system enumeration order). Incremental Gradle behavior
  (unchanged/changed/deleted settings, build, and version-catalog files; stale-artifact cleanup;
  full vs. incremental equivalence) is covered in `tests/index/androidGradleIncremental.spec.ts`,
  which drives the real CLI (`--incremental`) against a copied fixture rather than calling the
  parser directly. `tests/android/parseAndroidManifest.spec.ts` and `tests/android/androidManifestProject.spec.ts`
  cover the bounded XML parser (`src/android/xml/parseXml.ts`) and `android-manifest.json` assembly
  directly (namespace-prefix handling, malformed XML, resource-reference/placeholder classification,
  component-name resolution). Fixtures live under `tests/fixtures/android-manifest/`: a basic
  launcher-activity app, a component-complete app (activity/activity-alias/service/receiver/provider),
  a multi-source-set app (duplicate declarations across `main`/`debug`, asserting no merge), a
  custom-manifest-path app (Gradle `manifest.srcFile(...)` override), a malformed-XML app, and an
  Android module with zero manifest files. Deep-link and FileProvider/network-security fixtures are
  covered inline in `parseAndroidManifest.spec.ts` rather than as separate fixture directories, since
  they only need a single manifest file, not a full Gradle project tree. Deterministic-output tests
  build the same fixture twice and assert byte-identical results. Incremental manifest behavior
  (unchanged/added/changed/deleted manifests, namespace changes, custom-path changes, stale-artifact
  cleanup, full vs. incremental equivalence) is covered in `tests/index/androidManifestIncremental.spec.ts`,
  mirroring the Batch 1 Gradle incremental test's real-CLI-driven approach. `tests/android/androidResourceParsers.spec.ts`
  and `tests/android/androidResourceProject.spec.ts` cover qualifier parsing (`values-es-rUS-night-v31`
  style directory names), value-resource parsing (strings/colors/styles/arrays/plurals/attrs/styleables),
  layout parsing (declared IDs, ID/theme-attribute references, `<include>`, `<fragment>`), generic/
  drawable/menu/navigation XML file definitions, FileProvider `<paths>` parsing, and
  `<network-security-config>` parsing, plus resource-reference classification and candidate-target
  enumeration (never a single resolved winner). Fixtures live under `tests/fixtures/android-resources/`:
  a basic app with qualified `values`/`values-es`/`values-night` directories, a layout, a drawable, a
  mipmap placeholder, FileProvider paths, and network-security config; a custom-resource-directory app
  (Gradle `res.srcDirs(...)` override); a malformed-values-XML app; and an Android module with zero
  resource directories. When changing the shared XML parser for resource needs, always re-run
  `tests/android/parseAndroidManifest.spec.ts` too — it is the Batch 2 regression guard and must keep
  passing unchanged. Incremental resource behavior (unchanged/added/changed/deleted values and layouts,
  qualified-directory add/delete, binary-resource content changes, specialized-XML changes,
  custom-directory-path changes, stale-artifact cleanup, full vs. incremental equivalence) is covered in
  `tests/index/androidResourcesIncremental.spec.ts`. `tests/android/androidNavigationXml.spec.ts` and
  `tests/android/androidNavigationProject.spec.ts` cover XML navigation-graph parsing (root/nested
  graphs, fragment/activity/dialog/custom destinations, actions with candidate destination/popUpTo
  enumeration, arguments, deep links, includes with multi-candidate resolution, malformed XML) and the
  merged XML+Compose artifact; `tests/android/composeNavigationRoutes.spec.ts` covers the bounded static
  Compose route extractor directly (string routes, `route=` named argument, same-file `const val`
  resolution, dynamic-expression non-invention, direct-screen-candidate boundaries including the
  ambiguous-`if`/`else` case, `NavHost`/`navigation(...)` builder forms). Fixtures live under
  `tests/fixtures/android-navigation/`: a basic app with an XML nav graph plus a Kotlin file using
  `NavHost`/`composable`/local-const routes, a malformed-navigation-XML app, and an Android module with
  zero navigation evidence. When changing the shared XML parser for navigation needs, always re-run
  `tests/android/parseAndroidManifest.spec.ts` (Batch 2) and `tests/android/androidResourceParsers.spec.ts`
  (Batch 3) too — both are regression guards and must keep passing unchanged; likewise re-run the Kotlin
  adapter's own test suite if the Compose route extractor's bounded raw-text scan is ever merged into
  the Kotlin structural indexer rather than kept as an independent re-read (it currently is independent,
  by design, to avoid touching `symbol-index.json`/`KotlinAdapter` at all). Incremental navigation
  behavior (XML add/edit/delete, Compose-route add/edit/delete via the normal Kotlin changed-file path,
  qualified/custom-directory changes, stale-artifact cleanup, full vs. incremental equivalence) is
  covered in `tests/index/androidNavigationIncremental.spec.ts`. `tests/android/androidArtifactRelationships.spec.ts`
  covers `buildAndroidArtifactRelationships` directly against a full-pipeline fixture build (module/
  source-set union, manifest-component-to-class resolution including `activity-alias`/`targetActivity`
  and duplicate-candidate non-fuzzy matching, intent-filter/permission edges, resource-defined-in-file
  and `R.type.name` source-reference extraction including comment/string false-positive avoidance,
  navigation destination/action/include candidate enumeration, Compose-route-to-screen resolution,
  exact deep-link matching including placeholder/prefix rejection, and byte-identical determinism
  across repeated runs). It does not exercise the CLI or `--incremental` — that lives in
  `tests/index/androidRelationshipsIncremental.spec.ts`, which mirrors the Batch 1-4 incremental
  tests' real-CLI-driven approach but asserts against `code-graph.json`'s Android node/edge subset
  and the `android-relationships` analyzer entry in `manifest.json` rather than a dedicated artifact
  file, since Batch 5 adds no new artifact. `tests/graph-diff/androidGraphDiffCompatibility.spec.ts`'s
  module-type-change test was updated in Batch 5 (not a regression) to expect exactly one changed
  `android-module` node, since `android-project.json`'s module type is now projected onto
  `code-graph.json` — before Batch 5 that same edit produced zero node changes.
- `tests/android/androidRetrieval.spec.ts` (v1.10.0 Batch 6) unit-tests the shared resolver
  (`src/android/androidRetrieval.ts`) directly against a real indexed fixture: exact-match route/
  permission/resource/component resolution, `resolveAndroidSelectorMode`'s mutual-exclusivity
  contract, missing-index error behavior, search/lookup result-builder determinism, and stale
  retrieval after a route rename/permission removal plus full-vs-incremental result equivalence.
  `tests/cli/androidRetrievalCommands.spec.ts` drives the real CLI for every new selector/view
  (`search --android-route|--permission|--resource|--android-component`, `lookup --android-component`,
  `source --android-route|--resource`, `slice --android-route|--android-component`,
  `view --graph android-module|android-manifest|android-navigation`, and `context` Android-query
  integration) against `tests/fixtures/android-retrieval/combined-app/` — a single combined fixture
  with two components sharing a simple class name in different packages (ambiguity coverage), a
  resource defined in both `values/` and `values-es/` (qualifier-ambiguity coverage), a bare
  resource name shared by a `drawable` and a `mipmap` (type-ambiguity coverage), a binary PNG
  resource (binary non-decode coverage), and an exact manifest-to-navigation deep-link match. It
  also covers missing-Android-evidence and non-Android-project compatibility (existing `--query`
  search, existing `--graph code`/other views, and the new Android selectors all degrading
  honestly — empty results/graphs at exit 0, never a crash). When extending Batch 5's relationship
  edge kinds or Batch 6's resolver matching rules, re-run both files together, since the CLI test
  file's ambiguity/candidate-count assertions depend on the resolver's exact-match semantics.
- `tests/integration/` (v1.10.0 Batch 7) holds the combined-integration gate that validates the
  complete v1.10.0 Android pipeline end to end (source → Batch 1-4 artifacts → Batch 5 relationships
  → Batch 6 retrieval/views/context) as one coherent capability, rather than one batch at a time.
  It reuses **the same canonical fixture** `tests/fixtures/android-retrieval/combined-app/` Batch 6
  established (per Batch 7's explicit no-duplicate-fixture decision), extended with a second
  (`:core`) library module, a Groovy build file alongside the existing Kotlin DSL one, product
  flavors/a flavor dimension/a version-catalog alias/one intentionally-dynamic dependency
  expression, a debug-source-set-only permission, an activity-alias with resolved `targetActivity`
  evidence, `uses-permission-sdk-23`/`uses-feature`/application-and-component metadata, an exact
  deep-link candidate plus a host-mismatched non-matching one, a manifest component with no
  matching source class, night-mode-qualified color duplicates, styles/arrays/plurals/styleable
  resources, a nested navigation graph, a dialog/custom destination, an action with `popUpTo` and
  one referencing a missing target, an included graph, and Compose evidence covering every
  supported builder (`composable`/`navigation`/`dialog`) plus a direct type-safe route
  (`composable<HomeRoute>()`), a local-const route, a dynamic unresolved route, and an ambiguous
  conditional-content route. When adding fixture evidence, prefer extending this one fixture over
  creating a new one, and keep additions self-contained (no Gradle/Android-SDK/network dependency)
  so `tests/integration/androidV110CombinedFixture.spec.ts`'s fixture-integrity assertions and the
  other four suites' exact candidate-count assertions stay accurate — a fixture edit that changes
  match counts requires updating those counts in the same commit (Batch 7 hit exactly this while
  extending the fixture: two pre-existing Batch 6 tests in `tests/android/androidRetrieval.spec.ts`
  and `tests/cli/androidRetrievalCommands.spec.ts` had hardcoded counts/permission-removal string
  replacements that no longer matched the richer fixture, and were updated in place).
  `tests/integration/androidV110Artifacts.spec.ts` covers full artifact generation, cross-artifact
  ID continuity (module/source-set/manifest/resource/navigation IDs matching `androidEntityId` on
  the corresponding `code-graph.json` node), the full Batch 5 relationship-family matrix, and a
  graph-compactness check (no nested-object `androidMetadata` values, i.e. no embedded artifact
  fragment). `tests/integration/androidV110Retrieval.spec.ts` exercises every Batch 6 selector,
  lookup, source, slice, and the three graph views end to end, plus two dedicated closures Batch 6
  explicitly deferred: activity-alias public retrieval (search/lookup/slice all resolve the alias
  to its exact `targetActivity` source class) and direct type-safe Compose route retrieval.
  `tests/integration/androidV110Incremental.spec.ts` covers a representative incremental/stale
  matrix plus two more dedicated Batch 6 closures — resource-deletion and component-rename stale
  retrieval — each verified against both an incremental re-index and a clean full re-index of the
  same modified fixture for equivalence, plus a determinism gate (two clean full indexes compared
  byte-for-byte after normalizing `createdAt`/`projectRoot`). `tests/integration/androidV110GraphDiff.spec.ts`
  covers `graph-diff` against bounded Android changes (added permission, changed action target,
  added Compose route) and the missing/malformed-index gate (non-Android project compatibility,
  malformed `android-manifest.json` not silently ignored and not auto-mutated). Full versus
  incremental and determinism comparisons always normalize only `createdAt`/`projectRoot` — never
  broadly strip fields to force equality. None of the five suites require Gradle, an Android SDK,
  or network access; they only exercise the existing indexer/CLI against local fixture files.

Security tests cover:

- path traversal protection
- artifact path validation
- malformed artifact handling
- DOT escaping
- output path behavior
- traversal depth limits
- output size limits

## Example projects

The examples directory contains fixture projects used by tests, documentation, and smoke checks.

Included examples:

- examples/basic-ts/
  TypeScript example project.

- examples/basic-python/
  Python example project.

The package may include selected example source folders for public smoke tests. Development-only generated artifacts under examples should not be committed or published.

## Generated files

Common generated directories and files:

- dist/
  Build output. Included in the npm package.

- examples/basic-ts/.my-dev-kit-*/
  Local or CI index artifacts. Not committed.

- examples/basic-python/.my-dev-kit-*/
  Local or CI index artifacts. Not committed.

- *.tgz
  Local npm package tarballs. Not committed.

Generated index artifacts should be treated as disposable unless a specific test fixture intentionally requires one.

## Package contents

The published npm package should include:

- dist/
- README.md
- LICENSE
- CHANGELOG.md
- public documentation files
- public examples intended for users
- package.json

The published npm package should not include:

- src/
- tests/
- node_modules/
- generated index artifacts
- local smoke-test folders
- alpha-import/
- private planning notes
- temporary migration files

Use npm pack --dry-run to inspect package contents before publishing.

## Python development notes

Python indexing uses a subprocess and AST extraction scripts.

The adapter checks for:

- python
- python3

Python files are parsed but not executed.

When Python is not available, Python indexing may be skipped with a warning depending on the command path. TypeScript and JavaScript indexing should continue to work independently.

## Graphviz development notes

DOT output is generated directly and does not require Graphviz.

SVG and PNG rendering require the Graphviz dot executable.

Use DOT output for cross-platform CI smoke tests:

    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format dot --out examples/basic-ts/.my-dev-kit-dev/graph.dot

Use SVG or PNG manually when Graphviz is installed:

    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format svg --out examples/basic-ts/.my-dev-kit-dev/graph.svg
    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format png --out examples/basic-ts/.my-dev-kit-dev/graph.png

## Release preparation

Before publishing a release:

    npm ci
    npm run test
    npm run verify
    npm pack --dry-run

Then follow RELEASE.md.

Do not publish from an unverified working tree.
