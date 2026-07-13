# Security

This document describes the security model, boundaries, and relevant safeguards for my-dev-kit.

For command flags, see [COMMANDS.md](COMMANDS.md). For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Security model

my-dev-kit is a local, offline CLI tool. It reads source files and JSON artifact files from the local filesystem and writes local output files. It does not:

- make network requests
- call external services or LLMs
- execute arbitrary code from indexed projects
- connect to databases
- spawn shells to interpret user input as code
- modify indexed source files

The main attack surface is:

- crafted JSON artifact files such as `manifest.json`, `data-model.json`, `data-model-graph.json`, or `model-view-lineage.json`
- malicious file paths embedded in artifacts that could try to escape the intended project or artifact directory
- DOT output injection through graph labels and IDs
- the Graphviz `dot` subprocess invocation for SVG or PNG rendering only

## Boundaries enforced

### Source retrieval path containment

`source` enforces that source file reads stay within `manifest.projectRoot`. Paths that escape the indexed project root are rejected before file I/O occurs.

### Index artifact path containment

`readIndexManifest` resolves artifact paths recorded in `manifest.json` relative to the selected index directory and validates that each resolved path stays inside that directory. Crafted traversal values such as `../../outside.json` are rejected before the file is opened.

### Data-model artifact path containment

`dataModelArtifactPaths.ts` resolves:

- `data-model.json`
- `data-model-graph.json`

relative to the selected output or artifact directory and validates that the resolved paths stay inside that directory.

The `data-model` reader and writer use these helpers for all data-model artifact I/O.

### Model-view-lineage artifact path containment

`modelViewLineageArtifactPaths.ts` resolves:

- `model-view-lineage.json`

relative to the selected output or artifact directory and validates that the resolved path stays inside that directory.

The lineage reader and writer use this helper for all lineage artifact I/O.

### Read-only source access

my-dev-kit does not modify project source files.

Source reads are used by:

- `index`, for language-aware static extraction
- `source`, for bounded source retrieval
- `data-model`, for conservative TypeScript or TSX extraction from indexed files
- `trace-view`, for conservative same-project lineage evidence

These reads are bounded by the indexed project root or the selected artifact directory.

### No runtime execution

The tool uses static parsing and artifact processing. It does not execute indexed TypeScript, JavaScript, JSX, TSX, or Python application code.

Python indexing uses a Python subprocess with static `ast` parsing and does not import or execute user modules.

The data-model and lineage layers also use static analysis only. They do not execute user code, connect to databases, or evaluate runtime framework behavior.

### DOT output escaping

The graph view layer quotes node IDs, labels, and edge labels before emitting DOT content. This prevents DOT syntax injection through artifact data.

### Graphviz subprocess isolation

When SVG or PNG rendering is requested, Graphviz is invoked with `shell: false` and validated format arguments. DOT content is passed through stdin.

### Traversal and output limits

Bounded operations remain enforced:

- `lookup` depth: 0 through 3
- `slice` depth: 0 through 3
- `search` limit: 1 through 100
- `source` line-range enforcement through `--max-lines`

These limits reduce runaway traversal and oversized output for local analysis flows.

## Semantic analyzer and data-model security notes

The v1.1.0 semantic integration, data-model, and lineage features keep the same security posture as the rest of the CLI:

- no source modification
- no database connections
- no network calls
- no LLM calls
- no Graphviz requirement for `data-model` or `trace-view`
- no runtime React rendering claims
- no runtime database behavior claims

The TypeScript model analyzer runs as part of the `index` command. It reads only indexed TypeScript and TSX source files within the bounds of the indexed project root. The same path containment rules that apply to `source` and `data-model` apply to analyzer source reads.

Semantic artifact paths recorded in `manifest.json` under `semanticArtifacts` are resolved relative to the artifact directory and validated for path containment before use.

Managed artifact refresh removes only files from within the artifact directory that were produced by a prior index run. It does not remove arbitrary files outside the artifact directory.

