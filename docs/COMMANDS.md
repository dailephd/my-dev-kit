# Commands

my-dev-kit provides six public CLI commands:

- index
- search
- lookup
- source
- slice
- view

Use this document as the command reference for the installed CLI.

For usage workflows, see WORKFLOWS.md.
For graph artifact details, see GRAPH_SCHEMA.md.
For internal architecture, see ARCHITECTURE.md.

## Installation

Install the package globally:

    npm install -g @dailephd/my-dev-kit

Check that the CLI is available:

    my-dev-kit --help
    my-dev-kit --version

## Path conventions

Most workflows follow this pattern:

    my-dev-kit index --root . --src src --out .my-dev-kit --json
    my-dev-kit search --index .my-dev-kit --query "service" --json
    my-dev-kit lookup --index .my-dev-kit --node "file:src/index.ts" --json
    my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered
    my-dev-kit slice --index .my-dev-kit --node "file:src/index.ts" --depth 1 --json
    my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot

Path rules:

- Run commands from your project root unless you intentionally pass another root.
- index uses --root to define the project root.
- index resolves --src paths relative to --root.
- index resolves --out relative to --root.
- Read commands use --index to point at the artifact directory created by index.
- Node IDs must be exact.
- Use search to find node IDs before calling lookup, source, slice, or view.

Recommended artifact directory:

    .my-dev-kit

## index

Index local source files and write graph artifacts.

Supported languages:

- TypeScript
- JavaScript
- Python

Supported source extensions:

- .ts
- .tsx
- .js
- .jsx
- .py

### Usage

    my-dev-kit index --root <project-root> --src <source-root> --out <artifact-dir>

### Flags

- --root <path>
  Project root. Source roots and output paths are resolved relative to this path.

- --src <path>
  Source root to index, relative to --root. May be repeated. Required.

- --language <language>
  Language hint. Supported values are typescript, javascript, and python. When omitted, language is inferred from file extensions.

- --out <dir>
  Output directory for index artifacts, relative to --root.

- --exclude <path-or-name>
  Directory name or relative path prefix to exclude. May be repeated. This is path/name based, not glob based.

- --dry-run
  Scan and report what would be indexed without writing artifacts.

- --progress
  Print bounded progress diagnostics to stderr.

- --call-graph
  Write call-graph.json using conservative static call analysis when supported.

- --json
  Print JSON result to stdout.

### Default ignored directories

The indexer skips common dependency, generated, build, and cache directories before reading files from them.

Default ignored directory names include:

- node_modules
- .next
- dist
- build
- coverage
- playwright-report
- test-results
- output
- out
- .cache
- .turbo
- .vercel
- .git
- .pytest_cache
- __pycache__
- .venv
- venv

The --exclude flag adds extra directory names or relative path prefixes.

Examples:

    --exclude generated

Skips any directory segment named generated.

    --exclude apps/web/.next

Skips that relative path prefix.

### Artifacts

index writes the following files inside --out:

- manifest.json
- symbol-index.json
- code-graph.json

When --call-graph is requested and call graph data is available, index also writes:

- call-graph.json

### Examples

Index the current project:

    my-dev-kit index --root . --src src --out .my-dev-kit --json

Index with call graph generation:

    my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json

Index a Python project:

    my-dev-kit index --root . --src src --language python --out .my-dev-kit --json

Index multiple source roots:

    my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json

Preview a scan without writing artifacts:

    my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --dry-run --json

Show progress while keeping JSON output clean on stdout:

    my-dev-kit index --root . --src apps/web/app --src apps/web/lib --out .my-dev-kit-web --progress --json

Index targeted folders in a large monorepo:

    my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --json

Split indexes by area:

    my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --json
    my-dev-kit index --root . --src apps/web/tests --src apps/web/e2e --out .my-dev-kit-web-tests --exclude playwright-report --exclude test-results --json
    my-dev-kit index --root . --src apps/nlp-service/src --language python --out .my-dev-kit-nlp --call-graph --json
    my-dev-kit index --root . --src scripts --out .my-dev-kit-scripts --json

### Python behavior

Python indexing requires Python 3.8 or later on PATH as python or python3.

Python extraction supports:

- top-level functions
- async top-level functions
- top-level classes
- ALL_CAPS constants
- Final-annotated constants
- imports
- __all__ when defined as a plain list

Python export behavior:

- symbols are considered exported unless their name starts with _
- if __all__ is defined as a plain list, only names in __all__ are marked exported

Python call graph extraction uses static AST parsing. It records conservative call edges for straightforward calls such as:

- foo()
- self.foo()
- module.foo()
- ClassName.method()

Python source files are parsed but not executed.

## search

Search indexed files, symbols, and graph edges by keyword.

### Usage

    my-dev-kit search --index <artifact-dir> --query <text>

