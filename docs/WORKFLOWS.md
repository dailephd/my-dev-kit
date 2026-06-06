# Workflows

Practical usage workflows for my-dev-kit. For the full flag reference, see [COMMANDS.md](COMMANDS.md). For artifact and schema details, see [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md).

## Overview

The recommended usage pattern:

1. Run `index` into `.my-dev-kit`. Re-run `index` to refresh the artifact directory when source changes. Do not create a new index folder for every run unless you are deliberately taking a snapshot.
2. Use `search` to discover relevant node IDs, including by semantic role when available.
3. Use `lookup` to inspect exact nodes and their semantic metadata.
4. Use `slice` to inspect graph neighborhoods while preserving semantic metadata on nodes.
5. Use `source` to retrieve specific code excerpts.
6. Use `data-model` for entity, field, and trace-view tasks when data-model artifacts are present.
7. Use `view` to render the code graph as DOT, SVG, or PNG when a visual overview is needed.

Do not start by reading the full graph or full source tree. Use `search` first to narrow the context.

---

## Workflow 1: Index a TypeScript or JavaScript project

Run `index` from the project root:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

The `--out` path is relative to `--root`. The above creates or refreshes `.my-dev-kit/`.

Re-run the same command to refresh the artifact directory when source changes. The directory is updated in place and stale artifacts are removed.

Include a call graph:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --call-graph --json
```

Index multiple source roots:

```sh
my-dev-kit index --root . --src src --src tests --out .my-dev-kit --json
```

For large monorepos, avoid indexing broad roots that contain application output, dependency folders, caches, or generated artifacts. Target the source folders that matter for the current workflow:

```sh
my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --json
```

my-dev-kit skips common generated, dependency, cache, and build directories by default, including `node_modules`, `.next`, `dist`, `build`, `coverage`, `playwright-report`, `test-results`, `output`, `out`, `.cache`, `.turbo`, `.vercel`, `.git`, `.pytest_cache`, `__pycache__`, `.venv`, and `venv`. Add project-specific exclusions with repeated `--exclude` values:

```sh
my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --exclude .next --exclude coverage --exclude apps/web/generated --json
```

Use `--dry-run` before indexing a large tree, and add `--progress` when you want phase and count diagnostics. Progress is written to stderr and does not corrupt JSON stdout.

```sh
my-dev-kit index --root . --src apps/web --out .my-dev-kit-web --dry-run --json
my-dev-kit index --root . --src apps/web/app --src apps/web/lib --out .my-dev-kit-web --progress --json
```

Split indexes can keep focused workflows faster and easier to inspect:

```sh
my-dev-kit index --root . --src apps/web/app --src apps/web/lib --src apps/web/prisma --out .my-dev-kit-web --call-graph --json
my-dev-kit index --root . --src apps/web/tests --src apps/web/e2e --out .my-dev-kit-web-tests --exclude playwright-report --exclude test-results --json
my-dev-kit index --root . --src apps/nlp-service/src --language python --out .my-dev-kit-nlp --call-graph --json
my-dev-kit index --root . --src scripts --out .my-dev-kit-scripts --json
```

---

## Workflow 2: Index a Python project

Python indexing requires `python` or `python3` on `PATH` with Python 3.8 or later. The `--language python` flag selects Python mode. Language can also be inferred from `.py` file extensions.

**Step 1: Index the Python source root**

```sh
my-dev-kit index --root . --src src --language python --out .my-dev-kit --json
```

Include a static call graph when call edges are useful:

```sh
my-dev-kit index --root . --src src --language python --out .my-dev-kit --call-graph --json
```

**Step 2: Search for Python symbols**

```sh
my-dev-kit search --index .my-dev-kit --query "greet" --limit 20 --json
```

**Step 3: Look up a Python node**

```sh
my-dev-kit lookup --index .my-dev-kit --node file:src/main.py --depth 1 --json
```

**Step 4: Retrieve Python source**

```sh
my-dev-kit source --index .my-dev-kit --file src/main.py --symbol greet --format numbered
```

Use line-range retrieval for exact bounds:

```sh
my-dev-kit source --index .my-dev-kit --file src/main.py --start 1 --end 40 --format numbered
```

**Python notes:**

- Call-graph extraction is static and conservative. It uses `ast` parsing and may miss dynamic calls.
- If no Python interpreter is found on `PATH`, Python files are skipped with a warning in the manifest.

---

## Workflow 3: Graph-Guided Symbol Retrieval

Graph-Guided Symbol Retrieval is the recommended approach when navigating an unfamiliar codebase. It avoids broad file reading by narrowing context progressively from keyword search to exact graph nodes to targeted source excerpts.

**Step 1: Index the project**

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

**Step 2: Search to narrow candidates**

```sh
my-dev-kit search --index .my-dev-kit --query "<relevant term>" --limit 20 --json
```

Inspect `nodeId`, `kind`, and `matchReasons` in the results. Prefer symbol nodes when the target is a specific function, class, or type. When semantic metadata is present, result items include `semanticRoles` and `artifactRefs`, and match reasons may include `semanticRole` as a contributing field.

**Step 3: Look up the strongest candidate**

```sh
my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json
```

Review incoming edges, outgoing edges, and neighbors to understand the node's relationships. Repeat for adjacent nodes as needed.

**Step 4: Slice around the focus node**

```sh
my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
```

The slice provides a bounded subgraph view that is easier to reason about than the full graph.

**Step 5: Retrieve source for specific symbols**

Use symbol-mode retrieval when possible:

```sh
my-dev-kit source --index .my-dev-kit --file "<path>" --symbol "<symbol-name>" --format numbered
```

Use line-range retrieval when symbol-mode is too broad or incomplete:

```sh
my-dev-kit source --index .my-dev-kit --file "<path>" --start <n> --end <n> --format numbered
```

**What to avoid:**

- Do not read full `code-graph.json` manually to find node IDs. Use `search` first.
- Do not retrieve large line ranges when a symbol name is known. Use `--symbol` mode first.
- Do not iterate all files before searching. Let `search` narrow the scope.

---

## Workflow 4: Generate graph visualization

DOT output does not require Graphviz:

```sh
my-dev-kit view --index .my-dev-kit --format dot --out .my-dev-kit/graph.dot
my-dev-kit view --index .my-dev-kit --format dot --edge-style labeled --out .my-dev-kit/graph.labeled.dot
my-dev-kit view --index .my-dev-kit --format dot --edge-style minimal --out .my-dev-kit/graph.minimal.dot
```

SVG output requires Graphviz:

```sh
my-dev-kit view --index .my-dev-kit --format svg --out .my-dev-kit/graph.svg
```

Fall back to DOT if Graphviz is unavailable:

```sh
my-dev-kit view --index .my-dev-kit --format svg --allow-dot-fallback --out .my-dev-kit/graph.dot
```

Use `--format dot` for automated checks. Reserve SVG or PNG for interactive review.

---

## Workflow 5: Use my-dev-kit with ChatGPT or a coding agent

LLMs perform better when given bounded, relevant context instead of whole files or broad project dumps. my-dev-kit helps collect that context deterministically from your local project.

my-dev-kit does not call LLMs, does not edit files, and does not act as an autonomous agent. It prepares local bounded context for you or for downstream tools.

**Command sequence**

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
my-dev-kit search --index .my-dev-kit --query "<topic>" --limit 20 --json
my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json
my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
my-dev-kit source --index .my-dev-kit --file "<path>" --symbol "<symbol-name>" --format numbered
```

