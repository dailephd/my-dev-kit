# Architecture

## System goal

my-dev-kit provides deterministic, offline code graph indexing and retrieval for TypeScript, JavaScript, and Python projects.

The system produces file-based JSON artifacts that can be inspected, searched, sliced, and reused by developers or coding agents. It does not run a server, maintain a runtime graph, call LLMs, call external APIs, or modify user source files.

The core workflow is:

    index a project
    search or lookup graph nodes
    slice the relevant graph neighborhood
    retrieve bounded source context
    optionally render the graph for inspection

## High-level architecture

    CLI entry: src/cli.ts
      |
      +-- index command   -> Indexing layer        -> manifest.json, symbol-index.json, code-graph.json, optional call-graph.json
      +-- search command  -> Search layer          -> ranked keyword matches over index artifacts
      +-- lookup command  -> Lookup layer          -> exact node lookup and bounded neighbor traversal
      +-- source command  -> Source retrieval      -> bounded source slices
      +-- slice command   -> Graph slicing layer   -> bounded graph-neighborhood artifacts
      +-- view command    -> Graph view layer      -> DOT, SVG, or PNG graph output

The `index` command creates the artifact set. All other commands read from that artifact set.

## Artifact model

The index command writes artifacts into the selected output directory.

Core artifacts:

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`

Optional artifacts:

- `call-graph.json`, written when `--call-graph` is requested and call graph data is available

Artifact flow:

    index --root <project> --src <src>
      |
      +-> manifest.json
      +-> symbol-index.json
      +-> code-graph.json
      +-> call-graph.json, optional

    search / lookup / source / slice / view
      |
      +<- manifest.json
      +<- symbol-index.json
      +<- code-graph.json
      +<- call-graph.json, when requested by a command or workflow

The artifacts are local files. They can be committed, ignored, deleted, regenerated, inspected manually, or passed into other tools.

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

Command files:

- `indexCommand.ts`
- `searchCommand.ts`
- `lookupCommand.ts`
- `sourceCommand.ts`
- `sliceCommand.ts`
- `viewCommand.ts`

The CLI layer owns:

- command registration
- option parsing
- input validation
- output-format selection
- error presentation
- process exit behavior

The CLI layer does not own indexing, graph traversal, source retrieval, search scoring, or rendering logic.

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

Source discovery is centralized in `discoverSourceFiles.ts`. Normal indexing, dry-run mode, default ignores, repeated excludes, and progress counters use the same discovery path before symbol extraction.

The indexer skips common dependency, generated, build, and cache directories before reading files from those directories.

Examples of skipped directories include:

- `node_modules`
- `.next`
- `dist`
- `build`
- `coverage`
- `playwright-report`
- `test-results`
- `.cache`
- `.turbo`
- `.vercel`
- `.git`
- `.pytest_cache`
- `__pycache__`
- `.venv`
- `venv`

The indexing layer validates source roots and supported languages before running extraction.

## Language adapter layer

Files:

- `src/languages/`

The language adapter layer owns language-specific extraction.

Main files:

- `types.ts`
- `registry.ts`
- `typescript/adapter.ts`
- `python/adapter.ts`

The `LanguageAdapter` interface defines the adapter contract:

- supported file extensions
- whether the adapter supports call graph extraction
- source extraction
- optional call graph extraction
- optional import resolution

The default registry registers:

- TypeScript adapter for `.ts`, `.tsx`, `.js`, and `.jsx`
- Python adapter for `.py`

The builder uses the registry to select the correct adapter per file. Language-specific logic stays inside adapters instead of being hardcoded throughout the indexing pipeline.

## TypeScript and JavaScript adapter

Files:

- `src/languages/typescript/adapter.ts`

The TypeScript adapter handles:

- TypeScript files
- TSX files
- JavaScript files
- JSX files

It uses TypeScript compiler-based parsing for symbol extraction and conservative call graph extraction.

Extracted structures include:

- imports
- exports
- top-level symbols
- symbol names
- symbol kinds
- symbol start lines
- language metadata
- static call relationships where supported

The adapter is conservative. It does not attempt to fully resolve runtime dispatch, dynamic imports, generated code, or framework-specific behavior beyond what is statically available.

## Python adapter

Files:

- `src/languages/python/adapter.ts`

The Python adapter handles `.py` files.

Python indexing requires Python 3.8 or later on `PATH` as `python` or `python3`.

The adapter uses a Python subprocess with AST extraction scripts. It does not execute user source files.

Extracted structures include:

- top-level functions
- async top-level functions
- top-level classes
- imports
- `ALL_CAPS` constants
- `Final`-annotated constants
- `__all__` exports when defined as a plain list
- conservative syntactic call edges for straightforward calls

Python symbols are considered exported unless their names start with `_`, unless `__all__` provides a more specific export list.

The Python call graph is static and conservative. It records direct syntactic calls such as:

- `foo()`
- `self.foo()`
- `module.foo()`
- `ClassName.method()`

It does not execute Python code or infer dynamic runtime behavior.

## Symbol index layer

Files:

- `src/symbol-index/`

The symbol index layer builds per-file symbol tables.

For each indexed source file, it records:

- relative file path
- language
- imported module paths
- exported symbol names
- dependency paths when resolvable
- symbol records
- symbol names
- symbol kinds
- symbol start lines

The symbol index is written to `symbol-index.json`.

Consumers:

- `source` uses the symbol index to resolve symbol-name retrieval.
- `search` uses the symbol index to match symbol names, imports, exports, and dependency metadata.
- downstream workflows can use the symbol index as a compact file summary.

Current limitation:

- Symbol records include start lines, but not full symbol end-line bounds.
- Symbol retrieval may return a bounded preview from the symbol start line.
- Exact retrieval should use line-range mode when precise bounds are required.

## Code graph layer

Files:

- `src/graph/codeGraphTypes.ts`
- `src/indexing/`

The code graph is a typed directed graph.

Node types include:

- file nodes
- symbol nodes

Core edge kinds include:

- `defines`
- `imports`
- `exports`
- `calls`
- `depends-on`
- `related-to`

Edge meanings:

- `defines` means a file defines a symbol.
- `imports` means a file imports from another module or dependency.
- `exports` means a file exports a symbol.
- `calls` means a symbol calls another symbol when statically detected.
- `depends-on` means a file or symbol depends on another node.
- `related-to` means a general structural relationship that is useful but not represented by a narrower edge kind.

The code graph is written to `code-graph.json`.

Consumers:

- `lookup`
- `slice`
- `view`
- `search`

The code graph describes code structure. It is not a runtime execution graph and does not claim complete semantic understanding of a program.

## Call graph layer

The call graph is optional and generated only when `--call-graph` is requested.

Artifact:

- `call-graph.json`

The call graph stores conservative static call edges extracted from supported language adapters.

The call graph is useful for:

- finding direct call relationships
- inspecting local call structure
- expanding graph context around a symbol
- supporting deeper retrieval workflows when call relationships are relevant

Limitations:

- dynamic dispatch is not fully resolved
- runtime control flow is not modeled
- generated runtime behavior is not inferred
- unsupported call patterns are skipped rather than guessed

## Search layer

Files:

- `src/search/`

The search layer performs deterministic keyword search over index artifacts.

Search reads:

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`

