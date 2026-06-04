# Architecture

## System goal

my-dev-kit provides deterministic, offline code graph indexing, bounded source retrieval, downstream data-model extraction, and conservative static model-to-view lineage for TypeScript, JavaScript, and Python projects.

The system produces local JSON artifacts that can be inspected, searched, sliced, rendered, and reused by developers or coding agents. It does not run a server, call LLMs, call external APIs, execute user source code, or modify source files.

## High-level architecture

```text
CLI entry: src/cli.ts
  |
  +-- index command       -> Indexing layer
  |                        -> manifest.json, symbol-index.json, code-graph.json, optional call-graph.json
  |
  +-- search command      -> Search layer
  +-- lookup command      -> Lookup layer
  +-- source command      -> Source retrieval layer
  +-- slice command       -> Graph slicing layer
  +-- view command        -> Graph view layer
  |
  +-- data-model command  -> Data-model orchestration layer
                           -> data-model.json
                           -> data-model-graph.json
                           -> model-view-lineage.json (trace-view mode)
```

The `index` command remains the general source-structure indexer. Downstream data-model and lineage layers consume existing index artifacts instead of replacing the indexer.

## Artifact model

The system has three artifact layers:

### Index artifacts

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`
- `call-graph.json`, optional

These artifacts describe source files, symbols, edges, and optional static call relationships.

### Data-model artifacts

- `data-model.json`
- `data-model-graph.json`

These artifacts describe entities, fields, relationships, evidence, and a separate data-model graph.

### Lineage artifact

- `model-view-lineage.json`

This artifact describes conservative static relationships between data-model fields, transformations, view-model fields, component props, and rendered fields.

The data-model and lineage artifacts remain separate from `code-graph.json`.

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

The CLI layer owns:

- command registration
- option parsing
- input validation
- output-format selection
- error presentation
- process exit behavior

The CLI layer does not own indexing, extraction, builder logic, graph traversal, source retrieval, or lineage construction logic. Command files orchestrate subsystem calls and format bounded output.

## Indexing layer

Files:

- `src/indexing/`

The indexing layer owns the full index run.

Responsibilities:

- resolve the project root
- resolve source roots
- discover source files
- apply default ignored directories
- apply repeated `--exclude` rules
- support `--dry-run`
- support progress diagnostics
- dispatch files to language adapters
- assemble the symbol index
- build the code graph
- optionally build the call graph
- write index artifacts

Source discovery is centralized in `discoverSourceFiles.ts`. Indexing, dry-run mode, ignore handling, and progress reporting all use the same discovery path before extraction.

## Language adapter layer

Files:

- `src/languages/`

The language adapter layer owns language-specific extraction for the indexer.

Main files:

- `types.ts`
- `registry.ts`
- `typescript/adapter.ts`
- `python/adapter.ts`

The default registry supports:

- TypeScript for `.ts`, `.tsx`, `.js`, and `.jsx`
- Python for `.py`

The indexer uses the registry to select the correct adapter per file. Language-specific parsing stays inside adapters instead of being duplicated throughout the pipeline.

## Symbol index layer

Files:

- `src/symbol-index/`

The symbol index layer builds per-file summaries used by source retrieval, search, and downstream extraction orchestration.

For each indexed file, it records:

- relative file path
- language
- imports
- exports
- internal dependencies when resolvable
- extracted symbols
- symbol names
- symbol kinds
- symbol start lines

## Code graph layer

Files:

- `src/graph/codeGraphTypes.ts`
- `src/indexing/`

The code graph is a typed directed graph over file and symbol nodes.

Node kinds:

- `file`
- `symbol`

Core edge kinds:

- `defines`
- `imports`
- `exports`
- `calls`
- `depends-on`
- `related-to`

The code graph stays focused on static code structure. Data-model and lineage edges are not added to `code-graph.json`.

## Search, lookup, source, slice, and view layers

Files:

- `src/search/`
- `src/lookup/`
- `src/source/`
- `src/graph/`

These layers consume index artifacts only.

Responsibilities:

- `search`: deterministic keyword ranking over indexed files, symbols, and edges
- `lookup`: exact node lookup with bounded neighbor expansion
- `source`: bounded read-only source retrieval with path containment
- `slice`: bounded graph-neighborhood extraction
- `view`: DOT, SVG, or PNG rendering of `code-graph.json`

These commands preserve the v1.0.0 index workflow and do not depend on data-model or lineage artifacts.

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

The data-model layer does not:

- modify `code-graph.json`
- replace the indexer
- expose fuzzy search
- claim unsupported extractor families

## Data-model extractor layer

Files:

- `src/data-model/extractors/`

The extractor layer emits normalized records. It does not write final artifacts directly.

Current v1.1.0 extractor scope:

- exported interfaces with property signatures
- exported type aliases whose right side is an object literal type
- exported classes with property declarations

Current extractor boundaries:

- conservative and TypeScript-focused
- no Prisma extraction
- no SQL extraction
- no Django extraction
- no SQLAlchemy extraction
- no TypeORM extraction
- no Sequelize extraction
- no broad cross-file relationship inference

Unsupported or ambiguous patterns produce warnings instead of guessed relationships.

## Data-model command integration

Files:

- `src/commands/dataModelCommand.ts`

The `data-model` command is a thin orchestration layer over the data-model and lineage subsystems.

Supported command modes:

- generation mode
- exact entity lookup mode
- exact field lookup mode
- entity `trace-view` mode
- field `trace-view` mode

Generation mode:

- reads existing index artifacts
- runs the extractor-to-builder path
- writes `data-model.json`
- writes `data-model-graph.json`

Lookup mode:

- reads existing `data-model` artifacts
- performs exact entity or field lookup

Trace mode:

- rebuilds data-model artifacts from the index
- builds conservative lineage in memory
- writes `model-view-lineage.json`
- returns bounded lineage output

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

They do not:

- modify source files
- require Graphviz
- require network access

## Security boundaries

my-dev-kit remains a local, offline CLI.

Security-relevant design rules:

- no LLM calls
- no external API calls
- no runtime code execution
- no source-file modification
- source retrieval is read-only
- data-model extraction reads only indexed project files
- lineage reads only indexed project files needed for conservative static evidence
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
- It does not create GitHub releases automatically.

The main design rule is to keep indexing deterministic, downstream artifacts inspectable, retrieval bounded, and unsupported patterns explicit.
