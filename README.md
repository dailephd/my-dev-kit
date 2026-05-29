# my-dev-kit

Local codebase graph indexing, keyword search, symbol lookup, source retrieval, graph slicing, and visualization for TypeScript, JavaScript, and Python projects.

## Overview

my-dev-kit helps you navigate a local project by building a deterministic graph of files and symbols. You can search the graph, inspect a selected node, slice nearby relationships, and retrieve only the source excerpts needed for a task.

Everything runs locally. my-dev-kit does not call an LLM, make network requests, or edit source files.

## Installation

```sh
npm install -g @dailephd/my-dev-kit
```

Confirm:

```sh
my-dev-kit --help
my-dev-kit --version
```

## Quickstart

Run the CLI inside your own project:

```sh
cd <your-project>

my-dev-kit index --root . --src src --out .my-dev-kit --json
my-dev-kit search --index .my-dev-kit --query "service" --limit 20 --json
my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json
my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
my-dev-kit source --index .my-dev-kit --file "<path>" --symbol "<symbol-name>" --format numbered
my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot
```

Use one or more `--src` flags for the source roots you want to index:

```sh
my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
```

For large monorepos, index targeted source folders instead of broad package roots. The indexer skips common generated, dependency, cache, and build directories by default, including `node_modules`, `.next`, `dist`, `build`, `coverage`, `playwright-report`, `test-results`, `output`, `out`, `.cache`, `.turbo`, `.vercel`, `.git`, `.pytest_cache`, `__pycache__`, `.venv`, and `venv`.

```sh
my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --json
```

Use `--dry-run` to inspect what would be indexed without writing artifacts, `--progress` to print bounded progress diagnostics to stderr, and repeat `--exclude` for extra path/name exclusions:

```sh
my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --dry-run --json
my-dev-kit index --root . --src apps/web/app --src apps/web/lib --out .my-dev-kit-web --progress --json
```

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for a step-by-step walkthrough.

## Graph-Guided Symbol Retrieval for LLM workflows

LLMs and coding agents work better with bounded, relevant context than with broad project dumps. my-dev-kit supports that workflow by preparing local codebase evidence you can paste into ChatGPT or provide to a coding agent.

my-dev-kit does not call an LLM. It prepares deterministic local context; you decide what to share.

Recommended flow:

1. Index the project.
2. Search for candidate files or symbols.
3. Look up the strongest candidate node.
4. Slice the graph around that node.
5. Retrieve targeted source excerpts.
6. Give only the selected search, lookup, slice, and source outputs to ChatGPT or your coding agent.

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
my-dev-kit search --index .my-dev-kit --query "<topic>" --limit 20 --json
my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json
my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
my-dev-kit source --index .my-dev-kit --file "<path>" --symbol "<symbol-name>" --format numbered
```

Compact prompt template:

```text
I am using my-dev-kit to provide bounded codebase context.

Task:
<describe the task>

Search result:
<paste selected search result>

Selected node:
<node-id>

Lookup and graph slice:
<paste selected lookup/slice output or concise summary>

Source excerpts:
<paste numbered source output with file paths>

Instructions:
Use only the provided context unless you say what additional my-dev-kit command I should run.
Explain which provided evidence supports your answer.
```

For a fuller template and guidance on what to paste, see [docs/WORKFLOWS.md](docs/WORKFLOWS.md).

## Commands

| Command | Purpose |
| --- | --- |
| `index` | Scan source roots and write index artifacts |
| `search` | Search indexed files, symbols, and edges by keyword |
| `lookup` | Look up a graph node by exact node ID |
| `source` | Retrieve bounded source by line range, symbol, or node ID |
| `slice` | Build a bounded subgraph around a focus node |
| `view` | Render the code graph as DOT, SVG, or PNG |

See [docs/COMMANDS.md](docs/COMMANDS.md) for the full flag reference.

## Generated artifacts

The `index` command writes these artifacts to the output directory:

| Artifact | Contents |
| --- | --- |
| `manifest.json` | Project metadata, source roots, artifact paths, and summary counts |
| `symbol-index.json` | Per-file symbol tables with locations, imports, and exports |
| `code-graph.json` | Graph of file and symbol nodes connected by typed edges |
| `call-graph.json` | Call graph, written only when `--call-graph` is requested |

For normal LLM-assisted workflows, do not paste full `symbol-index.json` or `code-graph.json`. Use `search`, `lookup`, `slice`, and `source` to extract targeted context.

## Trying the bundled examples from a cloned repository

The bundled examples are useful when you cloned this repository, are inspecting package contents, or want a small smoke-test project. They are not the main quickstart path for npm users.

TypeScript example:

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --call-graph --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "user" --limit 5 --json
my-dev-kit lookup --index examples/basic-ts/.my-dev-kit --node symbol:src/index.ts#describeUser --depth 1 --json
my-dev-kit source --index examples/basic-ts/.my-dev-kit --file src/index.ts --symbol describeUser --format numbered
```

Python example:

```sh
my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --call-graph --json
my-dev-kit search --index examples/basic-python/.my-dev-kit --query "greet" --limit 5 --json
my-dev-kit lookup --index examples/basic-python/.my-dev-kit --node file:src/main.py --depth 1 --json
my-dev-kit source --index examples/basic-python/.my-dev-kit --file src/main.py --symbol greet --format numbered
```

See [examples/README.md](examples/README.md) for more detail.

## Graph visualization example

```sh
my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot --edge-style semantic
my-dev-kit view --index .my-dev-kit --format svg --out .my-dev-kit/graph.svg
my-dev-kit view --index .my-dev-kit --format svg --allow-dot-fallback --out .my-dev-kit/graph.dot
```

DOT output does not require Graphviz. SVG and PNG rendering require the Graphviz `dot` executable.

## Design boundaries

my-dev-kit is a local, deterministic read-only CLI tool. It does not:

- Make network requests or LLM calls
- Edit or modify source files
- Perform semantic or embedding-based search
- Execute orchestration, agents, or external services

Search is keyword-based. Result scores are deterministic ranking values, not probabilities or confidence scores.

## Limitations

- Symbol end lines are not recorded during indexing. Symbol source retrieval returns a capped preview from the symbol's start line with a warning. Use line-range mode with explicit `--start` and `--end` for exact bounds.
- Call-graph extraction is best-effort static syntactic analysis and may miss dynamic dispatch, computed calls, monkey-patching, decorator effects, and runtime behavior.
- Python call-graph extraction uses `ast` and records high-confidence function and method call sites such as `foo()`, `self.foo()`, `module.foo()`, and `ClassName.method()`.
- Python indexing requires `python` or `python3` on `PATH`. Python 3.8 or later is required. Python files are skipped with a warning if no interpreter is found.

## Development from source

```sh
npm install
npm run build
```

Validate:

```sh
npm run typecheck
npm run test
npm run verify
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the development guide and [docs/RELEASE.md](docs/RELEASE.md) for the maintainer release checklist.

## Roadmap

Version 1.0.0 includes all six commands fully implemented and tested.

Immediate next roadmap item: data-model graph extraction, a planned downstream layer that will interpret indexed code and schema files to identify entities, fields, keys, and relationships.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full roadmap.

## Bug reports

Open an issue in the project repository with a description of the finding and a reproduction case.

## License

MIT. Copyright (c) 2026 dailephd LLC.

See [LICENSE](LICENSE) for the full license text.