Search targets include:

- file paths
- file node IDs
- symbol node IDs
- symbol names
- symbol kinds
- imported module paths
- exported symbol names
- dependency paths
- edge kinds
- edge endpoints
- neighboring node labels

Search behavior:

- local only
- deterministic
- keyword-based
- field-weighted
- no embeddings
- no semantic similarity service
- no LLM calls
- no source-file modification

Search scores are ranking integers. They are not probabilities or model confidence values.

## Lookup layer

Files:

- `src/lookup/lookupNode.ts`

The lookup layer resolves an exact graph node ID and returns bounded graph context around that node.

Lookup supports:

- exact node ID lookup
- depth 0 through 3
- incoming edge traversal
- outgoing edge traversal
- neighboring node collection

Lookup is exact-match only. Partial or fuzzy node lookup belongs to `search`.

Node ID examples:

- `file:src/index.ts`
- `symbol:src/index.ts#describeUser`

## Source retrieval layer

Files:

- `src/lookup/getSourceSlice.ts`
- `src/lookup/resolveSourceTarget.ts`
- `src/lookup/sourceSliceTypes.ts`
- `src/source/renderSourceOutput.ts`

The source retrieval layer reads bounded source ranges from the indexed project.

Supported retrieval modes:

- file node retrieval
- symbol node retrieval
- file plus symbol-name retrieval
- file plus explicit line range retrieval

The source layer enforces:

- project-root containment
- path traversal protection
- valid line ranges
- max-line limits
- output-format selection

Output formats:

- `json`
- `plain`
- `numbered`

Source retrieval never modifies source files. It only reads source content and renders bounded output.

## Graph slicing layer

Files:

- `src/graph/`
- `src/lookup/`

The graph slicing layer builds a bounded graph neighborhood around a focus node.

Slice inputs:

- index directory
- focus node ID
- traversal depth
- traversal direction

Supported directions:

- `incoming`
- `outgoing`
- `both`

Traversal depth is capped. The current public command supports depth 0 through 3.

Slice output includes:

