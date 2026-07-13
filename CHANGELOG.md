# Changelog

## Unreleased

**v1.10.0 Batch 1** adds a detailed static Gradle project model on top of v1.9.0's Android/module/source-set detection foundation. **Conservative static evidence only** — no Gradle execution, no dependency resolution, no network access. Not yet published.

- Added `android-gradle.json`, written when detailed Gradle evidence (settings, build-file plugins/dependencies/`android {}` configuration, or version catalogs) is found under `--root`; registered in `manifest.json`'s `analyzers` array (`{ id: 'android-gradle', status, artifacts }`) using the same pattern `android-project`/`android-components` already use. `android-project.json` is unchanged and remains the coarse project/module/source-set summary.
- Extends `src/android/parseGradleEvidence.ts` (not a new Gradle scanner) with: settings evidence (`rootProject.name`, `includeBuild(...)`, `project(...).projectDir` remaps), plugin evidence (`id(...)`, `id '...'`, `alias(libs.plugins.*)`, `apply plugin:`/`apply(plugin = ...)`), dependency evidence (external-module/project/version-catalog-alias/platform/file/unknown), `android {}` evidence (`namespace`, `compileSdk`, `applicationId`, `minSdk`, `targetSdk`, `versionCode`, `versionName`, `testInstrumentationRunner`, `buildFeatures`, `buildTypes`, `productFlavors`, `flavorDimensions`, source-set overrides), and a bounded `gradle/libs.versions.toml` parser (no new runtime dependency).
- Every SDK/config value is a resolved-literal-or-raw-unresolved-with-warning union: a dynamic Gradle expression is always preserved as raw source text with a warning, never guessed at.
- `index --incremental`'s config fingerprint now also covers an `androidGradleEvidenceFingerprint`, alongside v1.9.0's `androidEvidenceFingerprint`; any settings/build/version-catalog edit that changes detected Gradle evidence invalidates the cache and regenerates `android-gradle.json` in full. Stale-artifact cleanup and `--reset-cache` behavior are unchanged.
- Does not implement: `AndroidManifest.xml` parsing (now implemented in Batch 2, below), resource/navigation artifacts, Compose semantic retrieval, or any new retrieval selector/graph view.

**v1.10.0 Batch 2** adds a detailed static Android manifest model on top of v1.9.0's Android detection and Batch 1's Gradle project model. **Conservative static evidence only** — no manifest merging, no runtime intent/deep-link proof, no resource resolution. Not yet published.

- Added `android-manifest.json`, written when one or more `AndroidManifest.xml` files are discovered for a detected Android module (default source-set locations, plus statically-visible custom Gradle manifest paths); registered in `manifest.json`'s `analyzers` array (`{ id: 'android-manifest', status, artifacts }`) using the same pattern `android-gradle`/`android-project` already use.
- Added a bounded, non-executing XML parser (`src/android/xml/parseXml.ts`, hand-written rather than a new runtime dependency) backing `src/android/discoverAndroidManifests.ts` and `src/android/parseAndroidManifest.ts`, orchestrated by `src/android/buildAndroidManifestProject.ts`.
- **Manifest merging is never simulated**: every source-set manifest is parsed and preserved as its own independent record, including duplicate declarations across `main`/`debug`/flavor manifests.
- Extracts package/`uses-sdk`/permissions/`uses-feature`/application attributes/`activity`/`activity-alias`/`service`/`receiver`/`provider` components/`intent-filter`/`meta-data`, plus launcher and deep-link *candidates* derived only from direct static intent-filter evidence (never claimed as runtime-reachable).
- `exported` state is represented as `"true"`/`"false"`/`"unspecified"` only — never computed from Android-version/manifest-merging rules. Component names are resolved against the manifest's own `package` attribute first, falling back to the Gradle namespace only when no `package` attribute exists, and left unresolved with a warning when neither is available. Resource references (`@type/name`, `?attr/name`) are preserved but never resolved to a value.
- `index --incremental`'s config fingerprint now also covers an `androidManifestEvidenceFingerprint`; any manifest add/edit/delete, Gradle namespace change, or custom-manifest-path change invalidates the cache and regenerates `android-manifest.json` in full.
- Does not implement: resource XML parsing/resolution (now implemented in Batch 3, below), `android-navigation.json`, a broad declaration-to-source relationship graph, or any Android retrieval selector/graph view.

**v1.10.0 Batch 3** adds a detailed static Android resource model on top of v1.9.0's Android detection, Batch 1's Gradle project model, and Batch 2's manifest model. **Conservative static evidence only** — no resource merging/overlay simulation, no binary decoding, no resource resolution. Not yet published.

- Added `android-resources.json`, written when one or more `res/` resource files are discovered for a detected Android module (default source-set locations, plus statically-visible custom Gradle `res.srcDirs(...)` paths); registered in `manifest.json`'s `analyzers` array (`{ id: 'android-resources', status, artifacts }`) using the same pattern `android-manifest`/`android-gradle`/`android-project` already use.
- Added `src/android/discoverAndroidResourceDirectories.ts`, `src/android/parseResourceDirectoryName.ts` (conservative qualifier parsing — locale/night-mode/API-level/density/orientation/smallest-width/width/height, with unrecognized segments preserved), `src/android/parseAndroidValuesResource.ts`, and `src/android/parseAndroidResourceFile.ts` (layouts, generic file-based XML, FileProvider paths, network-security config), orchestrated by `src/android/buildAndroidResourceProject.ts`. Reuses Batch 2's bounded XML parser, additively extended with an element `text` field — zero regression to Batch 2 manifest parsing.
- **Resource merging, overlay precedence, and device-configuration matching are never simulated**: every qualified directory/file across every source set is indexed and preserved independently; duplicate logical resource names are never collapsed, no runtime winner is ever selected.
- Extracts value resources (`string`/`color`/`style`/`bool`/`integer`/`dimen`/`fraction`/`plurals`/arrays/`attr`/`declare-styleable`), file-based resources (layouts, drawables, mipmaps, generic XML, menus, anims/animators, color-state-lists, fonts, raw files — navigation graphs recorded only as generic file resources, with no navigation semantics), declared view IDs, and resource references classified with enumerated `candidateTargetIds[]` (never a single resolved winner).
- `index --incremental`'s config fingerprint now also covers an `androidResourcesEvidenceFingerprint`, additionally folding in a per-file content hash for binary resources (which contribute no parsed content to the artifact JSON) so binary edits still invalidate the cache.
- Does not implement: `android-navigation.json` (now implemented in Batch 4, below), manifest-to-resource or source-to-resource relationships, resource resolution/compilation, or any Android retrieval selector/graph view.

