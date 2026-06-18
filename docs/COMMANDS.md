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

Use without installing globally:

```sh
npx @dailephd/my-dev-kit --help
npx @dailephd/my-dev-kit --version
```

Or install globally:

```sh
npm install -g @dailephd/my-dev-kit
```

## Path conventions

Most workflows follow this pattern:

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "service" --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "file:src/index.ts" --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "file:src/index.ts" --depth 1 --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph data-model --format dot --out .my-dev-kit/data-model.dot
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --entity User --json
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
npx @dailephd/my-dev-kit index --root <project-root> --src <source-root> --out <artifact-dir>
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

After indexing, `index` runs semantic analyzers. The TypeScript model analyzer runs on TypeScript and TSX source and produces `data-entity` and `data-field` semantic roles for exported interfaces, type aliases, and classes that qualify as data models.

The frontend analyzer runs on `.tsx` and `.jsx` source files to produce the frontend semantic artifact. It extracts:

- Exported React components (function and arrow-function forms)
- Local (non-exported) React components
- Prop type interfaces and type aliases
- Hook blocks (`useState`, `useEffect`, and others)
- Event handlers and inline handlers
- JSX return regions
- UI strings (`data-testid`, `aria-label`)

The frontend analyzer also detects files that match test file patterns (`.test.`, `.spec.`, `__tests__`) and extracts test facts (describe/test/it blocks, setup/teardown, locators, route strings) when those files are in the symbol index. **Note:** The base indexer excludes files matching `.test.` and `.spec.` from default file discovery. Test facts in `frontend-semantic.json` are only present when test files reach the symbol index through a source root that the indexer processes.

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

When the frontend analyzer processes TSX/JSX files:

- `frontend-semantic.json`

### Examples

```sh
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json
npx @dailephd/my-dev-kit index --root . --src src --language python --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
npx @dailephd/my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --dry-run --json
```

## search

Search indexed files, symbols, graph edges, and semantic roles by keyword.

### Usage

```sh
npx @dailephd/my-dev-kit search --index <artifact-dir> --query <text>
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
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "service" --limit 20 --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "formatUser" --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "data-entity User" --json
```

## lookup

Look up a graph node by exact node ID, including semantic metadata.

### Usage

```sh
npx @dailephd/my-dev-kit lookup --index <artifact-dir> --node <node-id>
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

`source` supports multiple retrieval modes:

```sh
# Line range retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --file <path> --start <n> --end <n>

# Symbol retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --file <path> --symbol <name>

# Node ID retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --node <node-id>

# Exact string search across all indexed files
npx @dailephd/my-dev-kit source --index <artifact-dir> --contains <string>

# React region retrieval by region name
npx @dailephd/my-dev-kit source --index <artifact-dir> --react-region <region> --file <path>

# Local component-tree retrieval
npx @dailephd/my-dev-kit source --index <artifact-dir> --symbol <component-name> --file <path> --include-local-component-tree
```

Use one retrieval mode per command.

### Flags

- `--index <dir>`: index artifact directory.
- `--node <node-id>`: file or symbol node ID.
- `--file <path>`: source file path relative to the indexed project root.
- `--start <n>`: start line for line-range retrieval.
- `--end <n>`: end line for line-range retrieval.
- `--symbol <name>`: symbol name to retrieve from the selected file.
- `--contains <string>`: exact string to search for across all indexed source files.
- `--context <n>`: number of context lines around each `--contains` match. Default: 3. Max: 20.
- `--path <prefix>`: path prefix filter for `--contains` (e.g. `src/components`). May not contain `..`.
- `--react-region <region>`: React region name to retrieve. Resolves a component, local component, JSX region, hook, or prop type by name from the frontend semantic artifact. Requires `--file`.
- `--include-local-component-tree`: retrieve the named component and its local child components as a connected source bundle. Requires `--symbol`.
- `--prop <name>`: filter local component-tree retrieval to show the named prop. Requires `--include-local-component-tree`.
- `--max-lines <n>`: maximum number of lines to return.
- `--format <json|plain|numbered>`: output format.
- `--out <path>`: write rendered output to a file.
- `--json`: alias for `--format json`.

### --contains behavior

`--contains` searches for an exact string match across all indexed source files (from `symbol-index.json`). Each match includes:

- `filePath`: the file containing the match
- `line` and `column`: the exact match location
- `context`: surrounding lines (controlled by `--context`)
- `classification`: whether the match appears to be a `declaration-like`, `usage-like`, or `unknown` context, based on static heuristics
- `frontendContext`: optional frontend value context when the string appears as a frontend-indexed literal

Multiple occurrences of the same string across files are all reported. `--path` narrows results to files whose path starts with the given prefix.

`--contains` cannot be combined with `--file`, `--symbol`, `--node`, `--start`, `--end`, or `--react-region`.

### --react-region behavior

`--react-region` looks up a named React region from the frontend semantic artifact and retrieves its source slice. Resolution priority:

1. component (exported)
2. local-component
3. jsx-region
4. hook
5. prop-type

Matching is case-insensitive; exact case is preferred over case-insensitive. When the region is not found, the error lists available region names in the file.

JSON output includes a `reactRegion` block with `matchedKind`, `matchedId`, and `matchedName`.

`--react-region` requires `--file`. It cannot be combined with `--contains`, `--symbol`, `--node`, `--start`, or `--end`.

### --include-local-component-tree behavior

`--include-local-component-tree` retrieves the named component (`--symbol`) and its local child components as connected source blocks, using statically extracted prop and event flow relationships from the frontend semantic artifact.

This is static analysis only. It does not trace runtime rendering, route reachability, or browser-state behavior.

Requires `--symbol` and `--file`. Cannot be combined with `--contains` or `--react-region`.

### Semantic metadata propagation

When `--node` or `--symbol` mode is used, the source result propagates `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the symbol when present in the index. These appear in the JSON output.

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
# Line range
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered

