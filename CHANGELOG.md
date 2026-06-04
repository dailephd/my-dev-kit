# Changelog

## 1.1.0 - YYYY-MM-DD

Added data-model graph extraction and conservative model-to-view lineage.

- Added the `data-model` command for data-model generation, exact entity lookup, exact field lookup, and conservative static `trace-view` inspection
- Added `data-model.json` and `data-model-graph.json` as separate downstream artifacts
- Added `model-view-lineage.json` for conservative static lineage evidence
- Added conservative TypeScript model extraction for supported exported interfaces, exported object-literal type aliases, and exported classes with property declarations
- Added exact entity lookup by name or stable ID and exact field lookup by `Entity.field`
- Added warnings for unsupported or ambiguous extraction and lineage patterns instead of guessed relationships
- Added end-to-end and subsystem coverage for data-model artifacts, command behavior, and lineage behavior
- Preserved existing `index`, `search`, `lookup`, `source`, `slice`, and `view` behavior

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
