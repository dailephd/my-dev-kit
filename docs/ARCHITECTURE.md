# Architecture

## System goal

my-dev-kit provides deterministic, offline code graph indexing, semantic enrichment, bounded source retrieval, downstream data-model extraction, and conservative static model-to-view lineage for TypeScript, JavaScript, and Python projects.

The system produces local JSON artifacts that can be inspected, searched, sliced, rendered, and reused by developers or coding agents. It does not run a server, call LLMs, call external APIs, execute user source code, or modify source files.

## High-level architecture

```text
CLI entry: src/cli.ts
  |
  +-- index command       -> Indexing layer
  |                        -> Symbol extraction, code graph, optional call graph
  |                        -> Semantic analyzer layer
  |                        -> manifest.json (artifact registry, analyzer registry)
  |                        -> symbol-index.json (symbols with compact semanticRoles, artifactRefs)
  |                        -> code-graph.json (nodes with compact semanticRoles, artifactRefs)
  |                        -> call-graph.json (optional)
  |                        -> data-model.json (when TypeScript model analyzer runs)
  |                        -> data-model-graph.json (when TypeScript model analyzer runs)
  |
  +-- search command      -> Searches structual and semantic fields in index artifacts
  +-- lookup command      -> Exact node lookup, returns semantic metadata when present
  +-- source command      -> Bounded source retrieval, propagates semantic metadata
  +-- slice command       -> Graph slicing, preserves semantic metadata on nodes
  +-- view command        -> Graph view layer (code/data-model/lineage graph artifacts)
  |
  +-- data-model command  -> Data-model inspection and regeneration layer
                           -> data-model.json
                           -> data-model-graph.json
                           -> model-view-lineage.json (trace-view mode)
```

The `index` command is the primary entry point. It builds the structural index, runs semantic analyzers, enriches the index artifacts with compact semantic metadata, writes all produced artifacts, and updates `manifest.json` as the authoritative registry.

Downstream data-model and lineage layers consume existing index artifacts instead of replacing the indexer. The `data-model` command is a focused inspection and regeneration command for those artifacts.

## Index-first architecture

`index` is the primary workflow command. Re-running it refreshes the artifact directory in place.

The managed artifact model works as follows:

1. `index` runs the full build: source discovery, language extraction, symbol index, code graph, optional call graph.
2. `index` runs semantic analyzers on the build output.
3. Semantic results are used to enrich the symbol index and code graph with compact role metadata.
4. `index` writes all produced artifacts to the output directory.
5. `index` removes artifacts from the previous run that were not produced in the current run.
6. `index` writes `manifest.json` last, recording which artifacts are present and the status of each analyzer.

`manifest.json` is always the authoritative registry. Consumers should read `manifest.json` to determine which artifacts are current rather than assuming fixed file names are always present.

## Artifact model

The system has three artifact layers.

### Structural artifacts

- `manifest.json` — artifact registry, analyzer registry, project metadata
- `symbol-index.json` — per-file symbol tables with compact semantic roles
- `code-graph.json` — file and symbol graph with compact semantic roles on symbol nodes
- `call-graph.json` — optional static call graph

These artifacts describe source files, symbols, edges, and optional static call relationships. They carry compact semantic role metadata when analyzers produce it.

### Semantic artifacts

- `data-model.json` — entities, fields, relationships, evidence, and warnings
- `data-model-graph.json` — derived semantic graph of data-model entities and fields

These artifacts carry detailed semantic records. They are separate from `code-graph.json` and use their own node and edge ID space.

`data-model-graph.json` is a derived semantic graph, not a slice of `code-graph.json`. The code graph describes static source structure. The data-model graph describes data entities and fields extracted by the TypeScript model analyzer.

### Lineage artifact

- `model-view-lineage.json` — conservative static relationships between data-model fields, transformations, view-model fields, component props, and rendered fields

This artifact is built by `data-model --trace-view`. It is separate from both the code graph and the data-model graph.

The bridge between structural and semantic artifacts is `artifactRefs` (links from compact symbol metadata to detailed artifact entries) and `evidenceRefs` (source location evidence attached to semantic roles).

## CLI layer

Files:

- `src/cli.ts`
- `src/commands/`

The CLI layer registers the public command surface with `commander`.

Public commands:

- `index`
- `search`
- `lookup`
- `source`
- `slice`
- `view`
- `data-model`

The CLI layer owns command registration, option parsing, input validation, output-format selection, error presentation, and process exit behavior. It does not own indexing, extraction, builder logic, graph traversal, source retrieval, or lineage construction logic.

## Indexing layer

Files:

- `src/indexing/`

The indexing layer owns the full index run.

Responsibilities:

