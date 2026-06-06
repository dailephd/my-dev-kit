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
my-dev-kit data-model --index .my-dev-kit --entity User --json
```

Path rules:

- Run commands from your project root unless you intentionally pass another root.
- `index` uses `--root` to define the project root.
- `index` resolves `--src` paths relative to `--root`.
- `index` resolves `--out` relative to `--root`.
- Read commands use `--index` to point at the artifact directory created by `index`.
- `data-model` reads index artifacts from `--index` and writes any additional data-model artifacts to `--out` or back into `--index` when `--out` is omitted.
- Node IDs must be exact.
- Use `search` to find node IDs before calling `lookup`, `source`, `slice`, or `view`.

Recommended artifact directory:

```sh
.my-dev-kit
```

Re-run `index` to refresh the artifact directory when source changes. The directory is refreshed in place; stale artifacts from previous runs are removed.

## index

Index local source files, run semantic analyzers, and write index and semantic artifacts.

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
- `--out <dir>`: output directory for index artifacts, relative to `--root`. Defaults to `.my-dev-kit`.
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

### Semantic analyzer behavior

After indexing, `index` runs semantic analyzers. The TypeScript model analyzer currently runs on TypeScript and TSX source and produces `data-entity` and `data-field` semantic roles for exported interfaces, type aliases, and classes that qualify as data models.

Compact `semanticRoles` and `artifactRefs` arrays are embedded on the relevant symbols in `symbol-index.json` and on the corresponding symbol nodes in `code-graph.json`. These link back to the detailed data-model artifacts through artifact references.

Analyzer results and status are recorded in `manifest.json` under the `analyzers` array.

### Managed artifact refresh

Each `index` run refreshes the artifact directory. Artifacts from previous runs that are no longer produced are removed. `manifest.json` is always the authoritative registry for the current artifact set.

### Artifacts

`index` writes the following files inside `--out`:

- `manifest.json` — artifact registry, analyzer registry, project metadata, and summary counts
- `symbol-index.json` — per-file symbol tables with compact semantic roles where available
- `code-graph.json` — file and symbol graph with compact semantic roles on symbol nodes where available

When `--call-graph` is requested and call graph data is available:

- `call-graph.json`

When the TypeScript model analyzer produces data-model output:

- `data-model.json`
- `data-model-graph.json`

### Examples

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json
my-dev-kit index --root . --src src --language python --out .my-dev-kit --json
my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --dry-run --json
```

## search

Search indexed files, symbols, graph edges, and semantic roles by keyword.

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

### Semantic-aware matching

When semantic metadata is present in the index, search includes `semanticRoles`, `semanticSubtype`, `semanticSource`, and `semanticArtifactRef` fields as weighted search targets. Match reasons in the result reflect which fields contributed to the score, including semantic role matches.

Result items include `semanticRoles` and `artifactRefs` when present on the matched node or symbol.

### Match reason fields

Result items include a `matchReasons` array. Each reason includes:

- `field`: the indexed field that matched (e.g. `symbolName`, `semanticRole`, `path`)
- `term`: the query term that matched

### Examples

```sh
my-dev-kit search --index .my-dev-kit --query "service" --limit 20 --json
my-dev-kit search --index .my-dev-kit --query "formatUser" --json
my-dev-kit search --index .my-dev-kit --query "data-entity User" --json
```

## lookup

Look up a graph node by exact node ID, including semantic metadata.

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

### Semantic metadata

The lookup result includes `semanticRoles`, `artifactRefs`, and `evidenceRefs` when present on the focus node. These fields are drawn from the code graph and reflect the compact semantic metadata written by `index`.

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

### Behavior

When `--node` or `--symbol` mode is used, the source result propagates `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the symbol when present in the index. These appear in the JSON output and are not displayed in plain or numbered text output.

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

### Semantic metadata

Nodes in the slice include their `semanticRoles` and `artifactRefs` from `code-graph.json` when present. Semantic metadata is preserved in slice output.

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

### Scope

`view` renders `code-graph.json` only. It does not render `data-model-graph.json` or `model-view-lineage.json`. Graph visualization for the data-model and lineage artifacts is planned for a future release.

## data-model

Inspect or regenerate data-model artifacts from an existing index.

The `data-model` command is a focused inspection and regeneration command. It consumes artifacts written by `index`. It does not replace `index`, modify source files, or alter `code-graph.json`.

When `index` runs, it already produces `data-model.json` and `data-model-graph.json` through the built-in semantic analyzers. Use `data-model` when you want to inspect specific entities or fields, run trace-view for an entity, or regenerate data-model artifacts with a different `--out` directory.

### Usage

Inspect an exact entity from existing data-model artifacts:

```sh
my-dev-kit data-model --index <artifact-dir> --entity <name-or-id> --json
```

Inspect an exact field from existing data-model artifacts:

```sh
my-dev-kit data-model --index <artifact-dir> --field <entity.field> --json
```

Regenerate data-model artifacts from the index:

```sh
my-dev-kit data-model --index <artifact-dir> --out <artifact-dir> --json
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

Generation mode reads the index and writes:

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

### Supported extraction behavior

The current extractor is conservative and TypeScript-focused. It supports:

- exported interfaces with property signatures
- exported type aliases whose right side is an object literal type
- exported classes with property declarations
- exact entity and field inspection over generated artifacts
- conservative static lineage where field identity remains explicit in the same file or directly connected local evidence

### Known limitations

- The data-model extractor does not support Prisma, SQL, Django, SQLAlchemy, TypeORM, or Sequelize.
- Data-model artifacts are separate from `code-graph.json`.
- The data-model graph is separate from the code graph and uses its own node and edge IDs.
- Model-to-view lineage is static evidence only. It does not claim runtime rendering, route reachability, browser-state behavior, or full React render-flow understanding.
- Unsupported patterns such as dynamic property access, spread props, computed property names, and unresolved indirect calls are reported as warnings or omitted conservatively.
- Lookup mode requires existing `data-model` artifacts.

### Examples

Inspect an entity after running `index`:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
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

Regenerate data-model artifacts explicitly:

```sh
my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

## Bundled examples

The bundled examples are useful for smoke tests and learning the command flow.

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --entity User --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --json
my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --trace-view User --json
```

## Troubleshooting

### Missing index manifest

Run `index` first or check the `--index` path.

### Missing data-model artifacts

`index` writes `data-model.json` and `data-model-graph.json` automatically when the TypeScript model analyzer finds qualifying source. If the files are missing, the source may not contain qualifying exported interfaces, type aliases, or classes, or the index was run without those source roots.

To regenerate explicitly:

```sh
my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

### Unknown node ID

Use `search` to find valid node IDs.

### Entity or field not found

`data-model` lookup is exact only. Use the exact entity name, entity ID, or `Entity.field` selector recorded in `data-model.json`.

### Graphviz not found

DOT output does not require Graphviz. `data-model` generation and trace-view mode do not require Graphviz.
