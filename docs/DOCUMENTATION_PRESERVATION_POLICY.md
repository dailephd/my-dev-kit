# Documentation Preservation Policy

This policy governs how documentation in this repository may be changed. It exists because earlier documentation-reconciliation work silently deleted or compressed content — a lost README workflow section, an under-maintained ARCHITECTURE.md frozen at v1.5.0, a RELEASE.md checklist that lost its human-authorization safety gate — instead of just updating stale facts. See `reports/documentation-drift/recovery-decision-ledger.txt` (generated, gitignored) for the forensic history behind this policy.

This policy applies to every future documentation task in this repository, not only to the recovery that introduced it.

## Document classes

- **Class A — Planning source of truth.** Example: `docs/ROADMAP.md`. Authority order: later explicit approved decisions, then the latest comprehensive agreed roadmap, then historical roadmaps, then published history for status updates, then implementation for current-status updates only. Never derive future scope from implementation alone.
- **Class B — Current-state documentation.** Examples: `docs/COMMANDS.md`, `docs/ARCHITECTURE.md`, `docs/GRAPH_SCHEMA.md`, `docs/PROJECT_OVERVIEW.md`, `docs/DEVELOPMENT.md`, `docs/CI_CD.md`, `docs/SECURITY.md`, `docs/QUICKSTART.md`. Authority order: package/application metadata, then implementation, then CLI help/API surface, then tests, then generated schemas/reports.
- **Class C — Historical documentation.** Example: `CHANGELOG.md`. Authority: tags, published releases, registries, deployment records, historical commits. Append-preserving; no silent deletion; no replacement of detailed history with summaries.
- **Class D — Mixed documentation.** Examples: `README.md`, `docs/RELEASE.md`, `docs/WORKFLOWS.md`. Classify each section separately and apply the matching class's rules to that section rather than one rule to the whole document.

## Authority hierarchy

1. Explicit later user-approved planning decisions.
2. Published implementation and release history for completed status.
3. The latest comprehensive planning document before any destructive compression.
4. Older comprehensive planning documents.
5. Current compressed summaries, for facts they explicitly confirm.
6. Coding-agent inference — last resort, and only for phrasing, never for scope.

Later explicit decisions override older conflicting plans. Published implementation changes *status*, never unrelated future plans. Work that has not been implemented yet remains planned unless explicitly canceled — inactivity is not cancellation.

## Status-update rules

- Update a roadmap version's status (planned → implemented → released → published) only against verified implementation and release evidence (git tags, GitHub Releases, npm registry, or an explicit user statement).
- Never mark a version "planned" if implementation evidence shows it shipped; never mark a version "published" without external release evidence (tag + registry/release record), even if implementation and a release branch exist.
- Current-state documents (Class B) must reflect the *current* implementation, not aspirational or historical framing left over from an earlier version.

## Deletion rules

No documentation task may delete, without an explicit user-provided allowlist naming the exact item:

- a roadmap version
- a planned feature
- a major section
- a release entry (CHANGELOG version)
- a command family
- an architecture subsystem
- a workflow family
- a project pillar (README.md)

The allowlist fields are `ALLOWED_DOCUMENT_REMOVALS`, `ALLOWED_ROADMAP_REMOVALS`, `ALLOWED_FUTURE_VERSION_REMOVALS`, `ALLOWED_RELEASE_HISTORY_REMOVALS`, and `ALLOWED_DOCUMENT_COMPRESSION`. Default value for all of them is `none`. A documentation task with no explicit allowlist may not remove any of the above.

## Reorganization rules

Without explicit user authorization, do not:

- merge individually planned versions into a range (e.g. "v1.10.0-v1.13.0")
- reorder roadmap versions
- move a feature from one version to another without recorded evidence (commit, PR, or explicit user statement) for the move
- rename a planned version
- convert a detailed plan into a generic "future work" bucket
- remove historical entries from CHANGELOG.md
- replace a multi-domain document with a single-domain summary

## Compression rules

A documentation edit that reduces a planning document's (Class A) or a comprehensive current-state document's (Class B) nonblank line count by more than 15% in one change is a stop condition (see below) unless the removed content is proven superseded and the removal is recorded in a decision ledger entry.

## Reconciliation vs. rewrite

Documentation reconciliation (routine "update stale facts" work) **may**:

- update current status, repair stale commands, repair current architecture descriptions
- correct package/release state
- preserve plans, release history, and unrelated domains
- report every deletion it makes

Documentation reconciliation **must not**:

- rewrite a document from scratch by default
- summarize an entire document down to a highlight list
- derive future plans from implementation
- delete unimplemented plans
- remove historical releases
- reorganize roadmap scope

If a task appears to require any of the "must not" items, stop and ask the user for an explicit allowlist before proceeding.

## Before/after inventory requirement

Any documentation task that edits a Class A or Class C document, or edits more than one section of a Class B/D document, must record before/after line counts, heading counts, and version counts for the documents it touches (see `reports/documentation-drift/` for the format used by this recovery).

## Stop thresholds

Stop and ask before committing if any of the following is true:

- a roadmap version disappeared
- a planned feature disappeared without an explicit allowlist entry
- a CHANGELOG release entry disappeared
- a major product pillar (README.md) disappeared
- an architecture subsystem disappeared
- a command or workflow family disappeared
- a Class A document lost more than 15% of its nonblank lines in one change
- a document was replaced with a materially shorter summary
- multiple unrelated domains disappeared in the same change
- any deletion lacks an explicit allowlist entry

## Enforcement

Structural completeness is enforced automatically by `npm run docs:check` (see `scripts/docs/checkDocs.ts`, driven by `docs/documentation-preservation-manifest.json`), which is part of `npm run verify`. It checks presence, order, and scope of required structural elements — not exact prose — so legitimate wording changes that preserve structure pass, while removed versions, merged ranges, missing pillars, missing command/workflow/architecture domains, missing CHANGELOG entries, and a missing release safety gate fail with an actionable error naming the document, the missing element, and the required fix.

The manifest is deliberately structural (headings, version identifiers, command/workflow/domain names, required phrases) rather than prose-based, so it does not need to change for ordinary wording edits — only when the actual required structure changes (a new roadmap version is added, a new command family ships, and so on). Extend the manifest by adding entries; do not remove manifest entries without the same explicit-allowlist justification required for the underlying documentation.
