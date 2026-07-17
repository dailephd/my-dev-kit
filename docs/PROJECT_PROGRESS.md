# Project Progress

This file tracks current implementation and release status for `@dailephd/my-dev-kit`. Product plans, future capability scope, and version goals live in `docs/ROADMAP.md`; this file is for "where are we right now."

## Published versions

`@dailephd/my-dev-kit@1.10.0` is the latest published release. It closed out the full Android/Kotlin/Java/Gradle/manifest/resource/navigation implementation described in the v1.10.0 roadmap section: Android project/module/source-set detection, Kotlin and Java structural indexing, Android component-role detection, the Gradle/manifest/resource/navigation artifacts, cross-artifact code-graph relationships, and command integration across `search`/`lookup`/`source`/`slice`/`view`/`context`. That work was validated by a combined integration fixture and a dedicated integration test suite, plus `npm run verify` (typecheck, build, `docs:check`) and `npm run benchmark:retrieval`, all passing at release time.

## Current version in progress: v1.10.1

Version 1.10.1 is implemented and release-prepared but not published. It is a bounded patch on the v1.10.0 baseline that extends the `context` command with deterministic, role-specific repository-evidence retrieval (`ContextRole`: `architecture`, `implementation`, and `test-implementation`) and honest bounded evidence reporting. See the "Version 1.10.1" section of [ROADMAP.md](ROADMAP.md) for the plan; this document records current status only.

### Implemented scope

1. **Request and role contracts** — `ContextRole` type, structured schema-versioned `ContextRequest` JSON contract, `context --request <path>` / `context --role <role>`, deterministic CLI/request-file normalization and conflict handling, structural validation of every optional field, and full legacy compatibility for pre-1.10.1 `context` invocations. See `src/context/contextRequestNormalization.ts`, `src/context/types.ts`, `src/context/contextRoles.ts`.
2. **Role-aware candidates and ranking** — role-specific candidate priorities for all three roles, `focusFiles`/`focusSymbols` resolution, `changedFiles`/`changedSymbols` and `beforeIndex`/`afterIndex` graph-diff-based changed-surface merging, `requestedEvidenceKinds` prioritization, additive `roleContext` capsule/audit fields. See `src/context/focusResolution.ts`, `src/context/changedSurface.ts`, `src/context/roleCandidates.ts`.
3. **Evidence groups and test infrastructure** — deterministic bounded evidence groups per role, cross-group rollups, bounded test-infrastructure discovery (related tests, fixtures, factories, mocks, setup, test configuration, package scripts, test commands). See `src/context/evidenceClassification.ts`, `src/context/evidencePatterns.ts`, `src/context/evidenceGroups.ts`, `src/context/testInfrastructureDiscovery.ts`.
4. **Responsibility mapping, adequacy, freshness, and provenance** — `responsibilityMapping.ts` (mapped/partially-mapped/unmapped/not-applicable statuses, criticality, duplicate/unknown-ID handling), `contextRoleAdequacy.ts` (role-specific adequacy verdicts, not just nonempty-evidence checks), `contextFreshness.ts` (fresh/stale/unknown classification), `contextBudget.ts` (limits reporting, truncation, full-file fallback via `fullFileFallback.ts`), `contextProvenance.ts` (deterministic evidence provenance classification).
5. **CLI integration** — `src/commands/contextCommand.ts` wires `--request`/`--role` into the existing `context` command pipeline; `src/context/contextCapsule.ts` and `src/context/retrievalAuditRecord.ts` carry the additive schema fields.

### Release-readiness evidence

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

### Remaining work before publication

- Run a separate, explicitly authorized publication workflow.
- Do not treat implementation, editorial, or release-readiness evidence as publication authorization.

## Where to look next

- Product plans and future version scope: [ROADMAP.md](ROADMAP.md)
- Command-level behavior and flags: [COMMANDS.md](COMMANDS.md)
- Schema and artifact fields: [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md)
- Release history: [CHANGELOG.md](../CHANGELOG.md)
