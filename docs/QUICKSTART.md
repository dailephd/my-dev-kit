# Quickstart

This guide shows the shortest path from installing the public npm package to using all six commands in your own project.

For the full flag reference, see [COMMANDS.md](COMMANDS.md). For artifact and schema details, see [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md). For practical workflows, see [WORKFLOWS.md](WORKFLOWS.md).

## Prerequisites

- Node.js 18 or later
- npm

Python is required only when indexing `.py` files. Graphviz is optional; DOT output works without it, while SVG and PNG rendering require the Graphviz `dot` executable.

## 1. Install

```sh
npm install -g @dailephd/my-dev-kit
```

## 2. Confirm the CLI

```sh
my-dev-kit --help
my-dev-kit --version
```

## 3. Index your project

Run the CLI from inside your own project:

```sh
cd <your-project>
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

The `--out` path is relative to `--root`. This creates `.my-dev-kit/` in your project.

Use multiple source roots when needed:

```sh
my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
```

For large repositories and monorepos, prefer targeted source folders over broad package roots. my-dev-kit automatically skips common generated, dependency, cache, and build directories such as `node_modules`, `.next`, `dist`, `build`, `coverage`, `playwright-report`, `test-results`, `.cache`, `.turbo`, `.vercel`, `.git`, `.pytest_cache`, `__pycache__`, `.venv`, and `venv`.

```sh
my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --json
```

Preview a scan without writing artifacts:

```sh
my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --dry-run --json
```

Add extra path/name exclusions and progress diagnostics when a scan is large:

```sh
my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --progress --json
```

For Python projects:

```sh
my-dev-kit index --root . --src src --language python --out .my-dev-kit --json
```

To include a best-effort static call graph:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json
```

Generated artifacts inside `.my-dev-kit/`:

- `manifest.json` - artifact registry, analyzer registry, and project metadata
- `symbol-index.json` - per-file symbol tables with compact semantic roles per symbol
- `code-graph.json` - graph of file and symbol nodes with compact semantic roles on symbol nodes
- `call-graph.json` - call edges, when `--call-graph` was requested
- `data-model.json` - data entities, fields, and relationships, when the TypeScript model analyzer finds qualifying source
- `data-model-graph.json` - derived semantic graph of data-model entities, when the TypeScript model analyzer runs

Re-run the same command to refresh the artifact directory when source changes.

Split indexes can keep large workspaces easier to navigate:

```sh
my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --json
my-dev-kit index --root . --src apps/web/tests --src apps/web/e2e --out .my-dev-kit-web-tests --exclude playwright-report --exclude test-results --json
my-dev-kit index --root . --src apps/nlp-service/src --language python --out .my-dev-kit-nlp --call-graph --json
my-dev-kit index --root . --src scripts --out .my-dev-kit-scripts --json
```

## 4. Search for a symbol or file

Use `search` to discover node IDs before using `lookup`, `slice`, or `source`.

```sh
my-dev-kit search --index .my-dev-kit --query "<term>" --limit 20 --json
```

Each result includes a `nodeId` field that can be passed to other commands.

## 5. Look up a node

Pass an exact node ID from search results:

```sh
my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json
```

The result includes the focus node, incoming edges, outgoing edges, and neighbors at the requested depth.

## 6. Build a graph slice

Get a bounded subgraph around a selected node:

```sh
my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
```

`slice` reads graph artifacts only. It does not read source files and does not require Graphviz.

## 7. Retrieve source

Retrieve a symbol with line numbers:

```sh
my-dev-kit source --index .my-dev-kit --file "<path>" --symbol "<symbol-name>" --format numbered
```

Retrieve an exact line range:

```sh
my-dev-kit source --index .my-dev-kit --file "<path>" --start 1 --end 40 --format numbered
```

Retrieve as structured JSON:

```sh
my-dev-kit source --index .my-dev-kit --file "<path>" --start 1 --end 40 --format json
```

Source retrieval never modifies source files. The `--max-lines` limit is enforced, and file paths that escape the project root are rejected.

## 8. Render the graph as DOT

DOT output does not require Graphviz:

```sh
my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot
```

Use a different edge style when useful:

```sh
my-dev-kit view --index .my-dev-kit --format dot --edge-style labeled --out .my-dev-kit/graph.labeled.dot
my-dev-kit view --index .my-dev-kit --format dot --edge-style minimal --out .my-dev-kit/graph.minimal.dot
```

## 9. Render SVG or PNG with Graphviz

If Graphviz is installed:

```sh
my-dev-kit view --index .my-dev-kit --format svg --out .my-dev-kit/graph.svg
```

If Graphviz is not installed, use DOT output directly or fall back automatically:

```sh
my-dev-kit view --index .my-dev-kit --format svg --allow-dot-fallback --out .my-dev-kit/graph.dot
```

## Use the output with an LLM or downstream tool

my-dev-kit does not call any LLM or external service. It prepares bounded local context that you can provide to an LLM conversation, a coding assistant, or any downstream tool.

Provide only the selected outputs that are relevant to the task:

- Selected `search` results or a concise summary of the strongest matches
- Selected `lookup` result
- Selected `slice` result or a concise graph summary
- Numbered `source` excerpts with file paths and symbol names

The full `symbol-index.json` and `code-graph.json` artifacts are index files intended for inspection and downstream tooling, not for direct inclusion in LLM context.

For a complete workflow example including a reusable context template, see [Workflow 5 in WORKFLOWS.md](WORKFLOWS.md#workflow-5-use-my-dev-kit-output-with-an-llm-or-downstream-tool).

## Bundled examples for cloned repositories

The `examples/basic-ts` and `examples/basic-python` folders are useful when working from the repository source, inspecting package examples, or smoke testing. They are not the normal path for a user inside their own project.

TypeScript example:

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --call-graph --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json
my-dev-kit lookup --index examples/basic-ts/.my-dev-kit --node file:src/index.ts --depth 1 --json
my-dev-kit source --index examples/basic-ts/.my-dev-kit --file src/index.ts --symbol describeUser --format numbered
```

Python example:

```sh
my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --call-graph --json
my-dev-kit search --index examples/basic-python/.my-dev-kit --query "greet" --limit 5 --json
my-dev-kit lookup --index examples/basic-python/.my-dev-kit --node file:src/main.py --depth 1 --json
my-dev-kit source --index examples/basic-python/.my-dev-kit --file src/main.py --symbol greet --format numbered
```

## Clean up generated artifacts

Inside your own project:

```sh
rm -rf .my-dev-kit
```

For bundled examples in a cloned repository:

```sh
rm -rf examples/basic-ts/.my-dev-kit
rm -rf examples/basic-python/.my-dev-kit
```

## Next steps

- [COMMANDS.md](COMMANDS.md) - full flag reference for every command
- [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) - artifact formats, node ID conventions, and edge kinds
- [WORKFLOWS.md](WORKFLOWS.md) - practical workflows including graph-guided retrieval
- [ARCHITECTURE.md](ARCHITECTURE.md) - internal subsystem structure
- [ROADMAP.md](ROADMAP.md) - current feature status and planned improvements
