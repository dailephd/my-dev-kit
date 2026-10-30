# Contracts

This document maps my-dev-kit's stable cross-cutting contracts to their current
implementation and detailed owners. It is deliberately not a second copy of
every JSON schema or command flag.

This is a repository-level maintainer and ecosystem contract document. It is
not part of the installed-user documentation surface, and normal use of the
published `@dailephd/my-dev-kit` CLI does not depend on this file being present
in the npm package.

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

**v1.12.5:** `index --incremental` gains an additive `--refresh-scope <changed-files|affected-neighborhood>` selector; plain `--incremental` remains equivalent to `--refresh-scope changed-files`. `manifest.json` remains the primary identity/registry authority. Internal `cache-metadata.json` (schema `1.2.0`) additionally carries SHA-256 identity of the manifest and manifest-referenced symbol-index/code-graph artifacts to strengthen incremental baseline trust, but this stays internal bookkeeping — it does not replace or bypass manifest authority, and it is never registered in `manifest.json`'s `artifacts` map. `manifest.json` gains an additive optional `incrementalRefresh` field (present only when an incremental invocation actually writes the index) carrying requested-versus-applied scope, selection status, fallback reason, and fresh/reused evidence; the command result carries the same object, `null` for an ordinary non-incremental index. Untrustworthy, missing, or mismatched baseline evidence fails closed to a full rebuild, reported truthfully rather than silently narrowed to `changed-files` reuse. A no-change incremental invocation leaves the on-disk manifest untouched; only the command result reflects the current no-change request. See [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md) for the exact `incrementalRefresh` shape and [COMMANDS.md](COMMANDS.md) for CLI syntax.

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

### v1.14.0 qualified identity and Rust compatibility contract