### Flags

- --index <dir>
  Index artifact directory.

- --query <text>
  Search query text. Required.

- --limit <n>
  Maximum number of results. Valid range is 1 through 100.

- --json
  Print JSON result to stdout.

### Searched fields

search checks:

- file paths
- file labels
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

### Behavior

- Search is local.
- Search is deterministic.
- Search is keyword-based.
- Multi-word queries match results containing any query term.
- Result scores are deterministic ranking values.
- Scores are not probabilities or confidence values.
- Search does not call LLMs.
- Search does not use embeddings.
- Search does not read arbitrary source files.
- Search does not modify project files.

### Examples

Search for service-related files or symbols:

    my-dev-kit search --index .my-dev-kit --query "service" --limit 20 --json

Search for a known symbol name:

    my-dev-kit search --index .my-dev-kit --query "formatUser" --json

Search for import or export related matches:

    my-dev-kit search --index .my-dev-kit --query "imports exports" --limit 10 --json

## lookup

Look up a graph node by exact node ID.

### Usage

    my-dev-kit lookup --index <artifact-dir> --node <node-id>

### Flags

- --index <dir>
  Index artifact directory.

- --node <node-id>
  Exact node ID. Required.

- --depth <n>
  Neighbor expansion depth. Valid range is 0 through 3.

- --json
  Print JSON result to stdout.

### Behavior

- lookup is exact-match only.
- Depth 0 returns only the focus node.
- Depth 1 through 3 expands neighbors breadth-first.
- Lookup includes incoming edges, outgoing edges, and neighboring nodes.
- Partial matching and fuzzy matching are not supported.
- Use search first when the exact node ID is unknown.

### Node ID formats

File node:

    file:<relative-path>

Example:

    file:src/index.ts

Symbol node:

    symbol:<relative-path>#<symbol-name>

Example:

    symbol:src/index.ts#describeUser

### Examples

Look up a file node:

    my-dev-kit lookup --index .my-dev-kit --node "file:src/index.ts" --depth 1 --json

Look up a symbol node:

    my-dev-kit lookup --index .my-dev-kit --node "symbol:src/index.ts#describeUser" --depth 2 --json

## source

Retrieve bounded source content from an indexed project.

### Usage

source supports three retrieval modes.

Retrieve by node ID:

    my-dev-kit source --index <artifact-dir> --node <node-id>

Retrieve by file line range:

    my-dev-kit source --index <artifact-dir> --file <path> --start <n> --end <n>

Retrieve by symbol name inside a file:

    my-dev-kit source --index <artifact-dir> --file <path> --symbol <name>

Use one retrieval mode per command.

### Flags

- --index <dir>
  Index artifact directory.

- --node <node-id>
  File or symbol node ID.

- --file <path>
  Source file path relative to the indexed project root.

- --start <n>
  Start line for line-range retrieval.

- --end <n>
  End line for line-range retrieval.

- --symbol <name>
  Symbol name to retrieve from the selected file.

- --max-lines <n>
  Maximum number of lines to return.

- --format <json|plain|numbered>
  Output format.

- --out <path>
  Write rendered output to a file.

- --json
  Alias for --format json.

### Output formats

- json
  Structured result with metadata.

- plain
  Retrieved source content only.

- numbered
  Retrieved source content with source line numbers.

### Safety behavior

source enforces:

- project-root containment
- path traversal rejection
- valid line ranges
- max-lines limits
- read-only source access

source never modifies source files.

### Symbol retrieval limitation

The current index records symbol start lines but not complete symbol end lines.

Because of this, symbol retrieval returns a bounded preview from the symbol start line and may include a warning. Use explicit line-range retrieval when exact bounds are required.

### Examples

Retrieve a numbered source range:

    my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format numbered

Retrieve a symbol preview:

    my-dev-kit source --index .my-dev-kit --file src/index.ts --symbol describeUser --format numbered

Retrieve by node ID:

    my-dev-kit source --index .my-dev-kit --node "file:src/index.ts" --format json

Write source output to a file:

    my-dev-kit source --index .my-dev-kit --file src/index.ts --start 1 --end 40 --format plain --out output/index.ts

## slice

Build a bounded graph neighborhood around a focus node.

### Usage

    my-dev-kit slice --index <artifact-dir> --node <node-id>

### Flags

- --index <dir>
  Index artifact directory.

- --node <node-id>
  Focus node ID. Required.

- --depth <n>
  Traversal depth. Valid range is 0 through 3.

- --direction <both|incoming|outgoing>
  Traversal direction.

- --out <path>
  Write JSON slice artifact to a file.

- --json
  Print JSON result to stdout.

### Behavior