- resolve the project root and source roots
- discover source files
- apply default ignored directories and `--exclude` rules
- support `--dry-run`
- support progress diagnostics
- dispatch files to language adapters
- assemble the symbol index
- build the code graph
- optionally build the call graph
- run semantic analyzers
- enrich the symbol index and code graph with semantic metadata
- write index artifacts
- refresh the artifact directory (remove stale artifacts)
- write `manifest.json` as the final step

## Semantic analyzer layer

Files:

- `src/indexing/runSemanticAnalyzers.ts`
- `src/semantics/`

The semantic analyzer layer runs after the base index build. Analyzers consume the symbol index, code graph, and optionally the call graph.

Current analyzers:

- `syntax` — baseline structural analysis
- `call-graph` — static call graph, when `--call-graph` is requested
- `data-model` — TypeScript model extraction, produces `data-model.json` and `data-model-graph.json`
- `model-view-lineage` — conservative lineage, runs in `data-model --trace-view` mode

Analyzer output feeds two paths:

1. Compact role metadata (`semanticRoles`, `artifactRefs`) is embedded on symbols in `symbol-index.json` and on symbol nodes in `code-graph.json`.
2. Detailed semantic artifacts (`data-model.json`, `data-model-graph.json`) are written to the output directory and registered in `manifest.json`.

Analyzer status is recorded in `manifest.json` under the `analyzers` array.

## Semantic types

Files:

- `src/semantics/semanticTypes.ts`

The semantic schema defines the `SemanticRole`, `SemanticArtifactRef`, `SemanticEvidenceRef`, and related types used throughout the system.

Defined role names include `data-entity`, `data-field`, `canonical-type`, `schema-model`, `database-model`, `artifact-type`, `projection-type`, `view-model`, `ui-only-state`, `persistence-adapter`, `route-handler`, `react-component`, `client-component`, `server-component`, `test-block`, `test-fixture`, `browser-storage-payload`, `storage-key`, `rendered-field`, and `unknown`.

Currently produced by `typescript-model-analyzer`: `data-entity`, `data-field`.

## Language adapter layer

Files:

- `src/languages/`

The language adapter layer owns language-specific extraction for the indexer.

Main files:

- `types.ts`
- `registry.ts`
- `typescript/adapter.ts`
- `python/adapter.ts`

The default registry supports TypeScript for `.ts`, `.tsx`, `.js`, and `.jsx`, and Python for `.py`.

## Symbol index layer

Files:

- `src/symbol-index/`

The symbol index layer builds per-file summaries used by source retrieval, search, and downstream extraction orchestration.

For each indexed file, it records:

- relative file path
- language
- imports and exports
- internal dependencies when resolvable
- extracted symbols with names, kinds, start lines, and compact semantic roles when available

## Code graph layer

Files:

- `src/graph/codeGraphTypes.ts`
- `src/indexing/`

The code graph is a typed directed graph over file and symbol nodes.

Node kinds: `file`, `symbol`

Core edge kinds: `defines`, `imports`, `exports`, `calls`, `depends-on`, `related-to`

Symbol nodes carry compact `semanticRoles` and `artifactRefs` arrays when the TypeScript model analyzer has classified the corresponding symbol. The code graph stays focused on static code structure; data-model and lineage edges are not added to it.

## Search, lookup, source, slice, and view layers

Files:

- `src/search/`
- `src/lookup/`
- `src/source/`
- `src/graph/`

These layers consume index artifacts.

Responsibilities:

- `search`: deterministic keyword ranking over indexed files, symbols, and edges, including semantic role fields when present
- `lookup`: exact node lookup with bounded neighbor expansion and semantic metadata in the result
- `source`: bounded read-only source retrieval with path containment, semantic metadata propagated when present
- `slice`: bounded graph-neighborhood extraction, semantic metadata preserved on nodes
- `view`: DOT, SVG, or PNG rendering of `code-graph.json`, `data-model-graph.json`, or `model-view-lineage.json`

The view layer uses a small renderable graph adapter layer:

- code graph artifact -> renderable graph model
- data-model graph artifact -> renderable graph model
- model-view-lineage artifact -> renderable graph model
- shared DOT/SVG/PNG renderer consumes the renderable graph model

`data-model-graph.json` is not merged into `code-graph.json`. `model-view-lineage.json` is not merged into `code-graph.json`. Each graph artifact keeps its own node and edge ID space, and `view --graph` selects which manifest-referenced artifact to render.

Search includes `semanticRole`, `semanticSubtype`, `semanticSource`, and `semanticArtifactRef` as weighted fields. Results include `semanticRoles` and `artifactRefs` on matched items when present.

