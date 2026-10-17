# Android retrieval benchmarks (v1.13.0)

Internal maintainer guide for `benchmarks/retrieval/v1.13/android.json`. This is not the public Android example or workflow documentation, and nothing here is part of the published npm package.

## 1. Purpose and version scope

The suite turns the Android retrieval evidence established for v1.13.0 into a deterministic regression suite: twelve scenarios (A01–A12) drawn from the roadmap's planned Android benchmark coverage. Each task runs one retrieval operation over a checked-in fixture and asserts only static evidence that the current analyzers actually produce.

A benchmark `PASS` means the asserted static evidence is still produced. It does not mean the full roadmap scenario is verified; each task below lists what it covers and what it cannot.

## 2. Existing regression-runner dependency

The suite uses the existing `src/retrievalRegression/` runner: configuration loader, fixture resolver, per-task index preparation, command executor, assertion evaluator, verdict and metrics, and report writer. There is no second runner. Each task executes exactly one primary command:

- `context` (omitted `execution`): A01, A10, A11
- `source`: A02
- `slice`: A03–A09, A12

Slice tasks use the typed `commandResult.slice` assertions (exact nodes, node kinds, edge kinds, exact `source`/`kind`/`target` edges, connected paths, forbidden nodes and edges, node and edge bounds, data-flow truncation and related Android test evidence). Context tasks use the existing context assertions. A02 uses the existing source `commandResult` fields.

## 3. Fixture sources

All fixtures are existing, unmodified, checked-in fixtures resolved relative to the configuration file:

- Combined Android application: `tests/fixtures/android-retrieval/combined-app` (A01–A10), source roots `app/src/main`, `app/src/debug`, `app/src/test`, `app/src/androidTest`, `core/src/main`.
- Android test-semantic application: `tests/fixtures/android-test-semantic/basic-app` (A12), source roots `app/src/main`, `app/src/test`, `app/src/androidTest`.
- Generated build-output application: `tests/fixtures/android/generated-build-output` (A11), source root `app`.

No host-specific absolute path appears in the configuration.

## 4. Suite configuration path

`benchmarks/retrieval/v1.13/android.json` — suite id `android-v1.13`, schema version `1.0.0`, twelve executable tasks `android-v113-a01` through `android-v113-a12`, none skipped.

## 5. How to run the suite

From a source checkout:

```
npm run benchmark:retrieval:android
```

This runs `tsx src/retrievalRegression/runRetrievalRegression.ts` with the Android configuration, writes to `.my-dev-kit/retrieval-regression-android`, and exits nonzero on regression. The output directory is generated and ignored; it is never tracked. To keep earlier results, pass a different `--out` directly to the runner instead of using the script.

## 6. Twelve benchmark tasks

- A01 Add a new Compose screen (`context`, feature-add).
- A02 Modify an existing Compose screen (`source`).
- A03 Test tag, composable and ViewModel evidence (`slice`).
- A04 Route to composable and navigation declaration (`slice`).
- A05 String resource to composable and tests (`slice`).
- A06 ViewModel state to UI ownership evidence (`slice`).
- A07 Repository to Room DAO and Retrofit service (`slice`, data flow).
- A08 Room entity to DAO, repository and test implications (`slice`, data flow and tests).
- A09 Manifest permission and component source (`slice`, Android component).
- A10 Screen UI versus ViewModel ownership (`context`, feature-add).
- A11 Generated Gradle and build output avoidance (`context`, feature-add).
- A12 Unit and instrumented test evidence (`slice`, tests).

## 7. Execution kind for each task

See section 6. Slice depth never exceeds 3 (A08 uses 3, A05 and A07 use 2, A04 uses 2, the others use 1). The `context` tasks keep the original query wording, including connector words such as `a` and `to` in A01.

## 8. Required positive and negative evidence

Positive evidence is exact: node identities, node kinds, exact directed edges and ordered connected paths inside one returned graph. Negative evidence names a realistic failure:

- A01: a Compose-screen focus other than `UserHomeScreen`, build-output files, or resource files in the selected graph or source evidence.
- A02: another screen's or the ViewModel's declaration appearing in the bounded source.
- A03/A06: the sibling settings screen, or over-expansion into the repository layer.
- A04: other routes (`compose_home` candidates), the home screen, and the sibling `UserSettingsScreen` composable.
- A05: the sibling settings screen.
- A07/A08: reversed or mis-attributed data-layer edges (DAO to repository, repository to service mislabeled as DAO).
- A09: other manifest components and permissions.
- A10: a ViewModel, instrumented-test or Activity focus, an ownership conflict, or the ViewModel file as source evidence.
- A11: generated build files in the selected graph or source evidence.
- A12: a unit test method wrongly wired to the instrumented test.

## 9. Actual assertion coverage

