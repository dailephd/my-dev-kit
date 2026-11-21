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

Historical limitation (v1.12.3 through the published v1.15.0): the shared
test-file classifier did not recognize Python `test_*.py` / `*_test.py` naming
as related-test evidence, so Python tests were absent from `selectedTests` and
responsibility mappings stayed partial. That limitation was corrected in the v1.15.1 package (KIT-PYTEST-01, below), not in v1.15.0. Current `package.json` metadata is `1.15.1`; release-channel verification remains separate from metadata.

<a id="python-test-discovery-kit-pytest-01-unreleased"></a>

### Python related-test discovery (KIT-PYTEST-01, v1.15.1)

**Status: implemented in v1.15.1; not part of `@dailephd/my-dev-kit@1.15.0`.** The change lives only in
`src/context/testInfrastructureDiscovery.ts`; `responsibilityMapping.ts`, the
capsule/audit schemas (`"1.0.0"`), the command syntax and every public option
are unchanged, and no artifact schema changed. These are separate claims and
must not be conflated:

- **Python test-file recognition.** `isPythonTestFile` accepts the pytest default
  names `test_*.py` and `*_test.py` at any depth (`tests/test_a.py`,
  `pkg/a_test.py`). `conftest.py`, helpers, `test.py` and other names are not
  test files. Recognition alone relates nothing to production code.
- **Static import relationship discovery.** A Python test is related to a
  selected production file only through authenticated indexed evidence: a
  `python-ast` import fact in the file's indexed `sourceAudit` with
  `importResolution: "resolved-local"` and exactly one `targetPaths` entry that
  is also an indexed file-dependency `import` edge from that test. `ambiguous`,
  `unresolved`, `external`, `outside-selected-roots` and multi-target imports
  never create a relationship; ambiguous and multi-target imports and
  unresolved `AppTest.from_file` literals are reported as bounded notes (at
  most three per test, five warnings overall). A `from package import submodule` import, which the index
  resolves only to the package `__init__.py`, also relates an indexed submodule
  of that name unless the package itself declares the name or the name matches
  both a module file and a package (reported, not guessed). A named import of a
  selected symbol is reported as `references-selected-production-symbol`;
  otherwise `imports-selected-production-file`.
- **Exact selected-source relationship evidence.** Evidence items carry the
  test path, the relationship, the basis, a provenance string
  (`python-indexed-import:import`, `python-indexed-import:named-import` or
  `python-literal-app-file:AppTest.from_file`) and the import or literal line as
  `sourceLocation.line`. Non-Python tests keep the existing
  `import-specifier-scan` provenance and output unchanged.
- **Streamlit `AppTest.from_file` literals.** Only when the test's indexed
  import bindings show `AppTest` imported from `streamlit`, a literal-only,
  comment- and string-aware token scan (bounded to 400,000 bytes per file and 400
  test-shaped files) reads `AppTest.from_file("path")` or `script_path=` calls.
  A complete plain string literal that resolves to exactly one existing indexed
  file under the repository root or the test's own directory
  (`references-selected-production-file-literal`) is evidence; variables,
  f-strings, bytes, escapes, concatenation, traversal, absolute or scheme paths,
  unknown files and literals matching both bases are counted as unresolved and
  never produce a path.
- **Test-command discovery** is unchanged. Commands still come only from
  `package.json` scripts and a repository `Makefile` `test` target, reported
  verbatim with their provenance. `pytest.ini`, `tox.ini` and similar
  configuration files are detected but not parsed (`supported: false`), and no
  targeted pytest command is derived from related Python tests.
- **Responsibility mapping, oracle evidence and execution.** A discovered
  related Python test supplies the core *related-test* evidence for a
  responsibility. It does not establish oracle/assertion evidence, that every
  responsibility is covered, or that any test ran or passed; a command never
  substitutes for oracle evidence. Mapping semantics are exactly those described
  above.

Still not supported: pytest configuration discovery or parsing, deriving
targeted pytest commands, dynamic imports and `importlib` use, fixtures,
`conftest.py` or plugin relationships, and any claim from static evidence about
test execution, coverage or passing. Broader Python language and framework
improvements shipped separately in v1.14.0.

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

<a id="v1150-source-evidence-contracts-unreleased"></a>

## v1.15.0 source-evidence contracts