# Symbol
npx @dailephd/my-dev-kit source --index .my-dev-kit --file src/index.ts --symbol describeUser --format numbered

# Node ID
npx @dailephd/my-dev-kit source --index .my-dev-kit --node "file:src/index.ts" --format json

# Exact string search
npx @dailephd/my-dev-kit source --index .my-dev-kit --contains "workspace-editor-empty-state" --context 5 --format numbered

# Exact string with path filter
npx @dailephd/my-dev-kit source --index .my-dev-kit --contains "structured-content" --path src/components --context 3 --format json

# React region
npx @dailephd/my-dev-kit source --index .my-dev-kit --react-region WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --format numbered

# Local component tree
npx @dailephd/my-dev-kit source --index .my-dev-kit --symbol WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --include-local-component-tree --format numbered

# Local component tree with prop filter
npx @dailephd/my-dev-kit source --index .my-dev-kit --symbol WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --include-local-component-tree --prop onSuccess --format numbered
```

## slice

Build a bounded graph neighborhood around a focus node.

### Usage

```sh
npx @dailephd/my-dev-kit slice --index <artifact-dir> --node <node-id>
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

Render graph artifacts as DOT, SVG, or PNG. By default, `view` renders `code-graph.json`.

### Usage

```sh
npx @dailephd/my-dev-kit view --index <artifact-dir> --graph <selection> --format <dot|svg|png> --out <path>
```

### Flags

- `--index <dir>`: index artifact directory.
- `--graph <code|data-model|model-view-lineage|react-component|react-flow|react-prop-event-flow|frontend-test>`: graph artifact to render. Defaults to `code`.
- `--format <dot|svg|png>`: output format.
- `--out <path>`: output path.
- `--edge-style <semantic|labeled|minimal>`: edge visualization style.
- `--allow-dot-fallback`: for SVG or PNG requests, write DOT instead of failing when Graphviz is unavailable.
- `--json`: print JSON result to stdout.

### Graph selection

Supported `--graph` values:

- `code`: renders the manifest-referenced `code-graph.json`.
- `data-model`: renders the manifest-referenced `data-model-graph.json`.
- `model-view-lineage`: renders the manifest-referenced `model-view-lineage.json`.
- `react-component`: renders a static React component graph from `frontend-semantic.json`. Nodes: file (box), exported component (box), local component (ellipse), prop type (diamond). Edges: `contains`, `renders`, `uses-props`.
- `react-flow`: renders all frontend flow facts from `frontend-semantic.json`. Nodes: component, local-component, hook, handler, JSX region, flow-fact. Edges: all extracted flow relationship kinds.
- `react-prop-event-flow`: renders only prop and event flow relationships from `frontend-semantic.json`. Same node types as `react-flow`, filtered to `react-passes-prop`, `react-fires-event`, `react-handles-event`, and `react-receives-prop` relationship kinds.
- `frontend-test`: renders frontend test structure from `frontend-semantic.json`. Only test files (`isTestFile=true`). Nodes: test-file (box), describe (box), test/it (ellipse), setup/teardown (oval), locator (diamond), route-string (oval).

`--graph` is optional. The default is `code`.