Available in v1.14.0. The [v1.14.0 Rust subtrack](ROADMAP.md#rust-language-intelligence--v1140-subtrack) added qualified declaration identity so that same-named associated methods in different modules, traits and `impl` blocks no longer collide. The existing `symbol-index.json`, `code-graph.json`, context capsule, source continuation, incremental-cache and graph-diff contracts are reused; persisted schema versions advance from the published v1.13.0 (symbol index `2` → `3`, code graph `1.0.0` → `1.1.0`, internal cache `1.2.0` → `1.3.0`). Users upgrading from v1.13.0 should rebuild their index with v1.14.0 (`index`, without `--incremental`) before relying on exact qualified ownership, particularly when an older index contains duplicate graph node IDs: such an index can make `search`, `lookup` and `slice` fail with an ambiguous-node-identity error until it is rebuilt. Many operations on a v1.13.0 index still work, so this is not a claim that every older index is unreadable. The exact additive shapes are in the [graph schema](GRAPH_SCHEMA.md#v1140-additive-schema).

- **Legacy IDs are preserved.** A declaration whose simple name is unique in its file keeps `symbol:<file>#<simpleName>`. Only a declaration that would otherwise collide, or a member with an owner, receives a `symbolq:<encoded file>#<encoded owner key>#<name>#<ordinal>` ID. Older readers still resolve every pre-existing ID; other languages' graph IDs were not rekeyed.
- **Owner keys are physical.** A Rust `impl` is identified by its type, optional trait and its position in the file, so two `impl` blocks, or a trait declaration and its implementation, stay independently addressable and a physical `impl` is a graph node of its own.
- **Resolution states are explicit.** Rust structure and relationship nodes carry one of `RESOLVED`, `AMBIGUOUS`, `UNRESOLVED_EXTERNAL`, `UNRESOLVED_SELECTED_ROOTS`, `CONDITIONAL`, `UNSUPPORTED_SYNTAX` or `MALFORMED`. Only a unique target inside the selected source roots is `RESOLVED`; ambiguous names report bounded candidates and are never silently picked.
- **Static evidence only.** Neither Cargo manifest parsing nor observed `cfg`, `use`, macro or trait syntax proves compiler resolution, selected features, test success or target execution. Direct-call inference (optional batch R7) is deferred and no `calls` edges are produced for Rust.
- **Selected roots and containment.** Only files in the user-selected `--src` roots are read. Source, `mod` and `#[path]` targets, Cargo manifests and symlinks are checked against the selected inventory and their real path; a target outside it is reported unresolved and its bytes are never read or returned. This also covers file names containing a backslash on POSIX.
- **Trust before reuse.** An incremental refresh requires a trusted baseline and equal parser, Cargo and configuration fingerprints; otherwise it falls back to a truthful full rebuild. Full and incremental graphs agree after timestamp normalization.
- **Bounds.** A Rust source over 65,536 bytes, a parse over one second or a process over 512 MiB resident memory is refused; diagnostics are bounded.
- **CLI.** No Rust-specific flag exists. Rust is detected by the `.rs` extension; `--language rust` is not accepted.

### v1.14.0 configured TypeScript/JavaScript import-resolution contract

Available in v1.14.0. The [configured-import correction](ROADMAP.md#configured-typescriptjavascript-import-resolution--v1140-correction) resolves supported project-local `tsconfig.json`/`jsconfig.json` `compilerOptions.paths` aliases into the **existing** index-time `symbolIndex.graph.fileDeps` entries, which the code graph projects as ordinary file `imports`/`depends-on` edges. It adds no second graph, command or artifact field. The TypeScript adapter and `src/symbol-index/builder.ts` own production (resolver in `src/languages/typescript/configuredImportResolver.ts`); the relative-only helper shared with ownership search and test discovery is a separate query-time consumer.

An alias edge requires an applicable, safely read in-repository config, a supported literal mapping (exact or single wildcard, ordered targets, longest-prefix specificity) and a **unique selected indexed file** as its target. A mapping such as `@/*` → `./src/*` works without `baseUrl`; the target is then relative to the config that defines the mapping, and the closest nested config applies. Local `extends` chains are followed to a bounded depth. Ambiguous, excluded, external, missing, oversized, unreadable or symlink-escaping targets produce no edge and bounded diagnostics. Config selection, inheritance and content changes participate in the incremental fingerprint so stale edges disappear and full and partial indexes agree. Target configuration and source are never executed.

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
The query plan keeps the original and normalized query; `searchQueries` holds
the effective lexical query, which differs from the normalized query only when
`context` suppressed the low-information connector words `a`, `to`, `in`, and
`the` from a multiword request (never from quoted, path, route, identifier, or
single-term input). This does not change `search` behavior or any schema field.
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

## Retrieval-precision contracts (v1.12.6)

**Status:** shipped in v1.12.6. These contracts are backward-compatible and introduce no new schema major. Exact syntax is in [COMMANDS.md](COMMANDS.md); field detail is in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md); ownership is in [ARCHITECTURE.md](ARCHITECTURE.md).

### Search intent and ownership metadata

- `search --query` gains an optional `--intent <relevance|ownership>`. Omitted intent and `relevance` produce exactly the existing result: the result carries no `intent` field and no result carries an `ownership` object.
- `ownership` mode is opt-in and valid only with `--query`; it is mutually exclusive with every other search selector. A result then carries `intent: "ownership"` and each result an additive `ownership` object: `tier` (`direct-owner` | `production-candidate` | `supporting-evidence`), `lexicalScore` (always equal to the unchanged result `score`), and `evidence[]` provenance.
- Ownership is static, deterministic, local evidence. It is not edit authorization, does not prove runtime behavior, and does not select a unique winner when several production owners are plausible.
- Recovered owner relationships are computed at query time over existing index evidence (one hop, fixed bounds) and are not persisted code-graph edges. Applied bounds are reported through `warnings` when they omit supported candidates. Query validation failures fail the command with exit code 2 before any result is produced.

### Optional symbol end line

- `SymbolLocation` gains an optional inclusive 1-based `endLine`. `line` is unchanged. The field is present only when the language extractor's parser establishes a trustworthy boundary: TypeScript, TSX, JavaScript, and JSX from the compiler AST; Python from validated `ast` `end_lineno`. It is absent for Kotlin, Java, files with parser diagnostics, and records from older indexes.
- Consumers must not fabricate `endLine` from the next declaration, parser recovery, or a brace scanner. An old index without the field remains readable and follows the unknown-boundary behavior.
- No symbol or node identity changes, no `code-graph.json` node-structure change, no new artifact, and no schema-major bump. Existing source modes, graph identities, and incremental/managed-artifact behavior are preserved.

### Source completion for known symbols

- For a symbol with a validated `endLine`, `source --file --symbol` and symbol-node `source --node` return the whole symbol when it fits in `--max-lines`, with no continuation cursor. A known symbol larger than `--max-lines` is returned in windows that never cross the recorded end; its cursor has `symbolBoundaryKnown: true`.
- For an unknown or untrusted boundary, the existing 20-line preview, `symbolBoundaryKnown: false`, and `symbol-end-unknown` continuation apply.
- A stale index whose `endLine` is beyond the current file length fails closed with a re-index instruction rather than claiming a complete symbol.
- The continuation contract remains the existing cursor fields (`nextStartLine`, `previousEndLine`, `eof`, `symbolBoundaryKnown`, `reason`) with `--continue` and `--continue-from`. No stateful cursor token exists.

### Regression-runner contract

The retrieval-regression runner gains additive `search` and `source` task execution and a `commandResult` expectation; tasks without `execution` behave as before. This is internal maintainer tooling, not a public command or published artifact schema.

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