- focus node
- included nodes
- included edges
- summary counts

Graph slicing reads graph artifacts only. It does not read source files and does not require Graphviz.

The result is written as a graph-slice artifact.

## Graph view layer

Files:

- `src/graph/`

The graph view layer converts `code-graph.json` into visual graph output.

Main responsibilities:

- build DOT text
- apply edge-style conventions
- optionally invoke Graphviz
- write DOT, SVG, or PNG output

Main files:

- `buildDotGraph.ts`
- `edgeStyleConvention.ts`
- `dotTypes.ts`
- `renderGraphviz.ts`
- `writeGraphView.ts`

Supported output formats:

- `dot`
- `svg`
- `png`

Supported edge styles:

- `semantic`
- `labeled`
- `minimal`

Edge style behavior:

- `semantic` uses DOT marker and line-style attributes per edge kind and emits a legend.
- `labeled` emits inline edge labels.
- `minimal` emits edges without labels or extra attributes.

DOT output does not require Graphviz. SVG and PNG rendering require the Graphviz `dot` executable.

Graphviz is invoked with `shell: false`, and DOT content is passed through stdin.

## I/O and shared helpers

Files:

- `src/io/`
- `src/version.ts`

The shared I/O layer supports:

- reading JSON artifacts
- writing JSON artifacts
- writing rendered output
- validating paths
- shared filesystem behavior

`src/version.ts` stores the package version constant used by the CLI.

## Test structure

Tests are in `tests/`, organized by subsystem.

Main test groups:

- `tests/cli/`
- `tests/index/`
- `tests/lookup/`
- `tests/view/`
- `tests/search/`
- `tests/security/`

Security tests cover:

- path traversal protection
- malformed artifact handling
- artifact path validation
- DOT escaping
- output path behavior
- graph traversal limits
- output-size limits

Most integration tests invoke the built CLI through child processes against fixture projects in `examples/`. Unit tests operate directly on exported functions.

## Security boundaries

my-dev-kit is designed as a local, offline CLI.

Security boundaries:

- no LLM calls
- no external API calls
- no server process
- no runtime agent execution
- no source-file modification
- no shell-based Graphviz invocation
- no execution of user Python source during Python indexing
- source retrieval is read-only
- graph traversal is bounded
- source retrieval is bounded
- artifact paths are validated
- project-root containment is enforced for source retrieval
- DOT node IDs, labels, and edge labels are escaped

Important implementation constraints:

- The CLI layer does not own retrieval or graph logic.
- The graph and lookup layers do not own CLI parsing.
- Source retrieval rejects paths outside `manifest.projectRoot`.
- Artifact paths in `manifest.json` are validated to stay inside the index directory.
- DOT generation escapes node IDs, labels, and edge labels.
- Graphviz receives DOT through stdin and is invoked without shell expansion.
- Graph traversal depth is capped for `lookup` and `slice`.

## Design boundaries

my-dev-kit uses conservative static analysis.

Current boundaries:

- It does not execute user project code.
- It does not infer complete runtime behavior.
- It does not resolve all dynamic imports.
- It does not fully resolve dynamic dispatch.
- It does not perform semantic similarity search.
- It does not use embeddings.
- It does not call LLMs.
- It does not provide an orchestrator.
- It does not provide backend agent execution.
- It does not provide evaluation workflows.
- It does not publish packages automatically.
- It does not create GitHub releases automatically.

The graph schema is stable within one index run. Re-indexing may produce different node IDs if file paths or symbol names change.

The `alpha-import/` directory in the source repository contains reference material. It is excluded from TypeScript compilation and is not part of the published package or runtime.

## Extension points

The architecture is intended to support additive downstream layers.

Potential future layers include:

- data-model graph extraction
- richer React and TSX indexing
- test-title and locator indexing
- route-aware indexing
- browser storage key tracing
- source continuation retrieval
- local dependency source bundles
- incremental indexing
- graph diffing
- additional language adapters

These features should build on the current artifact model instead of replacing the indexer or creating a parallel scanning pipeline.

A future data-model extraction layer may consume `symbol-index.json` and `code-graph.json` to produce separate data-model artifacts. That feature is not implemented in version 1.0.0.

## Practical summary

my-dev-kit has a small layered architecture:

- the CLI parses commands
- the indexing layer writes artifacts
- language adapters extract source structure
- the symbol index stores compact per-file symbol data
- the code graph stores file and symbol relationships
- search ranks artifact matches
- lookup traverses exact graph nodes
- source retrieves bounded source content
- slice extracts bounded graph neighborhoods
- view renders the graph

The main design rule is to keep indexing deterministic, artifacts inspectable, and retrieval bounded.