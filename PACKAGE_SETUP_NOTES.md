# Package Setup Notes

This file is for maintainers and packaging decisions. For user-facing documentation, see README.md, docs/COMMANDS.md, and docs/QUICKSTART.md.

## Package identity

- **Name:** `@dailephd/my-dev-kit`
- **Version:** `1.0.0`
- **Binary name:** `my-dev-kit`
- **License:** MIT
- **Copyright:** 2026 dailephd LLC
- **Visibility:** scoped public package; publish manually with `npm publish --access public`
- **Description:** Local codebase graph, indexing, slicing, source retrieval, search, and Graphviz visualization CLI

## Runtime entrypoint

- Source entry: `src/cli.ts`
- Built entry: `dist/cli.js`
- Build tool: `tsup` (ESM output targeting Node 18)

Run without building during development:

```sh
npm run dev -- <args>
```

Run the built CLI:

```sh
node dist/cli.js <args>
```

## Build setup

```sh
npm run build       # compile src/cli.ts to dist/cli.js
npm run typecheck   # TypeScript type check (no emit)
npm run verify      # typecheck + build + documentation validation (no tests)
npm run clean       # remove dist/
```

Build configuration is in `tsup.config.ts`. TypeScript configuration is in `tsconfig.json`.
For complete validation, run `npm test` once and `npm run verify` once. The
full Vitest suite belongs to `npm test`; `npm run verify` intentionally does
not rerun it.

## Test setup

```sh
npm run test        # run all tests with vitest
```

Tests are in `tests/`. They use `vitest` with child-process CLI invocation via `tests/lookup/testCli.ts`. Most integration tests spawn the CLI using `tsx` (TypeScript direct execution) to avoid requiring a build step.

Test suites by area:

- `tests/index/` — indexing and manifest
- `tests/cli/` — command registration and top-level help
- `tests/lookup/` — lookup, source, and rendering
- `tests/slice/` — slice command
- `tests/view/` — DOT builder and view command
- `tests/search/` — search command and index search

## Included runtime source folders

- `src/commands/` — CLI command implementations
- `src/graph/` — DOT builder, edge convention, Graphviz rendering, graph types
- `src/indexing/` — index orchestration, artifact loading
- `src/io/` — file I/O utilities
- `src/languages/` — language adapter registry and per-language adapters (TypeScript, JavaScript, Python)

Note: the CLI program name was updated from `my-dev-kit-v1` to `my-dev-kit` in `src/cli.ts` to match the `my-dev-kit` binary name in `package.json`. Tests in `tests/cli/` were updated accordingly.
- `src/lookup/` — source retrieval, symbol resolution, slice logic
- `src/search/` — search indexing and ranking
- `src/source/` — source output rendering (format and file writing)
- `src/symbol-index/` — symbol index construction

## Reference-only folders

- `alpha-import/` — candidate code copied from my-dev-kit-alpha for reference during V1 development; excluded from TypeScript compilation; not part of the runtime API; not published

The `alpha-import/` directory must remain excluded from `tsconfig.json` and from any published package.

## Generated artifact directories

- `examples/basic-ts/.my-dev-kit-v1/` — index artifacts for the bundled example
- `.my-dev-kit-v1-self/` — self-index artifacts generated during validation; not committed to source control
- Any `.my-dev-kit-v1` directory created by running `index` against a project

These directories contain JSON artifacts written by the CLI. They should not be treated as source files.

## Graphviz dependency note

Graphviz is an optional external tool. The `view` command:

- Generates DOT without Graphviz.
- Requires the `dot` executable from Graphviz to render SVG or PNG.
- Falls back to DOT output when `--allow-dot-fallback` is set and Graphviz is unavailable.

Graphviz is not a declared npm dependency. Users must install it separately if SVG or PNG output is needed.

## Command surface

Six commands are implemented and registered in `src/cli.ts`:

| Command  | Source file                        |
| -------- | ---------------------------------- |
| `index`  | `src/commands/indexCommand.ts`     |
| `lookup` | `src/commands/lookupCommand.ts`    |
| `source` | `src/commands/sourceCommand.ts`    |
| `slice`  | `src/commands/sliceCommand.ts`     |
| `view`   | `src/commands/viewCommand.ts`      |
| `search` | `src/commands/searchCommand.ts`    |

## Known exclusions

V1 intentionally does not include:

- LLM calls or API integrations
- Code editing or source modification
- Orchestrator or backend agent execution
- PromptPack or context bundle generation
- Evaluation or milestone workflows
- Documentation generation workflows
- Full semantic call graph accuracy; call graph extraction is static and conservative
- Semantic similarity search (search is keyword-based)

## CI/CD

The GitHub Actions workflow is at `.github/workflows/ci.yml`.

- Triggers: push to `main`, all pull requests
- Runner: `ubuntu-latest`, Node.js 20 LTS
- Uses `npm ci` (not `npm install`) for reproducible installs
- Runs: typecheck → test → build → verify → CLI smoke checks
- Smoke checks index `examples/basic-ts` and run `search` and `view --format dot`
- Does not install Graphviz; SVG/PNG rendering is not validated in CI
- CI smoke artifacts are written to `examples/basic-ts/.my-dev-kit-v1-ci/`, which is covered by `.gitignore`

See `docs/CI_CD.md` for the full description and local equivalent commands.

## Package contents policy

The `package.json` `files` field controls what is included in the npm package:

- `dist/` — built CLI (single bundled file)
- `README.md` — user-facing overview and installation
- `LICENSE` — MIT license text
- `CHANGELOG.md` — release notes
- `docs/` — full command, schema, architecture, and workflow documentation
- `examples/basic-ts/` — bundled TypeScript example project
- `examples/basic-python/` — bundled Python example project

Excluded from the package:
- `src/` — TypeScript source (not needed at runtime)
- `tests/` — test suites
- `alpha-import/` — reference material only
- `.my-dev-kit-v1*` — generated index artifacts
- `node_modules/`, `dist/` (from gitignore patterns)
- All scratch planning files and audit artifacts

## Release validation commands

```sh
npm test
npm run verify
npm audit
npm pack --dry-run
npm pack
npm install -g ./dailephd-my-dev-kit-1.0.0.tgz
my-dev-kit --help
npm uninstall -g @dailephd/my-dev-kit
```

See `docs/RELEASE.md` for the full release checklist and publish instructions.

## Release readiness checklist

Before publishing:

- `npm test` passes once (the full Vitest suite)
- `npm run verify` passes (typecheck + build + documentation validation, without rerunning tests)
- `dist/cli.js` exists with shebang `#!/usr/bin/env node`
- `LICENSE` exists with MIT text and copyright `2026 dailephd LLC`
- `CHANGELOG.md` exists
- `package.json` has no `"private": true` field
- `src/version.ts` `VERSION` constant matches `package.json` version
- `npm pack --dry-run` shows only intended package contents
- Packed tarball installs and `my-dev-kit --help` works
- `alpha-import/` is not in the packed tarball
- Release is published manually with `npm publish --access public`