Lookup returns `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the focus node when present.

## Data-model layer

Files:

- `src/data-model/types.ts`
- `src/data-model/normalizedTypes.ts`
- `src/data-model/buildDataModelArtifact.ts`
- `src/data-model/buildDataModelGraph.ts`
- `src/data-model/buildDataModelFromIndex.ts`
- `src/data-model/readDataModelArtifacts.ts`
- `src/data-model/writeDataModelArtifacts.ts`
- `src/data-model/lookupDataModelNode.ts`
- `src/data-model/dataModelArtifactPaths.ts`

The data-model layer is additive. It consumes existing index artifacts and produces separate data-model artifacts.

Responsibilities:

- define final artifact contracts
- define normalized extractor output contracts
- build deterministic `data-model.json` artifacts
- build deterministic `data-model-graph.json` artifacts
- read and write data-model artifacts safely
- provide exact entity and field lookup helpers
- orchestrate extraction over indexed TypeScript or TSX source files

The data-model layer does not modify `code-graph.json`, replace the indexer, or expose fuzzy search.

## Data-model extractor layer

Files:

- `src/data-model/extractors/`

The extractor layer emits normalized records. It does not write final artifacts directly.

Current extractor scope:

- exported interfaces with property signatures
- exported type aliases whose right side is an object literal type
- exported classes with property declarations

Current extractor boundaries:

- conservative and TypeScript-focused
- no Prisma, SQL, Django, SQLAlchemy, TypeORM, or Sequelize extraction
- no broad cross-file relationship inference

Unsupported or ambiguous patterns produce warnings instead of guessed relationships.

## Data-model command integration

Files:

- `src/commands/dataModelCommand.ts`

The `data-model` command is a thin orchestration layer over the data-model and lineage subsystems.

Supported command modes:

- generation mode: reads the index and regenerates data-model artifacts
- exact entity lookup mode: reads existing data-model artifacts
- exact field lookup mode: reads existing data-model artifacts
- entity `trace-view` mode: rebuilds data-model artifacts and builds lineage
- field `trace-view` mode: rebuilds data-model artifacts and builds lineage

## Model-to-view lineage layer

Files:

- `src/lineage/types.ts`
- `src/lineage/buildModelViewLineage.ts`
- `src/lineage/readModelViewLineage.ts`
- `src/lineage/writeModelViewLineage.ts`
- `src/lineage/modelViewLineageArtifactPaths.ts`

The lineage layer is separate from the data-model graph and the code graph.

Responsibilities:

- define lineage contracts
- build conservative static lineage from data-model artifacts plus source evidence
- read and write `model-view-lineage.json`
- expose bounded lineage results through the `data-model` command

Supported lineage concepts:

- data entity
- data field
- transformation
- view-model field
- component
- component prop
- rendered field

Supported lineage is intentionally narrow and evidence-backed. It does not claim runtime rendering, route reachability, browser-state behavior, or full React render-flow understanding.

## Data-model and lineage I/O

Files:

- `src/data-model/dataModelArtifactPaths.ts`
- `src/lineage/modelViewLineageArtifactPaths.ts`
- `src/io/`

The data-model and lineage I/O layers handle:

- deterministic JSON writes
- safe artifact path resolution
- path containment inside the selected output directory
- safe JSON reads with artifact kind validation

They do not modify source files, require Graphviz, or require network access.

## Security boundaries

my-dev-kit remains a local, offline CLI.

Security-relevant design rules:

- no LLM calls
- no external API calls
- no runtime code execution
- no source-file modification
- source retrieval is read-only
- data-model and lineage extraction reads only indexed project files
- artifact path containment is enforced for index, data-model, and lineage artifacts
- Graphviz is only used by `view`

## Design boundaries

my-dev-kit uses conservative static analysis throughout.

Current boundaries:

- It does not execute user project code.
- It does not infer complete runtime behavior.
- It does not provide route-aware tracing.
- It does not provide browser-state tracing.
- It does not provide React render-flow indexing.
- It does not provide source continuation retrieval.
- It does not perform semantic similarity search.
- It does not use embeddings.
- It does not call LLMs.

The main design rule is to keep indexing deterministic, downstream artifacts inspectable, retrieval bounded, and unsupported patterns explicit.

## Runtime and artifact-size considerations

The main artifacts (`symbol-index.json`, `code-graph.json`) carry compact semantic metadata rather than full role detail. Compact metadata uses short arrays with role names, confidence, and artifact references. Full detail is in the separate semantic artifacts.

This keeps the structural artifacts small enough for most project sizes while allowing detailed inspection through `data-model.json` and related artifacts. The `manifest.json` artifact registry allows consumers to load only what they need.
