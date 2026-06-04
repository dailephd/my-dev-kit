# Commands

my-dev-kit provides seven public CLI commands:

- `index`
- `search`
- `lookup`
- `source`
- `slice`
- `view`
- `data-model`

Use this document as the command reference for the installed CLI.

For artifact details, see [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md).
For internal design, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Installation

Install the package globally:

```sh
npm install -g @dailephd/my-dev-kit
```

Confirm the CLI is available:

```sh
my-dev-kit --help
my-dev-kit --version
```

## Path conventions

Most workflows follow this pattern:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
my-dev-kit search --index .my-dev-kit --query "service" --json
my-dev-kit lookup --index .my-dev-kit --node "file:src/index.ts" --json
my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered
my-dev-kit slice --index .my-dev-kit --node "file:src/index.ts" --depth 1 --json
my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot
my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

Path rules:

- Run commands from your project root unless you intentionally pass another root.
- `index` uses `--root` to define the project root.
- `index` resolves `--src` paths relative to `--root`.
- `index` resolves `--out` relative to `--root`.
- Read commands use `--index` to point at the artifact directory created by `index`.
- `data-model` reads index artifacts from `--index` and writes data-model artifacts to `--out` or back into `--index` when `--out` is omitted.
- Node IDs must be exact.
- Use `search` to find node IDs before calling `lookup`, `source`, `slice`, or `view`.

Recommended artifact directory:

```sh
.my-dev-kit
```

## index

Index local source files and write graph artifacts.

Supported languages:

- TypeScript
- JavaScript
- Python

Supported source extensions:

- `.ts`
- `.tsx`
- `.js`
- `.jsx`
- `.py`

### Usage

```sh
my-dev-kit index --root <project-root> --src <source-root> --out <artifact-dir>
```

### Flags

- `--root <path>`: project root. Source roots and output paths are resolved relative to this path.
- `--src <path>`: source root to index, relative to `--root`. May be repeated. Required.
- `--language <language>`: language hint. Supported values are `typescript`, `javascript`, and `python`. When omitted, language is inferred from file extensions.
- `--out <dir>`: output directory for index artifacts, relative to `--root`.
- `--exclude <path-or-name>`: directory name or relative path prefix to exclude. May be repeated. This is path/name based, not glob based.
- `--dry-run`: scan and report what would be indexed without writing artifacts.
- `--progress`: print bounded progress diagnostics to stderr.
- `--call-graph`: write `call-graph.json` using conservative static call analysis when supported.
- `--json`: print JSON result to stdout.

### Default ignored directories

The indexer skips common dependency, generated, build, and cache directories before reading files from them.

Default ignored directory names include:

- `node_modules`
- `.next`
- `dist`
- `build`
- `coverage`
- `playwright-report`
- `test-results`
- `output`
- `out`
- `.cache`
- `.turbo`
- `.vercel`
- `.git`
- `.pytest_cache`
- `__pycache__`
- `.venv`
- `venv`

The `--exclude` flag adds extra directory names or relative path prefixes.

### Artifacts

`index` writes the following files inside `--out`:

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`

When `--call-graph` is requested and call graph data is available, `index` also writes:

- `call-graph.json`

### Examples

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json
my-dev-kit index --root . --src src --language python --out .my-dev-kit --json
my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --dry-run --json
```

## search

Search indexed files, symbols, and graph edges by keyword.

### Usage

```sh
my-dev-kit search --index <artifact-dir> --query <text>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--query <text>`: search query text. Required.
- `--limit <n>`: maximum number of results. Valid range is 1 through 100.
- `--json`: print JSON result to stdout.

### Behavior

- Search is local.
- Search is deterministic.
- Search is keyword-based.
- Multi-word queries match results containing any query term.
- Scores are deterministic ranking values.
- Scores are not probabilities or confidence values.
- Search does not call LLMs.
- Search does not use embeddings.
- Search does not read arbitrary source files.
- Search does not modify project files.

### Examples

```sh
my-dev-kit search --index .my-dev-kit --query "service" --limit 20 --json
my-dev-kit search --index .my-dev-kit --query "formatUser" --json
```

## lookup

Look up a graph node by exact node ID.

### Usage

```sh
my-dev-kit lookup --index <artifact-dir> --node <node-id>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--node <node-id>`: exact node ID. Required.
- `--depth <n>`: neighbor expansion depth. Valid range is 0 through 3.
- `--json`: print JSON result to stdout.

### Behavior

