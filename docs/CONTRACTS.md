# Contracts

This document maps my-dev-kit's stable cross-cutting contracts to their current
implementation and detailed owners. It is deliberately not a second copy of
every JSON schema or command flag.

## CLI command contract

The public executable exposes nine command families: `index`, `search`,
`lookup`, `source`, `slice`, `view`, `data-model`, `context`, and `graph-diff`.
Command registration is owned by `src/cli.ts` and modules under `src/commands/`.
Exact arguments, mutual exclusions, defaults, output formats, side effects, and
stable exit behavior are defined in [COMMANDS.md](COMMANDS.md). Operational
compositions are defined in [WORKFLOWS.md](WORKFLOWS.md).

Compatibility expectation: additive flags and selectors preserve existing
invocations unless a documented versioned compatibility decision says otherwise.
Read-only commands may write an explicitly requested output artifact, but they
must not edit indexed project source.

## Index identity and artifact registry contract

`manifest.json` is the identity and artifact registry for one index directory.
It records artifact kind/schema, creation time, normalized project and source
roots, languages, call-graph setting, artifact paths, analyzer status, counts,
warnings, and errors. Consumers use the manifest rather than infer the current
artifact set from filenames left on disk.

`index` owns managed refresh. Conditional artifacts are registered only when
their analyzer produces applicable evidence, and managed stale artifacts from a
previous run are removed. Internal incremental cache metadata is not a public
replacement for manifest identity. Detailed relationships are defined in
[GRAPH_SCHEMA.md](GRAPH_SCHEMA.md). Producer flow is in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Graph and schema compatibility

Stable artifact kinds, schema versions, node IDs, node/edge kinds, semantic and
classification references, graph slices, search results, and Android/frontend/
data-model artifacts are specified in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md). That
document remains the detailed schema reference.

Compatibility is artifact-specific. Additive fields can evolve within the
documented compatible schema family. Consumers must not fabricate fields absent
from older artifacts. Stable IDs and normalized repository-relative paths are
part of interoperability between indexing, retrieval, diffing, and downstream
evidence consumers.

## Context request contract

The type owner is `ContextRequest` in `src/context/types.ts`, with loading,
validation, CLI/request-file reconciliation, and normalization owned by
`src/context/contextRequestNormalization.ts`. A request carries a schema version
and query and may specify role, index/root, mode, focus and changed surfaces,
before/after indexes, upstream artifact references, test-responsibility IDs,
requested evidence kinds, bounded limits, and output paths.

The supported roles are `architecture`, `implementation`, and
`test-implementation`. Role is distinct from legacy context modes. Invalid or
conflicting structured input fails rather than being silently guessed.

There is no new public role, flag, or requested-evidence-kind value as of
v1.12.3. The existing `test-commands` requested-evidence-kind value gains
sharper required-vs-supplemental semantics; see "Responsibility mapping and
test-command evidence" below.

## Context capsule and retrieval-audit contracts

`ContextCapsule` and `RetrievalAuditRecord` are schema-major-1 contracts owned by
`src/context/types.ts`. Their builders/writers are owned by
`src/context/contextCapsule.ts` and `src/context/retrievalAuditRecord.ts`.

The capsule carries bounded evidence selected for downstream use: request and
index identity, limits, required/optional/dropped context, query plan,
candidates, focus, graph/source selection, retention, warnings, and adequacy.
Role-aware output adds responsibility mapping, freshness, budget/truncation,
evidence origin, and role-condition coverage.

The audit records how retrieval reached that result: steps, fallbacks,
full-file-read recommendations, matching identity/readiness summaries, and the
same material boundedness and adequacy evidence. Capsule/audit fields that
describe the same readiness and identity state must agree. Consumers report
contradictions rather than silently resolving them. Detailed fields are defined
in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md).

As of v1.12.3, this parity requirement is protected by an integrated regression
covering role adequacy, responsibility mappings, `missingConditions`/
`blockingConditions`, and truncation together, so these representations cannot
silently disagree (see "Adequacy, freshness, boundedness, and evidence origin").

## Adequacy, freshness, boundedness, and evidence origin

Nonempty output is not automatically adequate. Role-specific adequacy evaluates
the evidence conditions required for the requested role. Missing candidates,
unresolved evidence, allocation-caused final-witness loss, and optional or
redundant truncation remain distinguishable.

