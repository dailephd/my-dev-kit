# Commands

`@dailephd/my-dev-kit@1.11.0` is the latest published release and includes the v1.11.0 command contracts documented here.

my-dev-kit provides nine public CLI commands:

- `index`
- `search`
- `lookup`
- `source`
- `slice`
- `view`
- `data-model`
- `context`
- `graph-diff`

Use this document as the command reference for the installed CLI.

For artifact details, see [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md).
For internal design, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Installation

Use without installing globally:

```sh
npx @dailephd/my-dev-kit --help
npx @dailephd/my-dev-kit --version
```

Or install globally:

```sh
npm install -g @dailephd/my-dev-kit
```

## Path conventions

Most workflows follow this pattern:

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "service" --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "file:src/index.ts" --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "file:src/index.ts" --depth 1 --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph data-model --format dot --out .my-dev-kit/data-model.dot
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --entity User --json
```

Path rules:

- Run commands from your project root unless you intentionally pass another root.
- `index` uses `--root` to define the project root.
- `index` resolves `--src` paths relative to `--root`.
- `index` resolves `--out` relative to `--root`.
- Read commands use `--index` to point at the artifact directory created by `index`.
- `data-model` reads index artifacts from `--index` and writes any additional data-model artifacts to `--out` or back into `--index` when `--out` is omitted.
- Node IDs must be exact.
- Use `search` to find node IDs before calling `lookup`, `source`, `slice`, or `view`.

Recommended artifact directory:

```sh
.my-dev-kit
```

Re-run `index` to refresh the artifact directory when source changes. The directory is refreshed in place; stale artifacts from previous runs are removed.

## index

Index local source files, run semantic analyzers, and write index and semantic artifacts.

Supported languages:

- TypeScript
- JavaScript
- Python
- Kotlin
- Java

Supported source extensions:

- `.ts`
- `.tsx`
- `.js`
- `.jsx`
- `.py`
- `.kt`
- `.java`

### Usage

```sh
npx @dailephd/my-dev-kit index --root <project-root> --src <source-root> --out <artifact-dir>
```

### Flags

- `--root <path>`: project root. Source roots and output paths are resolved relative to this path.
- `--src <path>`: source root to index, relative to `--root`. May be repeated. Required.
- `--language <language>`: language hint. Supported values are `typescript`, `javascript`, and `python`. Kotlin and Java are discovered from `.kt` and `.java` extensions; they are not separate `--language` values. When omitted, language is inferred from file extensions.
- `--out <dir>`: output directory for index artifacts, relative to `--root`. Defaults to `.my-dev-kit`.
- `--exclude <path-or-name>`: directory name or relative path prefix to exclude. May be repeated. This is path/name based, not glob based.
- `--dry-run`: scan and report what would be indexed without writing artifacts.
- `--progress`: print bounded progress diagnostics to stderr.
- `--call-graph`: write `call-graph.json` using conservative static call analysis when supported.
- `--incremental`: detect added/changed/removed/unchanged files against internal cache metadata (v1.8.0). See [Incremental indexing](#incremental-indexing-v180) below.
- `--reset-cache`: clear internal incremental-index cache metadata for `--out` before running (v1.8.0). See [Incremental indexing](#incremental-indexing-v180) below.
- `--json`: print JSON result to stdout.

### Default ignored directories

The indexer skips common dependency, generated, build, and cache directories before reading files from them.

Default ignored directory names include:

- `node_modules`
- `.next`
- `dist`
- `build`
- `coverage`
- `playwright-report`
- `test-results`
- `output`
- `out`
- `.cache`
- `.turbo`
- `.vercel`
- `.git`
- `.pytest_cache`
- `__pycache__`
- `.venv`
- `venv`
- `.my-dev-kit`
- `.my-dev-kit-*` (any directory name starting with `.my-dev-kit-`, e.g. a custom `--out` directory or a generated smoke-test output folder)

The `.my-dev-kit`/`.my-dev-kit-*` defaults keep `index` from re-scanning its own output directory (or other `my-dev-kit` output directories) on repeated runs.

The `--exclude` flag adds extra directory names or relative path prefixes.

### Large-repo preflight warnings (v1.8.0)

Both a real `index` run and `index --dry-run` compute deterministic preflight warnings from file-discovery counts and report them as a `preflightWarnings` array (`{ code, message }`) in JSON output, and as a `Preflight warnings:` section in human output. Warning order is fixed and does not depend on which warnings fire.

Warning codes:

- `large-file-count`: the number of files eligible for indexing exceeds a static safe-preflight threshold (5000).
- `broad-source-root`: a `--src` value resolves to the project root itself (e.g. `--src .`) and more than 1000 files were discovered under it.

These are advisories only, based on static file-count evidence. They never fail the command by themselves, and they never claim the run is unsafe or guaranteed to succeed — only that the file count is large enough to be worth a second look before scanning large or broad monorepos. See [Indexing large monorepos](#indexing-large-monorepos) below.

### Incremental indexing (v1.8.0)

`--incremental` performs a real **partial rebuild** for the core artifact pipeline: unchanged files' per-file analysis is reused instead of re-parsed, changed/added files are re-analyzed, removed files are dropped from every affected artifact, and `symbol-index.json`/`code-graph.json` are rebuilt deterministically from the merged result. Partial incremental output for these artifacts is logically equivalent to a clean full `index` run of the same source tree (proven by the equivalence tests in `tests/index/partialRebuild.spec.ts`, which compare normalized partial and full output byte-for-byte after the same edits).

**What is and isn't partially reused:**

- **Reused per-file analysis (`symbol-index.json`, `code-graph.json`):** an unchanged file's symbols/imports/exports/line-count are read back from the previous `symbol-index.json` rather than re-parsed. `graph.fileDeps`/`graph.symbols` (and the code graph built from them) are still recomputed globally across the full merged file set on every partial rebuild, because import/re-export/export-all resolution depends on which files currently exist, not just on the files that changed — a changed or removed file can change what an *unchanged* file's imports resolve to. This keeps output correct and stable file/symbol IDs (`file:<path>`, `symbol:<path>#<name>`) unchanged for files whose content didn't change.
- **Always regenerated as an artifact fallback (`call-graph.json`):** call-graph extraction re-parses source text directly (it is not derived from the cached per-file analysis), so whenever `--call-graph` is requested during a partial rebuild it is always fully regenerated from every current file's source — this is reported honestly as `cacheMode: "incremental-partial-with-artifact-fallback"` with `partialRebuildFallbackArtifacts: ["call-graph"]`, not silently treated as reused.
- **Always fully regenerated from the merged index (`data-model.json`, `frontend-semantic.json`, `frontend-reachability.json`, `classification.json`):** these analyzers already run over the complete current `symbol-index.json`/`code-graph.json` on every build, full or partial — they were never per-file-incremental — so a correct partial rebuild of the core pipeline automatically keeps them fully correct and free of stale entries with no analyzer-specific changes needed.

`--incremental` writes and reads an internal `cache-metadata.json` file inside `--out`. It records a config fingerprint (source roots, `--exclude` values, `--call-graph`, `--language`, and the default-ignore rule set) and, per indexed file, a content hash (SHA-256), size, and the two extraction fields not present in the public `symbol-index.json` shape (`reExportSpecifiers`, `exportAllSpecifiers`) needed to safely reuse that file's analysis later. `cache-metadata.json` is internal bookkeeping, not a public semantic artifact — it is not listed in `manifest.json`'s `artifacts` map and is not part of the "Artifacts" list below.

Each `--incremental` run reports a `cache` object (JSON output) and a `Cache mode:`/`Changed files:` section (human output) with one of these modes:

- `incremental-full-initial`: no usable cache existed yet; a full build ran and cache metadata was written.
- `incremental-full-cache-incompatible`: the existing cache file was missing required fields, unreadable, from an incompatible cache/package/artifact-schema version, or the on-disk index artifacts it referenced were missing; a full build ran and cache metadata was rewritten.
- `incremental-full-config-changed`: the cache was structurally valid but the config fingerprint changed (different `--src`, `--exclude`, `--call-graph`, `--language`, or default-ignore rules); a full build ran and cache metadata was rewritten. File-level diffing is skipped in this case because the discovered file set may no longer be comparable.
- `incremental-no-change`: the cache and config fingerprint matched and no file was added, changed, or removed. The existing `manifest.json`/artifacts on disk are reused as-is — no rebuild, no cache rewrite.
- `incremental-partial`: at least one file was added, changed, or removed, partial-rebuild reuse was safe, and every artifact family was either partially merged or didn't need to be (no `--call-graph` requested).
- `incremental-partial-with-artifact-fallback`: same as `incremental-partial`, but at least one artifact family listed in `partialRebuildFallbackArtifacts` (currently only ever `call-graph`) was fully regenerated rather than reused.
- `incremental-change-detected-full-rebuild`: changes were detected, but partial-rebuild reuse was **not** safely possible this run (for example: the previous `symbol-index.json` is missing, unreadable, or from an incompatible schema version) — a full rebuild ran instead, with the reason reported in `invalidationReason`. This is a safety fallback, not the normal path for a healthy cache.

`cache.changedFileSummary` (populated for every mode except `incremental-full-initial`/`incremental-full-cache-incompatible`/`incremental-full-config-changed`, which have no comparable prior baseline) reports `addedCount`/`changedCount`/`removedCount`/`unchangedCount` plus a bounded, alphabetically sorted sample (up to 20 paths) of added/changed/removed files.

`manifest.json` records `indexMode` (`"full"` or `"incremental"`), and, for incremental runs that actually (re)built artifacts, `cacheMode`, `cacheInvalidationReason`, `changedFileSummary`, and `partialRebuildFallbackArtifacts` from that specific build. A `manifest.json` returned by the `incremental-no-change` fast path reflects whichever earlier run actually last produced it, since no rebuild happened on this invocation — see the top-level `cache` field in the command result for what happened on the current invocation.

