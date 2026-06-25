# Changelog

## 1.3.0 - 2026-06-25

Added route-aware, browser-storage-aware, and UI-reachability retrieval backed by a new static frontend reachability artifact.

- Added `frontend-reachability.json`, a static semantic artifact that records route, browser-storage, UI-marker, and reachability evidence
- Added route-aware retrieval for static route, page, navigation, and test evidence through `search`, `lookup`, `slice`, and `source`
- Added browser-storage tracing for supported `sessionStorage` and `localStorage` read, write, remove, and clear patterns
- Added static UI reachability evidence connecting routes, components, UI markers, storage keys, gates, and tests where detectable
- Added `--route`, `--storage-key`, and `--ui` selectors to `search`, `lookup`, `slice`, and `source`
- Added `view --graph route`, `view --graph browser-storage`, and `view --graph ui-reachability`
- Updated React/TSX examples and command documentation to demonstrate v1.3.0 route, storage, and UI reachability workflows
- Notes: v1.3.0 is conservative static analysis only; it does not execute applications, run browsers, prove runtime UI visibility, or prove user reachability

## 1.2.0 - 2026-06-18

Added React/TSX and frontend-test indexing, exact source string retrieval and repeated literal reporting, React region retrieval, local component-tree prop/event-flow retrieval, and four new frontend semantic graph views.

- Added frontend analyzer running as part of `index`: produces `frontend-semantic.json` for `.tsx` and `.jsx` files
- Added `frontend-semantic.json` containing exported and local React components, prop types, hooks, handlers, JSX regions, test blocks, locators, and UI strings
- Added `source --contains` for exact string retrieval across all indexed files with context lines, match classification, and repeated literal reporting
- Added `source --path` for path-prefix filtering of `--contains` results
- Added `source --react-region` for retrieving a named React region (component, hook, handler, JSX region, prop type) by name from the frontend semantic artifact
- Added `source --include-local-component-tree` for retrieving a component and its local child components as a connected source bundle with prop, callback, state, handler, and branch blocks
- Added `source --prop` for filtering local-component-tree output to a specific prop name
- Added `view --graph react-component` for rendering exported and local components with structural relationships
- Added `view --graph react-flow` for rendering all frontend flow facts: hooks, handlers, JSX regions, and flow relationships
- Added `view --graph react-prop-event-flow` for rendering only prop and event flow relationships
- Added `view --graph frontend-test` for rendering test structure from frontend test facts in `frontend-semantic.json`
- Added `search` enrichment from frontend semantic values: `data-testid` and `aria-label` values are indexed and ranked alongside symbol matches
- Added `basic-react-tsx` bundled example with `WorkspaceEditorShell` TSX component and pre-built `.my-dev-kit-index` artifacts
- Known limitation: the base indexer excludes `.test.` and `.spec.` files from default file discovery; `view --graph frontend-test` produces output only when test files reach the frontend analyzer through a custom indexing path

## 1.1.0 - 2026-05-01

Added index-first semantic integration, manifest as authoritative artifact registry, semantic role metadata on index artifacts, data-model artifacts linked from the index, and semantic-aware search, lookup, slice, and source commands.

- Added managed artifact refresh: `index` removes stale artifacts from previous runs when refreshing the artifact directory
- Added `manifest.json` as the authoritative artifact registry for the current run, including `semanticArtifacts` paths and an `analyzers` array with status per analyzer
- Added `semanticRoles` and `artifactRefs` arrays on symbols in `symbol-index.json` and on symbol nodes in `code-graph.json`, populated by the TypeScript model analyzer
- Added the TypeScript model analyzer running as part of `index`: produces `data-entity` and `data-field` roles for qualifying exported interfaces, type aliases, and classes
- Added `data-model.json` and `data-model-graph.json` written by `index` when the TypeScript model analyzer produces output
- Added semantic schema `1.0.0` with defined role names, confidence levels, source identifiers, artifact refs, and evidence refs
- Added semantic-aware search: `search` indexes `semanticRole`, `semanticSubtype`, `semanticSource`, and `semanticArtifactRef` fields; result items include `semanticRoles` and `artifactRefs` when present
- Added semantic metadata to `lookup` output: `semanticRoles`, `artifactRefs`, and `evidenceRefs` returned from the focus node when present
- Added semantic metadata preservation in `slice` output: nodes carry `semanticRoles` and `artifactRefs` from `code-graph.json`
- Added semantic metadata propagation in `source` output: `semanticRoles`, `artifactRefs`, and `evidenceRefs` from the symbol target included in JSON output
- Added the `data-model` command for focused inspection and regeneration of data-model artifacts, exact entity lookup, exact field lookup, and conservative static `trace-view`
- Added `model-view-lineage.json` for conservative static lineage evidence in `trace-view` mode
- Added `view --graph <code|data-model|model-view-lineage>` for rendering code, data-model, and model-to-view lineage graph artifacts through the existing DOT/SVG/PNG Graphviz pipeline
- Added conservative TypeScript model extraction for exported interfaces, exported object-literal type aliases, and exported classes with property declarations
- Added exact entity lookup by name or stable ID and exact field lookup by `Entity.field`
- Added warnings for unsupported or ambiguous extraction and lineage patterns instead of guessed relationships
- Added end-to-end and subsystem coverage for semantic metadata contracts, managed artifacts, manifest authority, and semantic-aware command behavior

## 1.0.0 - 2026-05-29

Initial release.

- Six CLI commands: `index`, `lookup`, `source`, `slice`, `view`, `search`
- TypeScript, JavaScript, and Python indexing with symbol extraction, code graph, and optional static call graph
- Python indexing covers functions, classes, constants, imports, and conservative syntactic call edges
- Graph-guided symbol retrieval workflow: `search` -> `lookup` -> `slice` -> `source`
- Source output formats: `json`, `plain`, `numbered`; file output with `--out`
- Semantic graph visualization with three edge styles: `semantic` (default), `labeled`, `minimal`; DOT, SVG, and PNG output
- Deterministic local keyword search over indexed artifacts with field-weighted ranking
- Security hardening: artifact path containment, source retrieval path containment, DOT escaping, Graphviz subprocess isolation
- CI validation baseline via GitHub Actions
- MIT license, copyright 2026 dailephd LLC
