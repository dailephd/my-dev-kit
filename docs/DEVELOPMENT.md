# Development

This document describes how to work with the my-dev-kit source repository.

For public CLI usage, see COMMANDS.md.
For release steps, see RELEASE.md.
For CI behavior, see CI_CD.md.

## Prerequisites

Required:

- Node.js 18 or later
- npm

Required only for Python indexing tests or manual Python indexing:

- Python 3.8 or later
- python or python3 available on PATH

Optional:

- Graphviz, required only when manually testing SVG or PNG graph rendering

DOT graph output does not require Graphviz.

## Setup

Install dependencies from the repository root:

    npm ci

Build the CLI:

    npm run build

Check the built CLI:

    node dist/cli.js --help
    node dist/cli.js --version

## Development mode

For development without rebuilding after every source change, run the CLI through tsx:

    npm run dev -- <command> <args>

Examples:

    npm run dev -- --help
    npm run dev -- index --root examples/basic-ts --src src --out .my-dev-kit-dev --json
    npm run dev -- search --index examples/basic-ts/.my-dev-kit-dev --query user --json

The development command runs src/cli.ts directly.

## Build

Build the distributable CLI:

    npm run build

Build output:

- dist/cli.js

The build uses tsup with the repository tsup configuration.

The built CLI should start with the Node shebang:

    #!/usr/bin/env node

## Type checking

Run TypeScript type checking:

    npm run typecheck

This runs tsc without emitting compiled files.

## Tests

Run the full test suite:

    npm run test

Tests are located in tests/ and are organized by subsystem.

Main test areas:

- CLI behavior
- indexing
- lookup
- source retrieval
- graph slicing
- graph viewing
- search
- security boundaries
- language adapters

Most integration tests invoke the CLI as a child process against fixture projects in examples/. Unit tests call exported functions directly.

## Full validation

Run the full validation chain before release-related changes or package publishing:

    npm run verify

The verify script runs the main local validation sequence for the repository.

If a more explicit validation sequence is needed, run:

    npm run typecheck
    npm run test
    npm run build
    npm run verify

## Local CLI smoke test

After building, run a basic TypeScript smoke test:

    node dist/cli.js index --root examples/basic-ts --src src --out .my-dev-kit-dev --call-graph --json
    node dist/cli.js search --index examples/basic-ts/.my-dev-kit-dev --query user --limit 5 --json
    node dist/cli.js lookup --index examples/basic-ts/.my-dev-kit-dev --node file:src/index.ts --depth 1 --json
    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format dot --out examples/basic-ts/.my-dev-kit-dev/graph.dot --edge-style semantic --json

Run a Python smoke test when Python is available:

    node dist/cli.js index --root examples/basic-python --src src --language python --out .my-dev-kit-dev --json
    node dist/cli.js search --index examples/basic-python/.my-dev-kit-dev --query greet --limit 5 --json

Clean up local smoke-test artifacts:

    node -e "require('fs').rmSync('examples/basic-ts/.my-dev-kit-dev', { recursive: true, force: true })"
    node -e "require('fs').rmSync('examples/basic-python/.my-dev-kit-dev', { recursive: true, force: true })"

## Local tarball testing

Use local tarball testing to verify installed-package behavior before publishing.

Build and pack the package:

    npm run build
    npm pack

Install the tarball globally:

    npm install -g ./dailephd-my-dev-kit-1.6.0.tgz

Run installed CLI checks:

    my-dev-kit --help
    my-dev-kit --version

Run an installed CLI smoke test:

    my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit-release --call-graph --json
    my-dev-kit search --index examples/basic-ts/.my-dev-kit-release --query user --limit 5 --json
    my-dev-kit view --index examples/basic-ts/.my-dev-kit-release --format dot --out examples/basic-ts/.my-dev-kit-release/graph.dot --edge-style semantic --json

Clean up smoke-test artifacts:

    node -e "require('fs').rmSync('examples/basic-ts/.my-dev-kit-release', { recursive: true, force: true })"