As of v1.12.3, final role adequacy is derived from the role's actual required
conditions rather than from an unconditional downgrade the moment an early,
non-material base-retrieval or helper-classification step reports a failure
(for example, an unsuitable top-ranked focus producing no source slice). When
independently retained evidence satisfies the required owner, contract,
source/evidence, and freshness conditions for the role, the role can still be
reported sufficient. Genuinely missing required evidence, unresolved material
conflict, and loss of the final required witness through truncation remain
blocking exactly as before. `--no-source` remains supported, and legacy
no-role behavior is unchanged.

Freshness is `fresh`, `stale`, or `unknown` from supplied and active index
identities. An existing index is not automatically fresh. Applied limits,
selected/omitted evidence, truncation causes, fallback recommendations, and
evidence origin are explicit output rather than hidden implementation details.

## Structure-aware contract evidence

Implementation-contract discovery (the mechanism that identifies contract,
validator, result-shape, case-definition, error, or schema owners for the
`architecture`/`implementation` roles) is owned by the same candidate/evidence
pipeline as other role evidence (`src/context/roleCandidates.ts` and related
evidence-group modules). As of v1.12.3, a neutral filename (for example a
Python `result.py` or `cases.py`) is not excluded from contract eligibility
merely because it lacks a filename hint such as `type`, `schema`, `valid`,
`constant`, or `error`; grounded structural evidence (indexed symbols, graph
relationships, classification/evidence-group information, source evidence) can
independently establish a legitimate neutral-named owner. Filename hints remain
supporting evidence, not the sole gate. A neutral filename alone, with no
supporting structural evidence, still does not establish contract ownership,
and unrelated neutral files and misleading filename-only candidates remain
excluded. Candidate ordering and ambiguity handling remain deterministic.

## Responsibility mapping and test-command evidence

Test-responsibility mapping (the `test-implementation` role's mapping from a
requested `testResponsibilityRefs` entry to grounded evidence) is owned by
`src/context/responsibilityMapping.ts` and consumed through the same
capsule/audit contracts described above. As of v1.12.3, the mapping
distinguishes two evidence tiers:

- **Core evidence**, required for every mapping regardless of request content:
  grounded production-symbol evidence, contract/validator/error evidence,
  related or proposed test evidence, and oracle/assertion/expected-result
  evidence. A responsibility missing any genuinely required core evidence
  remains partially mapped or unmapped, and critical responsibilities keep the
  existing fail-closed behavior.
- **Supplemental evidence**, currently the discovered test-execution command
  (`testInfrastructure.testCommands`, owned by
  `src/context/testInfrastructureDiscovery.ts`, including bounded static
  discovery from `package.json` scripts and a repository `Makefile` `test`
  target). A core-complete responsibility with no discovered command is still
  reported sufficiently mapped, with an explicit warning that no test command
  was discovered, unless the request's `requestedEvidenceKinds` explicitly
  includes `test-commands` — in that case grounded command evidence becomes
  required for that request. A discovered command's provenance is preserved
  and never fabricated, and command-derived evidence (including a command's
  exit-code outcome) cannot substitute for missing core oracle/assertion
  evidence.

This distinction prevents supplemental execution metadata from silently
gating core responsibility readiness while preserving fail-closed behavior for
genuinely missing core evidence or an explicit `test-commands` request.

Known limitation: the shared test-file classifier does not generally recognize
Python `test_*.py` / `*_test.py` naming as related-test evidence. This is not
implemented as of v1.12.3; broader Python language/framework classifier
improvements remain v1.14.0 scope.

## Static-evidence boundary

All produced evidence is conservative static repository evidence. It does not
prove runtime behavior, test success, UI visibility, route reachability,
dependency injection, database/network behavior, Android builds, or security.
Uncertainty, ambiguity, skipped evidence, and unsupported patterns remain
observable. [SECURITY.md](SECURITY.md) owns path containment, subprocess,
untrusted-input, and generated-output safety.

## Ecosystem responsibility boundary

- my-dev-kit owns repository indexing, bounded retrieval, and static evidence.
- my-dev-kit-orchestrator owns staged workflows, prompts, artifacts, readiness,
  lifecycle, judge/correction routing, and publication authorization.
- my-dev-kit-lab owns experiments, audits, security validation, evidence and
  reporting, and release-readiness support.

Orchestrator guides agents to run my-dev-kit. It does not turn my-dev-kit into a
workflow engine. Lab evaluates evidence and agreement. It does not become the
production retrieval runtime.

## Contract change discipline

Contract changes require synchronized implementation, tests, detailed schema or
command documentation, compatibility notes, and preservation checks. Current
behavior may correct stale status, but it must not erase future roadmap scope.
Release history and versioned schema details remain append-preserving.
