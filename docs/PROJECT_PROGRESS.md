# Project Progress

This file tracks current implementation and release status for `@dailephd/my-dev-kit`. Product plans, future capability scope, and version goals live in `docs/ROADMAP.md`; this file is for "where are we right now."

## Published versions

`@dailephd/my-dev-kit@1.10.0` is the latest published release. It closed out the full Android/Kotlin/Java/Gradle/manifest/resource/navigation implementation described in the v1.10.0 roadmap section: Android project/module/source-set detection, Kotlin and Java structural indexing, Android component-role detection, the Gradle/manifest/resource/navigation artifacts, cross-artifact code-graph relationships, and command integration across `search`/`lookup`/`source`/`slice`/`view`/`context`. That work was validated by a combined integration fixture and a dedicated integration test suite, plus `npm run verify` (typecheck, build, `docs:check`) and `npm run benchmark:retrieval`, all passing at release time.

## Current version in progress: v1.10.1

Version 1.10.1 is not yet published. It is a bounded patch on the v1.10.0 baseline that extends the `context` command with deterministic, role-specific repository-evidence retrieval (`ContextRole`: `architecture`/`implementation`/`test-implementation`) and honest bounded evidence reporting. See `docs/ROADMAP.md`'s "Version 1.10.1" section for the full plan; this section only tracks what has actually landed in the working tree so far.

### Implementation stages completed in the working tree (uncommitted)

1. **Request and role contracts** — `ContextRole` type, structured schema-versioned `ContextRequest` JSON contract, `context --request <path>` / `context --role <role>`, deterministic CLI/request-file normalization and conflict handling, structural validation of every optional field, and full legacy compatibility for pre-1.10.1 `context` invocations. See `src/context/contextRequestNormalization.ts`, `src/context/types.ts`, `src/context/contextRoles.ts`.
2. **Role-aware candidates and ranking** — role-specific candidate priorities for all three roles, `focusFiles`/`focusSymbols` resolution, `changedFiles`/`changedSymbols` and `beforeIndex`/`afterIndex` graph-diff-based changed-surface merging, `requestedEvidenceKinds` prioritization, additive `roleContext` capsule/audit fields. See `src/context/focusResolution.ts`, `src/context/changedSurface.ts`, `src/context/roleCandidates.ts`.
3. **Evidence groups and test infrastructure** — deterministic bounded evidence groups per role, cross-group rollups, bounded test-infrastructure discovery (related tests, fixtures, factories, mocks, setup, test configuration, package scripts, test commands). See `src/context/evidenceClassification.ts`, `src/context/evidencePatterns.ts`, `src/context/evidenceGroups.ts`, `src/context/testInfrastructureDiscovery.ts`.
4. **Responsibility mapping, adequacy, freshness, and provenance** — `responsibilityMapping.ts` (mapped/partially-mapped/unmapped/not-applicable statuses, criticality, duplicate/unknown-ID handling), `contextRoleAdequacy.ts` (role-specific adequacy verdicts, not just nonempty-evidence checks), `contextFreshness.ts` (fresh/stale/unknown classification), `contextBudget.ts` (limits reporting, truncation, full-file fallback via `fullFileFallback.ts`), `contextProvenance.ts` (deterministic evidence provenance classification).
5. **CLI integration** — `src/commands/contextCommand.ts` wires `--request`/`--role` into the existing `context` command pipeline; `src/context/contextCapsule.ts` and `src/context/retrievalAuditRecord.ts` carry the additive schema fields.

### Validation results as of the last verification pass

- `npm run typecheck` — passing.
- `npx vitest run tests/context` — 218/218 tests passing across 23 test files.
- `npm run docs:check` — passing.
- `npm run benchmark:retrieval` — PASS, 6/6 tasks.
- `npm pack --dry-run` — clean; 30 files reported; no fixtures, indexes, or credentials included.

### Known implementation facts worth tracking precisely

- `limits.responsibilityMappings` is an **enforcing** limit — it actually truncates the number of responsibility mappings produced (`src/context/contextBudget.ts`, `src/context/responsibilityMapping.ts`).
- `limits.evidenceGroupEntries` is **reporting-only** — the field is validated, normalized, and reported alongside real usage/availability/drop counts in `budget.limits[]`, but the actual per-group truncation caps come from fixed internal values in `src/context/evidenceGroups.ts` (for example owners = 3 or 5 depending on role, contracts = 10). The declared request-level value does not override those internal caps. This is documented in `docs/ROADMAP.md` as an intentional reporting boundary, not a gap.
- Files that merely match a naming convention (for example a file named similarly to "builder" or "factory") are intentionally excluded from evidence groups and test-infrastructure discovery unless backed by graph, import, or classification evidence. This is a deliberate conservative boundary.

### Remaining work before v1.10.1 can be published

- Final CLI help-text and cross-platform smoke validation pass (candidate batch 5 in the roadmap's dependency ordering).
- A release-readiness pass (version bump confirmation, changelog finalization, package publication) — out of scope for documentation-only work.
- No production code, test code, or package version was changed as part of the Batch 6 documentation-reconciliation pass; see `reports/v1.10.1-batch-6-documentation-reconciliation.md` for that pass's details.

## Where to look next

- Product plans and future version scope: `docs/ROADMAP.md`
- Command-level behavior and flags: `docs/COMMANDS.md`
- Schema/artifact field reference: `docs/GRAPH_SCHEMA.md`
- Release history: `CHANGELOG.md`
- Batch-level implementation reports: `reports/`
