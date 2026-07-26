# Project Progress

This file tracks current implementation and release status for `@dailephd/my-dev-kit`. Product plans, future capability scope, and version goals live in `docs/ROADMAP.md`; this file is for "where are we right now."

## Published versions

`@dailephd/my-dev-kit@1.10.2` is the latest published release. It is a documentation-only corrective patch that fixes stale release-state wording included with v1.10.1; runtime and CLI behavior are unchanged from v1.10.1. Version 1.10.1 introduced deterministic, role-specific repository-evidence retrieval, while v1.10.0 introduced the completed Android/Kotlin/Java/Gradle/manifest/resource/navigation surface.

## Implemented but unreleased: v1.10.3

The current branch contains the complete my-dev-kit v1.10.3 context-readiness corrective patch. Package metadata remains `1.10.2`, and npm, Git tags, and GitHub Releases still identify v1.10.2 as latest; implementation is not publication.

The four completed corrections are:

1. **Structurally grounded owners** — implementation-owner eligibility now combines request relevance with exported-production-symbol, contract/canonical-type, classification, or graph-producer evidence. Neutral filenames qualify when the structure supports ownership; focus, owner-like naming, test/fixture/generated paths, projections/views, and unrelated leaf consumers do not qualify by themselves.
2. **Required-first allocation** — the implementation role treats existing required-group caps as initial reservations in one finite deterministic pool. Unused capacity spills in fixed priority order; genuine demand beyond the aggregate reservation bound remains reported and blocks adequacy. Additive diagnostics expose reservation, contribution, borrowing, selected/omitted counts, aggregate capacity, and adequacy impact.
3. **Observable duplicate responsibilities** — public request normalization preserves duplicate `testResponsibilityRefs` until responsibility mapping. One mapping is emitted per unique ID in first-occurrence order, while duplicate and unknown/unmapped diagnostics remain visible and capsule/audit summaries remain equal.
4. **Directed file evidence** — file evidence now resolves to canonical `file:<path>` graph identity for dependency/caller classification, matching symbol-level direction and deduplicating alternate evidence representations.

Compatibility remains intact: the CLI syntax, roles, evidence-kind vocabulary, string-only responsibility references, legacy no-role behavior, and context artifact schema `"1.0.0"` are unchanged. Separate orchestrator and lab corrective patches remain ecosystem work; their behavior is not implemented here.

### v1.10.3 validation evidence

- Focused v1.10.3 context suites: 52/52 tests passing across 5 files.
- Full suite: 1,845/1,845 tests passing across 163 files after the documentation-preservation cases were added.
- `npm run typecheck` and `npm run build`: passing.
- `npm run docs:check` and `npm run verify`: passing.
- `npm run benchmark:retrieval`: PASS, 6/6 tasks.
- `node dist/cli.js --version`: `1.10.2`, confirming no version bump.
- `node dist/cli.js context --help`: passing; syntax and role flags remain unchanged.

## Shipped context capability: v1.10.1

Version 1.10.1 shipped as a bounded patch on the v1.10.0 baseline that extends the `context` command with deterministic, role-specific repository-evidence retrieval (`ContextRole`: `architecture`, `implementation`, and `test-implementation`) and honest bounded evidence reporting. See the "Version 1.10.1" section of [ROADMAP.md](ROADMAP.md) for its preserved goals and boundaries; this document records current status only.

### Implemented scope

1. **Request and role contracts** — `ContextRole` type, structured schema-versioned `ContextRequest` JSON contract, `context --request <path>` / `context --role <role>`, deterministic CLI/request-file normalization and conflict handling, structural validation of every optional field, and full legacy compatibility for pre-1.10.1 `context` invocations. See `src/context/contextRequestNormalization.ts`, `src/context/types.ts`, `src/context/contextRoles.ts`.
2. **Role-aware candidates and ranking** — role-specific candidate priorities for all three roles, `focusFiles`/`focusSymbols` resolution, `changedFiles`/`changedSymbols` and `beforeIndex`/`afterIndex` graph-diff-based changed-surface merging, `requestedEvidenceKinds` prioritization, additive `roleContext` capsule/audit fields. See `src/context/focusResolution.ts`, `src/context/changedSurface.ts`, `src/context/roleCandidates.ts`.
3. **Evidence groups and test infrastructure** — deterministic bounded evidence groups per role, cross-group rollups, bounded test-infrastructure discovery (related tests, fixtures, factories, mocks, setup, test configuration, package scripts, test commands). See `src/context/evidenceClassification.ts`, `src/context/evidencePatterns.ts`, `src/context/evidenceGroups.ts`, `src/context/testInfrastructureDiscovery.ts`.
4. **Responsibility mapping, adequacy, freshness, and provenance** — `responsibilityMapping.ts` (mapped/partially-mapped/unmapped/not-applicable statuses, criticality, duplicate/unknown-ID handling), `contextRoleAdequacy.ts` (role-specific adequacy verdicts, not just nonempty-evidence checks), `contextFreshness.ts` (fresh/stale/unknown classification), `contextBudget.ts` (limits reporting, truncation, full-file fallback via `fullFileFallback.ts`), `contextProvenance.ts` (deterministic evidence provenance classification).
5. **CLI integration** — `src/commands/contextCommand.ts` wires `--request`/`--role` into the existing `context` command pipeline; `src/context/contextCapsule.ts` and `src/context/retrievalAuditRecord.ts` carry the additive schema fields.

### Validation evidence

- `npm run typecheck` — passing.
- `npm run build`, `npm run docs:check`, and `npm run verify` — passing.
- `npm test` — 1,785/1,785 tests passing across 159 test files.
- `npx vitest run tests/context` — 218/218 tests passing across 23 test files.
- `npm run test:security` — 60/60 tests passing across 5 test files.
- `npm run benchmark:retrieval` — PASS, 6/6 tasks.
- `npm pack --dry-run` — clean; 30 files reported; no fixtures, indexes, or credentials included.
- GitHub Actions passed on Linux, Windows, and macOS with Node.js 24.x for the exact release candidate.

### Known implementation facts worth tracking precisely

- `limits.responsibilityMappings` is an **enforcing** limit — it actually truncates the number of responsibility mappings produced (`src/context/contextBudget.ts`, `src/context/responsibilityMapping.ts`).
- `limits.evidenceGroupEntries` is **reporting-only** — the field is validated, normalized, and reported alongside real usage/availability/drop counts in `budget.limits[]`, but the actual per-group truncation caps come from fixed internal values in `src/context/evidenceGroups.ts` (for example owners = 3 or 5 depending on role, contracts = 10). The declared request-level value does not override those internal caps. This is documented in `docs/ROADMAP.md` as an intentional reporting boundary, not a gap.
- Files that merely match a naming convention (for example a file named similarly to "builder" or "factory") are intentionally excluded from evidence groups and test-infrastructure discovery unless backed by graph, import, or classification evidence. This is a deliberate conservative boundary.
- For the implementation role in unreleased v1.10.3, internal group caps are initial reservations in a shared finite allocation pass. This does not make `limits.evidenceGroupEntries` an enforcing selector.

### Documentation correction

Version 1.10.2 corrects the v1.10.1 release-state documentation and does not change runtime, CLI, artifact, schema, or retrieval behavior.

## Where to look next

- Product plans and future version scope: [ROADMAP.md](ROADMAP.md)
- Command-level behavior and flags: [COMMANDS.md](COMMANDS.md)
- Schema and artifact fields: [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md)
- Release history: [CHANGELOG.md](../CHANGELOG.md)
