# Graph Schema

This document describes the JSON artifacts produced and consumed by my-dev-kit.

my-dev-kit writes local, file-based artifacts when a project is indexed. These artifacts describe project metadata, per-file symbols, code graph structure, and optional call graph information.

The public product name is my-dev-kit. Some artifactKind values include my-dev-kit-v1 because they are versioned schema identifiers for the Version 1 artifact format. They do not change the product name.

For command flags, see COMMANDS.md.
For practical workflows, see WORKFLOWS.md.
For internal architecture details, see ARCHITECTURE.md.

## Artifact overview

The index command writes artifacts into the selected output directory.

The output directory is passed through --out and is resolved relative to --root.

Recommended output directory:

    .my-dev-kit

Core artifacts:

- manifest.json
- symbol-index.json
- code-graph.json

Optional artifact:

- call-graph.json

The optional call graph is written only when --call-graph is requested and call graph data is available.

Artifact flow:

    my-dev-kit index --root <project> --src <src> --out .my-dev-kit
      |
      +-> manifest.json
      +-> symbol-index.json
      +-> code-graph.json
      +-> call-graph.json, optional

Consumer commands:

- search reads manifest.json, symbol-index.json, and code-graph.json
- lookup reads manifest.json and code-graph.json
- source reads manifest.json, symbol-index.json, and sometimes code-graph.json
- slice reads manifest.json and code-graph.json
- view reads manifest.json and code-graph.json

## Versioned artifact kinds

Some output objects include an artifactKind field.

Version 1 artifact kind values may include the string my-dev-kit-v1. These values are schema identifiers, not the public product name.

Current versioned artifact kind examples:

- my-dev-kit-v1-manifest
- my-dev-kit-v1-graph-slice
- my-dev-kit-v1-search-result

These values should remain stable for Version 1 compatibility unless the code and tests are intentionally migrated to a new schema identifier.

## manifest.json

manifest.json records project metadata, source roots, artifact paths, warnings, errors, and summary counts.

Artifact kind:

- my-dev-kit-v1-manifest

Main fields:

- artifactKind
- version
- createdAt
- projectRoot
- sourceRoots
- languages
- callGraphEnabled
- artifacts
- summary
- warnings
- errors

Field descriptions:

- artifactKind is the versioned manifest schema identifier.
- version is the schema version string.
- createdAt is an ISO 8601 timestamp.
- projectRoot is the absolute path to the indexed project root.
- sourceRoots contains source roots relative to projectRoot.
- languages contains detected or requested source languages.
- callGraphEnabled is true when call graph generation was requested and produced.
- artifacts records artifact filenames relative to the index directory.
- summary contains file, symbol, edge, warning, and error counts.
- warnings contains non-fatal indexing warnings.
- errors contains indexing errors.

The artifacts object may include:

- symbolIndex
- codeGraph
- callGraph

When call graph generation is not requested or not available, artifacts.callGraph is null.

## symbol-index.json

symbol-index.json records per-file symbol information extracted during indexing.

Top-level fields:

- schemaVersion
- buildTime
- repoRoot
- sourceRoots
- fileCount
- symbolCount
- files

Each file summary may include:

- path
- language
- imports
- exports
- symbols
- dependencies

Field descriptions:

- path is the file path relative to the indexed project root.
- language is the detected source language.
- imports contains imported module paths.
- exports contains exported symbol names.
- symbols contains per-symbol records.
- dependencies contains resolved internal dependency paths when available.

Each symbol record may include:

- name
- kind
- line
- exported
- language-specific metadata when available

Current symbol indexing records symbol start lines but not complete symbol end-line bounds.

symbol-index.json is consumed by:

- source, for symbol-name and symbol-node retrieval
- search, for symbol names, imports, exports, and dependency matching
- downstream tools that need compact per-file source summaries

## code-graph.json

code-graph.json records the main typed code graph.

Artifact kind:

- code-graph

Top-level fields:

- artifactKind
- schemaVersion
- createdAt
- nodes
- edges
- summary

Field descriptions:

- artifactKind identifies the artifact as a code graph.
- schemaVersion is the code graph schema version.
- createdAt is an ISO 8601 timestamp.
- nodes contains file and symbol nodes.
- edges contains typed relationships between nodes.
- summary contains node and edge counts.

Summary fields:

- nodeCount
- edgeCount
- fileNodeCount
- symbolNodeCount

The code graph is consumed by:

- search
- lookup
- slice
- view
- source, when resolving node-based retrieval

The code graph describes static code structure. It is not a complete runtime execution graph.

## Node model

Each code graph node has:

- id
- kind
- label

Additional fields depend on node kind.

File node fields:

- id
- kind
- label
- path
- language

Symbol node fields:

