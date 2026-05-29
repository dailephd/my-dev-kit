# Changelog

## 1.0.0 — 2026-05-29

Initial release.

- Six CLI commands: `index`, `lookup`, `source`, `slice`, `view`, `search`
- TypeScript, JavaScript, and Python indexing with symbol extraction, code graph, and optional static call graph
- Python indexing covers functions, classes, constants, imports, and conservative syntactic call edges
- Graph-guided symbol retrieval workflow: search → lookup → slice → source
- Source output formats: `json`, `plain`, `numbered`; file output with `--out`
- Semantic graph visualization with three edge styles: `semantic` (default), `labeled`, `minimal`; DOT, SVG, and PNG output
- Deterministic local keyword search over indexed artifacts with field-weighted ranking
- Security hardening: artifact path containment, source retrieval path containment, DOT escaping, Graphviz subprocess isolation
- CI validation baseline via GitHub Actions
- MIT license, copyright 2026 dailephd LLC