- `lookup` is exact-match only.
- Depth 0 returns only the focus node.
- Depth 1 through 3 expands neighbors breadth-first.
- Lookup includes incoming edges, outgoing edges, and neighboring nodes.
- Partial matching and fuzzy matching are not supported.
- Use `search` first when the exact node ID is unknown.

### Node ID formats

File node:

```sh
file:<relative-path>
```

Symbol node:

```sh
symbol:<relative-path>#<symbol-name>
```

## source

Retrieve bounded source content from an indexed project.

### Usage

`source` supports three retrieval modes:

```sh
my-dev-kit source --index <artifact-dir> --node <node-id>
my-dev-kit source --index <artifact-dir> --file <path> --start <n> --end <n>
my-dev-kit source --index <artifact-dir> --file <path> --symbol <name>
```

Use one retrieval mode per command.

### Flags

- `--index <dir>`: index artifact directory.
- `--node <node-id>`: file or symbol node ID.
- `--file <path>`: source file path relative to the indexed project root.
- `--start <n>`: start line for line-range retrieval.
- `--end <n>`: end line for line-range retrieval.
- `--symbol <name>`: symbol name to retrieve from the selected file.
- `--max-lines <n>`: maximum number of lines to return.
- `--format <json|plain|numbered>`: output format.
- `--out <path>`: write rendered output to a file.
- `--json`: alias for `--format json`.

### Safety behavior

`source` enforces:

- project-root containment
- path traversal rejection
- valid line ranges
- max-lines limits
- read-only source access

`source` never modifies source files.

### Limitation

The current index records symbol start lines but not complete symbol end lines. Symbol retrieval returns a bounded preview from the symbol start line and may include a warning.

### Examples

```sh
my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered
my-dev-kit source --index .my-dev-kit --file src/index.ts --symbol describeUser --format numbered
my-dev-kit source --index .my-dev-kit --node "file:src/index.ts" --format json
```

## slice

Build a bounded graph neighborhood around a focus node.

### Usage

```sh
my-dev-kit slice --index <artifact-dir> --node <node-id>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--node <node-id>`: focus node ID. Required.
- `--depth <n>`: traversal depth. Valid range is 0 through 3.
- `--direction <both|incoming|outgoing>`: traversal direction.
- `--out <path>`: write JSON slice artifact to a file.
- `--json`: print JSON result to stdout.

### Behavior

- Depth 0 returns only the focus node.
- Depth 1 through 3 expands breadth-first.
- Direction controls whether incoming edges, outgoing edges, or both are followed.
- The result includes focus node, included nodes, included edges, and summary counts.
- `slice` reads graph artifacts only.
- `slice` does not read source files.
- `slice` does not require Graphviz.

## view

Render `code-graph.json` as DOT, SVG, or PNG.

### Usage

```sh
my-dev-kit view --index <artifact-dir> --format <dot|svg|png> --out <path>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--format <dot|svg|png>`: output format.
- `--out <path>`: output path.
- `--edge-style <semantic|labeled|minimal>`: edge visualization style.
- `--allow-dot-fallback`: for SVG or PNG requests, write DOT instead of failing when Graphviz is unavailable.
- `--json`: print JSON result to stdout.

### Graphviz behavior

- DOT output does not require Graphviz.
- SVG output requires the Graphviz `dot` executable.
- PNG output requires the Graphviz `dot` executable.
- If Graphviz is unavailable and `--allow-dot-fallback` is used, DOT is written instead of the requested SVG or PNG.

## data-model

Build or inspect data-model artifacts from an existing index.

The `data-model` command consumes artifacts written by `index`. It does not replace `index`, modify source files, or alter `code-graph.json`.

### Usage

Generate data-model artifacts:

```sh
my-dev-kit data-model --index <artifact-dir> --out <artifact-dir> --json
```

Inspect an exact entity:

```sh
my-dev-kit data-model --index <artifact-dir> --entity <name-or-id> --json
```

Inspect an exact field:

```sh
my-dev-kit data-model --index <artifact-dir> --field <entity.field> --json
```

Trace static model-to-view lineage for an entity:

```sh
my-dev-kit data-model --index <artifact-dir> --trace-view <entity> --json
```

Trace static model-to-view lineage for an exact field:

```sh
my-dev-kit data-model --index <artifact-dir> --field <entity.field> --trace-view --json
```

### Flags