- Depth 0 returns only the focus node.
- Depth 1 through 3 expands breadth-first.
- Direction controls whether incoming edges, outgoing edges, or both are followed.
- The result includes focus node, included nodes, included edges, and summary counts.
- slice reads graph artifacts only.
- slice does not read source files.
- slice does not require Graphviz.

### Examples

Slice one hop around a file:

    my-dev-kit slice --index .my-dev-kit --node "file:src/index.ts" --depth 1 --json

Slice two hops in both directions:

    my-dev-kit slice --index .my-dev-kit --node "file:src/index.ts" --depth 2 --direction both --json

Write a slice artifact:

    my-dev-kit slice --index .my-dev-kit --node "file:src/index.ts" --depth 1 --direction incoming --out .my-dev-kit/slice.json

## view

Render code-graph.json as DOT, SVG, or PNG.

### Usage

    my-dev-kit view --index <artifact-dir> --format <dot|svg|png> --out <path>

### Flags

- --index <dir>
  Index artifact directory.

- --format <dot|svg|png>
  Output format.

- --out <path>
  Output path.

- --edge-style <semantic|labeled|minimal>
  Edge visualization style.

- --allow-dot-fallback
  For SVG or PNG requests, write DOT instead of failing when Graphviz is unavailable.

- --json
  Print JSON result to stdout.

### Edge styles

semantic:

- applies distinct DOT marker and line-style attributes per edge kind
- emits a legend

labeled:

- emits inline edge labels

minimal:

- emits edges without labels, attributes, or legend

### Graphviz behavior

- DOT output does not require Graphviz.
- SVG output requires the Graphviz dot executable.
- PNG output requires the Graphviz dot executable.
- If Graphviz is unavailable and --allow-dot-fallback is used, DOT is written instead of the requested SVG or PNG.

### Examples

Write DOT output:

    my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot

Write labeled DOT output:

    my-dev-kit view --index .my-dev-kit --format dot --edge-style labeled --out .my-dev-kit/graph.labeled.dot

Write minimal DOT output:

    my-dev-kit view --index .my-dev-kit --format dot --edge-style minimal --out .my-dev-kit/graph.minimal.dot

Write SVG output:

    my-dev-kit view --index .my-dev-kit --format svg --out .my-dev-kit/graph.svg

Request SVG but fall back to DOT if Graphviz is unavailable:

    my-dev-kit view --index .my-dev-kit --format svg --allow-dot-fallback --out .my-dev-kit/graph.dot

## Recommended graph-guided retrieval workflow

Use this workflow when preparing context for a coding task.

### 1. Build the index

    my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json

### 2. Search for candidate files or symbols

    my-dev-kit search --index .my-dev-kit --query "<task term>" --limit 20 --json

### 3. Look up the strongest node

    my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json

### 4. Slice the graph around the strongest node

    my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --out .my-dev-kit/task-slice.json

### 5. Retrieve bounded source

Retrieve by symbol when possible:

    my-dev-kit source --index .my-dev-kit --file "<path>" --symbol "<symbol-name>" --format numbered

Use line-range retrieval when exact bounds are needed:

    my-dev-kit source --index .my-dev-kit --file "<path>" --start <n> --end <n> --format numbered

### 6. Render the graph when useful

    my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot --edge-style semantic

## Bundled examples

The bundled examples are useful for smoke tests and learning the command flow.

Index the TypeScript example:

    my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json

Search the TypeScript example:

    my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

Index the Python example:

    my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --json

Search the Python example:

    my-dev-kit search --index examples/basic-python/.my-dev-kit --query "greet" --limit 5 --json

## Troubleshooting

### Missing index manifest

Run index first or check the --index path.

Example:

    my-dev-kit index --root . --src src --out .my-dev-kit --json

Then use:

    --index .my-dev-kit

### Unknown node ID

Use search to find valid node IDs.

    my-dev-kit search --index .my-dev-kit --query "<name>" --limit 20 --json

### Symbol not found

Check the symbol name and file path.

Use search to confirm the symbol was indexed:

    my-dev-kit search --index .my-dev-kit --query "<symbol-name>" --json

### Range exceeds max-lines

Reduce the requested range or increase --max-lines.

### Graphviz not found

DOT output does not require Graphviz.

Use DOT output:

    my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot

Or allow DOT fallback for SVG or PNG requests:

    my-dev-kit view --index .my-dev-kit --format svg --allow-dot-fallback --out .my-dev-kit/graph.dot

### Python interpreter not found

Install Python 3.8 or later and ensure python or python3 is available on PATH.

Python indexing checks both command names automatically.

### Empty or unexpectedly small index

Check:

- --root points to the intended project root
- --src points to real source folders
- default ignored directories are not hiding the intended files
- --exclude is not too broad
- --language matches the source files, if provided

Use dry-run to inspect what would be indexed:

    my-dev-kit index --root . --src src --out .my-dev-kit --dry-run --json