Uninstall the local package after testing:

    npm uninstall -g @dailephd/my-dev-kit

## npm scripts

Common scripts:

- npm run build
  Builds src/cli.ts into dist/cli.js.

- npm run dev -- <args>
  Runs the CLI from source through tsx.

- npm run typecheck
  Runs TypeScript type checking without emitting files.

- npm run test
  Runs all tests with Vitest.

- npm run verify
  Runs the main validation chain.

- npm run clean
  Removes dist/.

## Source layout

Main source directories:

- src/cli.ts
  CLI entry point.

- src/commands/
  One command module per public CLI command.

- src/indexing/
  Index orchestration, source discovery, artifact writing, and artifact loading.

- src/languages/
  Language adapter registry and language-specific adapters.

- src/languages/typescript/
  TypeScript, TSX, JavaScript, and JSX indexing support.

- src/languages/python/
  Python indexing support through Python AST extraction.

- src/symbol-index/
  Per-file symbol table construction.

- src/graph/
  Code graph types, graph slicing support, DOT generation, and Graphviz rendering.

- src/lookup/
  Node lookup, source target resolution, source slicing, and traversal behavior.

- src/search/
  Deterministic keyword search over index artifacts.

- src/source/
  Source output rendering.

- src/io/
  Shared file-system and JSON I/O helpers.

- src/version.ts
  CLI version constant.

## Test layout

Main test directories:

- tests/cli/
  Command registration and CLI behavior.

- tests/index/
  Indexing, manifest writing, artifact writing, and source discovery.

- tests/lookup/
  Lookup behavior, source retrieval, source rendering, and graph slice behavior.

- tests/view/
  DOT generation and graph view behavior.

- tests/search/
  Search behavior and search ranking.

- tests/security/
  Security boundary regression tests.

Security tests cover:

- path traversal protection
- artifact path validation
- malformed artifact handling
- DOT escaping
- output path behavior
- traversal depth limits
- output size limits

## Example projects

The examples directory contains fixture projects used by tests, documentation, and smoke checks.

Included examples:

- examples/basic-ts/
  TypeScript example project.

- examples/basic-python/
  Python example project.

The package may include selected example source folders for public smoke tests. Development-only generated artifacts under examples should not be committed or published.

## Generated files

Common generated directories and files:

- dist/
  Build output. Included in the npm package.

- examples/basic-ts/.my-dev-kit-*/
  Local or CI index artifacts. Not committed.

- examples/basic-python/.my-dev-kit-*/
  Local or CI index artifacts. Not committed.

- *.tgz
  Local npm package tarballs. Not committed.

Generated index artifacts should be treated as disposable unless a specific test fixture intentionally requires one.

## Package contents

The published npm package should include:

- dist/
- README.md
- LICENSE
- CHANGELOG.md
- public documentation files
- public examples intended for users
- package.json

The published npm package should not include:

- src/
- tests/
- node_modules/
- generated index artifacts
- local smoke-test folders
- alpha-import/
- private planning notes
- temporary migration files

Use npm pack --dry-run to inspect package contents before publishing.

## Python development notes

Python indexing uses a subprocess and AST extraction scripts.

The adapter checks for:

- python
- python3

Python files are parsed but not executed.

When Python is not available, Python indexing may be skipped with a warning depending on the command path. TypeScript and JavaScript indexing should continue to work independently.

## Graphviz development notes

DOT output is generated directly and does not require Graphviz.

SVG and PNG rendering require the Graphviz dot executable.

Use DOT output for cross-platform CI smoke tests:

    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format dot --out examples/basic-ts/.my-dev-kit-dev/graph.dot

Use SVG or PNG manually when Graphviz is installed:

    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format svg --out examples/basic-ts/.my-dev-kit-dev/graph.svg
    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-dev --format png --out examples/basic-ts/.my-dev-kit-dev/graph.png

## Release preparation

Before publishing a release:

    npm ci
    npm run verify
    npm pack --dry-run

Then follow RELEASE.md.

Do not publish from an unverified working tree.