The data-model and lineage graph modes require `manifest.json` to reference the corresponding artifact. The four frontend graph modes (`react-component`, `react-flow`, `react-prop-event-flow`, `frontend-test`) require `manifest.json` to reference `frontendSemantic`. `view` does not scan the directory for stale files.

Frontend graphs are separate from the code graph. They are rendered from `frontend-semantic.json` at command time and are not merged into `code-graph.json`, `data-model-graph.json`, or `model-view-lineage.json`.

### Graphviz behavior

- DOT output does not require Graphviz.
- SVG output requires the Graphviz `dot` executable.
- PNG output requires the Graphviz `dot` executable.
- If Graphviz is unavailable and `--allow-dot-fallback` is used, DOT is written instead of the requested SVG or PNG.

### Examples

Render the default code graph:

```sh
npx @dailephd/my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/code.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph code --format dot --out .my-dev-kit/code.dot --json
```

Render the data-model graph:

```sh
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph data-model --format dot --out .my-dev-kit/data-model.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph data-model --format svg --out .my-dev-kit/data-model.svg --allow-dot-fallback --json
```

Render model-to-view lineage:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --trace-view User --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph model-view-lineage --format dot --out .my-dev-kit/lineage.dot --json
```

Render frontend graphs (requires TSX/JSX files in the index):

```sh
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-component --format dot --out .my-dev-kit/react-component.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-flow --format dot --out .my-dev-kit/react-flow.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph react-prop-event-flow --format dot --out .my-dev-kit/react-prop-event-flow.dot --json
npx @dailephd/my-dev-kit view --index .my-dev-kit --graph frontend-test --format dot --out .my-dev-kit/frontend-test.dot --json
```

All four frontend graph views render static artifact-backed graphs. They do not claim runtime React behavior, route reachability, or browser-state behavior.

## data-model

Inspect or regenerate data-model artifacts from an existing index.

The `data-model` command is a focused inspection and regeneration command. It consumes artifacts written by `index`. It does not replace `index`, modify source files, or alter `code-graph.json`.

When `index` runs, it already produces `data-model.json` and `data-model-graph.json` through the built-in semantic analyzers. Use `data-model` when you want to inspect specific entities or fields, run trace-view for an entity, or regenerate data-model artifacts with a different `--out` directory.

### Usage

Inspect an exact entity from existing data-model artifacts:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --entity <name-or-id> --json
```

Inspect an exact field from existing data-model artifacts:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --field <entity.field> --json
```

Regenerate data-model artifacts from the index:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --out <artifact-dir> --json
```

Trace static model-to-view lineage for an entity:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --trace-view <entity> --json
```

Trace static model-to-view lineage for an exact field:

```sh
npx @dailephd/my-dev-kit data-model --index <artifact-dir> --field <entity.field> --trace-view --json
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
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --entity User --json
```

Inspect a field:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --field User.email --json
```

Trace an entity into conservative static view usage:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --trace-view User --json
```

Trace a field into conservative static view usage:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --field User.email --trace-view --json
```

Regenerate data-model artifacts explicitly:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

## Bundled examples

The bundled examples are useful for smoke tests and learning the command flow.

```sh
npx @dailephd/my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

npx @dailephd/my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --entity User --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --trace-view User --json

npx @dailephd/my-dev-kit index --root examples/basic-react-tsx --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --contains "workspace-editor-empty-state" --context 5 --format numbered
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit --graph react-component --format dot --out examples/basic-react-tsx/.my-dev-kit/react-component.dot
```

## Troubleshooting

### Missing index manifest

Run `index` first or check the `--index` path.

### Missing data-model artifacts

`index` writes `data-model.json` and `data-model-graph.json` automatically when the TypeScript model analyzer finds qualifying source. If the files are missing, the source may not contain qualifying exported interfaces, type aliases, or classes, or the index was run without those source roots.

To regenerate explicitly:

```sh
npx @dailephd/my-dev-kit data-model --index .my-dev-kit --out .my-dev-kit --json
```

### Missing frontend-semantic artifact

`index` writes `frontend-semantic.json` automatically when the frontend analyzer finds `.tsx`, `.jsx`, or test files. If the artifact is missing, either no qualifying files were found or the source root was not indexed.

### --react-region region not found

When `--react-region` fails with "region not found," the error output lists available region names for the given `--file`. Use one of the listed names.

### Unknown node ID

Use `search` to find valid node IDs.

### Entity or field not found

`data-model` lookup is exact only. Use the exact entity name, entity ID, or `Entity.field` selector recorded in `data-model.json`.

### Graphviz not found

DOT output does not require Graphviz. `data-model` generation and trace-view mode do not require Graphviz. Frontend graph views in DOT format do not require Graphviz.
