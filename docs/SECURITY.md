# Security

This document describes the security model, boundaries, and audit findings for my-dev-kit.

For command flags, see [COMMANDS.md](COMMANDS.md). For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Security model

my-dev-kit is a local, offline CLI tool. It reads source files and JSON artifact files from the local filesystem and writes output files. It does not:

- Make network requests
- Call external services or LLMs
- Execute arbitrary code from indexed projects
- Spawn shells or evaluate dynamic input as code

The attack surface is limited to:

- Crafted JSON artifact files (`manifest.json`, `code-graph.json`, `symbol-index.json`) that could cause path traversal or trigger unsafe behavior during artifact loading
- Malicious file paths embedded in artifacts that could read files outside the project root during source retrieval
- DOT output injection through symbol names, node IDs, or edge labels
- The Graphviz `dot` subprocess invocation (SVG/PNG rendering only)

## Boundaries enforced

### Source retrieval path containment

`getSourceSlice` enforces that all source file reads stay within `manifest.projectRoot`. The check uses `path.relative` and rejects any path whose relative form starts with `..` or is absolute.

Paths that escape the project root are rejected with a clear error before any file I/O occurs.

### Artifact path containment

`readIndexManifest` resolves artifact paths recorded in `manifest.json` (for `symbolIndex`, `codeGraph`, `callGraph`) relative to the index directory and validates that each resolved path stays within the index directory using `isInsideRoot`. A crafted manifest with paths like `../../../../etc/passwd` is rejected before the artifact file is opened.

### DOT output escaping

`buildDotGraph` quotes all node IDs, node labels, edge source/target IDs, and edge labels through a single `quote()` function that escapes backslashes (`\` → `\\`), double-quotes (`"` → `\"`), and newlines (CR+LF/LF → `\n`). This prevents DOT syntax injection through symbol names, file paths, or user-provided edge labels in artifact data.

### Graphviz subprocess isolation

`renderGraphviz` invokes `dot` using `spawnSync` with `shell: false`. The DOT content is passed as stdin, not as a shell argument or temporary file. The format argument is pre-validated to be `'svg'` or `'png'` before the subprocess is launched. There is no shell interpolation.

### Python indexing subprocess isolation

Python indexing invokes `python` or `python3` with `shell: false` and passes embedded `ast` parsing scripts via `python -c`. Indexed Python source is provided on stdin and parsed statically. my-dev-kit does not import or execute user Python modules during symbol, import, or call-graph extraction.

### Traversal limits

All graph traversal operations are bounded:

- Slice depth: 0 through 3 (`validateSliceInputs`)
- Lookup depth: 0 through 3 (`validateDepth`)
- Source line range: capped by `--max-lines` (default 160), enforced in `validateLineRange`
- Search result limit: 1 through 100 (`parseLimit`)

These limits prevent runaway traversal on large or pathologically-shaped graphs.

### Output path behavior

The `--out` flags in `source`, `view`, and `slice` commands accept user-specified output paths. These paths are resolved to absolute form and parent directories are created automatically. There is no traversal restriction on output destinations — users control where output is written. This is intentional for a local CLI tool.

## User responsibilities when indexing private repositories

my-dev-kit reads source files and writes index artifacts containing file paths, symbol names, and import data from the indexed project. When indexing a private repository:

- Index artifacts (`manifest.json`, `symbol-index.json`, `code-graph.json`) contain structural metadata about the project. Treat them with the same access controls as the source code.
- The `--out` directory should be placed inside the project root or another location that matches your project's access policy.
- Do not publish index artifacts or include them in version control unless intentional.

## Dependency security

The production runtime has no npm dependencies beyond Node.js built-ins and the `commander` package for CLI argument parsing.

The `esbuild` package used in the build and test infrastructure has a known moderate-severity advisory (GHSA-67mh-4wv8-2f99) affecting `esbuild ≤ 0.24.2` via `vite` and `vitest`. This affects development tooling only. The built `dist/cli.js` output does not include esbuild or vite at runtime.

Run `npm audit` to see the current advisory status. Upgrading `vitest` to v4.x would resolve the esbuild advisory but may introduce breaking changes in the test suite.

## Security test coverage

Security tests are in `tests/security/`:

| File | What it tests |
| ---- | -------------- |
| `pathTraversal.spec.ts` | `ensureInsideProjectRoot` and `isInsideRoot` reject `../` traversal patterns |
| `malformedArtifacts.spec.ts` | `readIndexManifest` rejects missing, invalid, or traversal-exploiting manifests |
| `dotEscaping.spec.ts` | `buildDotGraph` escapes quotes, backslashes, newlines, and angle brackets |
| `outputPath.spec.ts` | Write helpers create parent directories and return normalized paths |
| `graphTraversalLimits.spec.ts` | Slice depth, lookup depth, and source line range limits are enforced |

## Reporting

This is a local open-source CLI tool with no external services. If you discover a security issue, open an issue in the project repository with a description of the finding and a reproduction case.
