# my-dev-kit

Local codebase graph indexing, bounded source retrieval, data-model extraction, and conservative static model-to-view lineage for TypeScript, JavaScript, and Python projects.

## Overview

my-dev-kit helps you navigate a local project by building deterministic artifacts for files, symbols, supported data models, and supported static view usage. You can search the code graph, inspect exact nodes, retrieve bounded source, generate data-model artifacts, inspect exact entities and fields, and trace supported static model-to-view paths.

Everything runs locally. my-dev-kit does not call an LLM, make network requests, connect to a database, or edit source files.

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

Generate data-model artifacts from the existing index:

```sh
my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

Inspect an exact entity or field:

```sh
my-dev-kit data-model --index .my-dev-kit --entity User --json
my-dev-kit data-model --index .my-dev-kit --field User.email --json
```

Trace supported static view usage:

```sh
my-dev-kit data-model --index .my-dev-kit --trace-view User --json
my-dev-kit data-model --index .my-dev-kit --field User.email --trace-view --json
```

## Commands

| Command | Purpose |
| --- | --- |
| `index` | Scan source roots and write index artifacts |
| `search` | Search indexed files, symbols, and edges by keyword |
| `lookup` | Look up a graph node by exact node ID |
| `source` | Retrieve bounded source by line range, symbol, or node ID |
| `slice` | Build a bounded subgraph around a focus node |
| `view` | Render the code graph as DOT, SVG, or PNG |
| `data-model` | Generate data-model artifacts, inspect exact entities or fields, and trace supported static view usage |

See [docs/COMMANDS.md](docs/COMMANDS.md) for the full flag reference.

## Generated artifacts

The `index` command writes:

| Artifact | Contents |
| --- | --- |
| `manifest.json` | Project metadata, source roots, artifact paths, and summary counts |
| `symbol-index.json` | Per-file symbol tables with locations, imports, and exports |
| `code-graph.json` | Graph of file and symbol nodes connected by typed edges |
| `call-graph.json` | Optional static call graph written when `--call-graph` is requested |

The `data-model` command writes:

| Artifact | Contents |
| --- | --- |
| `data-model.json` | Entities, fields, relationships, source refs, and warnings |
| `data-model-graph.json` | Separate graph of data-model entity and field nodes |
| `model-view-lineage.json` | Conservative static lineage between data-model fields and supported view usage, written in `trace-view` mode |

`data-model-graph.json` and `model-view-lineage.json` are separate from `code-graph.json`.

## Data-model extraction

Version 1.1.0 adds a conservative TypeScript-first data-model layer on top of the existing index artifacts.

Supported extraction patterns:

- exported interfaces with property signatures
- exported type aliases whose right side is an object literal type
- exported classes with property declarations

Supported inspection behavior:

- exact entity lookup by name or stable ID
- exact field lookup by `Entity.field`
- conservative static `trace-view` output for supported same-project evidence

Unsupported or ambiguous patterns are reported as warnings or omitted conservatively. The current release does not claim Prisma, SQL, Django, SQLAlchemy, TypeORM, or Sequelize support.

## Conservative model-to-view lineage

`trace-view` is a static evidence feature, not a runtime UI tracer.

Supported lineage is intentionally narrow. It can connect supported data-model fields through:

- direct transformation functions that return object literals from model field reads
- direct view-model property assignments from known model fields
- direct component prop assignments when field identity remains explicit
- direct JSX rendering when field identity remains explicit

It does not claim:

- route-aware reachability
- browser-state behavior
- full React render-flow tracing
- runtime rendering behavior

## Trying the bundled examples from a cloned repository

The bundled examples are useful when you cloned this repository, are inspecting package contents, or want a small smoke-test project.

TypeScript graph example:

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --call-graph --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "user" --limit 5 --json
my-dev-kit lookup --index examples/basic-ts/.my-dev-kit --node symbol:src/index.ts#describeUser --depth 1 --json
```

Data-model example:

```sh
my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --out examples/basic-data-model-ts/.my-dev-kit --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --entity User --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --trace-view User --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --trace-view --json
```

See [examples/README.md](examples/README.md) for more detail.

## Design boundaries

my-dev-kit is a local, deterministic read-only CLI tool. It does not:

- make network requests or LLM calls
- edit or modify source files
- perform semantic or embedding-based search
- execute user application code
- connect to databases
- claim runtime React or browser-state behavior

## Limitations

- Symbol end lines are not recorded during indexing. Symbol source retrieval returns a capped preview from the symbol's start line with a warning. Use explicit line ranges for exact bounds.
- Call-graph extraction is best-effort static syntactic analysis and may miss dynamic dispatch, computed calls, monkey-patching, decorator effects, and runtime behavior.
- Data-model extraction is conservative and currently focused on supported TypeScript patterns.
- Lookup is exact only. There is no fuzzy entity or field lookup.
- `trace-view` is conservative static analysis only. Unsupported dynamic or ambiguous patterns are warned or omitted.

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

Version 1.1.0 adds the first data-model and model-to-view lineage MVP on top of the existing code graph workflow. Future roadmap items still cover broader schema extractors, richer TSX and route-aware analysis, source expansion, graph rendering improvements, and scalability.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full roadmap.

## Bug reports

Open an issue in the project repository with a description of the finding and a reproduction case.

## License

MIT. Copyright (c) 2026 dailephd LLC.

See [LICENSE](LICENSE) for the full license text.
