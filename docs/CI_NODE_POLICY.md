# Node validation and CI policy

This repository follows the four-repository my-dev-kit ecosystem policy. Local validation is run on the **latest stable Node.js release**, dynamically checked against the official [Node.js release index](https://nodejs.org/dist/index.json). GitHub Actions runs the supported **Node 24** baseline on Ubuntu, macOS, and Windows. The two environments serve different purposes and should not duplicate the same full-suite matrix.

Run `npm run validate:local` from a fully installed checkout (`npm ci`) for a full local latest-Node validation. It checks the actual local Node version; it does not download or install Node. Network access to nodejs.org is needed for the version preflight, which fails closed when unavailable. During iterative corrections, use the directly affected tests instead of repeatedly invoking the full local suite.

The GitHub [CI workflow](../.github/workflows/ci.yml) runs Node 24 across the three supported OS families, once per job, with typecheck/build/docs through `npm run verify`, then the full test suite and package/CLI smoke checks. The package dry-run uses `--ignore-scripts` to inspect the build already produced by `verify` without repeating the `prepack` build. All package publication and release requirements remain unchanged.

Do not create a second full-suite CI workflow for the same OS/Node/candidate. A PR check and a subsequent main-branch check can be separate release identities, but do not manually dispatch duplicate jobs for the same commit. Additional tests are permitted when they validate **distinct** installed-package, security, or integration behavior.