**Status:** implemented in v1.15.0 (KIT-FACTS-01 producer). This section is the canonical contract summary; the artifact is in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md#source-audit-evidencejson-v1150-unreleased), commands in [COMMANDS.md](COMMANDS.md#source-audit-selectors-v1150-unreleased), ownership in [ARCHITECTURE.md](ARCHITECTURE.md#source-audit-evidence-architecture-v1150-unreleased). They are not repeated here.

- **Additive, not replacing.** Symbol-index schema `3`, code-graph `1.1.0` and manifest `1.0.0` are unchanged; the artifact is `source-audit-evidence.json` (kind `my-dev-kit-v1-source-audit-evidence`, schema `1.1.0`), referenced by an optional `manifest.json` `sourceAuditEvidence` field. No new command family exists.
- **Source selection and coverage.** The evidence records the selected source roots, the effective exclusion rules and coverage counts. `inventoryComplete` and `exclusionsAreExplicit` state whether the selected inventory and its exclusions are fully accounted for. An unselected or excluded path is not evidence that a file is absent or clean.
- **Hashes and identity.** Each file carries a content SHA-256 where available. The manifest records the exact serialized artifact SHA-256 and a semantic `snapshotId`; they are different identities. Files without a trusted hash are never claimed authenticated.
- **Stable fact IDs.** Fact IDs are opaque, deterministic and taken from output; consumers must not reconstruct them.
- **Capability completeness.** Each file and capability is reported as complete, partial, unsupported, failed, skipped or not applicable. Partial or unsupported evidence is explicit, and a missing fact there is not absence. A complete selected inventory does not imply complete parsing or semantic resolution.
- **Managed artifact and manifest integrity.** `index` validates the artifact, writes it, then writes the manifest last. Readers verify the manifest reference, hash and snapshot and fail closed on a missing, unregistered or mismatched artifact. Multi-artifact publication is not atomic: an interrupted write can leave incomplete output, which must fail closed.
- **Cache compatibility.** The private cache (schema `1.4.0`) records the extractor revision (`source-audit-v1.5.0`) and capability set; an incompatible older cache causes one full rebuild. Legacy indexes without the artifact stay valid for all other commands, and the audit selectors report the evidence unavailable.
- **Complete inventory and exact-fact pagination.** Audit pagination is zero-based with fixed page sizes (64 files, 128 facts), a `null` `nextPageIndex` on the terminal page, an error for a page beyond it, and an explicit `not-selected` result for an unselected path. Ranked search and context capsules are not a substitute for this enumeration.
- **Import-target existence states.** `present` (candidate existence only), `proven-missing` (complete enumerated candidates in a complete, explicit selection, none on disk), `outside-selected-roots` and `indeterminate`. The last two are never missing-file proof. `present` does not establish unique semantic binding, and Java/Kotlin `candidatePaths` can be incomplete.
- **Raw occurrence completeness.** The exact-file query returns literal occurrences with `complete`, scan limit 200000 bytes, 200 matches and 40 context lines. A zero-match result is absence evidence only when `complete` is true; truncated, oversized, invalid or unhashed content is never reported as complete absence.
- **Containment and freshness.** Source reads stay inside the indexed project root; a changed, deleted, replaced or symlink-escaping selected file is rejected as stale. Targets are never modified.
- **Failure behavior.** Successful results are JSON. Argument and evidence errors exit with code 2 and print a code-prefixed plain-text message; a JSON error object is not guaranteed.
- **Kit facts versus Lab policy.** Kit supplies source facts, existence and occurrence evidence. Lab keeps audit rules, severity, policy, findings and reports. An exact occurrence is not automatically a syntactic reference, and a candidate's existence is not proof of unique semantic binding.
- **Graph identity.** File-dependency edge IDs in `code-graph.json` stay unique when a file depends on one target through several statement kinds: the first kind (import, re-export, export-all) keeps the historical ID and the others receive a `#<kind>` suffix. Node and edge validation was not weakened.

### Planned v1.15.2 capability-isolation patch (KIT-FACTS-01 maintenance)

**Status: planned immediate correction, not shipped by the current 1.15.1 package.** Kotlin script explicit-import enumeration must be qualified independently from declaration, export and JVM identity completeness. The existing per-file, per-capability source-audit contract remains authoritative: a partial or unsupported capability cannot prove a negative, and complete selected inventory cannot prove complete semantic analysis.

