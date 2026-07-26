# Documentation Preservation Policy

This policy governs how documentation in this repository may be changed. It exists because earlier documentation-reconciliation work silently deleted or compressed content — a lost README workflow section, an under-maintained ARCHITECTURE.md frozen at v1.5.0, a RELEASE.md checklist that lost its human-authorization safety gate — instead of just updating stale facts. See `reports/documentation-drift/recovery-decision-ledger.txt` (generated, gitignored) for the forensic history behind this policy.

This policy applies to every future documentation task in this repository, not only to the recovery that introduced it.

## Document classes

- **Class A — Planning source of truth.** Example: `docs/ROADMAP.md`. Apply the repository-wide hierarchy below: later explicit decisions and the latest comprehensive agreed roadmap control planned structure; verified implementation and publication evidence may update status only. Never derive future scope from implementation alone.
- **Class B — Current-state documentation.** Examples: `docs/COMMANDS.md`, `docs/ARCHITECTURE.md`, `docs/GRAPH_SCHEMA.md`, `docs/PROJECT_OVERVIEW.md`, `docs/DEVELOPMENT.md`, `docs/CI_CD.md`, `docs/SECURITY.md`, `docs/QUICKSTART.md`. Apply the repository-wide hierarchy below, then use CLI help, public types/schemas, and tests to verify the current contract.
- **Class C — Historical documentation.** Example: `CHANGELOG.md`. Authority: tags, published releases, registries, deployment records, historical commits. Append-preserving; no silent deletion; no replacement of detailed history with summaries.
- **Class D — Mixed documentation.** Examples: `README.md`, `docs/RELEASE.md`, `docs/WORKFLOWS.md`. Classify each section separately and apply the matching class's rules to that section rather than one rule to the whole document.

## Authority hierarchy

1. Explicit later user-approved planning decisions.
2. Current verified implementation for current capability.
3. Package metadata for the package version.
4. npm, Git tags, and GitHub Releases for publication status.
5. The latest comprehensive agreed roadmap for planned structure.
6. Later comprehensive planning documents.
7. Historical documents.
8. Current compressed summaries, for facts they explicitly confirm.
9. Coding-agent inference — last resort, and only for phrasing, never for scope.

Later explicit decisions override older conflicting plans. Verified implementation may change implementation status; external publication evidence may change publication status. Neither changes unrelated future plans. Work that has not been implemented remains planned unless explicitly canceled — inactivity is not cancellation.

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

## Relocation rules

Information may move between documents only when all of these conditions hold:

- the complete substantive information remains in its canonical owning document
- the source document retains an audience-appropriate summary or direct link
- a relocation ledger records the source, destination, whether the move was full or summarized, and why
- no plan, command, artifact, limitation, procedure, release entry, project pillar, architecture subsystem, or workflow family disappears from the repository
- the move does not change roadmap version assignment, current/planned/deferred status, or tool ownership

Ambiguous content is preserved and marked for confirmation. Ambiguity is not deletion authority.

## Compression rules

A documentation edit that reduces a planning document's (Class A) or a comprehensive current-state document's (Class B) nonblank line count by more than 15% in one change is a stop condition (see below) unless the removed content is proven superseded and the removal is recorded in a decision ledger entry.

During factual reconciliation or forensic recovery, document compression is prohibited unless the user explicitly authorizes it. Editorial work may reduce duplication only after a protected-content inventory and relocation ledger exist and only under the relocation rules above.

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

Any documentation task that edits a Class A or Class C document, or edits more than one section of a Class B/D document, must record before/after total lines, nonblank lines, words, headings, version headings, links, and code blocks for the documents it touches. The inventory must also record restored and relocated sections, every removed heading, the reason for its removal, and the destination of its substantive content.

The before/after inventory must be produced before commit. A reduction above 15% requires explicit investigation even when the change appears editorial.

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

Structural completeness is enforced automatically by `npm run docs:check` (see `scripts/docs/checkDocs.ts`, driven by `docs/documentation-preservation-manifest.json`), which is part of `npm run verify`. It checks presence, order, status boundaries, and scope of required structural elements — not exact prose — so legitimate wording changes that preserve structure pass. Removed versions, merged ranges, reassigned future scope, false publication status, missing pillars, missing command/workflow/artifact/architecture domains, missing static-analysis limits, missing CHANGELOG entries, and a missing release safety gate fail with an actionable error naming the document, the missing element, and the required fix.

The manifest is deliberately structural (headings, version identifiers, command/workflow/domain names, required phrases) rather than prose-based, so it does not need to change for ordinary wording edits — only when the actual required structure changes (a new roadmap version is added, a new command family ships, and so on). Extend the manifest by adding entries; do not remove manifest entries without the same explicit-allowlist justification required for the underlying documentation.

## Final-report requirements

A documentation reconciliation, forensic recovery, or repository-wide editorial task must report:

- the evidence used for implementation, package, and publication status
- every current or historical full-file read
- document classification and authority
- the drift timeline and recovery decision ledger
- the protected-content and relocation inventories
- before/after metrics and suspicious-reduction investigations
- preservation-check and project-validation results, including skipped checks and reasons
- staged files, commit and push results, and confirmation that unrelated product behavior and package metadata did not change

Generated forensic, validation, and editorial reports must remain ignored or external unless a tracked report was explicitly requested.
