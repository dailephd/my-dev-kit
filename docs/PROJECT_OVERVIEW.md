# Project Overview

## What this project is

my-dev-kit is a local, deterministic command-line tool for indexing TypeScript, JavaScript, and Python codebases, inspecting their structure, retrieving bounded source context, generating semantic and data-model artifacts, and tracing supported static model-to-view lineage.

It runs offline and works through file-based JSON artifacts. It does not require a server, does not call external APIs, does not call language models, and does not modify source files.

## Purpose

Large codebases are difficult to inspect manually and too expensive to paste into coding-agent workflows without filtering. Developers usually need a smaller set of facts:

- where a file or symbol is located
- what a file imports or exports
- which symbols are defined in a file
- how graph nodes relate to one another
- what semantic role a symbol plays (data entity, data field, etc.)
- which source excerpt is relevant to a task
- which entities and fields exist in a supported model layer
- where a supported model field is statically transformed or rendered

my-dev-kit provides this structural and semantic view through deterministic local artifacts that can be searched, inspected, sliced, rendered, and reused by humans or downstream tools.

## Current release scope

Version 1.6.0 supports:

- indexing TypeScript, JavaScript, and Python source roots
- extracting per-file symbol tables, imports, exports, dependencies, and source locations
- building a typed code graph of file and symbol nodes
- generating an optional static call graph
- running semantic analyzers as part of the index run
- embedding compact `semanticRoles` and `artifactRefs` on symbols and code-graph nodes
- recording analyzer status and artifact paths in `manifest.json` as the authoritative artifact registry
- searching indexed files, symbols, edges, and semantic roles by keyword
- looking up exact graph nodes with bounded neighbor expansion and semantic metadata
- retrieving bounded source by line range, symbol name, or node ID with semantic metadata propagation
- slicing a bounded graph neighborhood around a focus node with semantic metadata preserved
- rendering the code graph as DOT, SVG, or PNG
- generating `data-model.json` and `data-model-graph.json` as part of the index run
- conservative TypeScript model extraction for supported static model patterns
- exact entity and field inspection from data-model artifacts
- generating `model-view-lineage.json` in `trace-view` mode
- conservative static model-to-view lineage tracing for supported TypeScript and TSX cases
- generating `frontend-semantic.json` for supported TSX/JSX frontend structures
- generating `frontend-reachability.json` for static route, browser-storage, UI-marker, and cross-domain reachability evidence
- querying exact route, storage-key, and UI-marker facts through `search`, `lookup`, `slice`, and `source`
- rendering route, browser-storage, and UI-reachability graph views
- continuing bounded source retrieval past an initial preview window, and expanding to same-file local dependencies (types, props, local components, imports, helpers), with reasons for every included block (v1.4.0)
- running a conservative static classification analyzer that assigns files and symbols a schema/layer category, edit guidance, readiness, additive risk labels, evidence, and an uncertainty tier
- generating `classification.json` and embedding compact `classificationRoles`/`classificationRefs` on symbols and code-graph nodes
- surfacing classification metadata through `search`, `lookup` (including an opt-in `--resolve-classification` flag for full detail), `slice`, and `source` (v1.5.0)
- generating bounded `context-capsule.json` artifacts and optional `retrieval-audit-record.json` artifacts for query-focused downstream planning
- ranking context candidates deterministically with bounded `general`, `feature-add`, and `subsystem` mode behavior
- selecting bounded graph and source evidence for context capsules, with conservative static conflict detection and `--no-source` source suppression

## Public commands

my-dev-kit provides eight public commands.

| Command | Purpose |
| --- | --- |
| `index` | Index source roots, run semantic analyzers, and write all artifacts |
| `search` | Search indexed files, symbols, edges, and semantic roles by keyword |
| `lookup` | Look up a graph node by exact node ID, including semantic metadata |
| `source` | Retrieve bounded source by line range, symbol name, or node ID |
| `slice` | Build a bounded graph neighborhood around a focus node |
| `view` | Render the code graph as DOT, SVG, or PNG |
| `data-model` | Inspect exact entities or fields, regenerate data-model artifacts, and trace supported static view usage |
| `context` | Build a bounded context capsule and optional retrieval audit for a task query against an existing index |

## Generated artifacts

The `index` command writes:

- `manifest.json` — artifact registry, analyzer registry, project metadata, and summary counts
- `symbol-index.json` — per-file symbol tables with compact semantic roles per symbol
- `code-graph.json` — graph of file and symbol nodes with compact semantic roles on symbol nodes
- `call-graph.json` — optional static call graph, when `--call-graph` is requested
- `data-model.json` — data entities, fields, relationships, and source evidence, when the TypeScript model analyzer runs
- `data-model-graph.json` — derived semantic graph of data-model entities and fields, when the TypeScript model analyzer runs
- `frontend-semantic.json` — React component, prop, hook, handler, JSX, and test facts, when the frontend analyzer runs on TSX/JSX files
- `frontend-reachability.json` — static route, browser-storage, and UI-marker reachability facts, when the frontend analyzer runs on TSX/JSX files
- `classification.json` — conservative static schema/layer classification of files and symbols, whenever the classification analyzer runs (v1.5.0)

The `data-model` command additionally writes:

- `model-view-lineage.json` — conservative static lineage, in `trace-view` mode

The recommended local artifact directory is:

```sh
.my-dev-kit
```

Re-run `index` to refresh the artifact directory when source changes. Stale artifacts are removed automatically. `manifest.json` always reflects the current artifact state.

The data-model and lineage artifacts are separate from `code-graph.json` and use their own node and edge ID space.

## Typical user workflow

Install the package globally:

```sh
npm install -g @dailephd/my-dev-kit
```

