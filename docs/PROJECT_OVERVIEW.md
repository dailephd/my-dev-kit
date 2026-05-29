# Project Overview

## What this project is

my-dev-kit is a local, deterministic command-line tool for indexing TypeScript, JavaScript, and Python codebases, inspecting their structure, retrieving bounded source context, and visualizing code graphs.

It runs offline and works through file-based JSON artifacts. It does not require a server, does not call external APIs, does not call language models, and does not modify source files.

Version 1.0.0 focuses on a stable CLI foundation for structural codebase access.

## Purpose

Large codebases are difficult to inspect manually and too expensive to paste into coding-agent or LLM workflows without filtering. A developer often needs a smaller set of facts:

- where a file or symbol is located
- what a file imports or exports
- which symbols are defined in a file
- how graph nodes relate to one another
- which source excerpt is relevant to a task
- what local graph neighborhood surrounds a selected node

my-dev-kit provides this structural view through deterministic local artifacts. The artifacts can be searched, inspected, sliced, rendered, and reused by humans or downstream tools.

## Current release scope

Version 1.0.0 supports:

- indexing TypeScript, JavaScript, and Python source roots
- extracting per-file symbol tables, imports, exports, dependencies, and source locations
- building a typed code graph of file and symbol nodes
- generating an optional static call graph
- searching indexed files, symbols, and graph edges by keyword
- looking up exact graph nodes with bounded neighbor expansion
- retrieving bounded source by line range, symbol name, or node ID
- slicing a bounded graph neighborhood around a focus node
- rendering the code graph as DOT, SVG, or PNG
- using semantic, labeled, or minimal graph edge styles

## Public commands

my-dev-kit provides six public commands.

| Command | Purpose |
| --- | --- |
| `index` | Index source roots and write graph artifacts |
| `search` | Search indexed files, symbols, and edges by keyword |
| `lookup` | Look up a graph node by exact node ID |
| `source` | Retrieve bounded source by line range, symbol name, or node ID |
| `slice` | Build a bounded subgraph neighborhood around a focus node |
| `view` | Render the code graph as DOT, SVG, or PNG |

## Generated artifacts

The `index` command writes artifacts into the selected output directory.

Core artifacts:

- `manifest.json` — project metadata, source roots, language information, artifact paths, warnings, errors, and summary counts
- `symbol-index.json` — per-file symbol tables, imports, exports, dependencies, and symbol locations
- `code-graph.json` — typed graph of file and symbol nodes connected by typed edges

Optional artifact:

- `call-graph.json` — static call edges, written when `--call-graph` is requested and call graph data is available

The recommended local artifact directory is:

    .my-dev-kit

## Typical user workflow

Install the package globally:

    npm install -g @dailephd/my-dev-kit

Index a project:

    my-dev-kit index --root . --src src --out .my-dev-kit --json

Search to discover relevant node IDs:

    my-dev-kit search --index .my-dev-kit --query "<term>" --limit 20 --json

Look up a selected node:

    my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json

Build a graph slice around the selected node:

    my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json

Retrieve source context:

    my-dev-kit source --index .my-dev-kit --file "<path>" --start <n> --end <n> --format numbered

Render the graph as DOT:

    my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot

For a full walkthrough, see QUICKSTART.md.

For command flags, see COMMANDS.md.

For practical graph-guided workflows, see WORKFLOWS.md.

## Graph-guided retrieval

The recommended retrieval pattern is:

1. run `index`
2. use `search` to find candidate files or symbols
3. use `lookup` to inspect the strongest node
4. use `slice` to inspect the local graph neighborhood
5. use `source` to retrieve only the needed source excerpt
6. use `view` when a graph visualization is useful

This workflow is designed to avoid broad source-tree reading and large context dumps.

## What my-dev-kit does not do

my-dev-kit does not provide:

- LLM calls
- external API integrations
- code editing
- source modification
- autonomous agent execution
- backend agent orchestration
- PromptPack generation
- evaluation workflows
- milestone workflows
- documentation generation workflows
- semantic similarity search
- embedding-based retrieval
- package publishing automation
- GitHub release automation

Search is deterministic and keyword-based. It is not semantic search.

## Current limitations

- Symbol records currently include start lines but not complete end-line bounds.
- Symbol-mode source retrieval returns a bounded preview from the symbol start line and may include a capped-preview warning.
- Use line-range retrieval when exact source bounds are required.
- Call graph extraction is best-effort static syntactic analysis.
- Dynamic dispatch, computed calls, runtime behavior, and generated runtime behavior may not be captured.
- Python call graph extraction uses static `ast` parsing and does not execute user Python source.
- Lookup requires exact node IDs.
- Node IDs are obtained from `search` results or from `code-graph.json`.
- Graph traversal depth is capped at 3 for `lookup` and `slice`.
- Search is keyword-based and does not use embeddings or fuzzy matching.

## Version 1.0.0 focus

Version 1.0.0 is focused on the core local CLI workflow:

- build index artifacts
- inspect graph structure
- search and retrieve bounded source context
- render graph output
- keep behavior deterministic and offline

Future releases may add richer source retrieval, TSX and test-aware indexing, route-aware retrieval, data-model graph extraction, incremental indexing, graph diffing, and additional language support.

For planned work, see ROADMAP.md.

## Documentation map

- QUICKSTART.md — install, first use, and end-to-end examples
- COMMANDS.md — full command and flag reference
- GRAPH_SCHEMA.md — artifact formats, node IDs, edge kinds, and command output behavior
- ARCHITECTURE.md — internal subsystem structure and design boundaries
- WORKFLOWS.md — practical usage workflows and graph-guided retrieval
- SECURITY.md — security model, path boundaries, subprocess behavior, and audit notes
- DEVELOPMENT.md — source-repository setup, tests, build, and local package testing
- RELEASE.md — manual npm release checklist
- ROADMAP.md — current version status and planned improvements