**v1.10.0 Batch 4** adds a detailed static Android navigation model on top of v1.9.0's Android detection, Batch 1's Gradle model, Batch 2's manifest model, and Batch 3's resource model. **Conservative static evidence only** — no runtime navigation reachability, no full Compose semantics, no dynamic-route invention. Not yet published.

- Added `android-navigation.json`, written when one or more `res/navigation/*.xml` graphs or narrowly-supported static Compose navigation routes are discovered; registered in `manifest.json`'s `analyzers` array (`{ id: 'android-navigation', status, artifacts }`) using the same pattern the other three Android analyzers use.
- Added `src/android/buildAndroidNavigationXmlModel.ts` (root/nested graphs, fragment/activity/dialog/custom destinations, actions with candidate destination/popUpTo enumeration, arguments, deep links, includes with multi-candidate resolution — reusing Batch 3's already-discovered navigation resource-file records, no independent directory rescan) and `src/android/buildComposeNavigationRoutes.ts` (bounded static extraction from `composable`/`navigation`/`dialog`/`activity`/`NavHost` calls: direct string literals, same-file `const val` resolution, and type-route arguments only — dynamic expressions always left unresolved with a warning, never invented), merged by `src/android/buildAndroidNavigationProject.ts`.
- **XML and Compose evidence are kept as two clearly separated evidence kinds, never auto-linked from name/string similarity.**
- Extended the shared XML parser with `findNamespacePrefixForUri` for navigation XML's `app`/`tools` namespaces — zero regression to Batch 2/3 parsing, verified by their existing suites.
- Every candidate lookup (start destination, action targets, include targets) enumerates all statically-matching definitions — never a single selected runtime winner. A direct screen candidate is recorded only for an unambiguous single top-level call in a route's content lambda.
- `index --incremental`'s config fingerprint now also covers an `androidNavigationXmlEvidenceFingerprint` for the XML portion; Compose-route changes are already covered by the standard Kotlin/Java changed-file mechanism.
- Does not implement: manifest-to-navigation deep-link relationships, navigation-to-resource or destination-to-source relationships, route-to-screen graph edges, full Compose semantic indexing, or any Android retrieval selector/graph view (manifest/navigation/resource/source relationship linking implemented in Batch 5, below; retrieval selectors/graph views remain planned for Batch 6).

**v1.10.0 Batch 5** connects the six Android artifacts from Batches 1-4 (plus v1.9.0's `android-project.json`/`android-components.json`) through compact, deterministic, conservative static graph relationships. **Integrated into the existing `code-graph.json` — no new artifact, no parallel graph, no new retrieval runtime.** Not yet published.

- Added `src/android/buildAndroidArtifactRelationships.ts`, called at the end of the same index-finishing pipeline stage `android-components.json`/Compose route extraction already use, and `src/graph/addAndroidRelationshipsToCodeGraph.ts`, which additively merges nodes/edges into `code-graph.json` by `id` — the same merge pattern `addFrontendRelationshipsToCodeGraph.ts` already uses for frontend routes. Registered in `manifest.json`'s `analyzers` array (`{ id: 'android-relationships', status, artifacts: [] }`, since no new top-level file is produced).
- Additively extended `CodeGraphNodeKind`/`CodeGraphEdgeKind` (backward compatible) with 13 Android node kinds and 17 Android edge kinds covering: modules/source sets, manifest files/components/intent-filters/permissions, resource files/definitions, navigation graphs/destinations/actions/deep-links, and Compose routes.
- Every relationship node reuses its owning artifact's existing stable ID; every source-side edge endpoint reuses the existing `symbol`- or `file`-kind node from structural indexing — Kotlin/Java class nodes are never duplicated.
- Implements `module-contains-source-set`, `manifest-declares-component`, `manifest-component-resolves-to-source` (exact fully-qualified class name only), `component-has-intent-filter`, `component-uses-permission`/`manifest-uses-permission` (no security verdict drawn), `resource-defined-in-file`, `source-references-resource` (bounded, comment/string-stripped `R.type.name` scan; `android.R.*` always skipped), `navigation-graph-contains-destination`, `navigation-destination-has-action`, `navigation-action-targets-destination`/`navigation-action-pop-up-to-destination`, `navigation-graph-includes-graph`, `navigation-destination-has-deep-link`, `manifest-deep-link-matches-navigation-deep-link` (exact scheme/host/port/path only — a `pathPrefix`/`pathPattern`/placeholder is always a non-match), `navigation-destination-resolves-to-screen`, `compose-route-resolves-to-screen`.
- Every one-to-many static match is enumerated as one edge per candidate, never narrowed to a single runtime winner (edge metadata cannot hold arrays).
- No dedicated incremental fingerprint: relationships are recomputed fresh whenever the finishing pipeline runs (already triggered by any upstream Android evidence fingerprint change or tracked Kotlin/Java source change). `graph-diff` required zero code changes — it already diffs `CodeGraph.nodes`/`.edges` purely by `id` equality.
- Does not implement: any new retrieval selector, graph view, or CLI flag for these relationships (Batch 6's scope); does not claim runtime reachability, effective permission enforcement, or deep-link resolution success.

**v1.10.0 Batch 6** exposes the Android evidence and Batch 5 relationships through the existing `search`, `lookup`, `source`, `slice`, `context`, and `view` commands. **No new top-level command, no second retrieval runtime, no second graph.** Not yet published.

- Added `src/android/androidRetrieval.ts`: one shared, bounded resolver (exact-match route/permission/resource/component resolution, plus search/lookup result builders) reused by every command below — never reparses source, never re-runs analyzers, never rebuilds Android artifacts.
- `search --android-route|--permission|--resource|--android-component`, `lookup --android-component`, `source --android-route|--resource`, and `slice --android-route|--android-component`: all resolve to existing Batch 5 `code-graph.json` node IDs. Matching is exact-first throughout (fully-qualified class names, permission names, resource names, route strings are never case-folded or fuzzy-matched); every one-to-many match preserves every candidate.
- `lookup --android-component` follows the existing lookup ambiguity contract (`found`/`not-found`/`ambiguous`, never a chosen winner). `source --android-route|--resource` returns a bounded excerpt from the resolved node's own `path`/`line`; binary resources are never decoded; multiple exact candidates (e.g. across qualifiers/source-sets) return `ambiguous` with every candidate ID. `slice --android-route|--android-component` resolves a unique root then calls the unmodified `sliceGraph` engine.
- `view --graph android-module|android-manifest|android-navigation`: three new graph names rendering `code-graph.json` itself (the same artifact `--graph code` renders), filtered to a Batch 5 node-kind seed set and expanded one hop across a fixed set of real relationship edges — never a fabricated visual-only edge, no second renderer.
- `context` gained no new command or flag: `android-*` code-graph nodes are now eligible for the same generic `search`-engine candidate pool `file`/`symbol` nodes already use (`src/search/searchIndex.ts`, `src/context/candidateRanking.ts`), and `resolveFileNodeTarget` (`src/lookup/resolveSourceTarget.ts`, shared by `source --node` and `context`) was additively extended to resolve bounded source for Android nodes carrying a `path`/`line` — not a separate Android ranking model or context builder.
- Added `tests/fixtures/android-retrieval/combined-app/` (duplicate simple class names, duplicate-qualifier resources, a bare name shared across resource types, a binary PNG resource, an exact manifest-to-navigation deep-link match) plus `tests/android/androidRetrieval.spec.ts` and `tests/cli/androidRetrievalCommands.spec.ts`, covering every new selector/view, ambiguity/no-match behavior, missing-Android-evidence and non-Android-project compatibility, and stale-retrieval-after-re-index (route rename, permission removal, full/incremental equivalence).
- Does not implement: full Compose semantic retrieval, Android UI-test indexing, Android architecture/data-flow classification, or an Android retrieval benchmark program (those remain v1.11.0-v1.13.0 scope); no new Android artifact, no `android-relationships.json`, no new relationship family.
- **v1.10.0 Batch 7 correction:** `search`/`source`/`slice --android-route` now also matches a direct type-safe Compose route (`composable<RouteType>(...)`) by its type name. `android-navigation.json` always recorded `typeRouteName` (Batch 4), but Batch 5's compact `android-compose-route` `androidMetadata` never projected it, so a type-safe route existed in `code-graph.json` but could never be found by any Batch 6 selector. Fixed by adding `typeRouteName` to the existing `androidMetadata` shape and a matching resolver branch — no new relationship family, no new artifact field beyond the already-agreed compact-metadata contract.

**v1.10.0 Batch 7** validates Batches 1-6 as one coherent Android capability end to end against one canonical combined fixture. **Integration and regression gate only — no new product scope.** Not yet published.

- Extended the Batch 6 canonical fixture (`tests/fixtures/android-retrieval/combined-app/`) rather than creating a second one: added a library module, Groovy-alongside-Kotlin-DSL evidence, product flavors/version-catalog/dynamic-dependency evidence, an activity-alias with resolved `targetActivity`, `uses-permission-sdk-23`/`uses-feature`/metadata, an exact and a host-mismatched deep link, a component with no matching source class, additional resource/navigation/Compose evidence (including the direct type-safe route above), and a fixture-integrity test suite.
- Added `tests/integration/` (five suites, 181 tests) validating full artifact generation, cross-artifact ID continuity, the complete Batch 5 relationship-family matrix, graph compactness/integrity, the complete Batch 6 retrieval/lookup/source/slice/view/context matrix, a combined incremental/stale-evidence/determinism gate, and a graph-diff plus missing/malformed-index gate.
- Closed the two fixture-level gaps Batch 6 explicitly deferred: dedicated activity-alias public-retrieval tests and dedicated resource-deletion/component-rename stale-retrieval tests, each verified against both incremental re-indexing and a clean full re-index for equivalence.
- Full test suite: 1645/1645 passing; `npm run verify` and `npm run benchmark:retrieval` both pass with no regression from Batch 6's context candidate-eligibility change.
- Does not implement: any new Android artifact, selector, graph view, or relationship family; Batch 8 documentation reconciliation and implementation-completeness audit remain.

## 1.9.0 - 2026-07-06

Android project detection foundation (v1.9.0 Batch 1): static Android/Gradle project, module, and source-set detection during `index`. **Detection only** — Kotlin/Java structural symbol indexing is explicitly deferred to a later `v1.9.0` batch.

- `index` now performs static Android project detection against `--root` on every run (no new flag): `settings.gradle(.kts)` `include(...)` parsing (conservative, regex-based — not a real Groovy/Kotlin-DSL parser), root/module `build.gradle(.kts)` Android plugin-id substring evidence (`com.android.application`/`com.android.library`), `AndroidManifest.xml` path existence, and `main`/`test`/`androidTest` source-set + Kotlin/Java source-root existence
- Added `android-project.json`: written only when Android evidence is found (own `artifactKind`, own schema version, own ID space), registered in `manifest.json`'s `analyzers` array (`{ id: 'android-project', status, artifacts }`) using the same pattern `classification` already uses — a non-Android project is completely unaffected (`status: 'skipped'`, no file written, all existing artifacts unchanged)
- Added `.gradle` to the default-ignore directory list; `build` (already default-ignored since v1.8.0 Batch 1) already covers all nested Android build-output paths with zero new ignore-pattern code
- `index --incremental`'s config fingerprint now covers detected Android structure (`androidEvidenceFingerprint`, derived from the built artifact itself rather than raw file hashing), so a Gradle/manifest edit that changes detected structure correctly invalidates the cache even though those files live outside `--src`; an edit that doesn't change any detected fact correctly does not
- `graph-diff` required zero code changes and remains fully compatible: it never enumerates the index directory, so `android-project.json` is inert to it, and the existing generic `manifest.analyzerChanges` diff already reports Android analyzer-status changes — proven by a dedicated compatibility test suite
- Does not implement: Kotlin/Java structural symbol indexing, Kotlin/Java file/symbol nodes in `code-graph.json`/`symbol-index.json`, Android component-role detection, Room/Retrofit/Hilt/Dagger detection, a detailed Gradle project model or dependency graph, a detailed `AndroidManifest.xml` artifact, Android resources/navigation artifacts, Compose semantic retrieval, or any Android build/emulator/APK/AAB/security/release validation
- Preserved all v1.8.0 behavior: preflight warnings, `--dry-run`, `--progress`, `--incremental`/`--reset-cache`/partial rebuild, and `graph-diff`

**v1.9.0 Batch 2** adds Kotlin structural indexing on top of Batch 1's Android/source-root detection foundation. **Conservative static structural indexing only** — no Kotlin compiler execution, no Gradle execution, no full semantic resolution, no Java indexing yet.

- `.kt` files under a requested `--src` root are now discovered and indexed exactly like `.ts`/`.js`/`.py` files, through a new `KotlinAdapter` registered in the existing `LanguageRegistry` — no new indexing pipeline, no new command, no new flag
- A conservative, deterministic, line/regex-based extractor (not the Kotlin compiler) extracts package declarations, imports (including wildcards), top-level `class`/`data class`/`sealed class`/`interface`/`object`/`enum class` declarations, top-level functions (including extension functions), and top-level `val`/`var` properties
- **Top-level declarations only**, matching the existing TypeScript/Python precedent exactly — no new member-symbol model was invented for Kotlin
- Modifiers, `suspend`, extension receivers, annotations, and `Flow`/`StateFlow` usage are surfaced via the existing `signature` text field, not new dedicated fields — the same choice the Python adapter already made for decorators
- Added one new `SymbolKind` value, `object` (Kotlin `object`/`companion object`); added `kotlin` to `SourceLanguage`
- Import resolution is a best-effort heuristic (single-top-level-declaration-per-file convention); wildcard imports and multi-declaration files honestly resolve to no target rather than guessing
- Call-graph extraction is not implemented for Kotlin (`supportsCallGraph: false`) — documented limitation, not a silent gap; `--call-graph` continues to work normally for TS/JS/Python files in the same run
- `search`, `lookup`, `slice`, and `source` all work on Kotlin file/symbol nodes with zero new flags, verified by dedicated tests
- Incremental indexing and `graph-diff` remain fully compatible with zero Kotlin-specific special-casing — Kotlin files participate in the existing changed-file/partial-rebuild machinery and appear as ordinary graph nodes
- Preserves the `--src` source-root boundary: Batch 1's detected Android Kotlin source roots are informational only and never expand or override `--src`
- Does not implement: Java structural indexing, Android component-role detection, Compose semantic retrieval, member function/property symbols, or call-graph edges for Kotlin

**v1.9.0 Batch 3** adds Java structural indexing on top of Batch 1's Android detection and Batch 2's Kotlin indexing. **Conservative static structural indexing only** — no `javac` execution, no Maven execution, no Gradle execution, no full semantic resolution.

- `.java` files under a requested `--src` root are now discovered and indexed exactly like `.ts`/`.js`/`.py`/`.kt` files, through a new `JavaAdapter` registered in the existing `LanguageRegistry` — no new indexing pipeline, no new command, no new flag
- A conservative, deterministic, line/regex-based extractor (not `javac`) mirrors the Kotlin adapter's design: package declaration, imports (including `static` and wildcard forms), top-level `class`/`interface`/`enum`/`record`/`@interface` (annotation type) declarations
- **Top-level declarations only**, matching the Kotlin/TypeScript/Python precedent exactly — no method/field/constructor symbols were added, and no member-symbol schema change was needed
- Modifiers (`abstract`/`final`/`static`/`sealed`/`non-sealed`), `extends`/`implements` targets, and annotations are surfaced via the existing `signature` text field, not new dedicated fields
- **Zero new `SymbolKind` values needed** — `record` maps to `class`, `@interface` annotation types map to `interface`; added `java` to `SourceLanguage`
- Import resolution uses the same best-effort single-declaration-per-file heuristic as Kotlin (`<packageDir>/<Name>.java`); wildcard and static-wildcard imports correctly resolve to no target
- Call-graph extraction is not implemented for Java (`supportsCallGraph: false`), matching the Kotlin decision
- `search`, `lookup`, `slice`, and `source` all work on Java file/symbol nodes with zero new flags, verified by dedicated tests
- Incremental indexing and `graph-diff` remain fully compatible with zero Java-specific special-casing
- Preserves the `--src` source-root boundary: Batch 1's detected Android Java source roots are informational only and never expand or override `--src`
- Does not implement: Java method/field/constructor symbols, call-graph edges for Java, semantic type resolution, cross-file `extends`/`implements` resolution, Maven/Gradle model parsing, Android component-role detection

**v1.9.0 Batch 4** adds conservative static Android component-role detection on top of Batch 1's Android detection and Batch 2/3's Kotlin/Java structural indexing. **Static evidence only** — no Gradle/compiler/runtime execution, no manifest-declaration guarantee, no dependency-injection or navigation correctness guarantee.

- Detects 14 roles — `activity`, `fragment`, `view-model`, `service`, `broadcast-receiver`, `content-provider`, `worker`, `repository`, `use-case`, `room-entity`, `room-dao`, `room-database`, `retrofit-service`, `hilt-module` — for already-indexed Kotlin/Java top-level `class`/`interface`/`object` symbols in an already-detected Android project; runs automatically on every `index`, no new flag, no new command, no second indexing pipeline
- Evidence priority: explicit annotation (`@Entity`, `@Dao`, `@Module`, ...) > explicit superclass/interface name (`extends AppCompatActivity`, Kotlin `: ViewModel()`) > import > package/path hint > naming suffix (weakest — never alone sufficient for `high` confidence, always produces a warning); `repository`/`use-case` have no annotation/superclass evidence tier at all and never exceed `medium`
- Only Retrofit-service detection reads past the symbol's own declaration line (HTTP method annotations live on methods, not the interface declaration) — a small, bounded, brace-depth-scanned re-read of the already-indexed file (capped at 400 lines) covers that one case; every other role uses only data already in `symbolIndex`
- Added `android-components.json`: written only when at least one role is detected, registered in `manifest.json`'s `analyzers` array (`{ id: 'android-components', status, artifacts }`) using the exact same pattern `android-project`/`classification` already use
- Added compact `androidComponentRoles`/`androidComponentRefs` fields to `SymbolDefinition`, `GraphSymbolRecord`, and `CodeGraphNode` — the same compact-projection-plus-artifact-ref pattern `classificationRoles`/`classificationRefs` already established; purely additive, no existing field changed
- `search` gained one new indexed field (role label); `lookup` and `source` mirror the existing `classificationRoles`/`classificationRefs` pass-through wiring exactly; `slice` needed no code changes at all (it already returns whole node objects)
- Incremental indexing and `graph-diff` remain fully compatible with zero Android-component-specific special-casing
- Preserves the `--src` source-root boundary: detection only reads files already present in the indexed `symbolIndex`, never additional Kotlin/Java source roots Batch 1 may have recorded
- Does not implement: method/field/constructor-level role evidence, a detailed `AndroidManifest.xml`-based component registry, Compose semantic retrieval, or any build/emulator/runtime/security validation

**v1.9.0 Batch 5** hardens and verifies end-to-end retrieval and command compatibility for the Android/Kotlin/Java work added in Batches 1 through 4. **Integration hardening only** — no new commands, no new flags, no schema redesign.

- Added `tests/fixtures/android/mixed-kotlin-java-app`: a single Android module with role-bearing and plain Kotlin and Java sources side by side, closing the one real gap in Batch 1–4 coverage (each prior batch's tests exercised Kotlin and Java fixtures separately, never together in one index)
- Added focused integration tests proving `index`, `search`, `lookup`, `source`, `slice`, `context`, `graph-diff`, and `--incremental` all behave correctly when Android project facts, Kotlin symbols, Java symbols, and Android component roles coexist in the same index — including that role metadata attaches only to role-bearing symbols and never leaks onto plain Kotlin/Java symbols
- Added a `context` compatibility test proving the context capsule can surface Android/Kotlin/Java candidates (a Kotlin `ViewModel`, a Java `Worker`) for task-like queries while remaining bounded and free of raw artifact/graph dumps
- Added combined incremental and `graph-diff` compatibility tests covering simultaneous Kotlin+Java role changes, additions, and removals, plus Batch 1's `androidEvidenceFingerprint` cache-invalidation behavior
- No source code changes were required: `context` and `graph-diff` were already fully generic (Batches 1–4 never added Android-specific special-casing to either), and `search`/`lookup`/`source`/`slice` already carried Android role metadata correctly per Batch 4 — this batch is tests-and-fixture-only
- Preserved all Batch 1–4 behavior: Android project/module/source-set detection, Kotlin/Java structural indexing, Android component-role detection, and their existing test suites
- Does not implement: new commands, new flags, a detailed Gradle model, a detailed `AndroidManifest.xml` artifact, Android resources/navigation artifacts, Compose semantic retrieval, method/field/constructor symbols, or any Android build/emulator/runtime/security validation

## 1.8.0 - 2026-07-06

Final v1.8.0 release line: safer large-repo indexing ergonomics, incremental indexing with partial rebuild for the core artifact pipeline, and deterministic read-only graph comparison. Deferred from the implemented v1.8.0 release work: watch mode, retrieval filtering, a dedicated `call-graph.json` diff section, and non-fallback partial call-graph rebuild.

- `index` and `index --dry-run` now skip `.my-dev-kit` and any `.my-dev-kit-*` directory by default, so indexing no longer re-scans its own or another `my-dev-kit` output directory
- Added a deterministic large-repo preflight step: both `index` and `index --dry-run` report a `preflightWarnings` array (`{ code, message }`) in JSON output and a `Preflight warnings:` section in human output, in a fixed order
  - `large-file-count`: eligible file count exceeds a static threshold of 5000
  - `broad-source-root`: a `--src` value resolves to the project root and discovered file count exceeds 1000
  - warnings are advisory only: they never fail the command and never claim safety beyond static file-count evidence
- Added an "Indexing large monorepos" section to `docs/COMMANDS.md` covering per-package `--src`/`--out` scoping and using `--dry-run` before indexing an unfamiliar large repository
- No changes to `manifest.json` schema, artifact file names, or existing `--dry-run`/`--progress`/default-ignore behavior for small projects

**v1.8.0 Batch 2** adds the incremental-indexing foundation: cache metadata and changed-file detection. **`--incremental` does not perform a partial artifact rebuild yet** — any detected change, or any incompatible/missing/stale cache, still triggers a full rebuild through the existing pipeline; only a genuine no-op run skips rebuilding.

- Added `index --incremental`: compares the current file set against an internal `cache-metadata.json` (SHA-256 content hash per file, plus a config fingerprint over source roots/`--exclude`/`--call-graph`/`--language`/default-ignore rules) and reports a deterministic `cache` object (`{ requested, mode, cacheMetadataPath, invalidationReason, changedFileSummary }`) in JSON output and a `Cache mode:`/`Changed files:` section in human output
  - modes: `incremental-full-initial`, `incremental-full-cache-incompatible`, `incremental-full-config-changed`, `incremental-no-change`, `incremental-change-detected-full-rebuild`
  - `changedFileSummary` reports added/changed/removed/unchanged counts plus bounded (20-entry), alphabetically sorted samples
- Added `index --reset-cache`: deletes only `cache-metadata.json` from `--out` (never `manifest.json` or other artifacts), reports `{ requested, existed, path }` in both JSON and human output, and succeeds when no cache exists; combined with `--incremental`, resets first and then performs a safe `incremental-full-initial` run
- `manifest.json` now records `indexMode` (`"full"`/`"incremental"`) on every build, and `cacheMode`/`cacheInvalidationReason`/`changedFileSummary` on builds that actually ran
- `cache-metadata.json` is internal indexer bookkeeping only — not registered in `manifest.json`'s `artifacts` map and not part of the documented public artifact set
- Preserved all Batch 1 behavior: `preflightWarnings`, `--dry-run` (writes no artifacts, never touches the cache), `--progress` (stdout stays parseable JSON), and `.my-dev-kit`/`.my-dev-kit-*` self-ignore (cache metadata is never indexed as source)
- Does not implement: partial artifact rebuild, deterministic artifact merge across changed/unchanged analyses, stable artifact IDs across partial rebuilds, graph-diff, or watch mode

**v1.8.0 Batch 3** adds real partial-rebuild correctness for the core artifact pipeline (`symbol-index.json`/`code-graph.json`), on top of Batch 2's cache metadata and changed-file detection.

- `index --incremental` now reuses unchanged files' per-file analysis instead of re-parsing them, re-analyzes changed/added files exactly like a full build, and removes deleted files from every affected artifact
  - two new modes: `incremental-partial` (partial rebuild used, no artifact fallback needed) and `incremental-partial-with-artifact-fallback` (partial rebuild used, but at least one artifact family — currently only ever `call-graph` — was fully regenerated instead of reused; reported in `partialRebuildFallbackArtifacts`)
  - `incremental-change-detected-full-rebuild` is now reserved for the honest fallback case where partial-rebuild reuse is not safely possible (missing/unreadable/schema-incompatible previous `symbol-index.json`) — not the default path for a healthy cache anymore
- `graph.fileDeps`/`graph.symbols` are still recomputed globally from the full merged file set on every partial rebuild (import/re-export/export-all resolution depends on the complete current file set); file and symbol node IDs stay stable for unchanged files since they are derived purely from path/name
- `--call-graph` is always fully regenerated during a partial rebuild (its extraction re-parses source text directly) — never silently treated as reused
- `data-model.json`/`frontend-semantic.json`/`frontend-reachability.json`/`classification.json` needed no changes: they already run over the complete current index on every build and are automatically kept correct by a correctly merged core index
- `cache-metadata.json` per-file entries now also carry `reExportSpecifiers`/`exportAllSpecifiers` (needed to safely reuse an unchanged file's analysis); `CACHE_SCHEMA_VERSION` was bumped so a pre-Batch-3 cache is rebuilt once rather than misread
- `manifest.json` gained `partialRebuildFallbackArtifacts`
- Added equivalence tests (`tests/index/partialRebuild.spec.ts`) proving partial incremental output is logically equivalent to a clean full `index` run across changed/added/removed-file and re-export/export-all cross-file-dependency fixtures, plus stable-ID and call-graph-fallback coverage
- Preserved all Batch 1 and Batch 2 behavior: preflight warnings, `--dry-run`, `--progress`, `.my-dev-kit`/`.my-dev-kit-*` self-ignore, `--reset-cache`, and `incremental-no-change`/`incremental-full-*` modes
- Does not implement: partial (non-fallback) call-graph rebuild, graph-diff, or watch mode

**v1.8.0 Batch 4** adds the `graph-diff` command: a deterministic, read-only comparison of two existing index directories, built on Batch 3's stable node/edge IDs.

- Added `graph-diff --before <index-dir> --after <index-dir> --json`: compares `manifest.json`/`code-graph.json` (required) and `symbol-index.json`/`classification.json`/`data-model.json`/`frontend-semantic.json`/`frontend-reachability.json` (optional, degrading to a warning + "unavailable" section when absent from either side)
- Node/edge diffing reuses the existing stable `node.id`/`edge.id` identity — no new comparison scheme. Reports `added`/`removed` (compact refs, sorted) and `changed` (only the differing fields, with compact `before`/`after` limited to those fields)
- `symbol-index.json`: compact added/removed/changed file-path and symbol-id companion diff
- `manifest.json`: fixed-field diff (`indexMode`, `cacheMode`, `changedFileSummary`, `partialRebuildFallbackArtifacts`, analyzer status changes, etc. — excludes `createdAt`)
- `classification.json`: per-entry diff by its own stable id (added/removed/changed edit guidance, risk labels, classifications, readiness, uncertainty)
- `data-model.json`/`frontend-semantic.json`/`frontend-reachability.json`: safe summary-count-only diff (not a fragile deep per-entry diff — these artifacts have no single stable per-entry identity)
- Never runs `index`; never writes to or modifies either `--before`/`--after` directory
- Exit `0` for any valid comparison (with or without differences); non-zero with a clear error for invalid arguments, a missing index directory, or a malformed required artifact; a missing *optional* artifact never causes a non-zero exit
- Added `tests/graph-diff/graphDiff.spec.ts` (17 tests): no-difference, added/removed/changed node and edge fixtures, optional-artifact presence handling, error paths, determinism, and read-only-input-directory verification
- Does not implement: watch mode, search/lookup/slice/source filtering, or a dedicated `call-graph.json` diff section

**v1.8.0 Batch 5** performs the final integration and compatibility gate for the shipped v1.8.0 work.

- Reconciled `README.md`, `docs/GRAPH_SCHEMA.md`, `docs/PROJECT_OVERVIEW.md`, `docs/ROADMAP.md`, and help/test coverage so the documented v1.8.0 behavior matches the implemented Batch 1 through 4 surfaces
- Re-verified package contents with `npm pack --dry-run`; generated `.my-dev-kit*` folders, workflow reports, and other private/generated artifacts remain excluded from the published package
- No new CLI commands, flags, persisted artifact schemas, Android support, release audit, security validation, or publishing behavior

## 1.7.0 - 2026-07-05

Added an internal retrieval regression suite for my-dev-kit's own bounded-context retrieval behavior. No new public CLI commands, flags, or artifact schemas.

- Added `src/retrievalRegression/runRetrievalRegression.ts` and the `benchmark:retrieval` npm script, driven by a versioned regression config (`benchmarks/retrieval/v1.7/core.json`)
- Added deterministic regression scenarios exercising `search`, `lookup`, `slice`, and `source` against known fixture indexes, with pass/fail assertions on expected candidates and bounded output shape
- Added `--fail-on-regression` support so the retrieval regression suite can gate local validation runs
- This is a development/validation tool for my-dev-kit itself, not a new user-facing retrieval capability; the public command surface (`index`, `search`, `lookup`, `source`, `slice`, `view`, `data-model`) is unchanged from v1.6.0

## 1.6.1 - 2026-07-04

Repository-hygiene patch release: no source, CLI, or artifact-contract changes.

- Reorganized and consolidated `.gitignore` (sectioned comments, consolidated `.my-dev-kit*` ignore patterns, generalized `*.txt` ignore rule, removed stale entries)
- No changes to `package.json` `files` allowlist, published package contents, or CLI behavior

## 1.6.0 - 2026-07-04

Added deterministic context-capsule generation and retrieval audit artifacts for downstream planning workflows.

- Added the `context` CLI command for bounded, local, deterministic query-to-context retrieval against an existing index
- Added `context-capsule.json` output with deterministic query planning, candidate ranking, single-seed focus selection, bounded graph evidence, bounded source evidence, semantic/classification/artifact-reference summaries, retention/pruning, required/optional/dropped context, context adequacy, conservative static conflict detection, mode effects, and source-control metadata
- Added optional `retrieval-audit-record.json` output with an ordered 32-step audit trail, fallbacks, warnings, and full-file recommendation reporting
- Added deterministic mode-specific ranking adjustments for `feature-add` and `subsystem`; `general` remains the balanced baseline
- Added conservative static conflict detection for incompatible edit-guidance cases backed by existing static evidence
- Added `--no-source` to disable source slices and source bundles while retaining graph and metadata evidence
- Added compatibility coverage for older indexes without `classification.json` and indexes missing optional semantic artifacts
- Added deterministic output, no-raw-dump, audit-completeness, conflict, mode, and source-control tests for the context pipeline
- Added public command and example documentation for context capsules, retrieval audits, bounded source defaults, and `--no-source`

## 1.5.0 - 2026-07-02

Added conservative static schema/layer classification of files and symbols, surfaced through the existing `search`, `lookup`, `slice`, and `source` commands.

- Added `classification.json`, a static classification artifact (schemaVersion `1.0.0`) recording category assignment(s), edit guidance, readiness, additive risk labels, evidence, and an uncertainty tier per file/symbol
- Added the `classification` analyzer, registered in `manifest.json`'s `analyzers` array; runs after the data-model, frontend, and frontend-reachability analyzers so their output is available as evidence
- Classification categories: `canonical-type`, `artifact-type`, `database-model`, `projection-type`, `view-model`, `ui-only-state`, `test-fixture`, `persistence-adapter`, `route-handler`, `client-component`, `server-component`, `generated-file`, `configuration-file`, `command-handler`, `analyzer`, `validator`, `public-docs`, `internal-planning-docs`
- Added edit-guidance values (`safe-primary-edit-target`, `inspect-before-edit`, `avoid-primary-edit-target`, `read-only-reference`, `generated-do-not-edit`, `test-only`, `docs-only`, `uncertain`), readiness states (`ready`, `needs-more-context`, `risky-assumption`), additive risk labels, and uncertainty tiers (`certain`, `likely`, `possible`, `unknown`)
- Added `classificationRoles` and `classificationRefs` compact fields on `CodeGraphNode`/`GraphSymbolRecord`/`SymbolDefinition` — new fields, separate from `semanticRoles`/`artifactRefs`
- `search`: classification role and edit-guidance are now searchable fields; results include compact `classificationRoles`/`classificationRefs`
- `lookup`: focus node includes `classificationRoles`/`classificationRefs`; added `--resolve-classification` to resolve the full `classification.json` entry on request
- `slice`: preserves `classificationRoles`/`classificationRefs` on every node
- `source`: propagates `classificationRoles`/`classificationRefs` for `--node`/`--symbol` targets, plus a compact `classificationSummary` (risk labels, edit guidance, warnings)
- Classification is static and conservative only: no runtime execution, no browser, no database connection, no LLM or network calls; low-confidence classifications are marked `possible`/`unknown` with an explanatory warning rather than rounded up
- An index without `classification.json` (an older index, or an analyzer that has not run) is fully compatible — existing command output is unaffected

## 1.4.0 - 2026-06-25

Added source continuation and bounded local dependency expansion.

- Added `source --file <path> --continue-from <n>` — reads from an explicit line number with a `ContinuationCursor` in JSON output pointing to the next window
- Added `source --file <path> --symbol <name> --continue` — continues from the end of the symbol's initial 20-line preview window
- Added `source --node <id> --continue` — continues from the end of the node's initial preview window
- Added `source --file <path> --symbol <name> --continue-from <n>` — reads from explicit line with optional symbol metadata attached
- Added `ContinuationCursor` to every `SourceSlice` JSON response: `nextStartLine`, `previousEndLine`, `eof`/`exhausted`, `reason`, `symbolBoundaryKnown`
- Added `[CONTINUE: <file> from line N]` and `[EOF: <file> (N lines total)]` footers to numbered output
- Added `source --include-local-types` — includes same-file interface/type/enum definitions referenced in the primary window
- Added `source --include-props` — includes same-file prop type definitions (uses `frontend-semantic.json` when available for exact end lines)
- Added `source --include-local-components` — includes same-file local React child components rendered by the primary symbol
- Added `source --include-local-deps` — composite flag: includes same-file prop types, local types, constants above the primary symbol, and directly called helper functions
- Added `source --expand-to-local-dependencies` — alias for `--include-local-deps`
- Added `source --include-imports` — includes local import-site lines; external packages and dynamic imports go to `skippedBlocks` with reason codes
- Added `source --max-bundle-lines <n>` — caps total bundle line count (default 300); exceeded candidates become `skippedBlocks`
- Added `source --max-blocks <n>` — caps total block count (default 20); exceeded candidates become `skippedBlocks`
- Added `SourceBundle` output type with `primaryBlock`, `expansionBlocks`, `skippedBlocks`, `limits`, `stats`, `continuationCursors`, `warnings`
- Each `SourceExpansionBlock` has `expansionReasons`, `confidence`, `dedupeKey`, `targetRelationship`, `fallbackReason` (when end line estimated from heuristic)
- Overlapping same-file blocks are merged deterministically; both expansion reasons are preserved
- Numbered bundle output: block headers `=== [<kind>] <file>:<start>-<end> (<N> lines) — <reasons> ===`, skipped section, warnings section, continuation footer
- Expansion is static-analysis only: direct, same-file dependencies; no cross-file closure, no runtime tracing, no browser execution
- Notes: symbol end lines are still not stored in the symbol index; `--include-*` and `--continue` flags use the frontend-semantic artifact or a next-symbol heuristic to estimate end lines when available; confidence is reported per block

## 1.3.0 - 2026-06-25

Added route-aware, browser-storage-aware, and UI-reachability retrieval backed by a new static frontend reachability artifact.

- Added `frontend-reachability.json`, a static semantic artifact that records route, browser-storage, UI-marker, and reachability evidence
- Added route-aware retrieval for static route, page, navigation, and test evidence through `search`, `lookup`, `slice`, and `source`
- Added browser-storage tracing for supported `sessionStorage` and `localStorage` read, write, remove, and clear patterns
- Added static UI reachability evidence connecting routes, components, UI markers, storage keys, gates, and tests where detectable
- Added `--route`, `--storage-key`, and `--ui` selectors to `search`, `lookup`, `slice`, and `source`
- Added `view --graph route`, `view --graph browser-storage`, and `view --graph ui-reachability`
- Updated React/TSX examples and command documentation to demonstrate v1.3.0 route, storage, and UI reachability workflows
- Notes: v1.3.0 is conservative static analysis only; it does not execute applications, run browsers, prove runtime UI visibility, or prove user reachability

## 1.2.0 - 2026-06-18

Added React/TSX and frontend-test indexing, exact source string retrieval and repeated literal reporting, React region retrieval, local component-tree prop/event-flow retrieval, and four new frontend semantic graph views.

- Added frontend analyzer running as part of `index`: produces `frontend-semantic.json` for `.tsx` and `.jsx` files
- Added `frontend-semantic.json` containing exported and local React components, prop types, hooks, handlers, JSX regions, test blocks, locators, and UI strings
- Added `source --contains` for exact string retrieval across all indexed files with context lines, match classification, and repeated literal reporting
- Added `source --path` for path-prefix filtering of `--contains` results
- Added `source --react-region` for retrieving a named React region (component, hook, handler, JSX region, prop type) by name from the frontend semantic artifact
- Added `source --include-local-component-tree` for retrieving a component and its local child components as a connected source bundle with prop, callback, state, handler, and branch blocks
- Added `source --prop` for filtering local-component-tree output to a specific prop name
- Added `view --graph react-component` for rendering exported and local components with structural relationships
- Added `view --graph react-flow` for rendering all frontend flow facts: hooks, handlers, JSX regions, and flow relationships
- Added `view --graph react-prop-event-flow` for rendering only prop and event flow relationships
- Added `view --graph frontend-test` for rendering test structure from frontend test facts in `frontend-semantic.json`
- Added `search` enrichment from frontend semantic values: `data-testid` and `aria-label` values are indexed and ranked alongside symbol matches
- Added `basic-react-tsx` bundled example with `WorkspaceEditorShell` TSX component and pre-built `.my-dev-kit-index` artifacts
- Known limitation: the base indexer excludes `.test.` and `.spec.` files from default file discovery; `view --graph frontend-test` produces output only when test files reach the frontend analyzer through a custom indexing path

## 1.1.0 - 2026-05-01

Added index-first semantic integration, manifest as authoritative artifact registry, semantic role metadata on index artifacts, data-model artifacts linked from the index, and semantic-aware search, lookup, slice, and source commands.

- Added managed artifact refresh: `index` removes stale artifacts from previous runs when refreshing the artifact directory
- Added `manifest.json` as the authoritative artifact registry for the current run, including `semanticArtifacts` paths and an `analyzers` array with status per analyzer
- Added `semanticRoles` and `artifactRefs` arrays on symbols in `symbol-index.json` and on symbol nodes in `code-graph.json`, populated by the TypeScript model analyzer
- Added the TypeScript model analyzer running as part of `index`: produces `data-entity` and `data-field` roles for qualifying exported interfaces, type aliases, and classes
- Added `data-model.json` and `data-model-graph.json` written by `index` when the TypeScript model analyzer produces output
- Added semantic schema `1.0.0` with defined role names, confidence levels, source identifiers, artifact refs, and evidence refs
- Added semantic-aware search: `search` indexes `semanticRole`, `semanticSubtype`, `semanticSource`, and `semanticArtifactRef` fields; result items include `semanticRoles` and `artifactRefs` when present
- Added semantic metadata to `lookup` output: `semanticRoles`, `artifactRefs`, and `evidenceRefs` returned from the focus node when present
- Added semantic metadata preservation in `slice` output: nodes carry `semanticRoles` and `artifactRefs` from `code-graph.json`
- Added semantic metadata propagation in `source` output: `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the symbol target included in JSON output
- Added the `data-model` command for focused inspection and regeneration of data-model artifacts, exact entity lookup, exact field lookup, and conservative static `trace-view`
- Added `model-view-lineage.json` for conservative static lineage evidence in `trace-view` mode
- Added `view --graph <code|data-model|model-view-lineage>` for rendering code, data-model, and model-to-view lineage graph artifacts through the existing DOT/SVG/PNG Graphviz pipeline
- Added conservative TypeScript model extraction for exported interfaces, exported object-literal type aliases, and exported classes with property declarations
- Added exact entity lookup by name or stable ID and exact field lookup by `Entity.field`
- Added warnings for unsupported or ambiguous extraction and lineage patterns instead of guessed relationships
- Added end-to-end and subsystem coverage for semantic metadata contracts, managed artifacts, manifest authority, and semantic-aware command behavior

## 1.0.0 - 2026-05-29

Initial release.

- Six CLI commands: `index`, `lookup`, `source`, `slice`, `view`, `search`
- TypeScript, JavaScript, and Python indexing with symbol extraction, code graph, and optional static call graph
- Python indexing covers functions, classes, constants, imports, and conservative syntactic call edges
- Graph-guided symbol retrieval workflow: `search` -> `lookup` -> `slice` -> `source`
- Source output formats: `json`, `plain`, `numbered`; file output with `--out`
- Semantic graph visualization with three edge styles: `semantic` (default), `labeled`, `minimal`; DOT, SVG, and PNG output
- Deterministic local keyword search over indexed artifacts with field-weighted ranking
- Security hardening: artifact path containment, source retrieval path containment, DOT escaping, Graphviz subprocess isolation
- CI validation baseline via GitHub Actions
- MIT license, copyright 2026 dailephd LLC
