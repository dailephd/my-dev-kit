# basic-android-kotlin

Small Kotlin, Jetpack Compose, Room, and Retrofit Android project for learning and smoke testing my-dev-kit's Android retrieval workflow.

## 1. Purpose

This is a **static retrieval sample**. It shows how to index your own Android project, then use `search`, `lookup`, `slice`, and `source` to find the right screen, ViewModel, repository, data class, manifest entry, resource, route, or test before editing.

It has been reviewed for syntax and indexed with my-dev-kit. It has **not** been compiled with Gradle, built with the Android SDK, run on an emulator or device, or executed as unit or instrumented tests. Do not treat it as a validated deployable application.

You do not need Gradle, the Android SDK, an emulator, a running app, or instrumented test execution for any command below. my-dev-kit reads source files; it does not build or run them.

## 2. Architecture overview

```
MainActivity (manifest-declared, hosts Compose)
  -> AppNavigation (routes "home" and "settings")
       -> UserHomeScreen  -> UserViewModel -> UserRepository -> UserDao (Room) -> UserEntity
       |                                                    \-> UserApiService (Retrofit)
       -> UserSettingsScreen
AppDatabase (Room) exposes UserDao and lists UserEntity
```

The app is one module with manual construction in `MainActivity`. It deliberately has no dependency-injection framework, no backend, and no multi-module layout.

## 3. File and layer responsibilities

- `app/src/main/AndroidManifest.xml` — application identity, the `MainActivity` declaration with explicit `android:exported`, a launcher filter, and an illustrative `https://example.com/users` deep link.
- `MainActivity.kt` — Activity that builds the data layer and calls `setContent`.
- `AppNavigation.kt` — Compose `NavHost` with the `home` and `settings` routes.
- `UserHomeScreen.kt` — UI only: reads `uiState`, shows strings, has the `refresh_users_button` test tag and a click handler.
- `UserSettingsScreen.kt` — second, independent screen with local UI state.
- `UserViewModel.kt` — owns `uiState` and `refreshUsers()`, delegates data access to the repository.
- `data/UserRepository.kt` — combines `UserDao` and `UserApiService`.
- `data/UserEntity.kt`, `data/UserDao.kt`, `data/AppDatabase.kt` — Room entity, DAO, and database.
- `data/UserApiService.kt` — Retrofit interface and its response type.
- `app/src/main/res/values/strings.xml` — visible UI strings.
- `app/src/test/.../UserViewModelTest.kt` — JVM unit test source set.
- `app/src/androidTest/.../UserHomeScreenTest.kt` — Compose UI test source set (instrumented).

## 4. Prerequisites for my-dev-kit indexing

- Node.js and npm.
- Run commands from the my-dev-kit repository root (or an unpacked package that contains `examples/`).
- Pass the three Android source roots as repeated `--src` values so production, unit-test, and instrumented-test code are all indexed.

Android project, Gradle, manifest, resource, navigation, Compose, and test evidence is detected under `--root` automatically.

