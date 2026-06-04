# v1.1.0 Architecture Context Report

## 1. Summary

The current architecture appears ready for a downstream data-model layer, with constraints.

- The existing CLI and artifact model are already separated into indexing, artifact I/O, graph/schema types, retrieval, and language-adapter boundaries.
- The current `index` command is the central producer, and every downstream command consumes local file artifacts rather than an in-memory service. That is a good fit for adding a separate artifact family instead of rewriting existing artifacts.
- The strongest evidence supports adding a new data-model layer that consumes current index outputs and writes separate artifacts, rather than rewriting `code-graph.json` or replacing the indexer.
- The main readiness gap is source discovery and extraction scope. Current discovery and adapters are code-file oriented (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`) and may not yet cover schema sources such as Prisma, SQL, or framework metadata files.

No unconstrained full-file reads were needed for this audit. All code excerpts were retrieved by symbol or explicit line range.

## 2. Commands run

### Passed

- `git branch --show-current`
- `npx @dailephd/my-dev-kit index --root . --src src --src tests --src examples --out .my-dev-kit-v11-planning --call-graph --json > .my-dev-kit-v11-planning/context/00-index.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "cli command register commander index search lookup source slice view" --limit 30 --json > .my-dev-kit-v11-planning/context/01-cli-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "manifest artifacts symbolIndex codeGraph callGraph read write loadIndexArtifacts" --limit 30 --json > .my-dev-kit-v11-planning/context/02-artifact-loading-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "CodeGraphNode CodeGraphEdge EdgeKind defines imports exports calls depends-on related-to" --limit 30 --json > .my-dev-kit-v11-planning/context/03-graph-schema-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "SymbolIndex FileSummary SymbolSummary imports exports dependencies symbols line exported" --limit 30 --json > .my-dev-kit-v11-planning/context/04-symbol-index-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "LanguageAdapter registry supported extensions extract symbols call graph imports" --limit 30 --json > .my-dev-kit-v11-planning/context/05-language-adapter-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "projectRoot containment path traversal maxLines source retrieval resolve source target" --limit 30 --json > .my-dev-kit-v11-planning/context/06-source-safety-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "tests index command artifacts manifest code graph symbol index fixture basic-ts" --limit 40 --json > .my-dev-kit-v11-planning/context/07-tests-fixtures-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "LanguageAdapter SourceFileImport LanguageExtractionResult extractSymbols extractImports extractCalls supportedExtensions" --limit 30 --json > .my-dev-kit-v11-planning/context/05b-language-contract-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "indexCommand.spec graphTraversalLimits basic-python basic-ts renderSourceOutput testCli" --limit 30 --json > .my-dev-kit-v11-planning/context/07b-tests-targeted-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "ARCHITECTURE GRAPH_SCHEMA COMMANDS SECURITY ROADMAP" --limit 20 --json > .my-dev-kit-v11-planning/context/08-docs-constraints-search.json`
- `npx @dailephd/my-dev-kit search --index .my-dev-kit-v11-planning --query "indexCommand.spec.ts tests/index" --limit 20 --json > .my-dev-kit-v11-planning/context/07c-test-node-resolution-search.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:src/cli.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-cli.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node symbol:src/indexing/runIndexCommand.ts#runIndexCommand --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-index-command.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:src/indexing/loadIndexArtifacts.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-artifact-loading.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:src/graph/codeGraphTypes.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-graph-types.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:src/symbol-index/types.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-symbol-index-types.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:src/languages/types.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-language-adapter-types.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node symbol:src/languages/typescript/adapter.ts#TypeScriptAdapter --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-typescript-adapter.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node symbol:src/languages/python/adapter.ts#PythonAdapter --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-python-adapter.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:src/lookup/getSourceSlice.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-source-safety.json`
- `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:tests/lookup/testCli.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-tests-fixtures.json`
- `npx @dailephd/my-dev-kit source --index .my-dev-kit-v11-planning --file src/cli.ts --symbol createProgram --format numbered > .my-dev-kit-v11-planning/context/source-cli-registration.txt`
- `npx @dailephd/my-dev-kit source --index .my-dev-kit-v11-planning --file src/commands/indexCommand.ts --symbol registerIndexCommand --format numbered > .my-dev-kit-v11-planning/context/source-command-style.txt`
- Bounded artifact I/O excerpts into [context/source-artifact-loading.txt](context/source-artifact-loading.txt)
- `npx @dailephd/my-dev-kit source --index .my-dev-kit-v11-planning --file src/graph/codeGraphTypes.ts --start 1 --end 39 --format numbered > .my-dev-kit-v11-planning/context/source-graph-types.txt`
- Bounded symbol-index excerpts into [context/source-symbol-index-types.txt](context/source-symbol-index-types.txt)
- `npx @dailephd/my-dev-kit source --index .my-dev-kit-v11-planning --file src/languages/types.ts --start 1 --end 70 --format numbered > .my-dev-kit-v11-planning/context/source-language-adapter-interface.txt`
- `npx @dailephd/my-dev-kit source --index .my-dev-kit-v11-planning --file src/languages/typescript/adapter.ts --start 1 --end 44 --format numbered > .my-dev-kit-v11-planning/context/source-typescript-adapter.txt`
- Bounded Python adapter excerpts into [context/source-python-adapter.txt](context/source-python-adapter.txt)
- Bounded source safety excerpts into [context/source-source-safety.txt](context/source-source-safety.txt)
- Bounded test and fixture excerpts into [context/source-tests-fixtures.txt](context/source-tests-fixtures.txt)
- Direct doc reads of `docs/ARCHITECTURE.md`, `docs/GRAPH_SCHEMA.md`, `docs/COMMANDS.md`, `docs/SECURITY.md`, and `docs/ROADMAP.md`

### Failed

- Command:
  `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:tests/index/indexCommand.spec.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-tests-fixtures.json`
- Exact error:
  `Node not found: file:tests/index/indexCommand.spec.ts`
- Alternative run:
  `npx @dailephd/my-dev-kit lookup --index .my-dev-kit-v11-planning --node file:tests/lookup/testCli.ts --depth 2 --json > .my-dev-kit-v11-planning/context/lookup-tests-fixtures.json`
- Does it block planning:
  No. It indicates a real indexing limitation or omission for some test files as graph nodes, but direct source retrieval still worked for test files by path.

## 3. Index artifacts generated

### Core planning index

- [manifest.json](manifest.json)
- [symbol-index.json](symbol-index.json)
- [code-graph.json](code-graph.json)
- [call-graph.json](call-graph.json)
- [context/00-index.json](context/00-index.json)

### Search outputs

- [context/01-cli-search.json](context/01-cli-search.json)
- [context/02-artifact-loading-search.json](context/02-artifact-loading-search.json)
- [context/03-graph-schema-search.json](context/03-graph-schema-search.json)
- [context/04-symbol-index-search.json](context/04-symbol-index-search.json)
- [context/05-language-adapter-search.json](context/05-language-adapter-search.json)
- [context/05b-language-contract-search.json](context/05b-language-contract-search.json)
- [context/06-source-safety-search.json](context/06-source-safety-search.json)
- [context/07-tests-fixtures-search.json](context/07-tests-fixtures-search.json)
- [context/07b-tests-targeted-search.json](context/07b-tests-targeted-search.json)
- [context/07c-test-node-resolution-search.json](context/07c-test-node-resolution-search.json)
- [context/08-docs-constraints-search.json](context/08-docs-constraints-search.json)

### Lookup outputs

- [context/lookup-cli.json](context/lookup-cli.json)
- [context/lookup-index-command.json](context/lookup-index-command.json)
- [context/lookup-artifact-loading.json](context/lookup-artifact-loading.json)
- [context/lookup-graph-types.json](context/lookup-graph-types.json)
- [context/lookup-symbol-index-types.json](context/lookup-symbol-index-types.json)
- [context/lookup-language-adapter-types.json](context/lookup-language-adapter-types.json)
- [context/lookup-typescript-adapter.json](context/lookup-typescript-adapter.json)
- [context/lookup-python-adapter.json](context/lookup-python-adapter.json)
- [context/lookup-source-safety.json](context/lookup-source-safety.json)
- [context/lookup-tests-fixtures.json](context/lookup-tests-fixtures.json)

### Source excerpts

- [context/source-cli-registration.txt](context/source-cli-registration.txt)
- [context/source-command-style.txt](context/source-command-style.txt)
- [context/source-artifact-loading.txt](context/source-artifact-loading.txt)
- [context/source-graph-types.txt](context/source-graph-types.txt)
- [context/source-symbol-index-types.txt](context/source-symbol-index-types.txt)
- [context/source-language-adapter-interface.txt](context/source-language-adapter-interface.txt)
- [context/source-typescript-adapter.txt](context/source-typescript-adapter.txt)
- [context/source-python-adapter.txt](context/source-python-adapter.txt)
- [context/source-source-safety.txt](context/source-source-safety.txt)
- [context/source-tests-fixtures.txt](context/source-tests-fixtures.txt)

## 4. Files that must be read before planning v1.1.0

### CLI command registration

- `src/cli.ts`
  Why it matters: registers the public surface and shows the stable command-entry pattern.
  Identified by: [context/01-cli-search.json](context/01-cli-search.json), [context/lookup-cli.json](context/lookup-cli.json), [context/source-cli-registration.txt](context/source-cli-registration.txt)
  Required: required

### Command implementation style

- `src/commands/indexCommand.ts`
  Why it matters: representative `commander` command wiring, JSON/plain output conventions, and delegation into the indexing layer.
  Identified by: [context/01-cli-search.json](context/01-cli-search.json), [context/lookup-index-command.json](context/lookup-index-command.json), [context/source-command-style.txt](context/source-command-style.txt)
  Required: required

- `src/indexing/runIndexCommand.ts`
  Why it matters: actual orchestration boundary for source discovery, symbol extraction, graph build, manifest creation, and artifact writes.
  Identified by: [context/01-cli-search.json](context/01-cli-search.json), [context/07-tests-fixtures-search.json](context/07-tests-fixtures-search.json), [context/lookup-index-command.json](context/lookup-index-command.json)
  Required: required

### Artifact loading and writing

- `src/indexing/loadIndexArtifacts.ts`
  Why it matters: current read-path for `lookup`, `source`, `slice`, and `view`; strongest reuse point for any new artifact family.
  Identified by: [context/02-artifact-loading-search.json](context/02-artifact-loading-search.json), [context/lookup-artifact-loading.json](context/lookup-artifact-loading.json), [context/source-artifact-loading.txt](context/source-artifact-loading.txt)
  Required: required

- `src/indexing/readIndexManifest.ts`
  Why it matters: resolves artifact paths and enforces artifact-directory containment; any new artifact path must fit this contract.
  Identified by: [context/02-artifact-loading-search.json](context/02-artifact-loading-search.json), [context/06-source-safety-search.json](context/06-source-safety-search.json), [context/source-artifact-loading.txt](context/source-artifact-loading.txt)
  Required: required

- `src/indexing/writeIndexManifest.ts`
  Why it matters: current artifact writer for manifest, symbol index, code graph, and optional call graph; shows whether new artifact output should extend current writing flow or stay adjacent.
  Identified by: [context/02-artifact-loading-search.json](context/02-artifact-loading-search.json), [context/lookup-index-command.json](context/lookup-index-command.json), [context/source-artifact-loading.txt](context/source-artifact-loading.txt)
  Required: required

- `src/indexing/buildIndexManifest.ts`
  Why it matters: current manifest summary and artifact-path structure; needed if v1.1.0 adds manifest references to a new artifact family.
  Identified by: [context/02-artifact-loading-search.json](context/02-artifact-loading-search.json), [context/lookup-index-command.json](context/lookup-index-command.json)
  Required: required

### Graph schema and graph helpers

- `src/graph/codeGraphTypes.ts`
  Why it matters: defines current node and edge kinds; this is the file that would prove whether new data-model edges belong here or should stay separate.
  Identified by: [context/03-graph-schema-search.json](context/03-graph-schema-search.json), [context/lookup-graph-types.json](context/lookup-graph-types.json), [context/source-graph-types.txt](context/source-graph-types.txt)
  Required: required

- `src/graph/buildCodeGraph.ts`
  Why it matters: current code-graph assembly path; must be understood before deciding whether new lineage should consume code graph outputs or remain independent.
  Identified by: [context/02-artifact-loading-search.json](context/02-artifact-loading-search.json), [context/05-language-adapter-search.json](context/05-language-adapter-search.json), [context/lookup-index-command.json](context/lookup-index-command.json)
  Required: required

- `src/graph/graphSliceTypes.ts`
  Why it matters: existing graph-slice data shape may be reusable if v1.1.0 eventually needs bounded lineage slices.
  Identified by: [context/05-language-adapter-search.json](context/05-language-adapter-search.json)
  Required: optional

### Symbol-index schema and source summaries

- `src/symbol-index/types.ts`
  Why it matters: defines `SymbolIndex`, `FileSummary`, dependency edges, graph records, and call-graph types that v1.1.0 should build on rather than duplicate.
  Identified by: [context/04-symbol-index-search.json](context/04-symbol-index-search.json), [context/07-tests-fixtures-search.json](context/07-tests-fixtures-search.json), [context/lookup-symbol-index-types.json](context/lookup-symbol-index-types.json), [context/source-symbol-index-types.txt](context/source-symbol-index-types.txt)
  Required: required

- `src/symbol-index/builder.ts`
  Why it matters: main symbol-index build boundary and likely insertion point for any downstream extractor handoff.
  Identified by: [context/lookup-index-command.json](context/lookup-index-command.json)
  Required: required

- `src/symbol-index/writer.ts`
  Why it matters: current write path for symbol-index-family artifacts; useful evidence for how reusable artifact family writing already is.
  Identified by: [context/02-artifact-loading-search.json](context/02-artifact-loading-search.json), [context/07-tests-fixtures-search.json](context/07-tests-fixtures-search.json)
  Required: optional

- `src/symbol-index/graphBuilder.ts`
  Why it matters: current call-graph production path; useful comparison point if v1.1.0 adds lineage-style graph edges in a separate artifact.
  Identified by: [context/05-language-adapter-search.json](context/05-language-adapter-search.json), [context/07-tests-fixtures-search.json](context/07-tests-fixtures-search.json)
  Required: optional

### Language adapter contract

- `src/languages/types.ts`
  Why it matters: defines `SourceFileInput` and `LanguageAdapter`; this is the main contract for adding any extractor-adjacent logic without breaking existing adapters.
  Identified by: [context/05b-language-contract-search.json](context/05b-language-contract-search.json), [context/lookup-language-adapter-types.json](context/lookup-language-adapter-types.json), [context/source-language-adapter-interface.txt](context/source-language-adapter-interface.txt)
  Required: required

- `src/languages/registry.ts`
  Why it matters: shows how adapters are registered and where new extraction domains could be introduced without destabilizing current indexing.
  Identified by: [context/lookup-index-command.json](context/lookup-index-command.json)
  Required: required

### TypeScript extraction behavior

- `src/languages/typescript/adapter.ts`
  Why it matters: current TypeScript extraction scope, extension support, and import resolution behavior; likely comparison baseline for model-to-view lineage work.
  Identified by: [context/05b-language-contract-search.json](context/05b-language-contract-search.json), [context/lookup-typescript-adapter.json](context/lookup-typescript-adapter.json), [context/source-typescript-adapter.txt](context/source-typescript-adapter.txt)
  Required: required

### Python extraction behavior

- `src/languages/python/adapter.ts`
  Why it matters: shows the existing pattern for embedded static extraction scripts, import resolution, warnings, and optional call-graph extraction.
  Identified by: [context/05-language-adapter-search.json](context/05-language-adapter-search.json), [context/lookup-python-adapter.json](context/lookup-python-adapter.json), [context/source-python-adapter.txt](context/source-python-adapter.txt)
  Required: required

### Source and path safety

- `src/lookup/getSourceSlice.ts`
  Why it matters: enforces project-root containment and bounded line ranges; any new planner-facing context retrieval must preserve these guardrails.
  Identified by: [context/06-source-safety-search.json](context/06-source-safety-search.json), [context/lookup-source-safety.json](context/lookup-source-safety.json), [context/source-source-safety.txt](context/source-source-safety.txt)
  Required: required

- `src/lookup/resolveSourceTarget.ts`
  Why it matters: maps file nodes and symbols into bounded source targets; relevant if future lineage artifacts need source-backed explainer output.
  Identified by: [context/06-source-safety-search.json](context/06-source-safety-search.json), [context/source-source-safety.txt](context/source-source-safety.txt)
  Required: required

- `src/indexing/discoverSourceFiles.ts`
  Why it matters: source discovery is the main unknown for non-code schema support and the cleanest place to prove or disprove support for new file classes.
  Identified by: [context/06-source-safety-search.json](context/06-source-safety-search.json), [context/lookup-index-command.json](context/lookup-index-command.json)
  Required: required

### Test structure and fixtures

- `tests/lookup/testCli.ts`
  Why it matters: shared CLI test harness used across multiple command suites.
  Identified by: [context/07c-test-node-resolution-search.json](context/07c-test-node-resolution-search.json), [context/lookup-tests-fixtures.json](context/lookup-tests-fixtures.json), [context/source-tests-fixtures.txt](context/source-tests-fixtures.txt)
  Required: required

- `tests/index/indexCommand.spec.ts`
  Why it matters: strongest evidence for how index artifacts are asserted, how fixtures are synthesized, and how ignored paths are tested.
  Identified by: [context/source-tests-fixtures.txt](context/source-tests-fixtures.txt)
  Required: required

- `tests/lookup/sourceSlice.spec.ts`
  Why it matters: directly covers `ensureInsideProjectRoot`, `getSourceSlice`, and `resolveSymbolTarget`, which are relevant for bounded planning context.
  Identified by: [context/source-tests-fixtures.txt](context/source-tests-fixtures.txt)
  Required: required

- `examples/basic-ts/src/index.ts`
  Why it matters: representative fixture already used by lookup/search/source/slice tests and useful for validating lineage concepts later.
  Identified by: [context/07-tests-fixtures-search.json](context/07-tests-fixtures-search.json), [context/source-tests-fixtures.txt](context/source-tests-fixtures.txt)
  Required: optional

### Docs that constrain architecture

- `docs/ARCHITECTURE.md`
  Why it matters: states that `index` produces artifacts and all other commands consume them; this strongly favors extension over replacement.
  Identified by: direct doc read, [context/08-docs-constraints-search.json](context/08-docs-constraints-search.json)
  Required: required

- `docs/GRAPH_SCHEMA.md`
  Why it matters: current artifact contracts and compatibility expectations; required before changing manifest references or schema boundaries.
  Identified by: direct doc read, [context/08-docs-constraints-search.json](context/08-docs-constraints-search.json)
  Required: required

- `docs/COMMANDS.md`
  Why it matters: documents the public command surface and supported extensions; required to avoid drifting beyond the current CLI contract.
  Identified by: direct doc read, [context/08-docs-constraints-search.json](context/08-docs-constraints-search.json)
  Required: required

- `docs/SECURITY.md`
  Why it matters: documents artifact path containment, source path containment, subprocess isolation, and traversal caps that new planning flows must preserve.
  Identified by: direct doc read
  Required: required

- `docs/ROADMAP.md`
  Why it matters: confirms future direction toward data-model understanding and retrieval precision without authorizing a rewrite of current architecture.
  Identified by: direct doc read
  Required: optional

## 5. Recommended v1.1.0 architecture boundaries

These are boundaries supported by current repository evidence, not a full v1.1.0 design.

- The data-model layer should consume current artifacts and current source discovery outputs rather than replace the indexer.
  Evidence: `docs/ARCHITECTURE.md`, `src/indexing/runIndexCommand.ts`, `src/indexing/loadIndexArtifacts.ts`

- Data-model artifacts should remain separate from `code-graph.json` unless later evidence proves there is no cleaner artifact boundary.
  Evidence: `src/graph/codeGraphTypes.ts` is tightly scoped to file/symbol nodes and current edge kinds; `docs/GRAPH_SCHEMA.md` treats current artifacts as stable versioned contracts.

- The `index` command should remain the general source-structure indexer and orchestrator.
  Evidence: `src/cli.ts`, `src/commands/indexCommand.ts`, `src/indexing/runIndexCommand.ts`, `docs/ARCHITECTURE.md`

- Extractors should stay modular and adapter-like.
  Evidence: `src/languages/types.ts`, `src/languages/registry.ts`, `src/languages/typescript/adapter.ts`, `src/languages/python/adapter.ts`

- Unsupported patterns should be reported conservatively rather than guessed.
  Evidence: Python adapter warning flow, bounded retrieval and security docs, existing deterministic/offline product goal.

- Any new artifact path should fit the existing manifest/artifact-resolution safety model instead of creating a disconnected writer/reader path.
  Evidence: `src/indexing/readIndexManifest.ts`, `src/indexing/writeIndexManifest.ts`, `docs/SECURITY.md`

## 6. Risks and unknowns

- It is not yet proven whether source discovery supports non-code schema files such as Prisma, SQL, or ORM metadata.
  Evidence gap: `src/indexing/discoverSourceFiles.ts` still needs focused reading against supported extensions and ignore logic.

- It is not yet proven whether schema files are meant to participate through language adapters or through a separate extractor pipeline.

- It is not yet proven whether manifest writing and artifact loading helpers are reusable enough for a new artifact family without overloading current code paths.

- It is not yet proven whether graph rendering helpers should be reused for data-model graphs or whether they are too code-graph-specific.

- It is not yet proven whether model-to-view lineage needs React-specific or route-specific indexing before lineage extraction can be useful.

- Some test files did not appear as graph nodes in the planning index even though direct source retrieval by path worked.
  This suggests a practical difference between indexed graph nodes and retrievable project files that should be understood before promising new planner workflows.

- Docs were not part of the planning index and had to be inspected directly.
  This is not a blocker, but it means planning prompts should not assume docs are searchable through current artifacts.

## 7. Recommended implementation prompt sequence

### `feature/data-model-contracts`

- Goal: define the data-model artifact contracts and boundaries without changing current code-graph schema.
- Likely files to create:
  `src/data-model/types.ts`
  `tests/data-model/types.spec.ts`
- Likely files to modify:
  `src/indexing/manifestTypes.ts`
  `src/indexing/buildIndexManifest.ts`
- Tests to add:
  artifact shape validation
  manifest reference coverage
- Validation commands:
  `npm run typecheck`
  `npm run test -- tests/data-model/types.spec.ts`

### `feature/data-model-artifact-io`

- Goal: add read/write helpers for the new artifact family while preserving current manifest safety and artifact containment.
- Likely files to create:
  `src/data-model/writer.ts`
  `src/data-model/loadArtifacts.ts`
  `tests/data-model/artifactIo.spec.ts`
- Likely files to modify:
  `src/indexing/readIndexManifest.ts`
  `src/indexing/writeIndexManifest.ts`
  `src/indexing/manifestTypes.ts`
- Tests to add:
  manifest path resolution
  missing artifact behavior
  containment rejection
- Validation commands:
  `npm run typecheck`
  `npm run test -- tests/data-model/artifactIo.spec.ts`

### `feature/data-model-extractor-mvp`

- Goal: implement the first static extractor for a narrow, explicit model source class.
- Likely files to create:
  `src/data-model/extractors/<mvp-extractor>.ts`
  `src/data-model/builder.ts`
  `tests/data-model/extractorMvp.spec.ts`
  `tests/fixtures/data-model/<fixture-set>/...`
- Likely files to modify:
  `src/indexing/runIndexCommand.ts`
  possibly `src/indexing/discoverSourceFiles.ts`
- Tests to add:
  supported static cases
  unsupported-pattern warnings
  empty-project behavior
- Validation commands:
  `npm run typecheck`
  `npm run test -- tests/data-model/extractorMvp.spec.ts`

### `feature/data-model-command`

- Goal: expose the new artifact family through one narrow CLI command only after contracts and extraction stabilize.
- Likely files to create:
  `src/commands/dataModelCommand.ts`
  `tests/data-model/dataModelCommand.spec.ts`
- Likely files to modify:
  `src/cli.ts`
  `src/commands/parseUtils.ts`, if shared parsing is needed
- Tests to add:
  help output
  JSON output
  missing-artifact errors
- Validation commands:
  `npm run typecheck`
  `npm run test -- tests/data-model/dataModelCommand.spec.ts`

### `feature/model-view-lineage-mvp`

- Goal: add model-to-view lineage on top of the existing code artifacts plus the new data-model artifact, without guessing runtime behavior.
- Likely files to create:
  `src/lineage/types.ts`
  `src/lineage/buildModelViewLineage.ts`
  `tests/lineage/modelViewLineage.spec.ts`
- Likely files to modify:
  `src/languages/typescript/adapter.ts`
  possibly `src/search/searchTypes.ts` or future lineage readers
- Tests to add:
  static import/component linkage cases
  unsupported dynamic cases reported as unknown
- Validation commands:
  `npm run typecheck`
  `npm run test -- tests/lineage/modelViewLineage.spec.ts`

### `feature/data-model-docs-tests`

- Goal: finish docs, fixtures, and cross-command regression coverage after the implementation surfaces are real.
- Likely files to create:
  new fixture directories under `tests/fixtures/`
  targeted docs additions under `docs/`
- Likely files to modify:
  `README.md`
  `docs/ARCHITECTURE.md`
  `docs/GRAPH_SCHEMA.md`
  `docs/COMMANDS.md`
- Tests to add:
  end-to-end CLI flow
  artifact compatibility tests
  regression coverage for manifest and safety rules
- Validation commands:
  `npm run verify`

## 8. Do-not-do list

- Do not rewrite the current index command.
- Do not mix data-model edges into `code-graph.json`.
- Do not implement all ORM or framework extractors at once.
- Do not invent runtime database behavior.
- Do not infer model-to-view lineage without static evidence.
- Do not create a disconnected second artifact system that bypasses current manifest and path-safety rules.
- Do not add public docs claiming unimplemented behavior.
