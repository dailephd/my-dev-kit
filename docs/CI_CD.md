# CI/CD

## Overview

my-dev-kit uses GitHub Actions to validate that the repository can be installed, checked, tested, built, packaged, and run as a CLI on supported operating systems.

The CI workflow is for validation only. It does not publish npm packages, create GitHub releases, build Docker images, or deploy anything.

## Workflow file

The GitHub Actions workflow is defined at:

    .github/workflows/ci.yml

The workflow runs on:

- pushes to `main`
- pushes to `release/**`, `fix/**`, and `audit/**` branches
- pull requests

Each platform runs on Node.js 24.x.

## Platform support

CI runs on Linux, macOS, and Windows.

| Runner | Purpose |
| --- | --- |
| `ubuntu-latest` | Linux validation |
| `macos-latest` | macOS validation |
| `windows-latest` | Windows validation |

The matrix uses `fail-fast: false`, so all platforms complete their checks even if one platform fails.

## Validation steps

CI validates the following:

- dependencies install from a clean checkout
- TypeScript type checking passes
- the test suite passes
- the CLI builds successfully
- the full verification script passes
- package contents are inspectable with `npm pack --dry-run`
- the built CLI responds to `--help`
- the built CLI responds to `--version`
- the TypeScript example can be indexed with call graph generation
- search returns results from the indexed TypeScript example
- source retrieval returns results from the indexed TypeScript example
- context generation succeeds against the indexed TypeScript example
- graph view can generate DOT output from the indexed TypeScript example
- the Python example can be indexed when Python is available
- temporary example artifacts are removed after the smoke checks

## CI command sequence

The CI workflow runs the equivalent of the following commands from the repository root:

    npm ci
    npm run verify
    npm run test
    npm pack --dry-run --json
    node dist/cli.js --help
    node dist/cli.js --version
    node dist/cli.js index --root examples/basic-ts --src src --out .my-dev-kit-ci --call-graph --json
    node dist/cli.js search --index examples/basic-ts/.my-dev-kit-ci --query user --limit 5 --json
    node dist/cli.js source --index examples/basic-ts/.my-dev-kit-ci --contains User --format json
    node dist/cli.js context --index examples/basic-ts/.my-dev-kit-ci --query "user service" --out examples/basic-ts/.my-dev-kit-ci/context-capsule.json --json
    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-ci --format dot --out examples/basic-ts/.my-dev-kit-ci/graph.dot --edge-style semantic --json
    node dist/cli.js index --root examples/basic-python --src src --language python --out .my-dev-kit-ci --json

The `index` command resolves `--out` relative to `--root`, so the TypeScript example writes to:

    examples/basic-ts/.my-dev-kit-ci

The Python example writes to:

    examples/basic-python/.my-dev-kit-ci

## Local validation

Run the main validation chain before release-related changes:

    npm ci
    npm run test
    npm run verify
    npm pack --dry-run

For a more explicit local CI-style run:

    npm ci
    npm run typecheck
    npm run test
    npm run build
    npm run verify
    npm pack --dry-run

## Local CLI smoke test

After building, run the same CLI smoke checks locally:

    node dist/cli.js --help
    node dist/cli.js --version
    node dist/cli.js index --root examples/basic-ts --src src --out .my-dev-kit-local-ci --call-graph --json
    node dist/cli.js search --index examples/basic-ts/.my-dev-kit-local-ci --query user --limit 5 --json
    node dist/cli.js source --index examples/basic-ts/.my-dev-kit-local-ci --contains User --format json
    node dist/cli.js context --index examples/basic-ts/.my-dev-kit-local-ci --query "user service" --out examples/basic-ts/.my-dev-kit-local-ci/context-capsule.json --json
    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-local-ci --format dot --out examples/basic-ts/.my-dev-kit-local-ci/graph.dot --edge-style semantic --json
    node dist/cli.js index --root examples/basic-python --src src --language python --out .my-dev-kit-local-ci --json