Warnings are used instead of broad inference when static evidence is incomplete.

### Classification security notes (v1.5.0)

The `classification` analyzer keeps the same security posture as the other semantic analyzers: it runs as part of `index`, reads only already-indexed project files, performs no runtime execution, and never claims database or browser behavior. `classification.json` is a detailed artifact written to the artifact directory and is subject to the same artifact path containment as `data-model.json` and other semantic artifacts. Low-confidence classifications are marked `possible`/`unknown` with an explanatory warning rather than silently rounded to a higher-confidence category.

### Context capsule and retrieval audit security notes (v1.6.0)

The `context` command reads only artifacts already present in the selected index directory and writes bounded output to `--out` (and, when requested, `--audit-out`). Both output paths are resolved and validated the same way other artifact writes are — writes stay confined to the location the caller specifies; `context` does not write to `manifest.projectRoot` or any location outside the paths the caller passed. A context capsule never embeds a raw graph or artifact dump; all included evidence is bounded, capped, and reason-tagged, which limits how much source or structural detail a single capsule can expose relative to the underlying index.

### Graph-diff security notes (v1.8.0)

`graph-diff --before <dir> --after <dir>` opens both index directories strictly read-only: it never runs `index` and never writes to either input directory. Artifact reads from each directory go through the same manifest-relative path containment used elsewhere (`readIndexManifest`/`resolveArtifactPath`); a crafted `manifest.json` in either `--before` or `--after` cannot cause a read outside that directory.

### Android, Kotlin, and Java security notes (v1.9.0)

Android project detection (`android-project.json`) uses file existence and conservative text-substring evidence only. Per the detector's own design boundary: it "executes Gradle" — never; "resolves dependencies" — never; "parses Kotlin/Java symbols" — never. It never invokes the Gradle wrapper, a Gradle daemon, or any build tooling, and it never executes arbitrary Groovy/Kotlin-DSL code found in `build.gradle(.kts)`/`settings.gradle(.kts)` files — those files are read as plain text with regex-based substring matching, not parsed or evaluated as code.

The Kotlin (`.kt`) and Java (`.java`) language adapters extract top-level declarations using conservative, deterministic, line/regex-based parsing — not the Kotlin compiler, not `javac`, and not any JVM execution. They are subject to the same `--src` source-root path containment as the TypeScript, JavaScript, and Python adapters: only files under a requested `--src` root are read, and Batch 1's detected Android Kotlin/Java source roots are informational only and never expand or override `--src`.

Android component-role detection (`android-components.json`) reads only symbol data already present in `symbolIndex` from the same indexing run, with one bounded exception: Retrofit-service detection re-reads the already-indexed source file up to a fixed 400-line cap to inspect HTTP-method annotations on interface methods. This re-read is bounded, confined to files already inside the indexed project root, and does not follow any path derived from artifact content.

None of the v1.9.0 Android/Kotlin/Java work executes Gradle, `javac`, the Kotlin compiler, an Android build, an emulator, or any Android runtime; it does not inspect APK/AAB files and does not perform Android security validation.

## User responsibilities for private repositories

Index, data-model, and lineage artifacts can contain sensitive structural metadata such as:

- relative file paths
- symbol names
- entity names
- field names
- component names
- transformation names
- static evidence paths and line references

Treat these artifacts with the same access controls as the indexed source code.

When working with private repositories:

- keep artifact directories inside the project or another approved local workspace
- avoid committing generated artifacts unless intentional
- avoid publishing artifacts unless they are explicitly meant to be shared

## Security test coverage

Security tests in `tests/security/` cover:

- path traversal rejection
- malformed artifact handling
- DOT escaping
- output path behavior
- graph traversal limits

The data-model and lineage suites also cover:

- data-model artifact path containment
- lineage artifact path containment
- malformed data-model and lineage artifacts
- conservative handling of unsupported static patterns

## Reporting

This is a local open-source CLI tool with no external services. If you discover a security issue, open an issue in the project repository with a description of the finding and a reproduction case.