- A01: focus, candidate files and nodes, selected graph and source files, classification (`compose-ui-component`, `safe-primary-edit-target`), no conflict, mode effect, audit steps, cap compliance, adequacy, no raw content.
- A02: file window (lines 4–15), required content including `R.string.user_screen_title`, `refresh_users_button` test tag and `viewModel.refreshUsers()`, forbidden content, and the unknown-boundary end-of-file cursor.
- A03: composable, test-tag and click facts, ViewModel reference, test-file to class to method path, related-test summary.
- A04: unique `settings` route, exact route-to-screen edge, declaring-file path, bounds.
- A05: composable, string-resource fact, resource definition kind, composable-to-test reference, related-test summary.
- A06: composable-to-ViewModel reference, `collectAsState` fact reads the ViewModel (connected path), bounds, no data-layer expansion.
- A07: connected ViewModel, repository, DAO, entity path and ViewModel, repository, Retrofit service path; non-truncated data-flow summary.
- A08: Room database to DAO to entity and repository to DAO to entity paths, repository test-double fact kind and its test-to-production edge kind, non-truncated data flow, related-test summary.
- A09: manifest file declares component, component uses permission, component resolves to source class (connected path).
- A10: focus on the screen composable, retained candidates, no conflict, classification.
- A11: focus and source on the real `MainActivity`, no generated file in graph or source, static `generated-file` classification with `generated-do-not-edit` guidance and `generated-build-file-risk`.
- A12: unit test class (`src/test`) and instrumented test class (`src/androidTest`) both retrieved with their own production edges, instrumented class hierarchy path, related-test summary.

## 10. Known static-analysis limitations

- A03: the static graph has no complete click-handler-to-ViewModel-method or state edge. The click fact and the composable-to-ViewModel reference are asserted separately; no handler-to-state edge is asserted or implied.
- A05: the link between the resource and the test is indirect, and `stringResource` values are not resolved into executed Compose UI assertions. Nothing asserts that the test's `onNodeWithText` succeeds at runtime.
- A06: the Kotlin extractor does not index `uiState` as a class-member symbol, so no `uiState` node is required. Static state consumption is not proof of runtime rendering.
- A08: test doubles that reference the DAO and Retrofit interfaces are not resolved by the current relationship system; no such edges are asserted. The graph does not prove Room migration or schema behavior or executable test coverage.
- A09: the typed assertions do not compare manifest attributes. `android:exported`, `android:permission` values and intent-filter attributes are not regression-covered.
- A12: unit versus instrumented classification is visible only through the source-set path in node ids (`src/test` versus `src/androidTest`). No source-set metadata field is compared, and test existence is not evidence of execution.

## 11. Determinism and resource bounds

Every task indexes its fixture with the existing per-task index preparation and runs one command. Results are ordered, bounded by task caps, `maxNodes` and `maxEdges`, and independent of timestamps and absolute temporary paths. Slice depth is at most 3. Resource ordinals such as `strings.xml#value:1` are intentionally not pinned. Some identities embed source positions and must be updated if the fixture changes:

- `...::testtag#0@L11`, `...::click#0@L10` (A03), `...::stringresource#0@L7` (A05), `...::state#0@L6` (A06) compose-fact ids in `UserHomeScreen.kt`.
- `AppNav.kt#2` (the `settings` route ordinal, A04).
- The `:0` ordinal on manifest component ids (A09).

## 12. Interpretation of PASS, REGRESSION and BLOCKED

- `PASS`: every required assertion held for the fixture evidence.
- `REGRESSION`: a required expectation evaluated and failed (missing or forbidden node or edge, broken path, bound exceeded, wrong focus or status).
- `BLOCKED`: judgment could not be attempted (command failure, unreadable or malformed output, missing requested summary). BLOCKED outranks REGRESSION at suite level.

Optional (`required: false`) assertions can only warn; blocked assertions are never downgraded.

## 13. Relationship to the original fourteen-task core suite

The core suite (`benchmarks/retrieval/v1.7/core.json`, `npm run benchmark:retrieval`) is unchanged and independent. The Android suite adds twelve separate tasks and does not alter any core task, assertion or default output path.

## 14. Static retrieval verification versus Android runtime testing

These benchmarks check what static retrieval returns for fixture source. They do not run Gradle, an emulator or instrumentation, and do not execute app or test code. A passing benchmark says nothing about runtime behavior, exported-component behavior on a device, or whether any test passes.

## Context phrasing note (A10)

Context focus is lexical. With the same fixture, "modify the UserHomeScreen composable UI" selects the screen composable, but "change the UserHomeScreen layout" selects the instrumented test with low confidence, and requests that mention "ViewModel" or "refresh state" can select `UserViewModel`. A10 records the phrasing that selects the correct owner; the other phrasings are observed ranking behavior, not asserted here, and no production code special-cases this task.