**What to paste into the LLM**

- Selected search output or a concise summary of the strongest matches
- Selected lookup output
- Selected graph slice or a concise summary of nearby nodes and edges
- Numbered source excerpts
- File paths, symbol names, and node IDs used to retrieve the context

**What not to paste**

- The entire source tree
- Full `symbol-index.json`
- Full `code-graph.json`
- Broad unrelated files
- Generated artifacts that are not relevant to the current task

**Reusable prompt template**

```text
I am using my-dev-kit to provide bounded codebase context.

Task:
<describe the coding, debugging, documentation, or refactoring task>

Repository context:
Project root: <project root>
Index directory: .my-dev-kit
Source roots indexed: <source roots>

Graph-guided retrieval:
Search query used:
<query>

Search results:
<paste selected search JSON or summarized result>

Selected node:
<node-id>
Reason selected:
<why this node is the strongest candidate>

Lookup result:
<paste lookup result or concise summary>

Graph slice:
<paste slice result or concise summary>

Source excerpts:
<paste numbered source output with file paths>

Instructions:
Use only the provided context unless you explicitly say what additional file, symbol, or graph node is needed.
Do not assume unrelated files were inspected.
If the context is insufficient, ask for the next my-dev-kit search, lookup, slice, or source command to run.
Prefer targeted changes grounded in the retrieved source.
Explain which provided evidence supports your answer.
```

**When to rerun commands**

- Re-run `index` after source changes so graph artifacts match the current project.
- Use better query terms if `search` results are weak. Try symbol names, feature terms, error text, file names, or imported module names.
- Use `lookup --depth 1` first. Increase depth only when the immediate graph neighborhood is insufficient.
- Use `slice --depth 1` or `slice --depth 2` depending on context size.
- Use line-range source retrieval when symbol retrieval is too broad or incomplete.

---

## Bundled examples

The examples are for cloned repositories, documentation writers, and package smoke tests. Normal npm users should run my-dev-kit inside their own project.

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --json
my-dev-kit search --index examples/basic-python/.my-dev-kit --query "greet" --limit 5 --json
```

---

## Troubleshooting

**Problem: "Missing index manifest"**
The index artifact directory does not contain `manifest.json`. Run `index` first, or check the `--index` path.

**Problem: "Unknown node ID"**
The node ID passed to `lookup`, `source`, or `slice` is not in the graph. Use `search` to discover valid node IDs.

**Problem: "Symbol not found"**
The symbol name does not match any indexed symbol in the specified file. Run `search --query <symbol-name>` to confirm spelling and which file contains it.

**Problem: "Graphviz dot executable is not available"**
SVG and PNG rendering requires Graphviz. Install Graphviz, use `--format dot`, or add `--allow-dot-fallback`.

**Problem: Result content is capped with a preview warning**
Symbol retrieval is bounded from the start line. Increase `--max-lines` or use line-range mode with explicit `--start` and `--end` values.

**Problem: Python symbols not indexed or warnings about Python interpreter**
Python indexing requires `python` or `python3` on `PATH`. Install Python 3.8 or later and ensure the interpreter is accessible.