- id
- kind
- label
- path
- symbolName
- symbolKind
- language
- line
- exported

Field descriptions:

- id is the unique node ID.
- kind is file or symbol.
- label is a display label.
- path is the file path relative to the indexed project root.
- symbolName is the symbol name for symbol nodes.
- symbolKind is the extracted symbol kind.
- language is the detected source language.
- line is the symbol start line when available.
- exported indicates whether a symbol is exported.

## Node ID conventions

Node IDs must be passed exactly as they appear in code-graph.json.

Use search results or inspect the nodes array in code-graph.json to discover valid node IDs.

File node format:

    file:<relative-path>

Examples:

    file:src/index.ts
    file:src/userService.ts
    file:src/main.py

Symbol node format:

    symbol:<relative-path>#<symbol-name>

Examples:

    symbol:src/index.ts#describeUser
    symbol:src/userService.ts#formatUser
    symbol:src/main.py#greet

Node IDs are stable within a single index run. Re-indexing may produce different IDs if file paths or symbol names change.

## Edge model

Each edge has:

- id
- source
- target
- kind
- label

Field descriptions:

- id is the unique edge ID.
- source is the source node ID.
- target is the target node ID.
- kind is the edge kind.
- label is an optional display label.

## Edge kinds

Defined edge kinds:

- defines
- imports
- exports
- calls
- depends-on
- related-to

Edge meanings:

- defines means a file node defines a symbol node.
- imports means a file node imports from another module or dependency.
- exports means a file node exports a symbol node.
- calls means a symbol node calls another symbol node when statically detected.
- depends-on means a file or symbol depends on another file or symbol.
- related-to means a general structural relationship that does not fit a narrower edge kind.

Edge kinds are used by:

- lookup traversal
- slice traversal
- search scoring
- graph view rendering
- semantic edge styling

## call-graph.json

call-graph.json is written when --call-graph is requested and call graph data is available.

The call graph records static call edges discovered by supported language adapters.

Supported languages:

- TypeScript
- JavaScript
- Python

The call graph is best-effort and conservative.

It may detect straightforward calls such as:

- foo()
- self.foo()
- module.foo()
- ClassName.method()

It may miss:

- dynamic dispatch
- computed calls
- monkey-patching
- decorator-injected behavior
- runtime-generated calls
- framework-specific runtime wiring
- arbitrary import execution
- indirect runtime behavior

Python call graph extraction uses Python ast parsing and does not execute user source files.

The call graph should be treated as useful structural evidence, not as a complete runtime call graph.

## Lookup behavior

lookup reads:

- manifest.json
- code-graph.json

lookup requires an exact node ID.

Behavior:

- depth 0 returns only the focus node.
- depth 1 through 3 expands graph neighbors breadth-first.
- results include the focus node, incoming edges, outgoing edges, and expanded neighbors.
- lookup does not read source files.
- lookup does not require Graphviz.
- lookup does not perform fuzzy matching.

Use search first when the exact node ID is unknown.

## Source retrieval behavior

source reads different artifacts depending on retrieval mode.

Line-range retrieval reads:

- manifest.json
- source file from the indexed project

Symbol retrieval reads:

- manifest.json
- symbol-index.json
- source file from the indexed project

Node retrieval may read:

- manifest.json
- code-graph.json
- symbol-index.json
- source file from the indexed project

Supported retrieval modes:

- line range
- symbol name within a file
- node ID

Line-range mode:

    my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40

Symbol mode:

    my-dev-kit source --index .my-dev-kit --file src/index.ts --symbol describeUser

Node mode:

    my-dev-kit source --index .my-dev-kit --node symbol:src/index.ts#describeUser

Source retrieval output may include:

- status
- mode
- filePath
- absolutePath
- symbolName
- startLine
- endLine
- lineCount
- content
- warnings

Output formats:

- json
- plain
- numbered

Safety constraints:

- file paths that escape manifest.projectRoot are rejected
- ranges where start exceeds end are rejected
- ranges that exceed --max-lines are rejected
- source files are read-only
- source files are never modified

Current limitation:

- The index records symbol start lines but not symbol end lines.
- Symbol retrieval returns a bounded preview from the symbol start line.
- Symbol retrieval may include a warning when the result is capped.
- Use explicit line-range retrieval when exact source bounds are required.

## Graph slice artifact

slice produces a bounded graph-neighborhood artifact.

Artifact kind:

- my-dev-kit-v1-graph-slice

Main fields:

- artifactKind
- focusNodeId
- depth
- direction
- nodes
- edges
- summary
- artifactPaths

Field descriptions:

- artifactKind is the versioned graph-slice schema identifier.
- focusNodeId is the requested focus node.
- depth is the requested traversal depth.
- direction is incoming, outgoing, or both.
- nodes contains included graph nodes.
- edges contains included graph edges.
- summary contains node and edge counts by kind.
- artifactPaths records the manifest and code graph paths used to build the slice.

Traversal behavior:

- depth 0 returns only the focus node and no edges.
- depth 1 through 3 expands breadth-first.
- direction controls which edges are followed.
- slice reads graph artifacts only.
- slice does not read source files.
- slice does not require Graphviz.

## Graph view behavior

view reads code-graph.json and renders it as DOT, SVG, or PNG.

Supported output formats:

- dot
- svg
- png

DOT output:

- does not require Graphviz
- renders file nodes as boxes
- renders symbol nodes as ellipses
- uses relative file paths for file labels
- uses symbol names for symbol labels

SVG and PNG output:

- require the Graphviz dot executable
- can fall back to DOT when --allow-dot-fallback is used

Supported edge style modes:

- semantic
- labeled
- minimal

Edge style behavior:

- semantic uses distinct DOT marker and line-style attributes per edge kind and includes one legend.
- labeled emits inline edge labels.
- minimal emits edges without labels or extra attributes.

Semantic edge DOT attribute mapping:

| Edge kind | dir | arrowtail | arrowhead | style |
| --- | --- | --- | --- | --- |
| defines | both | dot | normal | solid |
| imports | both | dot | inv | solid |
| exports | both | dot | onormal | solid |
| calls | both | dot | normal | bold |
| depends-on | both | dot | inv | dashed |
| related-to | both | odot | odot | dotted |

Semantic visualization is a rendering convention. It does not change code-graph.json.

## Search result artifact

search produces a structured search result object.

Artifact kind:

- my-dev-kit-v1-search-result

Main fields:

- artifactKind
- version
- createdAt
- indexDir
- query
- normalizedTerms
- limit
- results
- summary
- artifactPaths
- warnings

Field descriptions:

- artifactKind is the versioned search result schema identifier.
- version is the schema version string.
- createdAt is an ISO 8601 timestamp.
- indexDir is the absolute path to the index artifact directory.
- query is the original query string.
- normalizedTerms contains tokenized query terms.
- limit is the requested result limit.
- results contains ranked file, symbol, and edge results.
- summary contains search coverage counts.
- artifactPaths records the artifacts used during search.
- warnings contains non-fatal warnings.

Summary fields:

- resultCount
- searchedFileCount
- searchedSymbolCount
- searchedEdgeCount

Each result includes:

- kind
- score
- matchReasons

File and symbol results include a nodeId.

Edge results include an edge ID.

Search result kinds:

- file
- symbol
- edge

Score behavior:

- score is a deterministic ranking integer
- score is not a probability
- score is not a confidence value
- score is not produced by a language model

matchReasons explain which fields matched the query and how the score was built.

Each match reason may include:

- field
- term
- weight
- text

Search reads only:

- manifest.json
- symbol-index.json
- code-graph.json

Search does not:

- read arbitrary source files
- call LLMs
- call external APIs
- use embeddings
- modify files

## Schema limitations

Version 1.0.0 has the following schema limitations:

- Symbol end lines are not recorded.
- Symbol-mode source retrieval returns a bounded preview from the symbol start line.
- Call graph extraction is static, syntactic, and best-effort.
- Dynamic and computed call sites may not be captured.
- Python indexing is supported but conservative.
- Python call graph extraction uses ast parsing and does not execute user source.
- Search is keyword-based and deterministic.
- Semantic similarity search is not supported.
- Embedding-based retrieval is not supported.
- Lookup requires exact node IDs.
- Node IDs are stable within a single index run but may change after re-indexing if paths or symbol names change.

## Compatibility notes

Version 1 artifact kinds may include my-dev-kit-v1 in artifactKind values.

These values should be treated as schema identifiers. They are not user-facing product names and should not be used as the package name, command name, or documentation title.

Public product identity:

- product name: my-dev-kit
- npm package: @dailephd/my-dev-kit
- CLI command: my-dev-kit

Versioned schema identifiers:

- my-dev-kit-v1-manifest
- my-dev-kit-v1-graph-slice
- my-dev-kit-v1-search-result

If artifact kinds are renamed in a future release, that change should be treated as a schema migration and documented in the changelog.

## Practical summary

The graph schema is built around three core ideas:

- manifest.json records project and artifact metadata.
- symbol-index.json records compact per-file symbol information.
- code-graph.json records static file and symbol relationships.

Other commands consume these artifacts:

- search ranks candidate files, symbols, and edges.
- lookup expands exact graph nodes.
- source retrieves bounded source excerpts.
- slice extracts bounded graph neighborhoods.
- view renders graph output.

The artifacts are designed to be local, deterministic, inspectable, and reusable.