`--reset-cache` deletes `cache-metadata.json` from `--out` if present; it never touches `manifest.json`, `symbol-index.json`, `code-graph.json`, or any other normal artifact, and it succeeds (reporting `existed: false`) when no cache file exists. `--reset-cache` can be combined with `--incremental`: the cache is cleared first, and the run then proceeds as a safe `incremental-full-initial` build. Used alone (without `--incremental`), `--reset-cache` only clears a stale cache file; the rest of the command runs exactly as it would without the flag.

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --incremental --json
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --reset-cache --json
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --reset-cache --incremental --json
```

Not implemented: deterministic artifact merge or partial rebuild for `--call-graph` itself (it is fully regenerated during a partial rebuild), stable artifact IDs across a full-rebuild fallback, watch mode, and retrieval filtering. The separate `graph-diff` command is implemented; see [graph-diff](#graph-diff) below.

### Android project detection (v1.9.0 Batch 1)

Every `index` run performs **static** Android/Gradle project detection against `--root` (not `--src` — Gradle/manifest files typically live outside the indexed source roots). This is a **detection foundation only**: it identifies project/module/source-set structure so later `v1.9.0` batches can add Kotlin/Java structural indexing on top of it. There is no new CLI flag — detection always runs automatically and degrades to "not detected" with zero side effects for a non-Android project.

**What is statically detected:**

- Project-level Gradle/Android evidence: `settings.gradle(.kts)`, root `build.gradle(.kts)`, `gradlew`/`gradlew.bat`, `gradle/libs.versions.toml`, and any `AndroidManifest.xml`.
- Gradle modules: parsed conservatively from `settings.gradle(.kts)` `include(...)` declarations (both Groovy multi-arg and Kotlin-DSL repeated-call forms), plus the conventional single-module `app/` folder and a root-as-module case when the root build file itself carries Android plugin evidence.
- Module type (`app`/`library`/`unknown`): inferred from the literal presence of the `com.android.application` or `com.android.library` plugin-id substrings in that module's build file text. `org.jetbrains.kotlin.android`/`kotlin-android` are recorded as corroborating evidence but do not by themselves determine `app`/`library`.
- Source sets (`main`, `test`, `androidTest`) and their `src/<set>/kotlin`, `src/<set>/java` roots: existence-based only (this detection step never opens a `.kt`/`.java` file; that happens separately, in Kotlin/Java structural indexing — see below).
- `AndroidManifest.xml` presence at `<module>/src/main/AndroidManifest.xml` (a path-existence check only — the manifest's contents are never parsed).

**What is explicitly not claimed** (static-analysis boundary): the Gradle build succeeding, dependencies resolving, plugin configuration being semantically valid, the app launching, an emulator/runtime property, or any Kotlin/Java symbol/component information. Detection never executes Gradle, never runs `gradlew`, never downloads or resolves dependencies, and never builds a Kotlin/Groovy AST — `settings.gradle`/`build.gradle` scanning is a conservative regex-based substring search, not a real parser. Version-catalog plugin aliases (`alias(libs.plugins.android.application)`) are not resolved to a concrete plugin id in this batch, and custom Gradle `project(...).projectDir` remaps are not honored — both are documented limitations, not defects.

**Output**: when any Android evidence is found, `index` writes `android-project.json` (schema below) and registers it in `manifest.json`'s `analyzers` array as `{ id: 'android-project', status, artifacts: [...] }` — the same registration pattern `classification` already uses, not a new top-level manifest field. `status` is `'skipped'` (no evidence at all — the default for every non-Android project), `'partial'` (low/medium confidence, warnings present), or `'complete'` (high confidence: a module with clear plugin evidence and a found manifest). It is never `'failed'`. The JSON command result also exposes a top-level `androidProjectPath` (the artifact's path, or `null` when nothing was detected).

**Default ignores**: `.gradle` is now a default-ignored directory name. `build` was already default-ignored (since v1.8.0 Batch 1) and, because default ignores match by directory name at any recursion depth, this already excludes `app/build`, `library/build`, `build/generated`, `build/intermediates`, `build/tmp`, and `build/kotlin` with no additional configuration.

**Incremental indexing**: `index --incremental`'s config fingerprint now also covers detected Android structure (an `androidEvidenceFingerprint` derived from the built `android-project.json` itself, not raw file hashes). Editing `settings.gradle`, a module's `build.gradle(.kts)`, or an `AndroidManifest.xml` in a way that changes what is *detected* invalidates the cache (`incremental-full-config-changed`) and re-runs detection; an edit that doesn't change any detected fact (e.g. bumping a dependency version) correctly does not invalidate the cache. `--reset-cache`, the `incremental-no-change` fast path, and stale-artifact cleanup (a stale `android-project.json` is removed the same way a stale `classification.json` is, when re-indexing a now-non-Android project root into the same `--out`) all continue to work unchanged.

**graph-diff**: `graph-diff` never enumerates the index directory's contents, so `android-project.json` sitting alongside the other artifacts is inert to it. The existing generic `manifest.analyzerChanges` diff (compares `manifest.analyzers[]` by id) automatically reports an `android-project` status change between two indexes with no `graph-diff`-specific code for this artifact.

**Batch 1 does not implement** (deferred to later batches): Kotlin/Java structural symbol indexing (both are now implemented — see "Kotlin structural indexing" and "Java structural indexing" below), Android component-role detection (now implemented — see "Android component-role detection" below), Room/Retrofit/Hilt/Dagger detection, a detailed Gradle project model or dependency graph (now implemented — see "Detailed Gradle project evidence" below), a detailed `AndroidManifest.xml` artifact (package name/permissions/components), an Android resources or navigation artifact, Compose semantic retrieval, and Android build/emulator/APK/AAB/Play-Store/security/release validation of any kind.

### Kotlin structural indexing (v1.9.0 Batch 2)

`.kt` files under a requested `--src` root are indexed the same way `.ts`/`.js`/`.py` files already are — no new flag, no new command. A conservative, deterministic, **regex/line-based** extractor (not the Kotlin compiler, not a real grammar parser) scans each file and records:

- the file's package declaration and import specifiers (including wildcard imports, e.g. `com.example.util.*`)
- top-level `class`, `data class`, `sealed class`, `interface`, `sealed interface`/`fun interface`, `object`, and `enum class` declarations
- top-level functions, including extension functions (`fun String.toSlug()`)
- top-level `val`/`var` properties

**Only top-level declarations become symbols** — this matches the existing TypeScript adapter (`ts.forEachChild(sourceFile, ...)`, direct children only) and Python adapter (`tree.body`, top-level statements only): neither language extracts class members as separate symbol-index entries today, so Kotlin member functions/properties are not either. Building a member-symbol model for Kotlin alone would be a parallel, inconsistent architecture rather than reuse of the existing one.

**Modifiers, `suspend`, extension receivers, annotations, and `Flow`/`StateFlow` usage are not new fields** — they are all visible through the existing `signature` text (the trimmed declaration line, capped at 120 characters, with any immediately-preceding `@Annotation` line(s) prepended), the same choice the Python adapter already made for decorators (computed, then folded into signature text rather than persisted as a dedicated field). `Flow`/`StateFlow` type usage is additionally visible through the file's `imports` list when the corresponding `kotlinx.coroutines.flow.*` type is imported.

Symbol kinds reuse the existing cross-language set (`class`, `interface`, `enum`, `function`, `const` for `val`, `variable` for `var`) plus one new kind, `object`, added because a Kotlin `object`/`companion object` (a singleton/namespace) doesn't map cleanly onto `class` without losing information.

**Import resolution**: `import com.example.foo.Bar` resolves to a local file only via the common single-top-level-declaration-per-file convention (`<packageDir>/Bar.kt`) — Kotlin does not enforce file-name-matches-declaration-name the way Java does, so this is a best-effort heuristic. A wildcard import, or a package directory containing multiple top-level declarations per file, correctly resolves to no target file rather than guessing.

**Call-graph extraction is not implemented for Kotlin** (`supportsCallGraph: false`): Kotlin's trailing-lambda call syntax (`foo { ... }`) makes regex-based call-site detection too unreliable to be worth the false-positive risk. `--call-graph` continues to work normally for TypeScript/JavaScript/Python files in the same run; Kotlin files simply contribute no call-graph edges.

**Existing commands work unchanged**: because Kotlin files/symbols land in the same `symbol-index.json`/`code-graph.json` artifacts, `search`, `lookup`, `slice`, and `source` all work on Kotlin file/symbol nodes with zero new flags or selectors.

**Source-root boundary preserved**: Kotlin source-root detection recorded in `android-project.json` (Batch 1) is informational only — it does not expand or override `--src`. A `.kt` file is indexed only when it falls under a source root the user explicitly passed via `--src`, exactly like every other language.

**Not implemented in Batch 2** (deferred): Java structural indexing (now implemented — see "Java structural indexing" below), Android component-role detection, Compose semantic retrieval, member function/property symbols, call-graph edges for Kotlin, and any Android build/emulator/runtime/security validation.

### Java structural indexing (v1.9.0 Batch 3)

`.java` files under a requested `--src` root are indexed the same way `.ts`/`.js`/`.py`/`.kt` files already are — no new flag, no new command. A conservative, deterministic, **regex/line-based** extractor (not `javac`, not a real grammar parser, no Maven/Gradle execution) scans each file, mirroring the Kotlin adapter's design (Batch 2) almost exactly, and records:

- the file's package declaration and import specifiers, including `static` imports and wildcard imports (`import com.example.util.*;`, `import static com.example.Util.helper;`) — static-ness is not preserved as separate metadata (no dedicated field for it, same choice made for Kotlin), the qualified name is still captured
- top-level `class`, `interface`, `enum`, `record`, and annotation type (`@interface`) declarations

**Only top-level declarations become symbols** — same rule as Kotlin (Batch 2) and the existing TypeScript/Python adapters: no language extracts class members (methods, fields, constructors) as separate symbol-index entries today, so Java doesn't either.

**Modifiers (`abstract`/`final`/`static`/`sealed`/`non-sealed`), `extends`/`implements` targets, and annotations are not new fields** — all visible through the existing `signature` text (the trimmed declaration line, capped at 120 characters, with any immediately-preceding `@Annotation` line(s) prepended), the same choice made for Kotlin and Python.

**Symbol kinds reuse the existing set with zero additions**: `class` (including `record` declarations — the `record` keyword remains visible via `signature`), `interface` (including annotation-type declarations, `@interface Foo` — an annotation type is technically a specialized interface at the JVM level), `enum`. No Java-only `SymbolKind` was needed.

**Import resolution**: `import com.example.foo.Bar;` resolves to a local file via the file-name-matches-public-type-name convention Java enforces (`<packageDir>/Bar.java`) — still a best-effort heuristic, not semantic verification. A wildcard or static-wildcard import (`import com.example.*;`, `import static com.example.Util.*;`) correctly resolves to no target file rather than guessing.

**Call-graph extraction is not implemented for Java** (`supportsCallGraph: false`), matching the Kotlin decision — out of scope for this batch regardless of reliability.

**Existing commands work unchanged**: `search`, `lookup`, `slice`, and `source` all work on Java file/symbol nodes with zero new flags, since Java symbols land in the same `symbol-index.json`/`code-graph.json` artifacts as every other language.

**Source-root boundary preserved**: Java source-root detection recorded in `android-project.json` (Batch 1) is informational only — a `.java` file is indexed only when it falls under a source root the user explicitly passed via `--src`.

**Not implemented in Batch 3** (deferred): method/field/constructor symbols, call-graph edges for Java, semantic type resolution, cross-file `extends`/`implements` resolution, Maven/Gradle model parsing, Android component-role detection (now implemented — see "Android component-role detection" below), Compose semantic retrieval.

### Android component-role detection (v1.9.0 Batch 4)

Every `index` run of an Android project (i.e. one where Android evidence was already detected per Batch 1) also runs **conservative static** component-role detection over the Kotlin/Java top-level symbols already indexed (Batch 2/3). No new flag, no new command — detection runs automatically and is inert (no artifact written, nothing added to any symbol) for a non-Android project or a project with zero detectable roles.

**Detected roles**: `activity`, `fragment`, `view-model`, `service`, `broadcast-receiver`, `content-provider`, `worker`, `repository`, `use-case`, `room-entity`, `room-dao`, `room-database`, `retrofit-service`, `hilt-module`.

**Evidence priority** (strongest first): explicit annotation (e.g. `@Entity`, `@Dao`, `@Module`) → explicit superclass/interface name (e.g. `extends AppCompatActivity`, Kotlin `: ViewModel()`) → import → package/path hint → naming suffix (weakest — e.g. a class merely named `...Activity`). Each detected role carries a `confidence` (`high`/`medium`/`low`) and an `evidence[]` list; **name-suffix-only matches are always capped at `low` confidence and always carry a warning** — a class is never called "high confidence" just because of how it's named. `repository` and `use-case` have no strong (annotation/superclass) evidence tier at all in this batch, so they never exceed `medium`.

Only Retrofit-service detection needs to look inside the symbol's body (HTTP method annotations like `@GET`/`@POST` live on methods, not on the interface declaration line) — a small, bounded, brace-depth-scanned re-read of the already-indexed file (capped at 400 lines) is used for that one case only; every other role is evaluated purely from data already in `symbol-index.json` (`signature` text, `imports`, symbol name, file path).

**What is explicitly not claimed**: that a component is declared in `AndroidManifest.xml` (this batch never parses manifest contents), that dependency injection actually wires up correctly, that navigation or runtime reachability holds, or any compiled/runtime behavior. Role detection never executes Gradle, Kotlin, or Java compilation.

**Output**: when one or more roles are detected, `index` writes `android-components.json` and registers it in `manifest.json`'s `analyzers` array as `{ id: 'android-components', status, artifacts: [...] }` — the same registration pattern `android-project`/`classification` already use. `status` is `'skipped'` (no Android evidence at all, or Android evidence exists but zero roles were detected — no file is written either way), `'partial'` (every detected role is `low` confidence), or `'complete'` (at least one role is `medium`/`high` confidence). It is `'failed'` only on an unexpected exception during detection (e.g. a source-file read error), mirroring the `classification` analyzer's failure-mode contract.

**Compact metadata on existing artifacts**: a detected role also becomes a compact `androidComponentRoles`/`androidComponentRefs` pair directly on the matching symbol in `symbol-index.json` (`files[].symbols[]` and `graph.symbols[]`) and on the matching `symbol`-kind node in `code-graph.json` — the exact same "compact projection + artifact ref" pattern `classificationRoles`/`classificationRefs` already uses. This is why `search`, `lookup`, `slice`, and `source` all pick up role metadata with zero new flags or selectors: `search` indexes the compact role label as a searchable field (so queries like `ViewModel`, `Repository`, `Room Entity`, `Retrofit`, `Hilt` return the relevant symbols); `lookup`'s returned node object (and a convenience top-level `androidComponentRoles`/`androidComponentRefs` pair) include it; `slice` preserves it on every node it returns; `source` copies it onto the `SourceSlice` result the same way it already does for `classificationRoles`/`classificationRefs`.

**Source-root boundary preserved**: detection only ever reads files that are already part of the indexed `symbolIndex` (i.e. under a requested `--src` root) — it never scans additional Kotlin/Java source roots that Batch 1's Android detection may have recorded in `android-project.json`.

**Not implemented in Batch 4** (deferred): method/field/constructor-level role evidence (matches the Batch 2/3 top-level-only precedent), a detailed `AndroidManifest.xml`-based component registry, Compose semantic retrieval, Room/Retrofit/Hilt *semantic* wiring validation, and any Android build/emulator/runtime/security validation.

### Detailed Gradle project evidence (v1.10.0 Batch 1)

Every `index` run of a project with Gradle/Android evidence (per Batch 1's v1.9.0 detection) also runs a **detailed, static, conservative** Gradle-evidence pass over the same modules — settings files, build-file plugins/dependencies/`android {}` configuration, and version catalogs. No new flag, no new command: it runs automatically and writes nothing for a project with zero qualifying Gradle evidence. It extends the existing `src/android/parseGradleEvidence.ts` module (the same regex/brace-scanning parser `detectAndroidProject` already uses for module/plugin-type detection) rather than introducing a second Gradle scanner.

**What is statically detected, per module**: applied plugins (`id("...")`, `id '...'`, `alias(libs.plugins.*)`, `apply plugin: "..."`, `apply(plugin = "...")`), dependency declarations (`implementation`/`api`/`testImplementation`/`kapt`/`ksp`/etc., classified as external-module/project/version-catalog-alias/platform/file/unknown), and `android {}` configuration — `namespace`, `compileSdk`, `applicationId`, `minSdk`, `targetSdk`, `versionCode`, `versionName`, `testInstrumentationRunner`, `buildFeatures`, `buildTypes`, `productFlavors`, `flavorDimensions`, and statically-visible `sourceSets` overrides (`manifest.srcFile`, `java.srcDirs`, `kotlin.srcDirs`, `res.srcDirs`, `assets.srcDirs`, `aidl.srcDirs`). At the project level: `rootProject.name`, `include(...)` module declarations (reusing Batch 1's parser), `includeBuild(...)`, `project(...).projectDir` remaps, and `gradle/libs.versions.toml` (`versions`/`libraries`/`bundles`/`plugins`, including `version.ref` indirection).

**What is explicitly not claimed**: any value is only recorded when it is a literal Gradle expresses statically (a quoted string, an integer, `true`/`false`). Anything computed — a variable reference, a function call, `project.property(...)`, string concatenation — is preserved as raw source text with `resolved: false` and a warning, never guessed at. The parser never executes Gradle, never runs `gradlew`, never resolves dependencies against a repository (local or remote), and never computes the final merged build-type × product-flavor variant configuration.

**Output**: when any detailed Gradle evidence is found, `index` writes `android-gradle.json` (schema below) and registers it in `manifest.json`'s `analyzers` array as `{ id: 'android-gradle', status, artifacts: [...] }` — the same registration pattern `android-project`/`android-components` already use. `status` is `'skipped'` (no Gradle evidence at all), `'partial'` (evidence found but at least one warning), or `'complete'` (no warnings). It is never `'failed'`: unreadable or dynamic evidence degrades to a warning, the same contract `android-project.json` already has. The JSON command result also exposes a top-level `androidGradlePath`.

**Incremental indexing**: `index --incremental`'s config fingerprint now also covers an `androidGradleEvidenceFingerprint` (derived from the built `android-gradle.json` itself), alongside Batch 1's existing `androidEvidenceFingerprint`. Any settings/build/version-catalog file edit that changes detected Gradle evidence invalidates the cache (`incremental-full-config-changed`) and regenerates `android-gradle.json` in full — there is no partial per-module Gradle rebuild in this batch. Stale-artifact cleanup, `--reset-cache`, and the `incremental-no-change` fast path all work the same way they already do for `android-project.json`.

**Batch 1 does not implement** (deferred to later `v1.10.0` batches): `AndroidManifest.xml` parsing (now implemented — see "Detailed Android manifest evidence" below), an Android resources or navigation artifact, Android route/permission/resource retrieval selectors, Android module/manifest/navigation graph views, Compose semantic retrieval, and any Android build/emulator/APK/AAB/security validation.

#### android-gradle.json shape

- `artifactKind`: `"my-dev-kit-v1-android-gradle"`, `schemaVersion`: `"1.0.0"`.
- `detected`, `filesExamined` (sorted), `settings` (nullable), `modules[]` (sorted by `directory`), `versionCatalogs[]` (sorted by `file`), `warnings[]` (sorted), `summary`.
- Each module: `id`, `gradlePath`, `directory`, `buildFile`, `dsl`, `moduleType`, `sourceSetRefs[]`, `plugins[]`, `android` (nullable), `dependencies[]`, `warnings[]`.
- See `docs/GRAPH_SCHEMA.md`'s `android-gradle.json` section for the full field list, including the `AndroidGradleValue<T>` resolved/unresolved shape shared by every SDK/config field.

### Detailed Android manifest evidence (v1.10.0 Batch 2)

Every `index` run of a project with detected Android modules also discovers and parses `AndroidManifest.xml` files — default source-set locations (`src/main`, `src/debug`, `src/release`, product-flavor/build-type names, `src/test`, `src/androidTest`) plus any statically-visible custom manifest path from Batch 1's Gradle evidence (`sourceSets["<name>"].manifest.srcFile(...)`). No new flag, no new command: it runs automatically and writes nothing when zero manifest files are discovered. A bounded, non-executing XML parser (`src/android/xml/parseXml.ts`, hand-written rather than a new runtime dependency — the repository's TOML parser from Batch 1 made the same call) backs `src/android/parseAndroidManifest.ts` (per-file parsing) and `src/android/discoverAndroidManifests.ts` (discovery), orchestrated by `src/android/buildAndroidManifestProject.ts`.

**Manifest merging is never simulated.** Every discovered manifest — including duplicate declarations across `main`/`debug`/flavor source sets — is parsed and preserved as its own independent record. There is no "effective" or "winning" manifest computed anywhere.

**What is statically detected, per manifest**: `package`, `versionCode`/`versionName`, `sharedUserId`, `installLocation`, `uses-sdk`; `uses-permission`/`uses-permission-sdk-23` (with `maxSdkVersion`); declared `<permission>` (with `protectionLevel`); `uses-feature` (with `required`/`glEsVersion`); the `<application>` declaration and its attributes (`allowBackup`, `debuggable`, `networkSecurityConfig`, `usesCleartextTraffic`, etc.); `activity`/`activity-alias`/`service`/`receiver`/`provider` components with `exported` state, process/permission attributes, and provider `authorities`/`grant-uri-permission`/`path-permission` evidence; `intent-filter`/`action`/`category`/`data` evidence; `meta-data` at both application and component level (including FileProvider-style `android.support.FILE_PROVIDER_PATHS` references). Component names in `.Name`, `Name`, or `com.example.Name` form are resolved against the manifest's own `package` attribute first, falling back to the Gradle `namespace` only when no `package` attribute exists — never against `applicationId`, and never invented when neither base is available (left unresolved with a warning instead).

**Launcher and deep-link candidates** are identified only from direct static intent-filter evidence (`MAIN`+`LAUNCHER`, `VIEW`+`BROWSABLE`+`<data>`) and always carry a warning that manifest merging, aliases, enabled state, and build-variant selection are not evaluated — neither claims the app actually launches through that component or that a URI is reachable in a built variant.

**What is explicitly not claimed**: an effective `exported` value computed from Android-version/manifest-merging rules; that a resource reference (`@string/...`, `@xml/...`) resolves to any particular value (preserved as a structured, unresolved reference — `android-resources.json`, Batch 3, indexes resource *definitions* but does not link back to these manifest references either, since that cross-artifact relationship is Batch 5's); that a deep link is reachable, that domain verification (`assetlinks.json`) succeeds, or any other runtime behavior. XML parsing never executes code and never fetches anything over the network.

**Output**: when any manifest evidence is found, `index` writes `android-manifest.json` (schema below) and registers it in `manifest.json`'s `analyzers` array as `{ id: 'android-manifest', status, artifacts: [...] }` — the same registration pattern `android-gradle`/`android-project` already use. `status` is `'skipped'` (no manifest files at all), `'partial'` (evidence found but at least one warning — including a malformed manifest, which produces a bounded per-file warning rather than crashing the run), or `'complete'` (no warnings). It is never `'failed'`. The JSON command result also exposes a top-level `androidManifestPath`.

**Incremental indexing**: `index --incremental`'s config fingerprint now also covers an `androidManifestEvidenceFingerprint`, alongside Batch 1's `androidEvidenceFingerprint`/`androidGradleEvidenceFingerprint`. Any manifest add/edit/delete, Gradle namespace change, or custom-manifest-path change invalidates the cache and regenerates `android-manifest.json` in full — there is no partial per-manifest rebuild in this batch. Stale-artifact cleanup, `--reset-cache`, and the `incremental-no-change` fast path all work the same way they already do for `android-gradle.json`.

**Batch 2 does not implement** (deferred to later `v1.10.0` batches): resource XML parsing/resolution (now implemented — see "Detailed Android resource evidence" below), `android-navigation.json`, a broad declaration-to-source relationship graph, and any Android retrieval selector or graph view.

#### android-manifest.json shape

- `artifactKind`: `"my-dev-kit-v1-android-manifest"`, `schemaVersion`: `"1.0.0"`.
- `detected`, `filesExamined[]` (sorted), `manifests[]`, `applications[]`, `components[]`, `intentFilters[]`, `launcherCandidates[]`, `deepLinkCandidates[]`, `permissions[]`, `declaredPermissions[]`, `usesFeatures[]`, `metadata[]`, `warnings[]` (sorted), `summary`.
- Each manifest record: `id`, `path`, `moduleId`, `gradlePath`, `sourceSet`, `discoverySource` (`"default-convention"`/`"gradle-override"`), `packageAttr`, `gradleNamespace`, `applicationId`, `parsingStatus` (`"parsed"`/`"malformed"`), `warnings[]`, `counts`.
- See `docs/GRAPH_SCHEMA.md`'s `android-manifest.json` section for the full field list, including the `AndroidManifestAttributeValue` and `ResolvedComponentName` shapes shared across components/application/permissions.

### Detailed Android resource evidence (v1.10.0 Batch 3)

Every `index` run of a project with detected Android modules also discovers and indexes `res/` resource directories — default source-set locations (`src/main/res`, `src/debug/res`, `src/release/res`, product-flavor/build-type names, `src/test/res`, `src/androidTest/res`) plus any statically-visible custom resource directory from Batch 1's Gradle evidence (`sourceSets["<name>"].res.srcDirs(...)`). No new flag, no new command: it runs automatically and writes nothing when zero resource files are discovered. Reuses the bounded XML parser Batch 2 added (`src/android/xml/parseXml.ts`, additively extended with an element `text` field — zero change to Batch 2 manifest-parsing behavior) via `src/android/parseAndroidValuesResource.ts` (`values*` XML) and `src/android/parseAndroidResourceFile.ts` (layouts, generic file-based XML, FileProvider paths, network-security config), with discovery in `src/android/discoverAndroidResourceDirectories.ts` and qualifier parsing in `src/android/parseResourceDirectoryName.ts`, orchestrated by `src/android/buildAndroidResourceProject.ts`.

**Resource merging, overlay precedence, and device-configuration matching are never simulated.** Every qualified directory (`values`, `values-es`, `values-night`, `layout-land`, `drawable-hdpi`, ...) across every source set is indexed and preserved independently; duplicate logical resource names across qualifiers/source sets are never collapsed, and no runtime winner is ever selected.

**What is statically detected**: value resources (`string`, `color`, `style`, `bool`, `integer`, `dimen`, `fraction`, `plurals`, `string-array`/`integer-array`/`array`, explicit-type `item`, `attr`, `declare-styleable`) from `values*` XML; file-based resources (layouts, drawables, mipmaps, generic `xml/`, menus, anims/animators, color-state-lists, fonts, raw files, navigation graphs — the last recorded only as a generic file resource, with no navigation semantics); layout structure (root element, declared `@+id/` IDs, `@id/`/`@android:id/` references, `<include>` layout references, `<fragment>` class names); resource references in every recognized form (`@type/name`, `@+id/name`, `@id/name`, `?attr/name`, `@android:...`, `@package:type/name`, `@null`/`@empty`); FileProvider `<paths>` path declarations; and `<network-security-config>` structure (`base-config`/`domain-config`/`domain`/`trust-anchors`/`certificates`/`pin-set`/`pin`/`debug-overrides`).

**Candidate-target enumeration, never resolution**: every reference's `candidateTargetIds[]` lists every statically-known local definition sharing its logical resource key — all matches are preserved, none is selected as "the" target; a framework reference or a reference with no local candidate is left with an empty list, which is expected rather than an error.

**What is explicitly not claimed**: an effective/merged resource value across qualifiers; a resolved style/theme inheritance chain; binary resource content (bitmaps/fonts are indexed by path/qualifier/extension only — never decoded, never rendered); that a FileProvider path is filesystem-safe; that a network-security pin/certificate is valid; or any runtime resource-selection behavior. XML parsing never executes code, resource compilation (`aapt`/`aapt2`) never runs, and no network access is required.

**Output**: when any resource evidence is found, `index` writes `android-resources.json` (schema below) and registers it in `manifest.json`'s `analyzers` array as `{ id: 'android-resources', status, artifacts: [...] }` — the same registration pattern `android-manifest`/`android-gradle` already use. `status` is `'skipped'` (no resource files at all), `'partial'` (evidence found but at least one warning — including a malformed individual XML file, which produces a bounded per-file warning rather than crashing the run), or `'complete'` (no warnings). It is never `'failed'`. The JSON command result also exposes a top-level `androidResourcesPath`.

**Incremental indexing**: `index --incremental`'s config fingerprint now also covers an `androidResourcesEvidenceFingerprint`, alongside the other three Android fingerprints. Because binary resource files contribute no parsed content to the artifact JSON, their fingerprint additionally folds in a per-file content hash so editing a binary file's bytes (without touching its path) still invalidates the cache. Any resource add/edit/delete or custom Gradle resource-directory change regenerates `android-resources.json` in full — there is no partial per-file rebuild in this batch. Stale-artifact cleanup, `--reset-cache`, and the `incremental-no-change` fast path all work the same way they already do for `android-manifest.json`.

**Batch 3 does not implement** (deferred to later `v1.10.0` batches): `android-navigation.json` (navigation destination/action/argument extraction — now implemented, see "Detailed Android navigation evidence" below), manifest-to-resource or source-to-resource cross-artifact relationships, resource resolution/compilation, and any Android retrieval selector or graph view.

#### android-resources.json shape

- `artifactKind`: `"my-dev-kit-v1-android-resources"`, `schemaVersion`: `"1.0.0"`.
- `detected`, `filesExamined[]` (sorted), `resourceDirectories[]`, `resourceFiles[]`, `valueDefinitions[]`, `fileDefinitions[]`, `layouts[]`, `idDefinitions[]`, `references[]`, `fileProviderPaths[]`, `networkSecurityRecords[]`, `warnings[]` (sorted), `summary`.
- Each resource directory/file/definition carries `moduleId`, `sourceSet`, and a `qualifiers` object (`AndroidResourceQualifiers`) parsed from the directory name.
- See `docs/GRAPH_SCHEMA.md`'s `android-resources.json` section for the full field list, including the `AndroidResourceKey` logical-key shape and candidate-target reference behavior.

### Detailed Android navigation evidence (v1.10.0 Batch 4)

Every `index` run of a project with Android navigation resources or supported Compose navigation source also indexes `res/navigation/*.xml` graphs and narrowly-recognized static Compose route calls. No new flag, no new command: it runs automatically and writes nothing when neither exists. XML evidence reuses Batch 3's already-discovered `navigation`-type resource-file records (`src/android/buildAndroidNavigationXmlModel.ts`, no independent directory rescan) and the shared bounded XML parser, additively extended with `findNamespacePrefixForUri` for the `app`/`tools` namespaces — zero change to Batch 2/3 parsing behavior. Compose evidence (`src/android/buildComposeNavigationRoutes.ts`) runs over already-indexed Kotlin/Java files, the same integration point `android-components.json` (v1.9.0 Batch 4) uses for evidence beyond `symbol-index.json`.

**XML and Compose evidence are two clearly separated evidence kinds, never auto-linked.** This batch never infers that an XML destination and a Compose route represent "the same" screen from name/string similarity — only Batch 5's cross-artifact relationship work may establish that, and only from explicit static evidence.

**What is statically detected in XML**: nested `<navigation>` graphs; `fragment`/`activity`/`dialog` destinations (any other element name is preserved conservatively as a `custom` destination, with a warning — never silently dropped); `<action>` (`app:destination`/`app:popUpTo` candidates, `popUpToInclusive`/`popUpToSaveState`/`launchSingleTop`/`restoreState`, animation references); `<argument>` (`argType`, `nullable`, classified `defaultValue`: literal/resource-reference/null/unresolved); `<deepLink>` (URI pattern with parsed scheme/host and placeholder detection — never linked to `android-manifest.json`); and `<include>` (candidate target graphs by logical resource key). Every candidate lookup (start destination, action targets, include targets) enumerates **all** statically-matching definitions — never a single selected winner, never source-set/qualifier overlay precedence, never a merged "effective" included graph.

**What is statically detected in Compose**: this is **not** a Compose semantic analyzer. Only `composable(...)`, `navigation(...)`, `dialog(...)`, `activity(...)`, and `NavHost(...)`'s `startDestination` are recognized, and only three route forms are resolved: a direct string literal, a same-file `const val` string constant, or a generic type-route argument (`composable<HomeRoute>`, labeled `type-safe-route`). String interpolation, concatenation, function-call results, and cross-file constants are always left `unresolved-recognized-call` with a warning — never invented. A **direct screen candidate** is recorded only when a route's content lambda is exactly one top-level PascalCase call with no `if`/`when`/`for`/`while`/`try` anywhere in the body; ambiguous content still produces a route record but no screen candidate.

**What is explicitly not claimed**: that a start destination, action target, popUpTo target, or include target resolves to one specific definition at runtime; that a deep link is reachable; that navigation graphs compose into one runtime graph; or any Compose recomposition/state/NavController-call-tracing behavior. Gradle, Android build tools, and application code are never executed; no network access is required.

**Output**: when any navigation evidence is found, `index` writes `android-navigation.json` (schema below) and registers it in `manifest.json`'s `analyzers` array as `{ id: 'android-navigation', status, artifacts: [...] }` — the same registration pattern the other three Android analyzers use. `status` is `'skipped'` (no evidence at all), `'partial'` (evidence found but at least one warning — including a malformed navigation XML file, which produces a bounded per-file warning rather than crashing the run), or `'complete'` (no warnings). It is never `'failed'`. The JSON command result also exposes a top-level `androidNavigationPath`.

**Incremental indexing**: `index --incremental`'s config fingerprint now also covers an `androidNavigationXmlEvidenceFingerprint` (the XML portion only, computed early like the other three Android fingerprints — navigation XML isn't tracked by the normal `--src` changed-file mechanism). The Compose-route portion has no separate fingerprint: Kotlin/Java changes are already covered by the standard changed-file mechanism, which re-runs the pipeline stage that recomputes Compose route evidence fresh whenever a relevant source file changes. Any navigation XML add/edit/delete or custom Gradle resource-directory change regenerates the XML portion in full — there is no partial per-file/per-graph rebuild in this batch.

**Batch 4 does not implement** (deferred to later batches): manifest-to-navigation deep-link relationships, navigation-to-resource or destination-to-source relationships, route-to-screen graph edges, full Compose semantic indexing (composable trees, state, recomposition, `NavController` call tracing), and any Android retrieval selector or graph view. Manifest/navigation/resource/source relationship linking is implemented in Batch 5, below; retrieval selectors/graph views remain planned for Batch 6.

#### android-navigation.json shape

- `artifactKind`: `"my-dev-kit-v1-android-navigation"`, `schemaVersion`: `"1.0.0"`.
- `detected`, `filesExamined[]` (sorted), `navigationFiles[]`, `graphs[]`, `destinations[]`, `actions[]`, `arguments[]`, `xmlDeepLinks[]`, `includes[]`, `composeRoutes[]`, `screenCandidates[]`, `warnings[]` (sorted), `summary`.
- Each graph/destination/action/argument/deep-link/include record carries `moduleId`, `sourceSet`, `qualifiers`, `file`, and candidate-target ID arrays (never a single resolved target).
- See `docs/GRAPH_SCHEMA.md`'s `android-navigation.json` section for the full field list, including the Compose `evidenceKind`/`builder` classification and direct-screen-candidate contract.

### Android artifact relationships (v1.10.0 Batch 5)

Every `index` run of a project with Android evidence also connects the six Android artifacts (`android-project.json`, `android-components.json`, `android-gradle.json`, `android-manifest.json`, `android-resources.json`, `android-navigation.json`) through compact static graph relationships. **No new flag, no new command, no new artifact file** — `src/android/buildAndroidArtifactRelationships.ts` runs at the end of the same index-finishing pipeline stage `android-components.json`/Compose route extraction already use, and its output is merged additively into the existing `code-graph.json` (`src/graph/addAndroidRelationshipsToCodeGraph.ts`), the same merge-by-`id` pattern `addFrontendRelationshipsToCodeGraph.ts` already uses.

**What is added**: `android-module`, `android-source-set`, `android-manifest-file`, `android-manifest-component`, `android-intent-filter`, `android-permission`, `android-resource-file`, `android-resource-definition`, `android-navigation-graph`, `android-navigation-destination`, `android-navigation-action`, `android-navigation-deep-link`, and `android-compose-route` node kinds, connected by `module-contains-source-set`, `manifest-declares-component`, `manifest-component-resolves-to-source`, `component-has-intent-filter`, `component-uses-permission`/`manifest-uses-permission`, `resource-defined-in-file`, `source-references-resource`, `navigation-graph-contains-destination`, `navigation-destination-has-action`, `navigation-action-targets-destination`/`navigation-action-pop-up-to-destination`, `navigation-graph-includes-graph`, `navigation-destination-has-deep-link`, `manifest-deep-link-matches-navigation-deep-link`, `navigation-destination-resolves-to-screen`, and `compose-route-resolves-to-screen` edge kinds. Every node reuses its owning artifact's existing stable ID; every source-side edge endpoint reuses the existing `symbol`- or `file`-kind node — Kotlin/Java class nodes are never duplicated.

**Matching is always exact and always enumerated**: manifest-component-to-class and Compose-route-to-screen resolution use exact fully-qualified/top-level-declaration names only (never fuzzy or simple-name matching); `manifest-deep-link-matches-navigation-deep-link` requires exact scheme/host/port/path equality (a manifest `pathPrefix`/`pathPattern` or a navigation deep link with a placeholder is always a non-match); and every one-to-many static match (multiple candidate classes, resource definitions, navigation targets, or screen functions) produces one edge per candidate — never a single selected runtime winner. No security verdict is ever produced from permission or exported-component relationships.

**Output**: no new file. Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-relationships', status, artifacts: [] }` (empty `artifacts`, since it enriches `code-graph.json` in place). `status` is `'skipped'` (no Android evidence at all), `'partial'` (relationships built but at least one warning), or `'complete'` (no warnings). `summary.addedNodeCount`/`summary.addedEdgeCount` report how much was added.

**Incremental indexing**: no dedicated fingerprint. Relationships are recomputed fresh whenever the index-finishing pipeline runs, which already happens on any upstream Android evidence fingerprint change (`androidEvidenceFingerprint`, `androidGradleEvidenceFingerprint`, `androidManifestEvidenceFingerprint`, `androidResourcesEvidenceFingerprint`, `androidNavigationXmlEvidenceFingerprint`) or any tracked Kotlin/Java source change via the standard `--src` changed-file mechanism. Because the finishing pipeline always rebuilds the code graph from scratch before this merge step, stale relationship nodes/edges from removed evidence never persist — there is no separate cleanup pass. `graph-diff` required zero code changes: it already diffs `CodeGraph.nodes`/`.edges` purely by `id` equality, so added/removed/changed Android relationships are reported the same way any other code-graph change is.

**Batch 5 does not implement** (deferred to later batches): any new retrieval selector, graph view, or CLI flag for these relationships (Batch 6's scope); runtime reachability, effective permission enforcement, or deep-link resolution proof.

### Retrieval and command compatibility hardening (v1.9.0 Batch 5)

Batch 5 adds no new command, flag, or artifact. It hardens and verifies that `index`, `search`, `lookup`, `source`, `slice`, `context`, and `graph-diff` (including `--incremental`) all behave correctly when Android project facts, Kotlin symbols, Java symbols, and Android component roles coexist in a single index — not just when each is exercised on its own fixture, as Batches 1–4 mostly did. A dedicated mixed Kotlin/Java Android fixture (`tests/fixtures/android/mixed-kotlin-java-app`) plus integration tests confirm: role metadata attaches only to role-bearing symbols and never leaks onto plain Kotlin/Java symbols in the same index; `context` capsules can surface Android/Kotlin/Java candidates for task-like queries while staying bounded; and `graph-diff` reports added/changed Kotlin and Java nodes, including Android role-metadata changes, with no dedicated Android/Kotlin/Java diff section. `context` and `graph-diff` needed no code changes — both were already fully generic with respect to Android/Kotlin/Java data.

#### android-project.json shape

- `artifactKind`: `"my-dev-kit-v1-android-project"`, `schemaVersion`: `"1.0.0"`.
- `detected`, `confidence` (`"none"`/`"low"`/`"medium"`/`"high"`).
- `evidence`: sorted list of relative evidence file/directory paths.
- `modules[]`: sorted by `path`; each has `id`, `name`, `path`, `type` (`"app"`/`"library"`/`"unknown"`), `gradleFiles`, `manifestPath`, `sourceSets[]` (sorted `main` → `test` → `androidTest`), `kotlinSourceRoots`, `javaSourceRoots`, `evidence`, `warnings`.
- `ignoredGeneratedDirectories`: sorted list of `build`/`.gradle` directories actually found under any detected module.
- `warnings`: sorted; ambiguous plugin evidence, a missing manifest, or a declared-but-not-found module all produce a warning rather than a crash.
- `summary`: `{ moduleCount, appModuleCount, libraryModuleCount, unknownModuleCount }`.

```sh
npx @dailephd/my-dev-kit index --root . --src app/src/main --out .my-dev-kit --json
```

### Semantic analyzer behavior

After indexing, `index` runs semantic analyzers. The TypeScript model analyzer runs on TypeScript and TSX source and produces `data-entity` and `data-field` semantic roles for exported interfaces, type aliases, and classes that qualify as data models.

The frontend analyzer runs on `.tsx` and `.jsx` source files to produce the frontend semantic artifact. It extracts:

- Exported React components (function and arrow-function forms)
- Local (non-exported) React components
- Prop type interfaces and type aliases
- Hook blocks (`useState`, `useEffect`, and others)
- Event handlers and inline handlers
- JSX return regions
- UI strings (`data-testid`, `aria-label`)

The frontend analyzer also detects files that match test file patterns (`.test.`, `.spec.`, `__tests__`) and extracts test facts (describe/test/it blocks, setup/teardown, locators, route strings) when those files are in the symbol index. **Note:** The base indexer excludes files matching `.test.` and `.spec.` from default file discovery. Test facts in `frontend-semantic.json` are only present when test files reach the symbol index through a source root that the indexer processes.

The classification analyzer (v1.5.0) runs after the analyzers above, using their output as evidence where available. It performs conservative static schema/layer classification of files and symbols — categories such as `canonical-type`, `database-model`, `view-model`, `test-fixture`, `generated-file`, `configuration-file`, `command-handler`, `analyzer`, and `validator` — and produces `classification.json` plus compact `classificationRoles`/`classificationRefs` fields on classified symbols in `symbol-index.json` and `code-graph.json`. Classification is static and conservative: it is derived only from file paths, naming conventions, and existing index/semantic evidence, never from runtime or browser behavior, and low-confidence classifications are marked `possible`/`unknown` with an explanatory warning rather than rounded up to a confident category. See the [`search`](#classification-metadata-v150), [`lookup`](#classification-metadata-v150-1), [`slice`](#classification-metadata-v150-2), and [`source`](#classification-metadata-v150-3) sections below for how classification metadata is surfaced.

Analyzer results and status are recorded in `manifest.json` under the `analyzers` array.

### Managed artifact refresh

Each `index` run refreshes the artifact directory. Artifacts from previous runs that are no longer produced are removed. `manifest.json` is always the authoritative registry for the current artifact set.

### Artifacts

`index` writes the following files inside `--out`:

- `manifest.json` — artifact registry, analyzer registry, project metadata, and summary counts
- `symbol-index.json` — per-file symbol tables with compact semantic roles where available
- `code-graph.json` — file and symbol graph with compact semantic roles on symbol nodes where available

When `--call-graph` is requested and call graph data is available:

- `call-graph.json`

When the TypeScript model analyzer produces data-model output:

- `data-model.json`
- `data-model-graph.json`

When the frontend analyzer processes TSX/JSX files:

- `frontend-semantic.json`
- `frontend-reachability.json` (v1.3.0)

Always, when the classification analyzer runs successfully (regardless of whether TSX/JSX or data-model output exists):

- `classification.json` (v1.5.0)

When static Android/Gradle project evidence is found under `--root` (v1.9.0 Batch 1 — project/module/source-set detection only; Kotlin/Java symbol indexing itself happens through the normal `--src`-driven indexing pipeline described above, not this artifact):

- `android-project.json`

When at least one Android component role is detected among already-indexed Kotlin/Java top-level symbols (v1.9.0 Batch 4):

- `android-components.json`

When detailed static Gradle evidence (settings, build-file plugins/dependencies/`android {}` config, or version catalogs) is found under `--root` (v1.10.0 Batch 1 — extends `android-project.json`'s module set with detailed, conservative Gradle evidence):

- `android-gradle.json`

When one or more `AndroidManifest.xml` files are discovered for a detected Android module (v1.10.0 Batch 2 — each source-set manifest parsed and preserved independently, with no merging):

- `android-manifest.json`

When one or more `res/` resource files are discovered for a detected Android module (v1.10.0 Batch 3 — each qualified source-set resource directory indexed independently, with no merge/overlay simulation):

- `android-resources.json`

When one or more `res/navigation/*.xml` graphs or narrowly-supported static Compose navigation routes are discovered (v1.10.0 Batch 4 — XML and Compose evidence kept as separate arrays, with no cross-artifact linking):

- `android-navigation.json`

When Android evidence is detected (v1.10.0 Batch 5 — no new artifact file; `code-graph.json` above is additively enriched in place with compact Android relationship nodes/edges connecting the artifacts listed above):

- (enriches `code-graph.json`; registered in `manifest.json` as `{ id: 'android-relationships', artifacts: [] }`)

### Examples

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json
npx @dailephd/my-dev-kit index --root . --src src --language python --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --dry-run --json
```

### Indexing large monorepos

`index` can be pointed at a subdirectory of a larger monorepo rather than the repository root, which keeps each run scoped and keeps `manifest.json`/`symbol-index.json`/`code-graph.json` sized to the part of the repo actually being worked on:

```sh
npx @dailephd/my-dev-kit index --root . --src apps/web/src --out apps/web/.my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src packages/shared/src --out packages/shared/.my-dev-kit --json
```

Before indexing an unfamiliar or large monorepo package, run `--dry-run` first to see file-count estimates and any preflight warnings without writing artifacts:

```sh
npx @dailephd/my-dev-kit index --root . --src apps/web/src --out apps/web/.my-dev-kit --dry-run --json
```

Recommendations for large or multi-package repositories:

- prefer one or more specific `--src` paths (e.g. a single package's `src`) over `--src .` at the repository root
- use `--exclude` for any generated or vendored directories not already covered by the default ignore list
- use a per-package `--out` (e.g. `apps/web/.my-dev-kit`) so each package's artifacts stay independent
- re-run `--dry-run` after adding a new package or source root to confirm file counts before a full run

This section documents large-repository scoping practices. Incremental indexing, cache reuse, and `graph-diff` are implemented elsewhere in this reference. Watch mode remains deferred; see [ROADMAP.md](ROADMAP.md).

## search

Search indexed files, symbols, graph edges, and semantic roles by keyword.

### Usage

```sh
npx @dailephd/my-dev-kit search --index <artifact-dir> --query <text>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--query <text>`: search query text. Required.
- `--limit <n>`: maximum number of results. Valid range is 1 through 100.
- `--json`: print JSON result to stdout.

### Behavior

- Search is local.
- Search is deterministic.
- Search is keyword-based.
- Multi-word queries match results containing any query term.
- Scores are deterministic ranking values.
- Scores are not probabilities or confidence values.
- Search does not call LLMs.
- Search does not use embeddings.
- Search does not read arbitrary source files.
- Search does not modify project files.

### Semantic-aware matching

When semantic metadata is present in the index, search includes `semanticRoles`, `semanticSubtype`, `semanticSource`, and `semanticArtifactRef` fields as weighted search targets. Match reasons in the result reflect which fields contributed to the score, including semantic role matches.

Result items include `semanticRoles` and `artifactRefs` when present on the matched node or symbol.

### Match reason fields

Result items include a `matchReasons` array. Each reason includes:

- `field`: the indexed field that matched (e.g. `symbolName`, `semanticRole`, `path`)
- `term`: the query term that matched

### Classification metadata (v1.5.0)

When classification metadata is present in the index, search includes `classificationRole` and `classificationEditGuidance` as weighted search targets, alongside the existing semantic fields — a query for a category name (e.g. `canonical-type`) or an edit-guidance value (e.g. `generated-do-not-edit`) can match classified files and symbols.

Result items include `classificationRoles` (compact: `role`, `editGuidance`, `readiness`, `uncertainty`) and `classificationRefs` (pointers back to `classification.json`) when present on the matched node or symbol.

When `classification.json` is absent (an older index, or a classification analyzer that has not run), these fields are simply absent from result items — search does not fail and existing `semanticRoles`/`artifactRefs` behavior is unaffected.

### Reachability selectors (v1.3.0)

`search` accepts three frontend-reachability selectors, each mutually exclusive with `--query` and with each other:

- `--route <path>`: find the route fact for a static route path, plus its related components, storage keys, and UI markers.
- `--storage-key <key>`: find the browser storage key fact, plus the components and routes that reach it.
- `--ui <value>`: find the UI marker fact, plus its component, routes, storage gates, and test evidence.

Syntax:

```sh
npx @dailephd/my-dev-kit search --index .my-dev-kit --route "/workspaces/new" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --storage-key "workspace-editor-draft.v1" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --ui "workspace-editor-empty-state" --json
```

JSON behavior: output `artifactKind` is `my-dev-kit-v1-reachability-search-result`, with `results`, `relatedEdges`, `warnings`, and a `summary` count block.

Missing-artifact behavior: when `frontend-reachability.json` is absent, the result has `status: "missing-artifact"` with a warning and exits 0 (no error).

Static-analysis limitation: these selectors read static evidence from `frontend-reachability.json`. They do not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

### Android selectors (v1.10.0 Batch 6)

`search` accepts four Android selectors, each mutually exclusive with `--query`, with the reachability selectors, and with each other. All four read Batch 5's compact `android-*` nodes/edges directly from `code-graph.json` — no new artifact, no second search index. Matching is exact only (never fuzzy, never case-folded); every one-to-many match returns every candidate.

- `--android-route <route>`: exact match against XML navigation destination/graph routes and IDs, and Compose routes — a resolved route string (string literal or same-file `const val`, matched via `resolvedRoute`) or a direct type-safe route (`composable<RouteType>(...)`, matched via its own `typeRouteName`, e.g. `--android-route "RouteType"`; v1.10.0 Batch 7 correction). A dynamic/unresolved Compose route expression never matches (it has neither `resolvedRoute` nor `typeRouteName`).
- `--permission <name>`: exact match against a permission name — both locally `<permission>`-declared permissions (`matchKind: "declared-permission"`) and permissions only referenced (`<uses-permission>`, `android:permission`/`readPermission`/`writePermission`, or a framework permission with no local declaration; `matchKind: "permission-reference"`). No `android.permission.` prefix is ever inferred. Each result includes `referers`: the components/manifest files statically referencing it.
- `--resource <name>`: a canonical `type/name` or `@type/name` selector matches exactly one logical resource key (every qualified/source-set duplicate is returned as a separate candidate — never one merged/overlay-selected value); a bare name (no `/`) matches every resource type sharing that name, preserving type ambiguity.
- `--android-component <name>`: exact match, tried in order per candidate — resolved fully-qualified class name (`matchKind: "resolved-fqcn"`), then raw manifest name including dot-prefixed/unqualified forms (`matchKind: "raw-manifest-name"`), then exact simple class name (`matchKind: "simple-name"`, deliberately ambiguity-prone: every component whose resolved class ends in `.<name>` is returned). Each result includes `sourceClassCandidates`: exact Kotlin/Java class node IDs from Batch 5's `manifest-component-resolves-to-source` edges.

Syntax:

```sh
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-route "home" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --permission "android.permission.CAMERA" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --resource "string/app_name" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-component "com.example.MainActivity" --json
```

JSON behavior: output `artifactKind` is `my-dev-kit-v1-android-search-result`, with `mode`, `query`, `results[]` (each carrying `graphNodeId`, `androidArtifactId`, `androidEntityId`, `kind`, `matchKind`, `matchedValue`, `moduleId`, `sourceSetId`, `path`, `line`, `androidMetadata`), `warnings`, and a `summary.resultCount`.

No-match behavior: zero exact matches returns `status: "ok"` with an empty `results` array and exits 0 — never an error, never a fuzzy fallback.

Static-analysis limitation: these selectors read static graph evidence only. They never claim a component is active at runtime, a permission is granted or enforced, a route is reachable, or a resource definition is the runtime-selected value.

### Compose selectors (v1.11.0 Batch 4)

`search` accepts three additional Compose selectors, joining the same mutual-exclusivity group as the Android selectors above (only one selector, or `--query`, at a time). They read Batch 4's compact `android-composable`/`android-compose-fact` nodes projected from `android-compose-semantic.json` — no new artifact, no second search index. Matching is exact only.

- `--composable <name>`: exact match against a composable's declared name, or its own stable declaration ID (`matchKind: "composable-name"` or `"composable-id"`).
- `--test-tag <tag>`: exact match against a resolved `Modifier.testTag(...)` value (`androidMetadata.resolvedValue`). A dynamic/unresolved tag has no resolved value and can never be matched.
- `--android-ui <value>`: exact match against a resolved visible-text literal, a string-resource logical key, or a string-resource qualified identifier (`R.string.name`) — `matchKind` is `"visible-text"`, `"string-resource-key"`, or `"string-resource-identifier"` respectively. Never fuzzy text matching, never Android resource-value resolution.

Composable and fact evidence is also discoverable through plain `search --query <text>` (composable names, test-tag values, visible text, resource keys, ViewModel reference names/types, and resolved navigation routes are all indexed as generic searchable fields) — the three flags above exist for exact, unambiguous lookup, not as the only way in.

```sh
npx @dailephd/my-dev-kit search --index .my-dev-kit --composable "HomeScreen" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --test-tag "login_button" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-ui "Welcome back" --json
```

Static-analysis limitation: no claim is made that a composable renders, a child is visible, a click occurs, navigation succeeds, a route is reachable, a ViewModel is scoped correctly, or a string resource resolves to displayed text.

### Android test evidence (v1.11.0 Batch 5)

No new selector flags. `android-test-semantic.json`'s compact `android-test-file`/`android-test-class`/`android-test-method`/`android-test-fact` nodes (test classes, test methods, JUnit/Compose-rule/Espresso/Robolectric evidence, and visible-text/test-tag/route/mock/fake facts) are discoverable exactly like the Compose nodes above through plain `search --query <text>` — test class/method names, framework names, annotation text, assertion values, route strings, and mocked/faked dependency names/types are all generic searchable fields, since every `android-*`-prefixed node is automatically eligible. `lookup --node <id>`, `source --node <id>` (bounded to the node's own recorded source range — never a whole-file fallback), and ordinary `slice --node <id> --depth <n>` all work unchanged; a test-method slice naturally includes real edges such as `android-test-references-composable`/`android-test-references-route`/`android-test-references-viewmodel` when the test statically references production evidence. `context` picks up test evidence as an ordinary candidate the same way. `graph-diff` reports added/removed/changed test nodes and edges the same way it reports any other code-graph change — there is no dedicated `android-test-semantic.json` diff section.

Static-analysis limitation: indexing never executes a test. No fact or edge claims a test ran, a Compose rule initialized, an Activity launched, an assertion passed, or a mock/fake was actually injected at runtime.

### Examples

```sh
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "service" --limit 20 --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "formatUser" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "data-entity User" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --route "/workspaces/new" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --storage-key "workspace-editor-draft.v1" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --ui "workspace-editor-empty-state" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-route "home" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --permission "android.permission.CAMERA" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --resource "string/app_name" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-component "com.example.MainActivity" --json
```

## lookup

Look up a graph node by exact node ID, including semantic metadata.

### Usage

```sh
npx @dailephd/my-dev-kit lookup --index <artifact-dir> --node <node-id>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--node <node-id>`: exact node ID. Required.
- `--depth <n>`: neighbor expansion depth. Valid range is 0 through 3.
- `--resolve-classification`: resolve the full `classification.json` entry for `--node`, when a classification analyzer artifact is present (v1.5.0).
- `--json`: print JSON result to stdout.

### Behavior

- `lookup` is exact-match only.
- Depth 0 returns only the focus node.
- Depth 1 through 3 expands neighbors breadth-first.
- Lookup includes incoming edges, outgoing edges, and neighboring nodes.
- Partial matching and fuzzy matching are not supported.
- Use `search` first when the exact node ID is unknown.

### Semantic metadata

The lookup result includes `semanticRoles`, `artifactRefs`, and `evidenceRefs` when present on the focus node. These fields are drawn from the code graph and reflect the compact semantic metadata written by `index`.

### Classification metadata (v1.5.0)

The lookup result includes `classificationRoles` (compact: `role`, `editGuidance`, `readiness`, `uncertainty`) and `classificationRefs` (pointers back to `classification.json`) when present on the focus node, both at the top level of the result and nested inside `node` — mirroring exactly how `semanticRoles`/`artifactRefs` already appear in both places.

Passing `--resolve-classification` additionally resolves the full matching entry from `classification.json` (category, edit guidance, readiness, risk labels, evidence, uncertainty, warnings) as `classificationDetail`. Without the flag, `classificationDetail` is not present in the result. With the flag, if `classification.json` is absent or has no matching entry, `classificationDetail` is `null` rather than an error.

When `classification.json` is absent (an older index, or a classification analyzer that has not run), lookup does not fail — the compact `classificationRoles`/`classificationRefs` fields are simply absent, and existing `semanticRoles`/`artifactRefs`/`evidenceRefs` behavior is unaffected.

### Node ID formats

File node:

```sh
file:<relative-path>
```

Symbol node:

```sh
symbol:<relative-path>#<symbol-name>
```

### Reachability selectors (v1.3.0)

`lookup` accepts `--route <path>`, `--storage-key <key>`, and `--ui <value>`, each mutually exclusive with `--node` and with each other. Each returns the single matching reachability fact plus its depth-1 cross-domain neighbors.

Syntax:

```sh
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --route "/workspaces/new" --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --storage-key "workspace-editor-draft.v1" --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --ui "workspace-editor-empty-state" --json
```

Example: `lookup --route "/workspaces/new"` returns the route fact and its depth-1 incident edges (owning components and any UI markers the route reaches).

JSON behavior: output `artifactKind` is `my-dev-kit-v1-reachability-lookup-result`, with `status` of `found`, `not-found`, or `missing-artifact`.

Missing-artifact behavior: when `frontend-reachability.json` is absent, `status` is `missing-artifact` with a warning and exit 0. A selector that matches no fact returns `not-found` at exit 0.

Static-analysis limitation: results are static evidence only. They do not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

### Android component selector (v1.10.0 Batch 6)

`lookup --android-component <name>` uses the same exact-match resolver as `search --android-component` (resolved FQCN, then raw manifest name, then simple name), mutually exclusive with `--node`.

Syntax:

```sh
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --android-component "com.example.MainActivity" --json
```

JSON behavior: output `artifactKind` is `my-dev-kit-v1-android-component-lookup-result`, with `status` of `found`, `not-found`, or `ambiguous`.

- `found` (exactly one exact candidate): `detail` includes the manifest component's graph node ID, kind, raw/resolved names, module/source-set, manifest file and source location, static `exported`/`exportedExplicit` state, `sourceClassCandidates` (exact Kotlin/Java classes), `intentFilterIds`, `permissionEdges`, and `deepLinkMatchIds` (Batch 5's `manifest-deep-link-matches-navigation-deep-link` targets).
- `not-found` (zero exact candidates): `detail` is `null`, exit 0.
- `ambiguous` (more than one exact candidate, e.g. two components sharing a simple class name in different packages): `detail` is `null` and `candidates[]` lists every candidate's graph node ID, match kind, module, source set, and raw/resolved names — no candidate is ever chosen automatically.

Static-analysis limitation: this does not claim the component is registered, reachable, or exported at runtime, and produces no security verdict from permission or exported-state evidence.

## source

Retrieve bounded source content from an indexed project.

### Usage

`source` supports multiple retrieval modes:

```sh
# Line range retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --file <path> --start <n> --end <n>

# Symbol retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --file <path> --symbol <name>

# Node ID retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --node <node-id>

# Exact string search across all indexed files
npx @dailephd/my-dev-kit source --index <artifact-dir> --contains <string>

# React region retrieval by region name
npx @dailephd/my-dev-kit source --index <artifact-dir> --react-region <region> --file <path>

# Local component-tree retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --symbol <component-name> --file <path> --include-local-component-tree
```

Use one retrieval mode per command.

### Flags

- `--index <dir>`: index artifact directory.
- `--node <node-id>`: file or symbol node ID.
- `--file <path>`: source file path relative to the indexed project root.
- `--start <n>`: start line for line-range retrieval.
- `--end <n>`: end line for line-range retrieval.
- `--symbol <name>`: symbol name to retrieve from the selected file.
- `--contains <string>`: exact string to search for across all indexed source files.
- `--context <n>`: number of context lines around each `--contains` match. Default: 3. Max: 20.
- `--path <prefix>`: path prefix filter for `--contains` (e.g. `src/components`). May not contain `..`.
- `--react-region <region>`: React region name to retrieve. Resolves a component, local component, JSX region, hook, or prop type by name from the frontend semantic artifact. Requires `--file`.
- `--include-local-component-tree`: retrieve the named component and its local child components as a connected source bundle. Requires `--symbol`.
- `--prop <name>`: filter local component-tree retrieval to show the named prop. Requires `--include-local-component-tree`.
- `--max-lines <n>`: maximum number of lines to return per block. Default: 160.
- `--format <json|plain|numbered>`: output format.
- `--out <path>`: write rendered output to a file.
- `--json`: alias for `--format json`.
- `--continue-from <n>`: continue file retrieval from this line number. Requires `--file`. (v1.4.0)
- `--continue`: continue from the end of the initial preview window. Requires `--node` or `--file --symbol`. (v1.4.0)
- `--include-imports`: include local import-site lines in bundle; external packages go to `skippedBlocks`. (v1.4.0)
- `--include-local-types`: include same-file interface/type/enum definitions referenced in the primary window. (v1.4.0)
- `--include-props`: include same-file prop type definitions. Uses `frontend-semantic.json` for exact end lines when available. (v1.4.0)
- `--include-local-components`: include same-file local React child components. Requires `frontend-semantic.json`. (v1.4.0)
- `--include-local-deps`: composite: includes prop types, local types, constants above primary symbol, and directly called helpers. (v1.4.0)
- `--expand-to-local-dependencies`: alias for `--include-local-deps`. (v1.4.0)
- `--max-bundle-lines <n>`: cap total lines across all bundle blocks. Default: 300. (v1.4.0)
- `--max-blocks <n>`: cap total block count in bundle. Default: 20. (v1.4.0)

### --contains behavior

`--contains` searches for an exact string match across all indexed source files (from `symbol-index.json`). Each match includes:

- `filePath`: the file containing the match
- `line` and `column`: the exact match location
- `context`: surrounding lines (controlled by `--context`)
- `classification`: whether the match appears to be a `declaration-like`, `usage-like`, or `unknown` context, based on static heuristics
- `frontendContext`: optional frontend value context when the string appears as a frontend-indexed literal

Multiple occurrences of the same string across files are all reported. `--path` narrows results to files whose path starts with the given prefix.

`--contains` cannot be combined with `--file`, `--symbol`, `--node`, `--start`, `--end`, or `--react-region`.

### --react-region behavior

`--react-region` looks up a named React region from the frontend semantic artifact and retrieves its source slice. Resolution priority:

1. component (exported)
2. local-component
3. jsx-region
4. hook
5. prop-type

Matching is case-insensitive; exact case is preferred over case-insensitive. When the region is not found, the error lists available region names in the file.

JSON output includes a `reactRegion` block with `matchedKind`, `matchedId`, and `matchedName`.

`--react-region` requires `--file`. It cannot be combined with `--contains`, `--symbol`, `--node`, `--start`, or `--end`.

### --include-local-component-tree behavior

`--include-local-component-tree` retrieves the named component (`--symbol`) and its local child components as connected source blocks, using statically extracted prop and event flow relationships from the frontend semantic artifact.

This is static analysis only. It does not trace runtime rendering, route reachability, or browser-state behavior.

Requires `--symbol` and `--file`. Cannot be combined with `--contains` or `--react-region`.

### Reachability selectors (v1.3.0)

`source` accepts `--route <path>`, `--storage-key <key>`, and `--ui <value>`, each mutually exclusive with the other retrieval modes and with each other. Each returns bounded source blocks at the lines where the route, storage key, or UI marker is defined, resolved from the source refs in `frontend-reachability.json`.

Syntax:

```sh
npx @dailephd/my-dev-kit source --index .my-dev-kit --route "/workspaces/new" --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --storage-key "workspace-editor-draft.v1" --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --ui "workspace-editor-empty-state" --format numbered
```

JSON behavior: output `artifactKind` is `my-dev-kit-v1-reachability-source-result`, with one bounded source block per source ref (default context 10 lines).

Missing-artifact behavior: when `frontend-reachability.json` is absent, the result is empty with a warning and exit 0.

Static-analysis limitation: source blocks are located from static source refs. They do not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

### Android selectors (v1.10.0 Batch 6)

`source` accepts `--android-route <route>` and `--resource <name>`, each mutually exclusive with the other retrieval modes. Both resolve through the same exact-match resolvers as `search`, then retrieve a bounded excerpt using `node.path`/`node.line` already recorded on the Batch 5 code-graph node — no reparsing of the repository to rediscover the route/resource.

Syntax:

```sh
npx @dailephd/my-dev-kit source --index .my-dev-kit --android-route "home" --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --resource "string/app_name" --json
```

JSON behavior: output `artifactKind` is `my-dev-kit-v1-android-source-result`, with `status` of `ok`, `not-found`, or `ambiguous`.

- `ok` (exactly one exact candidate): `result` includes the graph node ID, match kind, module/source-set, `androidMetadata`, and either a bounded `slice` (a small window starting at the node's declaration line, capped by `--max-lines`) or, for a binary resource (`.png`/`.jpg`/`.ttf`/etc.), `binary: true` with no `slice` — binary contents are never decoded or displayed as text.
- `not-found`: `result` is `null`, exit 0.
- `ambiguous` (e.g. a resource defined in both `values/` and `values-es/`, or a route/resource with no single exact match): `result` is `null` and `candidates[]` lists every exact match's graph node ID, match kind, kind, and path — `source` never picks `main` over a flavor/qualifier, never picks one density/locale, and never selects a runtime winner.

For an XML element (navigation destination/graph/action/deep-link), the excerpt is the surrounding element only, not the whole file. For a Compose route, the excerpt is a bounded window around the builder call, not the whole file.

Static-analysis limitation: excerpts are static source at a recorded declaration line — not proof of runtime reachability, not a resolved effective resource value, and not a merged manifest.

### Compose selectors (v1.11.0 Batch 4)

`source` accepts `--composable <name>`, `--android-ui <value>`, and `--test-tag <tag>`, each mutually exclusive with the other retrieval modes and with each other, resolved through the same `AndroidSelectorMode` dispatcher and `ok`/`not-found`/`ambiguous` contract as `--android-route`/`--resource` above (`artifactKind: "my-dev-kit-v1-android-source-result"`). Each retrieves a bounded excerpt using the composable's/fact's own recorded `path`/`line`/`endLine` — a composable's excerpt spans its full recorded declaration range (not a fixed small window), since that range is already known exactly from `android-compose-semantic.json`.

```sh
npx @dailephd/my-dev-kit source --index .my-dev-kit --composable "HomeScreen" --format numbered
npx @dailephd/my-dev-kit source --index .my-dev-kit --android-ui "Welcome back" --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --test-tag "login_button" --json
```

#### `--include-compose-tree`

```sh
npx @dailephd/my-dev-kit source --index .my-dev-kit --composable "HomeScreen" --include-compose-tree --max-bundle-lines 200 --max-blocks 10 --format json
```

Requires `--composable <name>` (an error otherwise); mutually exclusive with `--node`, `--file`, `--symbol`, `--contains`, `--react-region`, `--start`/`--end`, and continuation flags, same as the other Compose/Android selectors. Once the root composable resolves uniquely, it returns a bounded multi-block bundle (`artifactKind: "my-dev-kit-v1-compose-tree-result"`, `tree.mode: "compose-tree"`) built the same way `--include-local-component-tree` builds a React tree: a root block, then every composable reachable through Batch 1's `childCalls[]` (projected as `composable-calls-composable` code-graph edges) in deterministic root-first breadth-first order, each composable included at most once (cycle-protected). `--max-bundle-lines`/`--max-blocks` are the existing bundle caps; every omitted block is reported in `skippedBlocks[]` with a reason (`"max-block cap reached"`, `"max-line cap reached"`, or `"invalid source range"`). An ambiguous or unresolved child-composable call is never guessed into an edge in the first place (Batch 1 already omits it, recording a declaration-level warning instead) — any such warning reached by the walk is forwarded in the result's `warnings[]` rather than inventing a target. The tree never crosses into an unrelated composable merely because it shares the same file, and never claims a reachable child is always rendered or ever visible at runtime.

Static-analysis limitation: `--composable`/`--android-ui`/`--test-tag`/`--include-compose-tree` are static source-and-graph evidence only — no proof of rendering, visibility, click execution, navigation success, or runtime test discoverability.

### Semantic metadata propagation

When `--node` or `--symbol` mode is used, the source result propagates `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the symbol when present in the index. These appear in the JSON output.

### Classification metadata (v1.5.0)

When `--node` or `--symbol`/`--file` mode targets a classified symbol or file, the source result also propagates the compact `classificationRoles`/`classificationRefs` fields, mirroring how `semanticRoles`/`artifactRefs` already propagate. In addition, a compact `classificationSummary` field (category, edit guidance, readiness, risk labels, uncertainty, deduplicated evidence refs, and warnings — not the full evidence text) is resolved from `classification.json` when available. The default plain console output prints one concise line ("Classification edit guidance: ...", plus any risk labels) when a summary is present. Line-range retrieval (no symbol/file target) has no classification fields, the same way it has no `semanticRoles` today. When `classification.json` is absent, `classificationSummary` is `null` and `source` does not fail; v1.4.0 source continuation and local dependency expansion behavior is unaffected.

### Safety behavior

`source` enforces:

- project-root containment
- path traversal rejection
- valid line ranges
- max-lines limits
- read-only source access

`source` never modifies source files.

### --continue-from behavior (v1.4.0)

`--continue-from <n>` reads from line `n` to `n + maxLines - 1` (or EOF). Returns a `SourceSlice` with a `continuationCursor` in JSON output.

- If `n` is past EOF: returns empty content, `continuationCursor.exhausted = true`, and a warning.
- Optional `--symbol <name>`: attaches symbol metadata to the result without changing the line range.
- Cannot be combined with `--node`, `--contains`, `--react-region`, `--include-local-component-tree`, or `--start`/`--end`.

JSON output includes `continuationCursor.nextStartLine` to chain subsequent reads. Numbered output prints `[CONTINUE: <file> from line N]` or `[EOF: <file> (N lines total)]`.

### --continue behavior (v1.4.0)

`--continue` advances past the initial preview window of a symbol or node.

- `--file <path> --symbol <name> --continue`: continues from `symbolStartLine + min(maxLines, 20)`.
- `--node <id> --continue`: continues from `nodeEndLine + 1` (symbol nodes) or `min(maxLines, fileLines) + 1` (file nodes).

`reason` in the continuation cursor:
- `'symbol-end-unknown'`: symbol end line is not in the index; initial window was capped at 20 lines.
- `'eof'`: file is exhausted.
- `'window-capped'`: window was capped by `--max-lines`.

Cannot be combined with `--continue-from` or bundle flags.

### --include-* and source bundle behavior (v1.4.0)

Any of `--include-imports`, `--include-local-types`, `--include-props`, `--include-local-components`, `--include-local-deps`, or `--expand-to-local-dependencies` activates bundle mode, returning a `SourceBundle` instead of a `SourceSlice`.

**Purpose:** Each flag adds a category of same-file direct dependencies to the primary block.

| Flag | What it adds |
|------|-------------|
| `--include-imports` | Local import-site lines (external packages → `skippedBlocks`) |
| `--include-local-types` | Same-file interface/type/enum defs referenced in primary window |
| `--include-props` | Same-file prop type defs (exact from `frontend-semantic.json` when available) |
| `--include-local-components` | Local React child components (requires `frontend-semantic.json`) |
| `--include-local-deps` | Composite: props + types + constants above primary + called helpers |
| `--expand-to-local-dependencies` | Alias for `--include-local-deps` |

**JSON output (`--format json` or `--json`):**

```json
{
  "status": "ok",
  "mode": "source-bundle",
  "primaryBlock": { "kind": "primary-target", "expansionReasons": ["primary-target"], "confidence": "high", ... },
  "expansionBlocks": [
    { "kind": "local-type", "expansionReasons": ["local-type"], "confidence": "high", ... }
  ],
  "skippedBlocks": [
    { "kind": "import-site", "reasonCode": "external-package", "reason": "External package import: react", ... }
  ],
  "limits": { "maxLinesPerBundle": 300, "maxBlocks": 20, "maxLinesHit": false, "maxBlocksHit": false },
  "stats": { "primaryLineCount": 49, "expansionBlockCount": 1, "skippedBlockCount": 1, "totalLineCount": 54 },
  "continuationCursors": [{ "nextStartLine": 100, "exhausted": false, "reason": "window-capped", ... }],
  "warnings": []
}
```

**Numbered output:** block headers `=== [<kind>] <file>:<start>-<end> (<N> lines) — <reasons> ===` followed by numbered lines, then a skipped section, warnings section, and continuation footer.

**Block confidence:**
- `high`: end line from `frontend-semantic.json` (`FrontendSourceRef`) or explicit line range.
- `medium`: end line estimated from next-symbol heuristic.
- `low`: end line unknown; preview only.

**Deduplication:** overlapping same-file blocks are merged into one block; both expansion reasons are preserved.

**Limits:** `--max-bundle-lines <n>` (default 300) and `--max-blocks <n>` (default 20). When reached, remaining candidates become `skippedBlocks` with `reasonCode: 'max-lines-reached'` or `'max-blocks-reached'`.

**Static boundaries:**
- Direct, same-file dependency resolution only. No cross-file closure.
- No runtime tracing. No browser execution.
- When `frontend-semantic.json` is absent: local component and prop expansion skipped with `reasonCode: 'artifact-unavailable'`.

Cannot be combined with `--contains`, `--react-region`, or `--include-local-component-tree`.

### Limitation

The symbol index records symbol start lines but not complete symbol end lines. v1.4.0 uses the `frontend-semantic.json` artifact (when available) or a next-symbol heuristic to estimate end lines. `confidence` per block reports the estimation quality. Use `--continue-from <n>` or `--continue` to retrieve subsequent windows.

### Examples

```sh
# Line range
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered

# Symbol
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/index.ts --symbol describeUser --format numbered

# Node ID
npx @dailephd/my-dev-kit source --index .my-dev-kit --node "file:src/index.ts" --format json

# Exact string search
npx @dailephd/my-dev-kit source --index .my-dev-kit --contains "workspace-editor-empty-state" --context 5 --format numbered

# Exact string with path filter
npx @dailephd/my-dev-kit source --index .my-dev-kit --contains "structured-content" --path src/components --context 3 --format json

# React region
npx @dailephd/my-dev-kit source --index .my-dev-kit --react-region WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --format numbered

# Local component tree
npx @dailephd/my-dev-kit source --index .my-dev-kit --symbol WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --include-local-component-tree --format numbered

# Local component tree with prop filter
npx @dailephd/my-dev-kit source --index .my-dev-kit --symbol WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --include-local-component-tree --prop onSuccess --format numbered

# Continue from line 21 (v1.4.0)
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/WorkspaceEditorShell.tsx --continue-from 21 --format numbered

# Continue from end of symbol preview (v1.4.0)
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/WorkspaceEditorShell.tsx --symbol WorkspaceEditorShell --continue --format json

# Include same-file types and helpers (v1.4.0)
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/WorkspaceEditorShell.tsx --symbol WorkspaceEditorShell --include-local-deps --format numbered

# Include prop types with JSON output (v1.4.0)
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/WorkspaceEditorShell.tsx --symbol WorkspaceEditorShell --include-props --format json

# Bundle with limits (v1.4.0)
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/WorkspaceEditorShell.tsx --symbol WorkspaceEditorShell --include-local-deps --max-bundle-lines 150 --max-blocks 5 --format json
```

## slice

Build a bounded graph neighborhood around a focus node.

### Usage

```sh
npx @dailephd/my-dev-kit slice --index <artifact-dir> --node <node-id>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--node <node-id>`: focus node ID. Required.
- `--depth <n>`: traversal depth. Valid range is 0 through 3.
- `--direction <both|incoming|outgoing>`: traversal direction.
- `--out <path>`: write JSON slice artifact to a file.
- `--json`: print JSON result to stdout.

### Behavior

- Depth 0 returns only the focus node.
- Depth 1 through 3 expands breadth-first.
- Direction controls whether incoming edges, outgoing edges, or both are followed.
- The result includes focus node, included nodes, included edges, and summary counts.
- `slice` reads graph artifacts only.
- `slice` does not read source files.
- `slice` does not require Graphviz.

### Semantic metadata

Nodes in the slice include their `semanticRoles` and `artifactRefs` from `code-graph.json` when present. Semantic metadata is preserved in slice output.

### Classification metadata (v1.5.0)

Nodes in the slice also include their compact `classificationRoles` and `classificationRefs` from `code-graph.json` when present, preserved the same way `semanticRoles`/`artifactRefs` are — `slice` copies node objects as-is, so no slice-specific code is needed for this. Only the compact projection is included; the full detailed `classification.json` entry is never duplicated into slice output. When `classification.json` is absent, these fields are simply absent and slice output is otherwise unaffected.

### Reachability selectors (v1.3.0)

`slice` accepts `--route <path>`, `--storage-key <key>`, and `--ui <value>`, each mutually exclusive with `--node` and with each other. Each returns a depth-bounded cross-domain subgraph rooted at the route/storage-key/UI fact, traversing reachability edges in both directions.

Three modifiers gate which neighbor facts and evidence are pulled in:

- `--include-storage`: include storage key facts reachable from the focus.
- `--include-ui`: include UI marker facts reachable from the focus.
- `--include-tests`: include test evidence for included UI markers.

`--route` traverses at depth 1 by default (depth 2 when any include modifier is set); `--storage-key` and `--ui` traverse at depth 2.

Syntax:

```sh
npx @dailephd/my-dev-kit slice --index .my-dev-kit --route "/workspaces/new" --include-storage --include-ui --include-tests --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --storage-key "workspace-editor-draft.v1" --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --ui "workspace-editor-empty-state" --include-tests --json
```

JSON behavior: output `artifactKind` is `my-dev-kit-v1-reachability-slice-result`, with included route/storage/UI facts, edges, and summary counts.

Missing-artifact behavior: when `frontend-reachability.json` is absent, the result is an empty subgraph with a warning and exit 0. An `--include-*` modifier without a reachability selector is an error.

Static-analysis limitation: the subgraph is built from static reachability edges. It does not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

### Android selectors (v1.10.0 Batch 6)

`slice` accepts `--android-route <route>` and `--android-component <name>`, each mutually exclusive with `--node`. Both resolve a unique root through the same exact-match resolvers as `search`/`lookup`, then run the **existing** `sliceGraph` traversal against `code-graph.json` unchanged — depth/direction/edge-kind/JSON-output behavior is identical to `--node`, since a resolved Android node is just another `code-graph.json` node.

Syntax:

```sh
npx @dailephd/my-dev-kit slice --index .my-dev-kit --android-route "home" --depth 2 --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --android-component "com.example.MainActivity" --depth 2 --json
```

Root resolution behavior:

- Exactly one exact candidate: the slice runs normally, with an added top-level `androidSelector: { mode, query, matchKind }` field in JSON output.
- Zero exact candidates: prints `{ status: "not-found", ... }` (JSON) or an equivalent human message, exit 0 — no slice is built.
- More than one exact candidate (e.g. a component simple-name collision): prints `{ status: "ambiguous", candidates: [...] }` listing every candidate's graph node ID and match kind — no candidate is chosen and no slice is built.

Because the traversal is the unmodified `sliceGraph` engine, a route slice naturally includes real Batch 5 edges like `navigation-destination-resolves-to-screen`/`compose-route-resolves-to-screen`, and a component slice naturally includes `manifest-component-resolves-to-source`/`component-has-intent-filter`/`component-uses-permission` — never invented edges.

### Compose selector (v1.11.0 Batch 4)

`slice` accepts `--composable <name>`, mutually exclusive with `--node` and the other slice-root selectors, resolved through the same root-resolution contract as `--android-route`/`--android-component` above (`not-found`/`ambiguous`/exactly-one, with `androidSelector: { mode: "composable", query, matchKind }` on success). The default `--composable` slice already includes every relationship the requested `--depth`/`--direction` reaches, including the composable's defining source (`defines-composable`), direct child composables (`composable-calls-composable`), and directly contained facts (`composable-has-fact`) — no special-casing needed, since these are ordinary `code-graph.json` edges.

```sh
npx @dailephd/my-dev-kit slice --index .my-dev-kit --composable "HomeScreen" --depth 2 --direction both --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --composable "HomeScreen" --include-viewmodel --include-navigation --depth 3 --direction both --json
```

Two optional modifiers, both requiring `--composable` (an error otherwise) and combinable together, extend traversal exactly the way `--include-prop-flow`/`--include-event-handlers` already extend a React slice: `sliceGraph`'s existing `includeEdgeKinds` mechanism runs a second, deeper additive pass restricted to a specific edge-kind allowlist, on top of (never instead of) the normal depth-bounded slice.

- `--include-viewmodel`: extends reachability along `composable-references-viewmodel` edges only — Batch 4's own directly-resolved ViewModel candidates (one edge per exact class-name match; every candidate preserved when ambiguous, none when unresolved). No repository/DAO/data-flow expansion.
- `--include-navigation`: extends reachability along `click-handler-contains-navigation-call` and `compose-navigation-targets-route` edges — the lexical click-to-navigation-call link, then the navigation call's own exact route candidate(s) from `android-navigation.json`. No runtime navigation-reachability claim.

## view

Render graph artifacts as DOT, SVG, or PNG. By default, `view` renders `code-graph.json`.

### Usage

```sh
npx @dailephd/my-dev-kit view --index <artifact-dir> --graph <selection> --format <dot|svg|png> --out <path>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--graph <code|data-model|model-view-lineage|react-component|react-flow|react-prop-event-flow|frontend-test|route|browser-storage|ui-reachability|android-module|android-manifest|android-navigation|compose-ui|compose-navigation|android-test>`: graph artifact to render. Defaults to `code`.
- `--format <dot|svg|png>`: output format.
- `--out <path>`: output path.
- `--edge-style <semantic|labeled|minimal>`: edge visualization style.
- `--allow-dot-fallback`: for SVG or PNG requests, write DOT instead of failing when Graphviz is unavailable.
- `--json`: print JSON result to stdout.

### Graph selection

Supported `--graph` values:

- `code`: renders the manifest-referenced `code-graph.json`.
- `data-model`: renders the manifest-referenced `data-model-graph.json`.
- `model-view-lineage`: renders the manifest-referenced `model-view-lineage.json`.
- `react-component`: renders a static React component graph from `frontend-semantic.json`. Nodes: file (box), exported component (box), local component (ellipse), prop type (diamond). Edges: `contains`, `renders`, `uses-props`.
- `react-flow`: renders all frontend flow facts from `frontend-semantic.json`. Nodes: component, local-component, hook, handler, JSX region, flow-fact. Edges: all extracted flow relationship kinds.
- `react-prop-event-flow`: renders only prop and event flow relationships from `frontend-semantic.json`. Same node types as `react-flow`, filtered to `react-passes-prop`, `react-fires-event`, `react-handles-event`, and `react-receives-prop` relationship kinds.
- `frontend-test`: renders frontend test structure from `frontend-semantic.json`. Only test files (`isTestFile=true`). Nodes: test-file (box), describe (box), test/it (ellipse), setup/teardown (oval), locator (diamond), route-string (oval).
- `route` (v1.3.0): renders the route reachability graph from `frontend-reachability.json`. Nodes: route, component, UI marker. Edges: `route-serves-component`, `route-reaches-ui`.
- `browser-storage` (v1.3.0): renders the browser storage graph from `frontend-reachability.json`. Nodes: storage key, component, UI marker. Edges: `component-uses-storage`, `storage-gates-ui`.
- `ui-reachability` (v1.3.0): renders the full UI reachability graph from `frontend-reachability.json`. Nodes: route, component, storage key, UI marker. Edges: all cross-domain reachability edge kinds.
- `android-module` (v1.10.0 Batch 6): renders the manifest-referenced `code-graph.json`, filtered to `android-module`/`android-source-set` nodes plus every node with a matching `androidModuleId`, expanded one hop across actual edges to pull in connected exact Kotlin/Java classes. Same artifact as `code`, different node/edge filter — not a new artifact.
- `android-manifest` (v1.10.0 Batch 6): renders `code-graph.json` filtered to `android-manifest-file`/`android-manifest-component`/`android-intent-filter`/`android-permission` nodes, expanded across actual `manifest-declares-component`/`manifest-component-resolves-to-source`/`component-has-intent-filter`/`component-uses-permission`/`manifest-uses-permission`/`manifest-deep-link-matches-navigation-deep-link` edges only. Every manifest XML attribute is not rendered as a node; candidate deep-link matches remain labeled as candidates, never a confirmed runtime link.
- `android-navigation` (v1.10.0 Batch 6): renders `code-graph.json` filtered to `android-navigation-graph`/`android-navigation-destination`/`android-navigation-action`/`android-navigation-deep-link`/`android-compose-route` nodes, expanded across actual `navigation-*`/`compose-route-resolves-to-screen`/`manifest-deep-link-matches-navigation-deep-link` edges only. Never simulates a runtime navigation-graph merge and never selects one action target — every static candidate stays a separate edge.
- `compose-ui` (v1.11.0 Batch 6): renders `code-graph.json` filtered to every `android-composable`/`android-compose-fact` node (state, effect, ViewModel reference, test tag, visible text, string resource, click handler, navigation call, and UI-region facts alike — distinguished by node label/shape and `androidMetadata.factKind`, not by a separate node kind per fact), expanded across `defines-composable`/`composable-calls-composable`/`composable-has-fact`/`composable-references-viewmodel`/`compose-string-references-resource` edges only, pulling in the composable's defining file/symbol and any exact ViewModel-symbol/resource-definition target an existing edge already connects. Excludes all Android test evidence and unrelated navigation/resource nodes by construction.
- `compose-navigation` (v1.11.0 Batch 6): renders the static chain `composable -> click-handler fact -> navigation-call fact -> route/destination candidate -> screen candidate`. Seeded from `android-composable` nodes plus only the click-handler/navigation-call `android-compose-fact` nodes (never the unrelated state/effect/test-tag/visible-text/string-resource facts on the same composable) and existing `android-compose-route`/`android-navigation-destination`/`android-navigation-graph` nodes, expanded across `defines-composable`/`composable-has-fact`/`click-handler-contains-navigation-call`/`compose-navigation-targets-route`/`navigation-graph-contains-destination`/`navigation-destination-resolves-to-screen`/`compose-route-resolves-to-screen` edges. Every ambiguous route/screen candidate is preserved as a separate node/edge — never a picked winner; an unresolved navigation call is still rendered with no outgoing target edge, never a fabricated one.
- `android-test` (v1.11.0 Batch 6): renders `code-graph.json` filtered to the full `android-test-file`/`android-test-class`/`android-test-method`/`android-test-fact` hierarchy (unit vs. instrumented, and every fact family — JUnit annotation, Compose rule, visible-text/test-tag assertion, route reference, fake/mock/stub/spy — distinguishable through node label/shape and `androidMetadata.factKind`/`category`), expanded across `defines-test-class`/`test-class-defines-method`/`test-class-uses-rule`/`test-method-has-fact`/`android-test-uses-double`/`android-test-references-composable`/`android-test-references-route`/`android-test-references-viewmodel` edges only, pulling in exact production composable/route/ViewModel-symbol nodes an existing edge already connects. Never includes every production Compose/navigation node, and never claims a test executed, passed, or covers a referenced node's behavior.

`--graph` is optional. The default is `code`.

The six Android graph modes (`android-module`, `android-manifest`, `android-navigation`, `compose-ui`, `compose-navigation`, `android-test`) render `code-graph.json` itself (the same artifact `--graph code` renders) filtered to the relevant node/edge subset — they require no additional manifest-referenced artifact, reparse no semantic artifact or source file at view time, and behave like `--graph code` on a non-Android (or Compose/test-evidence-free) project: an empty bounded graph, zero nodes, zero edges, exit 0 — not an error. None of the three v1.11.0 Batch 6 views (`compose-ui`, `compose-navigation`, `android-test`) currently render a legend, matching the exact same precedent the three v1.10.0 Batch 6 Android views already established (`buildRenderableDotGraph` only appends the edge legend for `--graph code`).

The three reachability graph modes (`route`, `browser-storage`, `ui-reachability`) require `manifest.json` to reference `frontendReachability`. When `frontend-reachability.json` is absent, `view` reports an error and exits non-zero (unlike `search`/`lookup`/`slice`/`source`, which return a graceful empty result at exit 0). These graphs record static evidence only; they do not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

The data-model and lineage graph modes require `manifest.json` to reference the corresponding artifact. The four frontend graph modes (`react-component`, `react-flow`, `react-prop-event-flow`, `frontend-test`) require `manifest.json` to reference `frontendSemantic`. `view` does not scan the directory for stale files.

Frontend graphs are separate from the code graph. They are rendered from `frontend-semantic.json` at command time and are not merged into `code-graph.json`, `data-model-graph.json`, or `model-view-lineage.json`.

### Graphviz behavior

- DOT output does not require Graphviz.
- SVG output requires the Graphviz `dot` executable.
- PNG output requires the Graphviz `dot` executable.
- If Graphviz is unavailable and `--allow-dot-fallback` is used, DOT is written instead of the requested SVG or PNG.

### Examples

Render the default code graph:

```sh
npx @dailephd/my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/code.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph code --format dot --out .my-dev-kit/code.dot --json
```

Render the data-model graph:

```sh
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph data-model --format dot --out .my-dev-kit/data-model.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph data-model --format svg --out .my-dev-kit/data-model.svg --allow-dot-fallback --json
```

Render model-to-view lineage:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --trace-view User --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph model-view-lineage --format dot --out .my-dev-kit/lineage.dot --json
```

Render frontend graphs (requires TSX/JSX files in the index):

```sh
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-component --format dot --out .my-dev-kit/react-component.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-flow --format dot --out .my-dev-kit/react-flow.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-prop-event-flow --format dot --out .my-dev-kit/react-prop-event-flow.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph frontend-test --format dot --out .my-dev-kit/frontend-test.dot --json
```

All four frontend graph views render static artifact-backed graphs. They do not claim runtime React behavior, route reachability, or browser-state behavior.

Render reachability graphs (v1.3.0, requires `frontend-reachability.json` in the index):

```sh
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph route --format dot --out .my-dev-kit/route.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph browser-storage --format dot --out .my-dev-kit/browser-storage.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph ui-reachability --format dot --out .my-dev-kit/ui-reachability.dot --json
```

The reachability graph views render static evidence from `frontend-reachability.json`. They do not execute the app, run the browser, prove a route is reachable by any user, or prove a UI element is visible at runtime.

## data-model

Inspect or regenerate data-model artifacts from an existing index.

The `data-model` command is a focused inspection and regeneration command. It consumes artifacts written by `index`. It does not replace `index`, modify source files, or alter `code-graph.json`.

When `index` runs, it already produces `data-model.json` and `data-model-graph.json` through the built-in semantic analyzers. Use `data-model` when you want to inspect specific entities or fields, run trace-view for an entity, or regenerate data-model artifacts with a different `--out` directory.

### Usage

Inspect an exact entity from existing data-model artifacts:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --entity <name-or-id> --json
```

Inspect an exact field from existing data-model artifacts:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --field <entity.field> --json
```

Regenerate data-model artifacts from the index:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --out <artifact-dir> --json
```

Trace static model-to-view lineage for an entity:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --trace-view <entity> --json
```

Trace static model-to-view lineage for an exact field:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --field <entity.field> --trace-view --json
```

### Flags

- `--index <dir>`: required. Directory containing `manifest.json`, `symbol-index.json`, and `code-graph.json`.
- `--out <dir>`: output directory for generated `data-model` and lineage artifacts. Defaults to `--index`.
- `--entity <name-or-id>`: inspect an exact entity from existing `data-model.json`.
- `--field <entity.field>`: inspect an exact field from existing `data-model.json`.
- `--trace-view [entity]`: build conservative static model-to-view lineage for an entity or for the field selected with `--field`.
- `--json`: print compact JSON output.

### Generation mode

Generation mode reads the index and writes:

- `data-model.json`
- `data-model-graph.json`

Output summary fields include:

- `status`
- `mode`
- `indexDir`
- `outDir`
- `dataModelPath`
- `dataModelGraphPath`
- `entityCount`
- `fieldCount`
- `relationshipCount`
- `graphNodeCount`
- `graphEdgeCount`
- `warningCount`
- `warnings`

Warnings do not fail the command by themselves. Unsupported or ambiguous extraction cases are reported conservatively.

### Lookup mode

Lookup mode reads existing `data-model.json` and `data-model-graph.json`.

Entity lookup:

- exact by entity name
- exact by stable entity ID
- no fuzzy matching

Field lookup:

- exact `Entity.field` selector only
- returns the parent entity and selected field

### Trace-view mode

Trace mode builds conservative static lineage from data-model artifacts plus indexed TypeScript or TSX source evidence.

Trace mode writes:

- `model-view-lineage.json`

### Mode rules

- `--index` is always required.
- `--entity` cannot be combined with `--trace-view`.
- `--entity` and `--field` cannot be combined.
- `--field` lookup uses exact `Entity.field` syntax only.
- `--field <entity.field> --trace-view` requires the bare `--trace-view` flag.
- `--trace-view <entity>` requires an entity value when `--field` is not used.

### Supported extraction behavior

The current extractor is conservative and TypeScript-focused. It supports:

- exported interfaces with property signatures
- exported type aliases whose right side is an object literal type
- exported classes with property declarations
- exact entity and field inspection over generated artifacts
- conservative static lineage where field identity remains explicit in the same file or directly connected local evidence

### Known limitations

- The data-model extractor does not support Prisma, SQL, Django, SQLAlchemy, TypeORM, or Sequelize.
- Data-model artifacts are separate from `code-graph.json`.
- The data-model graph is separate from the code graph and uses its own node and edge IDs.
- Model-to-view lineage is static evidence only. It does not claim runtime rendering, route reachability, browser-state behavior, or full React render-flow understanding.
- Unsupported patterns such as dynamic property access, spread props, computed property names, and unresolved indirect calls are reported as warnings or omitted conservatively.
- Lookup mode requires existing `data-model` artifacts.

### Examples

Inspect an entity after running `index`:

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --entity User --json
```

Inspect a field:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --field User.email --json
```

Trace an entity into conservative static view usage:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --trace-view User --json
```

Trace a field into conservative static view usage:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --field User.email --trace-view --json
```

Regenerate data-model artifacts explicitly:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

## context

Write a bounded, local, deterministic context capsule for a query against an existing index.

`context` is a **v1.6.0 command**. It is local and deterministic:

- It does not call an LLM.
- It does not make network requests.
- It does not edit or execute project source code.
- It does not replace my-dev-kit-orchestrator or any staged workflow tool.

`context` performs deterministic query planning and single-seed, graph-focused candidate selection: it normalizes the query, extracts structured query terms, ranks candidate files and graph nodes using the existing `search` engine, selects **at most one** primary focus node/file, and builds a bounded graph neighborhood around that focus using the same traversal as `slice`. It respects the persisted `--max-candidate-files`, `--max-graph-nodes`, and `--max-graph-edges` limits, and records ambiguity notes and lowers confidence/adequacy when a single focus cannot be selected with certainty, rather than guessing.

`context` also attaches **bounded, content-free source evidence** around the selected focus and graph neighborhood (file path + line range only, never file content), at most one optional local-dependency source bundle for a symbol-kind focus, and compact semantic/classification/artifact-reference summaries - all pruned into `requiredContext`/`optionalSupportContext`/`droppedContext`. Source evidence is enabled by default and bounded by `--max-source-slices`; `--no-source` skips slices and bundles while retaining graph and metadata evidence.

The three modes apply only small deterministic ranking adjustments: `general` preserves balanced baseline ranking, `feature-add` lightly prefers statically safe/inspect-first implementation evidence and nearby tests over docs-only evidence, and `subsystem` lightly prefers the strongest candidate's path cluster. Static conflict detection is deliberately narrow: it reports a conflict only when a selected restrictive edit target and a near-tied safe/inspect-first candidate have explicit incompatible classification guidance. It does not infer runtime behavior or turn ordinary ambiguity into a conflict.

### Usage

```sh
npx @dailephd/my-dev-kit context --index <artifact-dir> --query "<task>" --out <path> --json
```

Also write a retrieval audit record:

```sh
npx @dailephd/my-dev-kit context --index <artifact-dir> --query "<task>" --out <path> --audit-out <path> --json
```

When `--audit-out` is supplied, the command builds both artifacts in memory and validates their duplicated repository/index identity and readiness summaries before writing either file. A contract mismatch fails nonzero with `RAW_EVIDENCE_PARITY_MISMATCH`; it never silently chooses one artifact as authoritative. The audit remains bounded and does not duplicate capsule-only evidence.

### Flags

- `--index <dir>`: index artifact directory. Defaults to `.my-dev-kit`.
- `--query <text>`: required. The task query to record in the capsule.
- `--out <path>`: required. Where to write `context-capsule.json`.
- `--audit-out <path>`: optional. Where to write `retrieval-audit-record.json`.
- `--mode <general|feature-add|subsystem>`: optional, defaults to `general`. Applies only the small deterministic ranking adjustments described above; it never changes caps, source breadth, graph depth, or single-seed focus.
- `--max-candidate-files <n>`: optional positive integer. Caps the retained `candidateFiles` entries; entries beyond the cap are recorded as dropped with reason `cap exceeded (--max-candidate-files)`.
- `--max-source-slices <n>`: optional positive integer, defaults to 8 when omitted. Caps `selectedSource.slices`; the primary focus node's slice is always retained first, then selected graph neighbors up to the cap.
- `--max-graph-nodes <n>`, `--max-graph-edges <n>`: optional positive integers. Cap `selectedGraph.nodes`/`selectedGraph.edges` around the primary focus node; the focus node itself is never dropped by the node cap.
- `--no-source`: disable source slices and source bundles. Semantic/classification summaries remain enabled, and adequacy records that source was intentionally disabled.
- `--role <architecture|implementation|test-implementation>`: optional, no default (**v1.10.1 Batch 1**; role-aware candidate behavior implemented in **Batch 2**). Orthogonal to `--mode`; recorded in `request.role` and never overwrites/is overwritten by mode. See "v1.10.1 Batch 2" below.
- `--request <path>`: optional (**v1.10.1 Batch 1**). A structured `ContextRequest` JSON file; see "v1.10.1 Batch 1: request-file and context-role contracts" and "v1.10.1 Batch 2" below.
- `--json`: print the written capsule (and audit record path, when produced) as JSON to stdout.

### Output

`context-capsule.json` includes `schemaVersion`, `generatedAt`, `tool`, `request`, `index`, `limits`, `requiredContext`, `optionalSupportContext`, `droppedContext`, `warnings`, `deferredRequestFields`, `roleContext`, `contextAdequacy`, `queryPlan`, `candidateFiles`, `candidateNodes`, `focus`, `selectedGraph`, `retention`, `selectedSource`, `selectedSourceBundles`, `semanticSummary`, `classificationSummary`, `artifactReferenceSummary`, `pruning`, `conflicts`, `modeEffects`, and `sourceControl`. Version 1.10.4 output also includes the additive `roleConditionCoverage` array described below.

- `request.role` (**v1.10.1 Batch 1**) is `architecture`/`implementation`/`test-implementation`, or `null` for a legacy invocation. `request.requestFilePath` is the `--request` file path used, or `null`.
- `deferredRequestFields` (**v1.10.1 Batch 1**; narrowed in **Batch 2**) names any `ContextRequest` fields that were supplied, validated, and normalized but are not yet operational; always `[]` for a legacy invocation. Each deferred field also produces a matching entry in `warnings`.
- `roleContext` (**v1.10.1 Batch 2**) is the operational role/focus/changed-surface summary — see "v1.10.1 Batch 2" below. Present (with `role: null` and empty focus/changed-surface) even for legacy invocations.
- `queryPlan` includes the normalized query and deterministic structured terms (raw, quoted phrases, path-like, symbol-like, route-like, command-like, artifact-like, classification-like).
- `candidateFiles`/`candidateNodes` include ranked, explained candidates (`score`, `reasons`, `matchedTerms`, `retained`, `droppedReason` when dropped), plus optional Batch 2 role-ranking metadata (`roleScoreAdjustment`, `contextRole`, `focusMatch`, `changedSurfaceMatch`, `changedStatus`) when a role/focus/changed-surface adjustment applied.
- `focus` records **at most one** primary focus node/file (`focusNodeId`, `focusFilePath`, `selectionMode`, `confidence`, `reasons`, `ambiguityNotes`). `focusNodeId` is `null` when no candidate is safe to select.
- `selectedGraph` is a bounded neighborhood (`nodes`, `edges`, `omittedNodeCount`, `omittedEdgeCount`) around the focus node, built the same way `slice` builds a neighborhood.
- `selectedSource` lists bounded, **content-free** source slices (`filePath`, `startLine`, `endLine`, `reason`, `sourceRetrievalMethod`, `truncated`, `continuationUsed`) around the focus node and selected graph neighbors, capped by `--max-source-slices`.
- `selectedSourceBundles` contains **at most one** local-dependency source bundle (built the same way `source`'s bundle mode works) for a symbol-kind focus, with content-free block metadata only.
- `semanticSummary`/`classificationSummary` compactly pass through already-present semantic roles, artifact refs, evidence refs, and (when `classification.json` is registered) edit guidance/readiness/risk labels/uncertainty for the focus, graph, and retained candidates - never a raw artifact dump. Both report `available: false` with a reason instead of crashing when the underlying data is absent.
- `artifactReferenceSummary` lists each artifact the manifest knows about (`symbolIndex`, `codeGraph`, `dataModel`, `classification`, etc.) with an `available` flag and a reason.
- `retention`/`pruning` summarize retained/dropped counts for candidates, graph evidence, and (as of Batch 3) source slices/bundles, plus the cap settings applied.
- `modeEffects` records every non-zero adjustment and reason. `sourceControl` records default-enabled or intentional disablement. `conflicts` contains only conservative static edit-guidance conflicts and is normally empty.
- `contextAdequacy.status` reflects candidate/focus/graph/source/metadata sufficiency and explicit conflicts. `--no-source` becomes a listed assumption rather than a retrieval failure. A detected static conflict uses `context conflict found and user or upstream stage decision required`.

`retrieval-audit-record.json` (when `--audit-out` is provided) includes `schemaVersion`, `generatedAt`, `tool`, `request`, `index`, `steps`, `fallbacks`, `fullFileReadRecommendations`, `warnings`, `roleContext` (**v1.10.1 Batch 2**), `contextAdequacy`, and (**v1.10.1 Batch 4**) `responsibilityMappings`/`roleAdequacy`/`freshness`/`budget`/`truncation`/`fullFileFallback`/`provenance`. Version 1.10.4 output carries the same `roleConditionCoverage` as the capsule. The ordered step sequence contains the v1.6-era source-evidence generation steps, `apply-mode-ranking-adjustment`, `resolve-focus`/`merge-changed-surface`/`apply-role-ranking` (**v1.10.1 Batch 2**, between ranking and focus selection), `build-evidence-groups`/`discover-test-infrastructure`/`derive-test-commands` (**v1.10.1 Batch 3**, immediately after), `skip-source-evidence`, `detect-context-conflicts`, `update-context-adequacy`, and `map-responsibilities`/`classify-freshness`/`apply-budget`/`evaluate-adequacy`/`record-provenance` (**v1.10.1 Batch 4**, immediately after `update-context-adequacy`). Every step contains a stable id/kind, description, inputs, outputs, status, and warnings. Full-file recommendations are normally empty.

### Android integration (v1.10.0 Batch 6)

`context` has no new Android-specific command or flag. It becomes Android-aware for a normal query because Batch 5's compact `android-*` code-graph nodes are now eligible for the exact same generic candidate pool `search --query` already ranks: a query like `"Where is the home route defined and which screen handles it?"` can rank an `android-navigation-destination` node above unrelated files, select it as `focus`, expand `selectedGraph` across real Batch 5 relationships (e.g. `navigation-destination-resolves-to-screen` pulling in the exact Kotlin/Java screen class), and attach a bounded source excerpt for it in `selectedSource.slices` — using the same ranking, graph-expansion, and source-selection code paths as any file/symbol candidate, not a second ranking model.

`candidateNodes[].kind` may now be a compact `android-*` kind (in addition to `file`/`symbol`); such entries additionally carry `androidArtifactId`/`androidMetadata` when present. `retrieval-audit-record.json`'s existing `run-search` step already records Android candidate selection/scoring, since it is the same generic search step used for every query — no separate Android audit step or file was added.

Static-analysis limitation: an Android node selected into a capsule is static evidence only — the same boundaries documented for `search`/`lookup`/`source`/`slice`'s Android selectors apply (no runtime component/route/permission claims).

Both artifacts are compatible with indexes that do not have `classification.json` registered.

### Known limitations

- Focus selection is **single-seed only**: never more than one `focusNodeId`. Multi-seed focus is deferred to a later v1.6 batch.
- Mode behavior is intentionally limited to small ranking adjustments; it does not implement broad workflow policy.
- Source continuation is limited to **one bounded window**, for the primary focus slice only. Local dependency expansion happens only through the one optional source bundle - there is no separate slice-level expansion mechanism.
- Conflict detection requires explicit incompatible static edit guidance on near-tied candidates; runtime, browser, and intent conflicts remain outside its scope.
- `my-dev-kit` produces artifacts only. It does not run `my-dev-kit-orchestrator`, call LLMs, edit source files, execute applications, validate security, or publish releases.

### Examples

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit context --index .my-dev-kit --query "add a sibling data model field" --out .my-dev-kit/context-capsule.json --audit-out .my-dev-kit/retrieval-audit-record.json --mode feature-add --max-candidate-files 8 --max-graph-nodes 30 --max-graph-edges 50 --json
```

### v1.10.1 Batch 1: request-file and context-role contracts

**Shipped in v1.10.1 Batch 1.** `--request <path>` and `--role <role>` are additive; every pre-1.10.1 invocation of `context` continues to work identically without them.

```sh
npx @dailephd/my-dev-kit context --index <artifact-dir> --request <request.json> --json
npx @dailephd/my-dev-kit context --index <artifact-dir> --query "<task>" --role implementation --out <path> --json
```

`--request <path>` supplies a versioned `ContextRequest` JSON document:

```json
{
  "schemaVersion": "1.0.0",
  "role": "implementation",
  "query": "add a sibling data model field",
  "mode": "feature-add",
  "focusFiles": ["src/models/user.ts"]
}
```

- `schemaVersion` (required) and `query` (required) are validated; only major `1` is accepted for `schemaVersion`.
- `role`, `mode`, `index`, `root`, `output`, `auditOutput` are optional scalars. When the same field is also supplied on the CLI, equivalent normalized values are accepted and conflicting values fail with a diagnostic naming both sources; when only one source supplies a field, that value is used.
- `root` (without `index`) resolves to `<root>/.my-dev-kit`, matching `index`'s own default index-directory convention; supplying both `index` and a `root` that implies a different index fails.
- `focusFiles`, `focusSymbols`, `changedFiles`, `changedSymbols`, `beforeIndex`, `afterIndex`, and `requestedEvidenceKinds` are validated and deterministically normalized (arrays are deduplicated and sorted); **as of Batch 2 these fields are operational** — see "v1.10.1 Batch 2" below. `upstreamArtifactRefs`, `testResponsibilityRefs`, and `limits` remain validated/normalized but not yet operational, and are still named in the written capsule's `deferredRequestFields` with a matching warning.
- `requestedEvidenceKinds` entries must be one of a fixed, documented set (`owner`, `dependencies`, `contracts`, `validators`, `constants`, `errors`, `schemas`, `callers`, `callees`, `closest-tests`, `test-infrastructure`, `test-commands`, `changed-surface`, `responsibility-mappings`); an unrecognized entry fails clearly rather than being silently accepted.
- `limits` is a distinct, forward-looking contract (`candidates`, `graphDepth`, `files`, `symbols`, `sourceRanges`, `sourceLinesPerRange`, `characters`, `evidenceGroupEntries`, `fullFileFallbacks`, `responsibilityMappings`) from the existing operational `--max-candidate-files`/`--max-source-slices`/`--max-graph-nodes`/`--max-graph-edges` flags, which remain the only limits Batch 1 enforces. Each `limits` field must be a non-negative integer.

`--role <architecture|implementation|test-implementation>` is a CLI equivalent to the request file's `role` field, subject to the same conflict rules. Role is orthogonal to `--mode`/`mode`: neither overwrites the other, and an unrecognized role value (from either source) fails clearly.

Malformed JSON, a missing `--request` file, an unsupported `schemaVersion` major, an unknown role/evidence kind, an invalid field type, and invalid `limits` all fail before any capsule or audit file is written — there is no partial output on a validation failure.

**Batch 1 boundary:** role-aware ranking and changed-surface intake arrived in Batch 2; evidence groups and test-infrastructure discovery arrived in Batch 3; responsibility mapping, role adequacy, freshness, and operational responsibility limits arrived in Batch 4. `testResponsibilityRefs` and `limits` were validated but deferred in Batch 1 and are operational in the final v1.10.1 implementation.

### v1.10.1 Batch 2: role-aware candidate generation and changed-surface ranking

**Shipped in v1.10.1 Batch 2.** Additive to Batch 1's contracts and the existing `context` pipeline — no new search engine, ranking pipeline, graph traversal, or graph-diff implementation was introduced.

- **`role` now changes candidate priorities.** `architecture` favors owner-like candidates (command handlers, registries/dispatchers, adapters, analyzers, builders) and public contracts. `implementation` favors an exact focus symbol, its direct dependencies, and validator/schema/error/constant contracts. `test-implementation` favors changed production files/symbols (from `changedFiles`/`changedSymbols`/`beforeIndex`+`afterIndex`) and their closest tests, and warns (rather than silently proceeding as if nothing changed) when no changed-surface input is supplied at all. A request without `role` is byte-for-byte unchanged from Batch 1/v1.10.0.
- **`focusFiles`/`focusSymbols` are now resolved** against the active index. A resolved focus file contributes its contained symbols as bounded candidates; an unresolved focus file/symbol is reported in `roleContext.focus.unresolvedFocusFiles`/`unresolvedFocusSymbols` (never invented). A focus symbol given as a stable ID (`symbol:<path>#<name>`) resolves exactly; a simple name that matches more than one symbol stays ambiguous (`roleContext.focus.ambiguousFocusSymbols`) rather than guessing.
- **`changedFiles`/`changedSymbols`/`beforeIndex`/`afterIndex` are now operational.** Caller-supplied changed files/symbols and a `beforeIndex`/`afterIndex` graph diff (reusing the existing `graph-diff` symbol-index comparison, not a second comparison) are merged into one deterministic `roleContext.changedSurface` model with a `status` (`added`/`modified`/`removed`/`unknown`) and `provenance` (`caller`/`graph-diff`/`both`) per entry. Removed symbols are preserved as changed-surface evidence, never discarded. `beforeIndex`/`afterIndex` must be supplied together; an incompatible symbol-index schema version between the two fails clearly, matching `graph-diff`'s existing compatibility contract.
- **`requestedEvidenceKinds` now constrains/prioritizes** the Batch 2 candidate categories it can express (`owner`, `dependencies`, `contracts`, `validators`, `constants`, `errors`, `schemas`, `callers`, `callees`, `closest-tests`, `changed-surface`). Kinds still owned by a later batch (`test-infrastructure`, `test-commands`, `responsibility-mappings`) are accepted but reported in `roleContext.unsupportedRequestedEvidenceKinds` with a warning, and never influence selection.
- **Additive metadata only.** `candidateFiles[]`/`candidateNodes[]` gained optional `roleScoreAdjustment`, `contextRole`, `focusMatch`, `changedSurfaceMatch`, and `changedStatus` fields (absent for legacy candidates). The capsule and retrieval audit both gained an additive `roleContext` object (`role`, `focus`, `changedSurface`, `requestedEvidenceKinds`, `unsupportedRequestedEvidenceKinds`, `warnings`). No existing field's meaning changed, and the schema major did not change.
- **Ranking stays deterministic and bounded.** Role/focus/changed-surface adjustments never bypass `--max-candidate-files`, `--max-graph-nodes`/`--max-graph-edges`, or `--max-source-slices`; ties still break on stable candidate ID/path, never insertion order.

**Batch 2 boundary:** evidence groups and test-infrastructure discovery followed in Batch 3; responsibility mapping, role adequacy, freshness, and the final limits contract followed in Batch 4.

### v1.10.1 Batch 3: evidence groups and bounded test-infrastructure discovery

**Shipped in v1.10.1 Batch 3.** Additive to Batch 1/2's contracts and the existing `context` pipeline — no new context engine, ranking pipeline, index artifact, or graph implementation was introduced. Reuses Batch 2's role-ranked candidates, the existing selected graph neighborhood, and the existing changed-surface model.

- **`evidenceGroups[]`** organizes role-ranked evidence into deterministic, bounded, named groups. `architecture`: `owners`, `extension-points`, `contracts`, `graph-neighborhood`, `architecture-tests`. `implementation`: `owners`, `dependencies`, `callers-and-callees`, `contracts`, `validators-and-constants`, `errors`, `schemas-and-serializers`, `compatibility-surfaces`, `closest-tests`. `test-implementation`: `changed-surface`, `production-symbols`, `validators-and-boundaries`, `errors-and-side-effects`, `related-tests`, `fixtures`, `factories`, `mocks`, `setup-and-configuration`, `test-commands`. Group order and item order (score, then path/nodeId) are deterministic; a request with no `role` keeps `evidenceGroups: []`, matching Batch 1/2's legacy behavior exactly. Each group carries `limit`/`availableCount`/`usedCount`/`truncated`/`droppedCount` for auditable, deterministic (sort-before-truncate) caps.
- **`selectedOwners`/`selectedContracts`/`selectedTests`** are deduplicated cross-group rollups of owner-like, contract-like, and test evidence respectively. **`groupTruncation`** mirrors every group's cap/truncation state at the capsule root for quick inspection.
- **`testInfrastructure`** reports bounded, conservative discovery of `relatedTests`, `fixtures`, `factories`, `mocks`, `setupFiles`, `testConfigurations`, `packageScripts`, `testCommands`, and `unresolved` entries. Because the existing indexer excludes `.test.`/`.spec.` paths from the symbol index/code graph by default (unchanged v1.10.0 behavior), related-test discovery performs a bounded, read-only directory walk of the index's own `sourceRoots` plus a lightweight, bounded, regex-based import-specifier scan (never executes or evaluates the scanned file) — not a second index. A test file becomes "related" only when it imports a file or named symbol of interest, never merely for its path; a fixture/factory/mock is only reported when a discovered related test imports it, and a `builder`/`factory`-named production file outside any test-scoped path is never misclassified as a test factory.
- **Vitest test configuration** (`vitest.config.*`/`vite.config.*` with a `test:` block) is parsed for `include`/`exclude`/`setupFiles`/`testTimeout`/`hookTimeout`/`maxWorkers`/`environment` via bounded regex extraction (the file is never evaluated as code). Other detected config files (`jest.config.*`, `.mocharc*`, `pytest.ini`, `tox.ini`) are reported with `supported: false` plus a warning, never silently treated as understood. Multiple detected configuration files are all reported — ambiguity is preserved, never arbitrarily narrowed to one.
- **Package scripts and exact test commands.** `packageScripts[]` lists `package.json` scripts matching a test/verification-relevant naming convention (`test*`, `typecheck`, `build`, `verify`, `docs*`, `benchmark*`, `security*`) — not every script. `testCommands[]` always includes the verbatim `test` script (scope `full-project`) when one exists, plus a file/suite-scoped `<test script> <related test file(s)>` command when at least one related test was discovered and the script matches a supported runner invocation (`vitest run`). A missing test script, no discovered related test, or an unsupported runner produces an `unresolved` entry rather than an invented command.
- **`requestedEvidenceKinds` `test-infrastructure` and `test-commands` are now operational** (previously deferred in Batch 2): requesting either prioritizes and exposes the matching evidence for any role, including `architecture`/`implementation`. `responsibility-mappings` remains the only `requestedEvidenceKinds` value still reported in `roleContext.unsupportedRequestedEvidenceKinds`.
- **Additive audit steps.** The retrieval audit gained `build-evidence-groups`, `discover-test-infrastructure`, and `derive-test-commands` steps between `record-retained-and-dropped-context` and `derive-source-targets`; no existing audit step's meaning changed.

**Batch 3 boundary:** Batch 4 completed test-responsibility mapping, role-specific adequacy, freshness, and the final limits contract.

### v1.10.1 Batch 4: responsibility mapping, adequacy, freshness, budget/truncation, full-file fallback, and provenance

**Shipped in v1.10.1 Batch 4.** Additive to Batches 1-3's contracts and pipeline — no new context engine, ranking pipeline, evidence-group builder, test-infrastructure discovery, artifact family, or second capsule/audit was introduced. Everything below reads and extends what Batches 1-3 already produce.

- **`testResponsibilityRefs` and `requestedEvidenceKinds: ['responsibility-mappings']` are now operational.** Each supplied ID (the current `ContextRequest.testResponsibilityRefs` contract is `string[]`) becomes a `responsibilityMappings.mappings[]` entry grounded only in explicit static evidence already produced by Batches 2/3 (changed/focus symbols, evidence-group membership, bounded test-infrastructure discovery) — never LLM reasoning, embedding similarity, or fuzzy filename matching. `mappingStatus` is `mapped` (every required evidence category grounded), `partially-mapped` (some grounded), `unmapped` (none grounded), or `not-applicable` (only ever from an explicit caller flag, never inferred). Duplicate IDs are rejected (first occurrence wins, reported in `duplicateResponsibilityIds`); unknown/unresolvable IDs are reported in `unknownResponsibilityIds`, never silently dropped. `limits` and `testResponsibilityRefs` are removed from `deferredRequestFields`; `responsibility-mappings` is removed from `unsupportedRequestedEvidenceKinds` — no `requestedEvidenceKinds` value remains deferred.
- **Criticality.** `criticality` (`critical`/`noncritical`) is caller-supplied per responsibility; the current string-only `testResponsibilityRefs` contract cannot express it, so every responsibility defaults to `noncritical` (the documented safe default — never inferred from prose). A critical, unmapped responsibility always makes the role inadequate; a noncritical gap only warns.
- **`roleAdequacy`** extends — never replaces — the existing (Batch 1) `contextAdequacy`. It reports `role`, `status` (reusing `ContextAdequacyStatus`), `requiredConditions`/`satisfiedConditions`/`missingConditions`/`blockingConditions`, `supportingEvidence`, `affectedResponsibilityIds`, and `truncationImpact`/`freshnessImpact`. Architecture requires a plausible owner and relevant contract/extension-point evidence; implementation additionally requires contract evidence and no critical unresolved requirement; test-implementation additionally requires changed-surface evidence, a related-test-or-explicit-missing-test state, and every critical responsibility mapped. A request with no `role` carries `contextAdequacy.status` forward unchanged and reports role adequacy as not applicable.
- **`freshness`** classifies `fresh`/`stale`/`unknown`. `fresh` only when the active `--index`/`index` matches a supplied `afterIndex`; `stale` only when it matches a supplied `beforeIndex` while relevant changed-surface evidence exists; otherwise `unknown` — never fabricated as `fresh`. `git rev-parse HEAD` is read read-only, optionally, and is wrapped so a missing/absent Git never throws; it is recorded as informational evidence only (the index manifest does not yet record a repository commit to compare it against).
- **`budget`/`truncation`.** `budget.limits[]` reports declared-vs-used values for `candidates`, `graphDepth`/graph nodes, `sourceRanges`, `sourceLinesPerRange`, `evidenceGroupEntries`, and `responsibilityMappings` from `ContextRequestLimits`, without overriding the existing `--max-*`/`ContextCapsuleLimits` boundary (both are reported side by side, never silently merged). `budget.characters` reports a deterministic serialized-evidence character measurement against `limits.characters` when supplied (never an exact-token claim). `truncation.records[]` rolls up per-group and responsibility-mapping truncation with `droppedCount`, `requiredEvidenceLost`, and `adequacyImpact`. Responsibility-mapping truncation is deterministically critical-first: a critical responsibility can only be dropped once every critical one already exceeds the limit, so a noncritical-only truncation is reported (never hidden) but does not by itself reduce adequacy.
- **`fullFileFallback`** extends the existing bounded source-selection/continuation model. For contract/validator/error evidence a responsibility mapping needed but no selected source slice covered, one bounded whole-file read is attempted (line/character counts recorded, never the file content itself). `limits.fullFileFallbacks = 0` disables fallback entirely — the need is still reported as an honest, disallowed fallback record, never silently omitted. A positive value caps the fallback count deterministically (sorted by file path); the cap can never be exceeded.
- **`provenance[]`** deterministically classifies and deduplicates every owner/contract/test/changed-surface/responsibility-mapping evidence item into a stable category (`caller-changed-file`, `graph-diff`, `code-graph`, `import-scan`, `test-configuration`, `package-json`, etc.) with a deterministic ID. Evidence appearing via more than one source merges its provenance (preserving every distinct relationship basis) rather than duplicating the evidence item.
- **Additive audit steps.** The retrieval audit gained `map-responsibilities`, `classify-freshness`, `apply-budget`, `evaluate-adequacy`, and `record-provenance` steps after `update-context-adequacy`; no existing audit step's meaning changed. The retrieval audit now also carries the real computed `contextAdequacy`/`responsibilityMappings`/`roleAdequacy`/`freshness`/`budget`/`truncation`/`fullFileFallback`/`provenance` (earlier-batch correction: the audit's `contextAdequacy` was previously never passed through from the capsule's real verdict — a hardcoded Batch 1 stub was always written instead — fixed as part of this batch's wiring).

**Not implemented:** LLM-based mapping or adequacy, subjective assertion-quality scoring, automatic test generation, and automatic test execution during retrieval remain outside the `context` command's scope.

### v1.10.3 implementation-role readiness corrections (shipped)

Newly generated capsule/audit pairs share one canonical identity sourced from the validated active index manifest. Both `index` objects contain the same `indexPath`, `manifestPath`, `manifestSchemaVersion`, and `projectRoot`; before/after paths remain represented identically in `freshness.comparedIdentities`. Paths use stable forward-slash serialization, preserve POSIX case, and are not compared by basename or suffix. Old supported-major audits without the additive repository fields remain readable but cannot prove repository identity to an identity-sensitive consumer.

These additive corrections are part of the published v1.10.3 package:

- **Owner eligibility:** an implementation owner needs request relevance plus independent structural evidence. Exported production symbols, contract/canonical-type shape, classification, or a graph producer relationship can qualify a neutral filename. Focus or owner-like naming alone cannot qualify a file, and test, fixture, generated, projection-only, view-only, or unrelated leaf evidence is excluded without independent structural support.
- **Required-first allocation:** each required implementation evidence group starts with its existing reservation. Unused reservation spills in fixed group priority to required groups with remaining qualified evidence. Selection stays within the finite sum of all participating reservations; demand beyond that bound is reported as required truncation and reduces role adequacy.
- **Allocation diagnostics:** implementation-role `groupTruncation[]` entries may add `required`, `reservation`, `initiallySelectedCount`, `unusedReservationContributed`, `borrowedCapacity`, `requiredOmittedCount`, `optionalOmittedCount`, `adequacyAffected`, `governingHardBound`, `aggregateCapacityUsed`, and `aggregateCapacityRemaining`. These fields are optional and additive. `limits.evidenceGroupEntries` remains reporting-only and is not a request-level hard selector.
- **Responsibility IDs:** `testResponsibilityRefs` keeps the caller's sequence through request normalization. Responsibility mapping emits one mapping per unique ID in first-occurrence order; `duplicateResponsibilityIds` reports each repeated ID once in first-duplicate-occurrence order. `unknownResponsibilityIds` and mapping status remain independent, so an ID can be both unknown/unmapped and duplicated without either diagnostic disappearing.
- **Directed file evidence:** plain file evidence retains its repository-relative evidence item ID but uses canonical `file:<path>` graph-node identity to classify dependency versus caller edges. Symbol evidence continues to use its symbol node ID. Capsule and retrieval-audit summaries use the same computed results.

The request schema major remains `1`, output schema version remains `"1.0.0"`, and the command syntax, modes, roles, evidence-kind vocabulary, and legacy behavior are unchanged. This correction does not add responsibility criticality to `testResponsibilityRefs`, runtime proof, LLM owner selection, source editing, or automatic orchestrator integration.

### v1.10.4 condition-aware adequacy corrections

The command has no new flag. Version 1.10.4 output adds deterministic condition coverage for the required implementation owner and required contract and writes the same result to the capsule and audit.

- `roleConditionCoverage[]` reports stable `conditionId`, associated `evidenceGroupIds`, `witnessPolicy`, required/available/retained witness counts, stable retained witness IDs, satisfaction, and allocation-caused loss.
- `groupTruncation[].requiredOmittedCount` now counts only the minimum required witness deficit caused by bounded allocation. `optionalOmittedCount` accounts for every remaining dropped candidate, including surplus owner/contract evidence and compatibility-surface overflow with no required compatibility condition.
- `truncation.truncated` still reports any bounded omission. The additive `truncation.requiredEvidenceLost` is true only when a record reports actual required-condition or critical-responsibility loss.
- Implementation `roleAdequacy` may be `context sufficient with listed assumptions` while optional truncation is present. Missing owner/contract candidates, stale evidence, critical responsibility failures, and allocation that loses the last adequate required witness remain inadequate.
- Missing candidates and lost candidates are distinct: an unavailable condition is inadequate but is not labeled truncation-caused required loss.
- Current implementation-role generation supplies nonempty coverage. Missing or empty current coverage fails closed. Legacy callers and schema-major-1 artifact pairs without both additive fields remain conservatively compatible; one-sided absence or disagreement fails raw-evidence parity.

Consumers should inspect `roleAdequacy`, `truncation.requiredEvidenceLost`, and the condition-specific diagnostics. General `truncation.truncated` alone does not establish inadequacy. Version 1.10.4 reports the corrected behavior while preserving the existing command contract.

## graph-diff

Compare two existing `my-dev-kit` index output directories and report added, removed, and changed graph/artifact elements. `graph-diff` is a **v1.8.0 Batch 4** command.

`graph-diff` is read-only and JSON-first: it never runs `index`, never modifies either input directory, and never writes any artifact of its own. It compares whatever `manifest.json`/`code-graph.json`/etc. already exist on disk in `--before` and `--after` — including output produced by `index --incremental`'s partial-rebuild path (v1.8.0 Batch 3), which `graph-diff`'s equivalence-based tests rely on for fixtures.

### Usage

```sh
npx @dailephd/my-dev-kit graph-diff --before <index-dir> --after <index-dir> --json
```

### Flags

- `--before <index-dir>`: the earlier index artifact directory. Required.
- `--after <index-dir>`: the later index artifact directory. Required.
- `--json`: print JSON output. A concise human summary (node/edge/file/symbol counts, manifest/classification summary, warnings) prints instead when `--json` is omitted.

### Required vs. optional artifacts

- Required on both sides: `manifest.json`, `code-graph.json`. A missing or malformed required artifact throws a clear error and exits non-zero (the same `readIndexManifest`/artifact-loading errors `lookup`/`slice`/`view` already produce) — `graph-diff` never guesses or silently skips these.
- Optional on either side: `symbol-index.json`, `classification.json`, `data-model.json`, `frontend-semantic.json`, `frontend-reachability.json`. Missing or unreadable on one or both sides degrades that section to an "unavailable"/presence-only report plus a warning — never a crash, and never treated as a difference in graph node/edge content.
- `call-graph.json` is not separately diffed in this batch (out of scope — see `docs/ROADMAP.md`); its content is already reflected in `code-graph.json`'s `calls` edges when `--call-graph` was used.

### Output

JSON output (`reportKind: "my-dev-kit-v1-graph-diff"`) includes:

- `before`/`after`: `{ indexDir, projectRoot }` for each side.
- `summary`: node/edge/file/symbol added/removed/changed counts.
- `nodes`/`edges`: `added`/`removed` (compact `{ id, ... }` refs) and `changed` (`{ id, changedFields, before, after }`, where `before`/`after` include only the fields that actually changed — never a full node/edge dump). Node identity is the existing stable `node.id` (`file:<path>`, `symbol:<path>#<name>`); edge identity is the existing stable `edge.id` (already derived from `source`/`kind`/`target`, plus call line for `calls` edges), so a matching id always means the same logical node/edge and any reported field differences are genuine metadata changes.
- `symbolIndex`: a compact companion to the node diff — `available` plus sorted `filesAdded`/`filesRemoved`/`filesChanged`/`symbolsAdded`/`symbolsRemoved`/`symbolsChanged` path/id lists (no per-file or per-symbol payloads; the node diff already carries field-level detail).
- `manifest`: `schemaVersionMatch`, `changedFields` (a fixed set of behavior-relevant fields: `projectRoot`, `sourceRoots`, `languages`, `callGraphEnabled`, `artifacts`, `semanticArtifacts`, `summary`, `indexMode`, `cacheMode`, `cacheInvalidationReason`, `changedFileSummary`, `partialRebuildFallbackArtifacts`, `warnings`, `errors` — deliberately excludes `createdAt`, which is never logical), and `analyzerChanges` (per-analyzer status changes by id).
- `classification`: `available` (`both`/`before-only`/`after-only`/`neither`) plus `added`/`removed`/`changed` classification entry ids (by the classification artifact's own stable `id`), where `changed` reports which of `classifications`/`editGuidance`/`readiness`/`risks`/`uncertainty`/`reason` differ.
- `semanticArtifacts.dataModel`/`frontendSemantic`/`frontendReachability`: `available` plus a compact summary-count diff (`changedFields`) — a safe, summary-only diff, not a fragile deep per-entry diff, since these artifacts are not built around a single stable per-entry identity the way classification is.
- `warnings`: human-readable notes about schema-version mismatches and optional-artifact presence differences.

All arrays are sorted deterministically (by id/path); output is otherwise a pure function of the two input directories' contents.

### Exit behavior

- Valid inputs, with or without differences: exit `0`. A no-difference result is a normal, valid outcome, not an error.
- Invalid arguments (missing `--before`/`--after`), a missing index directory, or a malformed required artifact: exit non-zero with a clear error message.
- A missing *optional* artifact never causes a non-zero exit; it becomes a warning and an "unavailable" section instead.

### Examples

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit-before --json
# ... make source changes ...
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit-after --json
npx @dailephd/my-dev-kit graph-diff --before .my-dev-kit-before --after .my-dev-kit-after --json
```

### Known limitations

- No `graph-diff --watch` or continuous mode (watch mode is a separate, later `v1.8.0` batch).
- No search/lookup/slice-style filtering of the diff output (retrieval filtering is a separate, later `v1.8.0` batch).
- `call-graph.json` has no dedicated diff section of its own in this batch.
- Semantic-artifact diffs are summary-count-only, not a deep per-field/per-entry diff (classification is the one exception, since it has a stable per-entry id).

## Bundled examples

The bundled examples are useful for smoke tests and learning the command flow.

```sh
npx @dailephd/my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

npx @dailephd/my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --entity User --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --trace-view User --json

npx @dailephd/my-dev-kit index --root examples/basic-react-tsx --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --contains "workspace-editor-empty-state" --context 5 --format numbered
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit --graph react-component --format dot --out examples/basic-react-tsx/.my-dev-kit/react-component.dot
```

## Troubleshooting

### Missing index manifest

Run `index` first or check the `--index` path.

### Missing data-model artifacts

`index` writes `data-model.json` and `data-model-graph.json` automatically when the TypeScript model analyzer finds qualifying source. If the files are missing, the source may not contain qualifying exported interfaces, type aliases, or classes, or the index was run without those source roots.

To regenerate explicitly:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

### Missing frontend-semantic artifact

`index` writes `frontend-semantic.json` automatically when the frontend analyzer finds `.tsx`, `.jsx`, or test files. If the artifact is missing, either no qualifying files were found or the source root was not indexed.

### --react-region region not found

When `--react-region` fails with "region not found," the error output lists available region names for the given `--file`. Use one of the listed names.

### Unknown node ID

Use `search` to find valid node IDs.

### Entity or field not found

`data-model` lookup is exact only. Use the exact entity name, entity ID, or `Entity.field` selector recorded in `data-model.json`.

### Graphviz not found

DOT output does not require Graphviz. `data-model` generation and trace-view mode do not require Graphviz. Frontend graph views in DOT format do not require Graphviz.