- `--index <dir>`: required. Directory containing `manifest.json`, `symbol-index.json`, and `code-graph.json`.
- `--out <dir>`: output directory for generated `data-model` and lineage artifacts. Defaults to `--index`.
- `--entity <name-or-id>`: inspect an exact entity from existing `data-model.json`.
- `--field <entity.field>`: inspect an exact field from existing `data-model.json`.
- `--trace-view [entity]`: build conservative static model-to-view lineage for an entity or for the field selected with `--field`.
- `--json`: print compact JSON output.

### Generation mode

Generation mode writes:

- `data-model.json`
- `data-model-graph.json`

Output summary fields include:

- `status`
- `mode`
- `indexDir`
- `outDir`
- `dataModelPath`
- `dataModelGraphPath`
- `entityCount`
- `fieldCount`
- `relationshipCount`
- `graphNodeCount`
- `graphEdgeCount`
- `warningCount`
- `warnings`

Warnings do not fail the command by themselves. Unsupported or ambiguous extraction cases are reported conservatively.

### Lookup mode

Lookup mode reads existing `data-model.json` and `data-model-graph.json`.

Entity lookup:

- exact by entity name
- exact by stable entity ID
- no fuzzy matching

Field lookup:

- exact `Entity.field` selector only
- returns the parent entity and selected field

### Trace-view mode

Trace mode builds conservative static lineage from data-model artifacts plus indexed TypeScript or TSX source evidence.

Trace mode writes:

- `model-view-lineage.json`

Entity trace output includes:

- `status`
- `mode`
- `indexDir`
- `outDir`
- `modelViewLineagePath`
- `entity`
- `lineageNodeCount`
- `lineageEdgeCount`
- `warningCount`
- `lineage`
- `warnings`

Field trace output includes:

- `status`
- `mode`
- `indexDir`
- `outDir`
- `modelViewLineagePath`
- `entity`
- `field`
- `lineageNodeCount`
- `lineageEdgeCount`
- `warningCount`
- `lineage`
- `warnings`

### Mode rules

- `--index` is always required.
- `--entity` cannot be combined with `--trace-view`.
- `--entity` and `--field` cannot be combined.
- `--field` lookup uses exact `Entity.field` syntax only.
- `--field <entity.field> --trace-view` requires the bare `--trace-view` flag.
- `--trace-view <entity>` requires an entity value when `--field` is not used.

### Supported v1.1.0 extraction behavior

The current extractor is conservative and TypeScript-focused. It supports:

- exported interfaces with property signatures
- exported type aliases whose right side is an object literal type
- exported classes with property declarations
- exact entity and field inspection over generated artifacts
- conservative static lineage where field identity remains explicit in the same file or directly connected local evidence

### Known limitations

- The v1.1.0 data-model extractor does not support Prisma, SQL, Django, SQLAlchemy, TypeORM, or Sequelize.
- Data-model artifacts are separate from `code-graph.json`.
- The data-model graph is separate from the code graph and uses its own node and edge IDs.
- Model-to-view lineage is static evidence only. It does not claim runtime rendering, route reachability, browser-state behavior, or full React render-flow understanding.
- Unsupported patterns such as dynamic property access, spread props, computed property names, and unresolved indirect calls are reported as warnings or omitted conservatively.
- Lookup mode requires existing `data-model` artifacts.

### Examples

Generate data-model artifacts from an existing index:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

Inspect an entity:

```sh
my-dev-kit data-model --index .my-dev-kit --entity User --json
```

Inspect a field:

```sh
my-dev-kit data-model --index .my-dev-kit --field User.email --json
```

Trace an entity into conservative static view usage:

```sh
my-dev-kit data-model --index .my-dev-kit --trace-view User --json
```

Trace a field into conservative static view usage:

```sh
my-dev-kit data-model --index .my-dev-kit --field User.email --trace-view --json
```

## Bundled examples

The bundled examples are useful for smoke tests and learning the command flow.

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --out examples/basic-data-model-ts/.my-dev-kit --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --entity User --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --trace-view User --json
```

## Troubleshooting

### Missing index manifest

Run `index` first or check the `--index` path.

### Missing data-model artifacts

Lookup mode requires existing `data-model.json` and `data-model-graph.json`.

Generate them first:

```sh
my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

### Unknown node ID

Use `search` to find valid node IDs.

### Entity or field not found

`data-model` lookup is exact only. Use the exact entity name, entity ID, or `Entity.field` selector recorded in `data-model.json`.

### Graphviz not found

DOT output does not require Graphviz. `data-model` generation and trace-view mode do not require Graphviz.