For the supported lexical profile, a complete `imports` capability covers every **explicit** import directive, including recognized alias/wildcard forms; it does not cover implicit Kotlin/Gradle DSL imports or resolved runtime dependencies. Any malformed directive or unresolved lexical boundary that may affect enumeration leaves `imports` partial or failed with diagnostic evidence. Executable top-level script statements alone are not import ambiguity. `declarations` stays partial where script declaration completeness is unproven, and no ordinary script JVM declaration identity is invented. All fact payloads remain source-anchored and producer-authenticated.

The implementation must change the producer extractor revision so old per-file cache records cannot claim newly strengthened completeness. Retain source-audit schema `1.1.0`, stable file/fact/lookup contracts, and existing containment and snapshot checks unless a concrete incompatibility is first established. Downstream Lab v0.10.1 must qualify each predicate independently; Kit cannot assign a Lab PASS, severity or audit applicability state.

### Planner-decided A1 dual-target source-evidence contract

**Status: designed 2026-11-19; release allocation now approved as Kit v1.16.0 / Lab v0.11.0; unimplemented and unreleased.** A0 is `PASS_A0`; it authenticates the three source candidates, historical website failure and exact SW-123 ledger, not a successful replay. One Kit producer supplies observations and evidence completeness; Lab alone decides applicability, findings, severity, mandatory coverage and exits.

**Patch-compatible Kit v1.15.2 portion (subject to verification):**

1. One source traversal maintains independent *ordinary graph* eligibility and *audit* eligibility. A file whose basename ends in `.d.ts` may be selected for audit evidence while remaining absent from the ordinary graph. Explicit `--src` and `--exclude` restrictions, containment, hashing and freshness remain authoritative; unselected mandatory files cause a selection error, not an empty clean result.
2. An authenticated `declare module "server-only";` becomes a `declaration` observation with `declarationKind: ambient-module`, canonical span, deterministic fact ID and no invented runtime/graph symbol. Optional legacy `symbolId` must not be fabricated. Independent imports, declarations, exports and ranges retain truthful per-capability status; an ambient declaration alone does not classify the whole file as runtime-inapplicable.
3. Preserve literal dynamic imports, known relative/static resolution, narrowly qualified immutable single-use bindings, and existing fact-bound import-target status/reason meanings. A computed operation unsupported by legacy `1.1.0` remains observed only to the extent its existing diagnostic proves and keeps its import-target coverage partial. Never promote an expression string to a literal `sourceSpecifier`.
4. Continue existing `source-audit-evidence.json` schema `1.1.0`, manifest `1.0.0`, symbol index `3`, code graph `1.1.0`, file/fact paging, read-time source hashes, exact UTF-8 occurrence and import-target selectors. The candidate `source-audit-v1.5.3` is not published; proposed correction revision `source-audit-v1.5.4` invalidates incompatible private cache entries without mislabeling old evidence.

**Allocated new public feature: Kit v1.16.0, consumed by Lab v0.11.0 (not published in the v1.15.2/v0.10.1 corrective candidates):**

- Opt-in `index --source-audit-schema 1.2.0` with legacy `1.1.0` as default. Schema `1.2.0` adds the `dynamic-import-expressions` capability, `dynamic-import-expression` facts, typed operand form and operand span, and an optional authenticated whole-file `ambientClassification`. Enumeration completeness is not target resolution completeness.
- A new fact-bound `lookup --audit-import-domain <expression-fact-id> --json` response (schema `1.0.0`) returns exhaustive finite operand alternatives, sound `disjoint-selected-domain`, or `indeterminate`, with independently qualified premise references, selection digest, path identity and per-alternative target statuses. Finite proof does not automatically imply successful resolution for every operand. Empty candidates without complete enumeration do not prove disjointness.
- A new `source --file P --contains-bytes-hex H --json` response (schema `1.0.0`) scans authenticated raw bytes, not decoded text. Bounds: 1–4096-byte hex needle; 200,000-byte scan; 200 returned matches; overlapping matches; zero-based byte offsets. `complete` requires source authentication, full scan, exact count, complete returned offsets and no truncation. A null content hash, oversized file or truncated enumeration cannot prove a negative.
- The finite evaluator follows at most 64 alternatives, 16 qualified immutable bindings and 32 expression levels. It may handle strings, concatenation, supported templates/conditionals and narrowly modeled `path`/file-URL operations with authenticated binding and platform semantics; no arbitrary execution, unknown-CWD substitution, wildcard runtime authority or guessed alias resolution. Bounds/unknowns yield `indeterminate` rather than an incomplete successful list.
- A sound negative reference claim for subject `s` requires complete relevant origins `O` and a qualified target overapproximation `D(o)` with `s` outside every `D(o)`. Membership in an overapproximation means *possible*, never an independently proven positive use. A definite missing-import claim requires every feasible operand alternative to satisfy the existing missing-target predicate. One present alternative does not clear unknown or missing alternatives.