This example is part of the unreleased v1.13.0 candidate. The commands below are written with `npx @dailephd/my-dev-kit`; from a built source checkout use `node dist/cli.js` in its place (the command surface is the same). See the [quickstart](../../docs/QUICKSTART.md) and the [Android coding-agent workflow](../../docs/WORKFLOWS.md#workflow-18-android-coding-agent-workflow-v1130-candidate).

## 5. Index the example

```sh
npx @dailephd/my-dev-kit index --root examples/basic-android-kotlin --src app/src/main --src app/src/test --src app/src/androidTest --out .my-dev-kit --json
```

`--out` is resolved against `--root`, so the index is written to `examples/basic-android-kotlin/.my-dev-kit`. The `android-gradle` analyzer reports partial status with warnings for BOM-managed dependencies that carry no version (for example `androidx.compose.ui:ui`). That is expected and does not affect retrieval. The `classification` analyzer also reports `partial` (per-entry warnings where no static classification evidence matched). The commands below assume this index location.

## 6. Search

```sh
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --composable UserSettingsScreen --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --test-tag refresh_users_button --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --query "UserViewModel" --limit 5 --json
```

Exact selectors (`--composable`, `--test-tag`, and the others in `docs/COMMANDS.md`) return exact matches. Free-text `--query` is fuzzy: a query that names a screen can also return its test file, so prefer an exact selector when you know the name.

## 7. Lookup

Obtain a node ID first (the `symbol:` ID appears in the `--query` result above), then look it up:

```sh
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --android-component MainActivity --json
npx @dailephd/my-dev-kit lookup --index examples/basic-android-kotlin/.my-dev-kit --node "symbol:app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt#UserViewModel" --depth 1 --resolve-classification --json
```

## 8. Slice

```sh
npx @dailephd/my-dev-kit slice --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --include-data-flow --json
npx @dailephd/my-dev-kit slice --index examples/basic-android-kotlin/.my-dev-kit --android-route settings --json
npx @dailephd/my-dev-kit slice --index examples/basic-android-kotlin/.my-dev-kit --android-component MainActivity --include-data-flow --json
```

## 9. Bounded source retrieval

```sh
npx @dailephd/my-dev-kit source --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --format numbered
npx @dailephd/my-dev-kit source --index examples/basic-android-kotlin/.my-dev-kit --file "app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt" --symbol UserViewModel --format numbered
npx @dailephd/my-dev-kit source --index examples/basic-android-kotlin/.my-dev-kit --file "app/src/main/kotlin/com/example/kitdemo/data/UserDao.kt" --start 1 --end 12 --format numbered
```

When a result ends with a `[CONTINUE: ...]` line, pass that line number to `--continue-from` to read the next window.

## 10. Compose and ViewModel relationships

`slice --composable UserHomeScreen --include-data-flow` returns, among other evidence, a `composable-references-viewmodel` edge to `UserViewModel`, a `compose-state-reads-viewmodel` edge for the `uiState.collectAsState()` read, and the `viewmodel-uses-repository` edge. It also lists the instrumented-test assertions that reference the composable.

The graph does **not** contain an edge from the click-handler fact to the `refreshUsers()` member or to a state mutation, and `uiState` is not indexed as a separate class-member node. Open the source (section 9) to confirm the handler-to-state path.

## 11. Room and Retrofit relationships

```sh
npx @dailephd/my-dev-kit slice --index examples/basic-android-kotlin/.my-dev-kit --node "symbol:app/src/main/kotlin/com/example/kitdemo/data/UserRepository.kt#UserRepository" --depth 1 --json
npx @dailephd/my-dev-kit slice --index examples/basic-android-kotlin/.my-dev-kit --node "symbol:app/src/main/kotlin/com/example/kitdemo/UserViewModel.kt#UserViewModel" --include-data-flow --depth 3 --json
```

The first slice returns the `repository-uses-dao` and `repository-uses-service` edges. The second, depth-3 data-flow slice also reaches `dao-uses-entity` and `room-database-exposes-dao`. The `--composable` and `MainActivity` slices in section 8 use the default depth and stay near the screen and manifest. The `@Database(entities = [...])` list is not turned into a database-to-entity edge.

## 12. Manifest, navigation, and resources

```sh
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --android-component MainActivity --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --permission android.permission.INTERNET --json
npx @dailephd/my-dev-kit source --index examples/basic-android-kotlin/.my-dev-kit --android-route settings --format numbered
npx @dailephd/my-dev-kit source --index examples/basic-android-kotlin/.my-dev-kit --resource string/user_screen_title --format numbered
```

The deep link in the manifest is static text. It does not prove a verified external endpoint or a runtime Compose destination; the Compose routes come separately from `AppNavigation.kt`. Resource retrieval shows the definition and its source evidence; it does not prove which string a device renders.

## 13. Unit and instrumented test retrieval

```sh
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --android-role android-unit-test --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --android-role instrumented-test --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --android-role compose-ui-test --json
```

The unit-test and instrumented-test roles return different files under `app/src/test` and `app/src/androidTest`. A `slice ... --include-tests` from the ViewModel or repository reaches only the instrumented Compose test; `UserViewModelTest` is found through the role search or `--query UserViewModelTest`, and it is linked to its two in-test fakes but not to `UserViewModel`. The test files are indexed, not executed; nothing here shows that they compile or pass. The `FakeUserDao` and `FakeUserApiService` doubles are implemented from interfaces, and their linkage to the real interfaces is not claimed.

## 14. Wrong-layer edit examples

Use classification before editing to avoid putting a change in the wrong layer.

- To change what happens when the refresh button is pressed, retrieve `UserViewModel` (`--android-role view-model`, edit guidance `safe-primary-edit-target`) rather than only editing the click lambda in `UserHomeScreen`.
- To change a visible label, edit `strings.xml` (see section 12) rather than inlining literals in the Composable.
- To change stored columns, start from `UserEntity` and then review `UserDao`, `UserRepository`, and the tests the slice returns.
- Test files carry `test-only` edit guidance. They are evidence, not production edit targets, and a high search score for a test is not edit authority.

```sh
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --android-role view-model --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --android-role generated-file --json
```

The first command returns `UserViewModel` (high-confidence `ViewModel` superclass evidence from its multiline declaration). Earlier builds also returned `UserUiState` and `MainActivity` because a file-level import was treated as role evidence; re-index with a current build if you still see them. The second command returns no results here because the example contains no generated or build output and none of it is indexed.

Natural-language `context` remains query-sensitive. The tested single-layer screen, ViewModel, Repository, and Retrofit requests select their corresponding production owner while keeping related layers as evidence. Requests spanning UI and ViewModel state or naming multiple plausible screens remain ambiguous; inspect focus, selected owners, adequacy, and conflicts before editing. See D2 in [WORKFLOWS.md](../../docs/WORKFLOWS.md#d2-context-owner-selection-is-unresolved) and verify the edit target from source.

## 15. Static-analysis limitations

- Analysis is static and conservative. Nothing is compiled, executed, or rendered.
- No claim is made about ViewModel lifecycle, dependency construction, state changes from clicks, or Compose rendering.
- Click-handler-to-state and resource-to-test relationships are partial; see sections 10 and 13.
- Kotlin members such as `uiState` are not separate indexed nodes.
- Interface test doubles for the DAO and Retrofit service are not fully linked to their interfaces.
- Gradle coordinates without versions (BOM-managed) produce analyzer warnings.
- Slices are depth-bounded, and explicit source reads stay inside the indexed project root.

## 16. What is not required

Gradle, the Android SDK, an emulator or device, a running app, a network backend, and instrumented test execution are not required for the retrieval workflow. The example also should not be built or run as part of it.

Generated `.my-dev-kit` directories are local output only and are not tracked.
