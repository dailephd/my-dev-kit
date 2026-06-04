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

## Data-model and lineage security notes

The v1.1.0 data-model and lineage features keep the same security posture as the rest of the CLI:

- no source modification
- no database connections
- no network calls
- no LLM calls
- no Graphviz requirement for `data-model` or `trace-view`
- no runtime React rendering claims
- no runtime database behavior claims

Warnings are used instead of broad inference when static evidence is incomplete.

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