Index a project:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

Re-run `index` to refresh when source changes:

```sh
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

Search to discover relevant node IDs, including by semantic role:

```sh
my-dev-kit search --index .my-dev-kit --query "<term>" --limit 20 --json
```

Look up a selected node with semantic metadata:

```sh
my-dev-kit lookup --index .my-dev-kit --node "<node-id>" --depth 1 --json
```

Build a graph slice around the selected node:

```sh
my-dev-kit slice --index .my-dev-kit --node "<node-id>" --depth 2 --direction both --json
```

Retrieve source context:

```sh
my-dev-kit source --index .my-dev-kit --file "<path>" --start <n> --end <n> --format numbered
```

Inspect a generated entity or field:

```sh
my-dev-kit data-model --index .my-dev-kit --entity User --json
my-dev-kit data-model --index .my-dev-kit --field User.email --json
```

Trace supported static view usage:

```sh
my-dev-kit data-model --index .my-dev-kit --trace-view User --json
my-dev-kit data-model --index .my-dev-kit --field User.email --trace-view --json
```

## Conservative static analysis stance

The semantic and data-model layers build on the existing artifact model and remain deliberately narrow.

Current v1.6.0 scope:

- conservative TypeScript model extraction producing `data-entity` and `data-field` semantic roles
- compact semantic metadata embedded in structural artifacts, linked to detailed artifacts via `artifactRefs`
- conservative same-project static lineage where field identity remains explicit
- React/TSX frontend analysis producing `frontend-semantic.json` with components, hooks, handlers, JSX regions, and UI strings
- exact source string retrieval with context, classification, and repeated literal reporting
- React region and local component-tree prop/event-flow retrieval
- frontend semantic graph views: react-component, react-flow, react-prop-event-flow, frontend-test
- static frontend reachability analysis producing `frontend-reachability.json`
- exact route, storage-key, and UI-marker retrieval with bounded source and graph views
- bounded source continuation and same-file local dependency expansion (v1.4.0)
- conservative static schema/layer classification of files and symbols, producing `classification.json` and compact `classificationRoles`/`classificationRefs` (v1.5.0)
- bounded context capsules and retrieval audit records with deterministic query planning, candidate ranking, graph/source selection, retention, adequacy assessment, conservative static conflict detection, and optional source suppression (v1.6.0)
- warnings for unsupported, ambiguous, or low-confidence patterns

Current v1.6.0 does not claim:

- full ORM or schema coverage
- runtime database behavior
- runtime React rendering behavior
- runtime route reachability
- runtime browser-state tracing
- full React render-flow tracing
- semantic similarity search or embedding-based retrieval
- an automatic or authoritative "safe to edit" decision — classification edit guidance, readiness, and risk labels are advisory signals backed by static evidence, not a substitute for the developer's own judgment
- the v1.7.0 internal retrieval regression suite or a plugin architecture

## What my-dev-kit does not do

my-dev-kit does not provide:

- LLM calls
- external API integrations
- code editing or source modification
- autonomous agent execution
- semantic similarity search or embedding-based retrieval
- package publishing automation
- GitHub release automation

## Product boundary with my-dev-kit-lab

`my-dev-kit` owns product retrieval behavior. v1.7.0 provides an internal retrieval regression suite that checks whether deterministic fixtures still produce the right bounded context, source, classification, conflict, and audit behavior after product changes. `npm run benchmark:retrieval` runs six representative local tasks through the real index/context pipeline, evaluates stable expectations, captures capsule/audit/execution artifacts, and reports `PASS`, `REGRESSION`, or `BLOCKED`. It remains separate from `npm run verify` and is not a public command, performance benchmark, browser/runtime check, LLM evaluation, or exhaustive coverage claim.

`my-dev-kit-lab` owns release and security validation. It answers whether a release candidate is safe to ship, whether package contents and dependencies are acceptable, and whether external release gates passed. It should not replace product-specific retrieval-quality assertions inside `my-dev-kit`.

## Current limitations

- Symbol records include start lines but not complete end-line bounds.
- Symbol-mode source retrieval returns a bounded preview from the symbol start line and may include a capped-preview warning.
- Use line-range retrieval when exact source bounds are required.
- Call graph extraction is best-effort static syntactic analysis.
- Data-model extraction is conservative and limited to supported TypeScript model patterns.
- Semantic roles currently produced: `data-entity` and `data-field` from `typescript-model-analyzer`. Other defined roles are planned.
- Unsupported dynamic or ambiguous lineage patterns are warned or omitted.
- Lookup requires exact node IDs, exact entity names or IDs, and exact `Entity.field` selectors.
- Route, browser-storage, and UI-reachability analysis remain conservative static evidence only and may omit dynamic or computed values.

## Support the project

my-dev-kit is independently developed and maintained by dailephd / dailephd LLC.

If the project helps your work, you can optionally support continued development through:

- GitHub Sponsors: https://github.com/sponsors/dailephd
- PayPal: https://paypal.me/daile88

Support is appreciated, but not required. The project remains usable under its published license.

## Documentation map

- `README.md` - install, quickstart, and release-level feature summary
- `COMMANDS.md` - full command and flag reference
- `GRAPH_SCHEMA.md` - artifact formats, node IDs, edge kinds, semantic roles, and downstream artifact structure
- `ARCHITECTURE.md` - internal subsystem structure and design boundaries
- `WORKFLOWS.md` - practical usage workflows and graph-guided retrieval
- `SECURITY.md` - security model, path boundaries, subprocess behavior, and audit notes
- `DEVELOPMENT.md` - source-repository setup, tests, build, and local package testing
- `RELEASE.md` - manual npm release checklist
- `ROADMAP.md` - implemented features and planned improvements