**Required B2-R1 negative-proof correction:** B3 installed qualification rejected Kit `c83cb859` because it treated `node:path`'s mutable default-export methods as stable semantic intrinsics. Two default imports from that built-in can alias the same CommonJS exports object; a mutation through a second alias changes the operation used by the first. Node reference: https://nodejs.org/api/esm.html#built-in-modules. No local-name usage check, absence of visibly selected mutation, source digest or snapshot digest certifies immutable runtime method behavior. Under the current static-only profile, a domain computation that depends on mutable Node built-in path/file-URL operations must return `indeterminate`, `domainComplete: false` and existing `INCOMPLETE_REFERENCE_PROFILE`; omit disjoint certification and avoid dependent `proven-missing`/positive-target witnesses. Apply this condition to finite, disjoint and nested per-alternative resolution branches. Preserve genuinely independent literal and immutable primitive-binding cases. The public schemas (`1.2.0` artifact, `1.0.0` byte/domain responses) are unchanged. Original B3 is BLOCKED until a new SHA's archive and installed CLI pass the retained counterexample. Kit-only correction B2-R1 precedes B3-P1 requalification, then B3-P2 Lab integration. All 13 inherited mandatory SW-123 gaps retain their status until B4 replay.

**Proof/consumer invariants:** all proof replies bind to the exact snapshot, selection, current authenticated bytes, fact or file identity, bounds, reasons and query mode; malformed, stale, missing-page, mixed-snapshot or mismatched producer evidence is a hard failure. Lab may retain qualified positives and independent findings while keeping other required predicates `UNAVAILABLE`; it must never rewrite the source capability as complete. Mandatory `UNAVAILABLE`/`UNDETERMINED` yields exit `2` regardless of `--fail-on none`; Lab public report remains schema `1.0`. A new feature-capable package invoked with legacy defaults is not feature-qualified: Lab must explicitly request and validate `1.2.0` and the two proof protocols.