The expected TypeScript output directory is:

    examples/basic-ts/.my-dev-kit-local-ci

The expected Python output directory is:

    examples/basic-python/.my-dev-kit-local-ci

Clean up local smoke-test artifacts with:

    node -e "require('fs').rmSync('examples/basic-ts/.my-dev-kit-local-ci', { recursive: true, force: true })"
    node -e "require('fs').rmSync('examples/basic-python/.my-dev-kit-local-ci', { recursive: true, force: true })"

## Smoke-test expectations

The TypeScript smoke test should produce:

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`
- `call-graph.json`

The Python smoke test should produce:

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`

The search smoke test should return ranked results for the query `user`.

The graph view smoke test should write a DOT file using semantic edge styling.

## Python support in CI

Python indexing requires Python 3.8 or later.

The Python adapter probes for both:

- `python`
- `python3`

Expected GitHub Actions behavior:

| Runner | Expected Python command |
| --- | --- |
| `ubuntu-latest` | `python3` |
| `macos-latest` | `python3` |
| `windows-latest` | `python` |

If no compatible Python interpreter is available, Python files are skipped with a warning. The index command should still complete instead of failing the entire run.

## Android/Kotlin/Java support in CI (v1.9.0)

Android project detection, Kotlin structural indexing, and Java structural indexing require no additional CI toolchain. Detection and extraction are conservative, static, regex/text-based analysis — they never invoke Gradle, `javac`, the Kotlin compiler, or an Android build/emulator. No JDK, Android SDK, or Gradle installation is required on CI runners to exercise `.kt`/`.java` indexing or Android component-role detection.

## Graphviz behavior in CI

DOT graph output does not require Graphviz.

CI uses:

    --format dot

SVG and PNG rendering are not part of CI because they require the Graphviz `dot` executable to be installed on the runner.

Graphviz-based rendering can be tested manually with:

    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-local-ci --format svg --out examples/basic-ts/.my-dev-kit-local-ci/graph.svg
    node dist/cli.js view --index examples/basic-ts/.my-dev-kit-local-ci --format png --out examples/basic-ts/.my-dev-kit-local-ci/graph.png

## Cross-platform notes

CI commands should stay compatible with Windows, Linux, and macOS.

Guidelines:

- use single-command `run:` entries in GitHub Actions
- avoid shell-specific line continuation syntax
- avoid Bash-only syntax in commands that must run on Windows
- prefer Node-based cleanup commands for cross-platform cleanup
- keep JSON output on stdout clean when `--json` is used
- write progress or diagnostics to stderr when JSON output is expected

## Generated artifacts

CI creates temporary index artifacts under the bundled example projects:

- `examples/basic-ts/.my-dev-kit-ci/`
- `examples/basic-python/.my-dev-kit-ci/`

Local smoke tests may create:

- `examples/basic-ts/.my-dev-kit-local-ci/`
- `examples/basic-python/.my-dev-kit-local-ci/`

These directories should be ignored by Git and should not be included in the npm package.

## Package inspection

CI runs:

    npm pack --dry-run

This checks which files would be included in the npm package.

The package should include:

- `dist/`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- public documentation files
- public examples intended for package users
- `package.json`

The package should not include:

- `src/`
- `tests/`
- generated index artifact directories
- local CI output folders
- `node_modules/`
- unpublished planning notes
- temporary migration folders
- private reference material

## Current CI exclusions

The CI workflow does not perform:

- npm publishing
- GitHub release creation
- version bumping
- changelog generation
- Docker build or publish
- deployment
- SVG rendering validation
- PNG rendering validation
- live external-service tests

## Release automation

Release automation is not implemented.

If release automation is added later, it should use a separate workflow file such as:

    .github/workflows/release.yml

The CI validation workflow should remain focused on install, test, build, package inspection, and CLI smoke checks.
