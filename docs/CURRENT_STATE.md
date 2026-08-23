# Current State

This document is the concise source of truth for the current operational state
of `@dailephd/my-dev-kit`. Historical implementation and release evidence remains in
[PROJECT_PROGRESS.md](PROJECT_PROGRESS.md) and [CHANGELOG.md](../CHANGELOG.md);
future version scope remains in [ROADMAP.md](ROADMAP.md).

## Package and publication

- Package: `@dailephd/my-dev-kit`
- Source version: `1.12.2`
- Latest verified npm version: `1.12.2`
- Latest Git tag and GitHub Release: `v1.12.2`
- Active next milestone: `v1.13.0`, Android retrieval benchmarks, examples,
  and workflow documentation

The package, lockfile, CLI version owner, npm registry, Git tag, and GitHub
Release agree on `1.12.2`.

## Implemented product surface

my-dev-kit is a local-first, deterministic, read-only static evidence producer.
It indexes TypeScript, JavaScript, Python, Kotlin, Java, and supported Android
project structures. It writes inspectable structural, semantic, classification,
frontend, data-model, Android, context, and retrieval-audit artifacts and then
supports bounded retrieval over those artifacts.

The nine current public commands are `index`, `search`, `lookup`, `source`,
`slice`, `view`, `data-model`, `context`, and `graph-diff`. Exact flags,
defaults, outputs, and exit behavior are owned by [COMMANDS.md](COMMANDS.md).
Ordered operational use is owned by [WORKFLOWS.md](WORKFLOWS.md).

## Current contract surface

The current index is rooted in `manifest.json`, which is the artifact registry
for the artifact set produced by an index run. Stable graph identity, schema
versions, artifact kinds, node and edge conventions, and compatibility details
are documented in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md).

The `context` command accepts legacy query input or a schema-versioned
`ContextRequest`, and can produce `context-capsule.json` plus an optional
`retrieval-audit-record.json`. Current schema-major-1 context output reports
bounded selection, adequacy, freshness, truncation, evidence origin,
responsibility mapping, and role-condition coverage without converting static
evidence into a runtime correctness claim. See [CONTRACTS.md](CONTRACTS.md).

## Current major limitations

- Analysis is conservative and static. It does not execute applications,
  Gradle, tests, emulators, browsers, databases, or user source code.
- It does not call an LLM or external API, edit source, or prove runtime
  reachability, rendering, navigation, data flow, security, or test success.
- Call-graph, frontend, lineage, Android, and classification evidence can omit
  dynamic or ambiguous behavior and report uncertainty rather than fabricate a
  result.
- Symbol records do not provide universally exact end lines. Bounded source
  continuation or explicit ranges may be needed.
- Exact lookup/selectors intentionally preserve ambiguity. They do not choose an
  unsupported winner.
- Watch mode, broader non-Android framework coverage, artifact schema v2,
  plugin architecture, and a retrieval API remain planned rather than shipped.

## Development direction

The next approved direction is the separately preserved `v1.13.0` milestone:
prove and document the shipped Android retrieval surface with dedicated
benchmarks, representative examples, and workflow guidance. Later `v1.14.0`
and `v2.0.0` scopes remain separate and unchanged. See [ROADMAP.md](ROADMAP.md)
for capability requirements, dependencies, exclusions, and acceptance criteria.

## Blockers

No release-independent blocker is currently documented for beginning v1.13.0
planning. Planning must inspect the current repository and retrieval evidence
before constructing implementation steps. This summary is not an implementation
plan.