**Historical and version boundary:** v1.16.0 is the single Kit source-evidence release target, incorporating patch-compatible v1.15.2 candidate corrections plus the public feature; Lab v0.11.0 is the integrated consumer. Prior KIT-OPS-01 is preserved at v1.17.0, frontend retrieval at v1.18.0. Thirteen SW-123 obligations remain mandatory unavailable (three binary, ten runtime-dependent); R6-02/R6-11 are discharged only for their exact recorded origin/target receipt. The original website code-rot JSON was never produced, and its scratch export excluding declarations is diagnostic only. Preserve two independent full-source acceptance identities and exact archive/installed/published Kit qualification. The new public proof feature has been explicitly assigned to Kit v1.16.0 and Lab v0.11.0; there is no remaining version-allocation blocker, but no acceptance or publication has occurred. See the [planned schema details](GRAPH_SCHEMA.md#a1-source-evidence-120-proof-protocols-local-b2-qualification-blocked) and [roadmap](ROADMAP.md#version-1152--kotlin-script-source-audit-capability-correction).


### Planned KIT-FACTS-02 proof boundaries: Python relative imports and fixture bytes

**Status: future producer capabilities, assigned to the planned v1.19.0 scope, not claims of v1.16.0 implementation.** The 2026-11-21 R6-R6 offline coverage ledger retains six Python and three unsupported fixture-byte `REQUIRES_KIT_CONTRACT` records, distinct from 105 JVM, 586 legitimately incomplete and nine out-of-profile records. The exact IDs, inputs and acceptance criteria are in [ROADMAP.md](ROADMAP.md#version-1190--qualified-relative-import-and-fixture-byte-evidence-kit-facts-02). The ledger is external run evidence; neither this document nor a report row establishes a successful Kit response.

- **Python (`KIT-PYREL-01`).** A parsed `import` fact or literal `sourceSpecifier` is not a resolved Python module. Complete relative-import negative proof requires a qualified package context, all relevant candidates under the declared selected-source profile, freshness and a sound candidate upper bound. An imported member might denote a submodule, attribute or deferred runtime binding; candidate enumeration does not prove which was imported. Missing, implicit, runtime-modified or unsupported package/importer premises force `indeterminate`, not `proven-missing`. Exact positive target identity needs a separately authenticated witness. Do not execute inspected imports or replicate an independent resolver in Lab.
- **Fixture bytes (`KIT-BYTES-01`).** A selected but unsupported PNG may still require literal-byte predicates. Evidence must be scoped to a verified selected file, current raw-content digest, bounded scan/response and explicit completeness. A zero occurrence is certified only for the exact needle and exact byte domain when scan, returned offsets and count are complete; a selected path, decoded source string, parser success or an unrelated occurrence is not equivalent. If no qualified reader or predicate-equivalent source-occurrence response exists, the consumer retains mandatory unavailable coverage. Read-only source evidence must not mutate or load the fixture.
- **Consumer separation.** Kit exposes typed source identities, facts, bounds, qualification and explicit unknown/error states. Lab chooses per-predicate applicability, findings, coverage and mandatory exit policy. Do not change existing source-audit `1.1.0` default or opt-in `1.2.0`, ordinary response `1.1.0`, or domain/byte response `1.0.0` solely to turn an unknown into a complete conclusion. A public contract extension, if genuinely necessary, requires versioned validation and fresh packed/installed Kit and Lab acceptance.
- **Not in this scope.** The 105 JVM declaration/symbol-identity gaps require a separate evaluation of source-set versus external classpath/Gradle/compiler identities; nine resolver-profile gaps remain outside their declared profiles. The 586 other mandatory gaps do not become nonmandatory or PASS by allocation to this milestone. Kit v1.16.0 and Lab v0.11.0 readiness remain independently gated.

## Static-evidence boundary

<a id="kit-api-01-bounded-cross-layer-projection-v1150-unreleased"></a>

### KIT-API-01 bounded cross-layer projection (v1.15.0)

The relationship foundation is an optional managed projection in the existing
index lifecycle. `manifest.json` registers `apiRelationshipEvidence` with the
fixed artifact path, schema version, serialized SHA-256 and source snapshot ID.
Legacy indexes without this registration retain their existing behavior;
unregistered leftover files are not trusted evidence. There is no public
relationship lookup command.

The persisted artifact contains `schemaVersion`, `artifactKind`, `producer`,
`sourceSnapshot`, `selection`, `capabilities`, `nodes`, `relationships`,
`unresolved`, `limitations` and `integrity`. Producer identity includes package
name/version and revision. Snapshot identity includes the selection fingerprint
and file/hash inventory; selection records roots, exclusions, completeness and
production state. Witnesses retain source spans, content hashes, symbol/fact
references and AST, framework-graph or symbol/import-graph provenance. Node and
relationship IDs and ordering are deterministic; source identity is not a
runtime execution identity. Private extraction observations, including
`crossLayerRevision`, are not additional persisted artifact fields.

The validator rejects incompatible kind/schema/producer, invalid structure,
identities, witness hashes and sealed integrity. The internal bounded reader
also authenticates manifest registration and source-audit snapshot/selection,
then uses inherited selected-source freshness checks: changed bytes invalidate
live lookup even when Git HEAD is unchanged. Internal lookup supports exact
node IDs, relationship kinds, witness-file filters and a bounded result count.
Candidate enumeration is capped at 64; omitted results and metadata remain
explicit. `RESOLVED`, `AMBIGUOUS`, `UNRESOLVED` and `UNSUPPORTED` preserve the
strength of the available evidence. Missing selectors, incomplete selection or
production, unsupported capabilities, relevant uncertainty and truncation
prevent a complete negative. Neither an empty result nor a complete file
inventory alone proves absence of a relationship.

The managed `api-relationship-evidence.json` projection keeps artifact kind
`kit-api-relationship-evidence-v1`, schema `1.0.0` and producer
`api-relationship-v1.0.0`. Batch 2 uses the existing node/relationship vocabulary;
it adds no public command or runtime-execution claim.

- Express effective paths compose only authenticated static mount edges and exact
  route/handler identities. Multiple mounting contexts remain ambiguous; dynamic
  prefixes and nested mounting semantics remain unresolved or unsupported.
- Next endpoints require existing App Router handler declarations, a static
  `app/api/.../route.ts` or `.js` convention (also under `src/`), exact named
  exported HTTP handlers, and an actual reference to a `next/server` import.
  Filename similarity, dynamic/catch-all/parallel/intercepting conventions and
  `.tsx`/`.jsx` route files do not qualify this profile.
- Same-origin root-relative literal requests match exact method/path pairs,
  preserving case and source URL evidence. Query strings/fragments are excluded
  only from matching. External origins, unknown paths and ambiguous candidates
  never receive resolved local dispatch claims.
- Explicit `onClick`/`onSubmit` references in a React-import context can link a
  component, exact handler and request through bounded, cycle-safe static call
  references. Callback/event execution is not proven; unresolved handlers and
  exceeded bounds remain explicit.
- Exact imported class references can bridge a handler to a uniquely identified
  existing data-model source record. Interfaces retain their explicit declaration/
  schema associations. Neither association proves validation, ORM operations,
  table equivalence, serialization, authorization or runtime schema compatibility.
- Lookup includes witness-file associations within its existing caps. Relevant
  unresolved/unsupported evidence prevents a complete negative claim. Source
  selection and changed-byte freshness remain owned by source-audit evidence.

All produced evidence is conservative static repository evidence. It does not
prove runtime behavior, test success, UI visibility, route reachability,
dependency injection, database/network behavior, Android builds, or security.
Uncertainty, ambiguity, skipped evidence, and unsupported patterns remain
observable. [SECURITY.md](SECURITY.md) owns path containment, subprocess,
untrusted-input, and generated-output safety.

<a id="kit-api-01-contract-oriented-graph-diff-evidence-v1150-unreleased"></a>

### KIT-API-01 contract-oriented graph-diff evidence (v1.15.0)

The existing `graph-diff` result optionally adds `apiRelationshipImpact`. It is
omitted when neither manifest registers API relationship evidence. No command,
flag, indexing pass or persisted relationship schema is added. The existing
`apiContractChanges` type reservation and all original result fields are retained.

- `availability` is `both`, `before-only` or `after-only`, describing registration,
  not successful validation. `status` is `COMPARABLE`, `PARTIAL` or `UNAVAILABLE`.
  One-sided or invalid evidence never becomes fabricated additions/removals.
- Each snapshot must pass existing manifest and persisted source-audit validation,
  relationship kind/schema/producer/structure and integrity validation, serialized
  SHA-256 verification, and registration/snapshot/file-inventory/selection checks.
  Both snapshots must have the same recorded project root and selection identity.
  Distinct checkout roots are conservatively incomparable. Historical source bytes
  need not match the live filesystem; graph-diff never refreshes either snapshot.
- `changes` contain deterministic IDs, `ADDED`/`REMOVED`/`MODIFIED` kinds, existing
  node or relationship subject kinds, available before/after references, proven
  `changedFields`, side-qualified snapshot/artifact/witness evidence, qualification
  and reason codes. Declaration changes cover recorded declaration metadata;
  relationship changes cover supported method/path, targets, explicit schema/model
  references and UI handler witnesses. Source byte changes alone do not establish
  a contract delta. Full signatures, schema bodies and arbitrary implementation
  changes are not inferred from hashes or the compact declaration metadata.
  Node additions/removals describe projection membership, not proof that a schema
  or declaration was physically created/deleted; reason codes preserve this boundary.
- Exact IDs take precedence, guarded by authenticated source/declaration identity.
  Equal unique declaration-associated semantic records can cancel location churn;
  equal semantic multisets can cancel repeated-site movement without pairing sites.
  One unmatched relationship per exact source identity and family can be associated.
  Other incompatible identities remain additions/removals. No fuzzy rename matching,
  line proximity or similar filenames establish identity.
- `potentialImpacts` contain deterministic IDs, changed and associated subjects,
  the existing relationship kind, before/after evidence, qualification and reason
  codes. Each association has an actual direct relationship witness. Unresolved
  candidates retain their uncertainty. There is no recursive dependency traversal.
- `summary` reports available/returned change, impact and warning counts, truncation,
  `complete` and the inherited `RESOLVED`/`AMBIGUOUS`/`UNRESOLVED`/`UNSUPPORTED`
  qualification. Collections are deterministically ordered and capped at 64;
  evidence references include available/returned witness counts. Truncated metadata,
  incomplete capabilities/selection and unresolved/unsupported evidence prevent a
  complete negative. Completeness covers only the supported selected static profile.
- `warnings` retain validation diagnostics and unsupported/ambiguous reasons with
  side identity; they remain inside this section, preserving original warning order.
  A changed relationship is not a compatibility verdict, and a source change does
  not prove runtime failure. Missing static dependencies do not prove independence.

This is bounded static association evidence, without breaking/nonbreaking verdicts,
risk scores, authorization decisions, runtime reachability or migration inference.

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
