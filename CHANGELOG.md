# Changelog

## 1.1.0 - YYYY-MM-DD

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
