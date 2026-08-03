# Graph Schema

This document describes the JSON artifacts produced and consumed by my-dev-kit.

my-dev-kit writes local, file-based artifacts when a project is indexed or when downstream data-model and lineage analysis runs. The Version 1 artifact family uses stable `artifactKind` identifiers that include `my-dev-kit-v1` as schema markers. These schema identifiers do not change the public product name.

For command flags, see [COMMANDS.md](COMMANDS.md).
For internal architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Artifact overview

Recommended artifact directory:

```sh
.my-dev-kit
```

Core index artifacts (always written by `index`):

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`

Optional index artifact:

- `call-graph.json` (when `--call-graph` is requested)

Semantic artifacts (written by `index` when the TypeScript model analyzer produces output):

- `data-model.json`
- `data-model-graph.json`

Frontend semantic artifacts (written by `index` when the frontend analyzer runs on TSX/JSX files):

- `frontend-semantic.json`
- `frontend-reachability.json` (v1.3.0)

Lineage artifact (written in `data-model --trace-view` mode):

- `model-view-lineage.json`

Context artifacts (written by the `context` command, v1.6.0):

- `context-capsule.json`
- `retrieval-audit-record.json` (optional, written when `--audit-out` is requested)

Classification artifact (written by `index` whenever the classification analyzer runs, v1.5.0; schema `1.1.0` as of v1.12.0 Batch 1, which additively extends `targetKind` with `'graph-node'` so entries can target an existing artifact-backed code-graph node — e.g. `android-project`/`android-module` nodes — alongside the existing `file`/`symbol` targets. All pre-1.1.0 file/symbol entries remain readable unchanged):

- `classification.json`

Android project artifact (written by `index` when static Android/Gradle project evidence is found under `--root`, v1.9.0 Batch 1 — Android/Gradle structure detection only; this artifact itself does not carry Kotlin/Java symbol data, which lives in `symbol-index.json`/`code-graph.json` as of Batch 2/Batch 3):

- `android-project.json`

Detailed Gradle project-evidence artifact (written by `index` when detailed static Gradle evidence is found under `--root`, v1.10.0 Batch 1 — extends `android-project.json`'s module set with plugins, dependencies, `android {}` configuration, and version-catalog evidence):

- `android-gradle.json`

Detailed Android manifest artifact (written by `index` when one or more `AndroidManifest.xml` files are discovered for a detected Android module, v1.10.0 Batch 2 — parses each source-set manifest independently, with no merging):

- `android-manifest.json`

Detailed Android resource artifact (written by `index` when one or more `res/` resource files are discovered for a detected Android module, v1.10.0 Batch 3 — indexes each qualified source-set resource directory independently, with no merge/overlay simulation):

- `android-resources.json`

Detailed Android navigation artifact (written by `index` when one or more `res/navigation/*.xml` graphs or narrowly-supported static Compose navigation routes are discovered, v1.10.0 Batch 4 — XML and Compose evidence kept in separate arrays, no cross-artifact linking):

- `android-navigation.json`

Android artifact relationships (v1.10.0 Batch 5 — no new artifact file; when Android evidence is detected, `index` additively enriches the existing `code-graph.json` with compact nodes/edges connecting the six Android artifacts above and existing Kotlin/Java `symbol`/`file` nodes):

- (enriches `code-graph.json` in place — see [Android relationship node and edge kinds](#android-relationship-node-and-edge-kinds-v1100-batch-5))

Artifact flow:

```text
index
  -> manifest.json           (artifact registry, analyzer registry)
  -> symbol-index.json       (symbols with compact semanticRoles/classificationRoles, artifactRefs/classificationRefs)
  -> code-graph.json         (nodes with compact semanticRoles/classificationRoles, artifactRefs/classificationRefs)
  -> call-graph.json         (optional)
  -> data-model.json         (when TypeScript model analyzer runs)
  -> data-model-graph.json   (when TypeScript model analyzer runs)
  -> classification.json     (when the classification analyzer runs, v1.5.0)
  -> android-project.json    (when static Android/Gradle evidence is found under --root, v1.9.0 Batch 1)
  -> android-gradle.json     (when detailed static Gradle evidence is found under --root, v1.10.0 Batch 1)
  -> android-manifest.json   (when AndroidManifest.xml files are discovered for a detected module, v1.10.0 Batch 2)
  -> android-resources.json  (when res/ resource files are discovered for a detected module, v1.10.0 Batch 3)
  -> android-navigation.json (when navigation XML graphs or static Compose routes are discovered, v1.10.0 Batch 4)
  -> code-graph.json enriched with android-* relationship nodes/edges (when Android evidence is detected, v1.10.0 Batch 5)

data-model --trace-view
  -> model-view-lineage.json

view --graph code
  -> renders code-graph.json

view --graph data-model
  -> renders data-model-graph.json

view --graph model-view-lineage
  -> renders model-view-lineage.json
```

`manifest.json` is the authoritative registry for the current artifact set. Artifacts from previous runs that are no longer produced are removed when `index` refreshes the directory.

## Artifact relationships

There are three artifact layers:

The structural layer (`symbol-index.json`, `code-graph.json`) describes file and symbol structure. These artifacts carry compact semantic role summaries on symbols and nodes when semantic analyzers produce them.

The semantic layer (`data-model.json`, `data-model-graph.json`) carries detailed entity, field, relationship, and source evidence. This is a derived layer separate from the structural layer.

The lineage layer (`model-view-lineage.json`) carries conservative static relationships between data-model fields, transformations, view-model fields, component props, and rendered fields.

The bridge between layers is artifact references (`artifactRefs`) and evidence references (`evidenceRefs`). Compact metadata on structural artifacts links to detailed records in semantic artifacts.

`data-model-graph.json` is a derived semantic graph, not a slice of `code-graph.json`. The code graph describes static source structure. The data-model graph describes data entities and fields. The model-view-lineage artifact describes static usage and flow paths. The `view` command can render each graph artifact independently with `--graph code`, `--graph data-model`, or `--graph model-view-lineage`.

## Versioned artifact kinds

Current versioned artifact kinds:

- `my-dev-kit-v1-manifest`
- `my-dev-kit-v1-graph-slice`
- `my-dev-kit-v1-search-result`
- `my-dev-kit-v1-data-model`
- `my-dev-kit-v1-data-model-graph`
- `my-dev-kit-v1-model-view-lineage`

`code-graph.json` uses:

- `code-graph`

## manifest.json

Artifact kind: `my-dev-kit-v1-manifest`

`manifest.json` is the authoritative registry for the current artifact set. It records which artifacts were written in the most recent `index` run, the status of each analyzer, and project-level metadata.

Main fields:

- `artifactKind`
- `version`
- `createdAt`
- `projectRoot`
- `sourceRoots`
- `languages`
- `callGraphEnabled`
- `artifacts`
- `semanticArtifacts`
- `analyzers`
- `summary`
- `warnings`
- `errors`
- `indexMode` (v1.8.0): `"full"` or `"incremental"` — how this specific build was produced
- `cacheMode` (v1.8.0, only present on incremental builds that actually (re)built artifacts): one of `incremental-full-initial`, `incremental-full-cache-incompatible`, `incremental-full-config-changed`, `incremental-change-detected-full-rebuild`, `incremental-partial`, `incremental-partial-with-artifact-fallback`
- `cacheInvalidationReason` (v1.8.0): human-readable reason when `cacheMode` reflects an invalidated/incompatible cache, or when partial-rebuild reuse was not safely possible; `null` otherwise
- `changedFileSummary` (v1.8.0): added/changed/removed/unchanged counts and bounded samples from the incremental change-detection pass that produced this build; `null` when not applicable (a plain full run, or an incremental run whose cache had no prior baseline to diff against)
- `partialRebuildFallbackArtifacts` (v1.8.0 Batch 3): artifact families fully regenerated rather than partially reused during a partial rebuild (currently only ever `["call-graph"]`, when `--call-graph` was requested); `[]` outside the two `incremental-partial*` cache modes

### artifacts

The `artifacts` object records paths for core index artifacts:

- `symbolIndex`
- `codeGraph`
- `callGraph` (null when not produced)

### semanticArtifacts

The `semanticArtifacts` object records paths for semantic artifacts:

- `dataModel` (null when not produced)
- `dataModelGraph` (null when not produced)
- `modelViewLineage` (null when not produced)
- `frontendSemantic` (null when not produced)
- `frontendReachability` (null when not produced)

A null value means the artifact was not produced in the most recent run. A non-null value is a path relative to the artifact directory.

### analyzers

The `analyzers` array records the status of each analyzer that was invoked.

Each entry includes:

- `id`: analyzer identifier (e.g. `syntax`, `call-graph`, `data-model`, `model-view-lineage`, `classification`, `android-project` (v1.9.0 Batch 1))
- `status`: one of `not-run`, `complete`, `partial`, `failed`, `skipped`
- `version`: analyzer version, when recorded
- `schemaVersion`: schema version of the produced artifact, when applicable
- `artifacts`: array of artifact references produced by this analyzer
- `warningCount`: number of warnings from this analyzer
- `errorCount`: number of errors from this analyzer
- `summary`: key-value summary counts from the analyzer

### summary

Top-level summary fields:

- `fileCount`
- `symbolCount`
- `edgeCount`
- `warningCount`
- `errorCount`

### Stale artifact behavior

When `index` refreshes the artifact directory, it removes artifacts that were present from a previous run but are not produced in the current run. `manifest.json` always reflects the current artifact state. Consumers should read `manifest.json` to determine which artifacts are available rather than assuming fixed file names are always present.

### cache-metadata.json (internal, v1.8.0)

`index --incremental` writes `cache-metadata.json` inside the output directory. It is **internal indexer bookkeeping, not a public semantic artifact**: it is not listed in `manifest.json`'s `artifacts` map, it is not documented as part of the artifact set below, and its shape is not guaranteed to stay stable across `my-dev-kit` versions the way `manifest.json`/`symbol-index.json`/`code-graph.json` are. It records a config fingerprint and, per file, a SHA-256 content hash, size, and (as of v1.8.0 Batch 3) the `reExportSpecifiers`/`exportAllSpecifiers` extraction fields not present in the public `symbol-index.json` shape — used to detect added/changed/removed/unchanged files and to safely reuse an unchanged file's analysis during a partial rebuild, without re-parsing it. Consumers building on `my-dev-kit` artifacts should read `manifest.json` and the artifacts it references, not `cache-metadata.json`. See [`index` → Incremental indexing](COMMANDS.md#incremental-indexing-v180) in `docs/COMMANDS.md` for behavior details.

## symbol-index.json

`symbol-index.json` records per-file symbol information extracted during indexing. `language` is one of `typescript`, `javascript`, `python`, `kotlin` (v1.9.0 Batch 2), or `java` (v1.9.0 Batch 3) — Kotlin/Java support is conservative static top-level structural indexing only; see `docs/COMMANDS.md` "Kotlin structural indexing" / "Java structural indexing" for what is and isn't extracted.

Top-level fields:

- `schemaVersion`
- `buildTime`
- `repoRoot`
- `sourceRoots`
- `fileCount`
- `symbolCount`
- `files`

Each file summary may include:

- `path`
- `language`
- `imports`
- `exports`
- `symbols`
- `dependencies`

Each symbol record may include:

- `name`
- `kind`: `function`, `class`, `interface`, `type`, `enum`, `const`, `variable`, or `object` (`object` added in v1.9.0 Batch 2 for Kotlin `object`/`companion object` declarations). Java (v1.9.0 Batch 3) reuses this set with no additions: `record` declarations map to `class`, `@interface` annotation-type declarations map to `interface`.
- `line`
- `exported`
- `signature`
- `semanticRoles`
- `artifactRefs`
- `classificationRoles` (v1.5.0)
- `classificationRefs` (v1.5.0)
- `androidComponentRoles` (v1.9.0 Batch 4): `[{ role, confidence }]`, only present on Kotlin/Java symbols in an Android project with a detected role
- `androidComponentRefs` (v1.9.0 Batch 4): pointers back into `android-components.json`

### semanticRoles on symbols

When the TypeScript model analyzer classifies a symbol, it writes a compact `semanticRoles` array on the symbol record.

Each role entry includes:

- `role`: semantic role name (e.g. `data-entity`, `data-field`)
- `subtype`: optional role subtype
- `confidence`: `explicit`, `inferred-static`, `partial`, or `unknown`
- `source`: the analyzer that assigned the role (e.g. `typescript-model-analyzer`)
- `artifactRefs`: references to entries in detailed semantic artifacts
- `evidenceRefs`: source evidence references

Currently produced roles: `data-entity`, `data-field` (from `typescript-model-analyzer`).

Other role names are defined in the semantic schema (`route-handler`, `react-component`, `view-model`, etc.) but are not yet produced by current analyzers.

### artifactRefs on symbols

`artifactRefs` at the symbol level are the union of artifact refs across all semantic roles for that symbol.

### classificationRoles and classificationRefs on symbols (v1.5.0)

When the classification analyzer has classified a symbol, it writes a compact `classificationRoles` array and a `classificationRefs` array on the symbol record. These are new, separate fields — they do not overload or change the meaning of `semanticRoles`/`artifactRefs`.

Each `classificationRoles` entry includes:

- `role`: classification category name (e.g. `canonical-type`, `database-model`, `command-handler`)
- `editGuidance`: e.g. `safe-primary-edit-target`, `inspect-before-edit`, `generated-do-not-edit`
- `readiness`: `ready`, `needs-more-context`, or `risky-assumption`
- `uncertainty`: `certain`, `likely`, `possible`, or `unknown`

This is a compact projection only — it does not include evidence, risk labels, warnings, or the human-readable reason text. Those live in the detailed `classification.json` artifact; `classificationRefs` (using the same shape as `artifactRefs`) points back to the matching entry there.

A symbol with no classification entry, or an index without a classification analyzer, simply omits both fields — this never changes existing `semanticRoles`/`artifactRefs` behavior.

**v1.12.0 Batch 1** projects the same `classificationRoles`/`classificationRefs` shape onto the `android-project:root` node and every `android-module` node, using four additive categories: `android-project` (project root, `read-only-reference`/`ready`/`certain`), `gradle-module` (every module), plus `android-app-module` or `android-library-module` (app/library modules, `inspect-before-edit`/`ready`/`certain`) — an unknown-type module receives only `gradle-module` at `needs-more-context`/`possible`, never a guessed app/library subtype. These are static structural facts only: they carry no build, runtime-variant, or DI-graph claim.

**v1.12.0 Batch 2** completes the Android classification vocabulary, projected the same way onto the remaining artifact-backed Android graph-node kinds:

- `android-manifest-file` → `android-manifest` + `configuration-file`, `inspect-before-edit`.
- `android-manifest-component` → `manifest-component`, `inspect-before-edit`, always carrying the advisory `emulator-validation-required`/`instrumented-test-required` risk labels (a manifest component always crosses an Android platform boundary).
- `android-navigation-graph`/`android-navigation-destination`/`android-navigation-deep-link`/`android-compose-route` → `navigation-route`, `inspect-before-edit` (navigation *actions* are never classified as routes — they are transitions, not route definitions).
- `android-resource-file` → `resource-file`, `safe-primary-edit-target` unless it is a platform-sensitive `xml`-baseType file (`inspect-before-edit` + `resource-contract-risk`); `android-resource-definition` → `resource-file` (+ `xml-layout` for layouts), always `safe-primary-edit-target`.
- `android-composable` → `compose-screen` (exact route/destination target evidence) or `compose-ui-component` (everything else); `@Preview` composables stay `compose-ui-component` but get `read-only-reference`, never a production-screen claim.
- `android-compose-fact` → `ui-only-state` (state facts only) or `ui-event` (click-handler facts only) — no other fact kind is classified in this batch, and no ViewModel-ownership is inferred for state facts.
- `android-test-file`/`android-test-class`/`android-test-method` → `android-unit-test` or `instrumented-test` (by source-set category) plus generic `test-block`/`test-fixture`, plus `compose-ui-test` when Compose-test framework evidence is present. Always `test-only`.
- `android-generated-build-path` → `generated-file`, `generated-do-not-edit` (see above).

Existing Android component-role facts (`android-components.json`) are reused verbatim as classification categories (`activity`, `fragment`, `view-model`, `repository`, `use-case`, `room-entity`, `room-dao`, `room-database`, `retrofit-service`, `hilt-module`, `worker`, `broadcast-receiver`, `service`, `content-provider`) by merging them into the matching already-built `symbol`-kind classification entry (`src/classification/mergeAndroidComponentRoleClassifications.ts`) — never a second detector, never a duplicate entry. Confidence maps to guidance/readiness/uncertainty: high → `ready`/`certain`; medium → `ready`/`likely`; low (naming-only) → `uncertain` guidance, `risky-assumption` readiness, `possible` uncertainty, and `wrong-layer-risk` — never upgraded merely because it is the only candidate.

Seven risk labels are advisory only, never a security verdict or runtime/build/test proof: `manifest-security-risk`, `generated-build-file-risk`, `resource-contract-risk`, `navigation-contract-risk`, `emulator-validation-required`, `instrumented-test-required`, and the existing `wrong-layer-risk` (assigned to usage/reference sites, test-only production-task focus, generated targets, and low-confidence naming-only evidence).

### Current limitation

Symbol start lines are recorded. Complete symbol end-line bounds are not recorded.

## code-graph.json

Artifact kind: `code-graph`

Schema version: `1.0.0`

Top-level fields:

- `artifactKind`
- `schemaVersion`
- `createdAt`
- `nodes`
- `edges`
- `summary`

Summary fields:

- `nodeCount`
- `edgeCount`
- `fileNodeCount`
- `symbolNodeCount`

The code graph describes static file and symbol structure.

It is consumed by:

- `search`
- `lookup`
- `slice`
- `view`
- `source`, when node-based retrieval is used

The code graph is not a runtime execution graph, and data-model or lineage edges are not added to it.

### Node model

Each code-graph node has:

- `id`
- `kind`
- `label`

File nodes may include:

- `path`
- `language`

Symbol nodes may include:

- `path`
- `symbolName`
- `symbolKind`
- `language`
- `line`
- `exported`
- `semanticRoles`
- `artifactRefs`
- `classificationRoles` (v1.5.0)
- `classificationRefs` (v1.5.0)

### semanticRoles and artifactRefs on symbol nodes

Symbol nodes carry compact `semanticRoles` and `artifactRefs` arrays when the TypeScript model analyzer has classified the corresponding symbol. These are the same compact records as on `symbol-index.json` symbols.

File nodes do not carry semantic role metadata.

### classificationRoles and artifactRefs on symbol nodes (v1.5.0)

Symbol nodes carry the same compact `classificationRoles`/`classificationRefs` records described above for `symbol-index.json` when the classification analyzer has classified the corresponding symbol. File nodes do not carry classification metadata. `slice` preserves these fields on every node it returns, the same way it preserves `semanticRoles`/`artifactRefs`.

### Edge model

Each edge has:

- `id`
- `source`
- `target`
- `kind`
- `label`

Defined edge kinds:

- `defines`
- `imports`
- `exports`
- `calls`
- `depends-on`
- `related-to`

### Android relationship node and edge kinds (v1.10.0 Batch 5)

When a project has Android evidence, `index` additively enriches `code-graph.json` with compact nodes/edges connecting the six Android artifacts (`android-project.json`, `android-components.json`, `android-gradle.json`, `android-manifest.json`, `android-resources.json`, `android-navigation.json`) to each other and to existing Kotlin/Java `symbol`/`file` nodes. See [android-project.json](#android-projectjson-v190-batch-1) below and the dedicated section [Android artifact relationships in code-graph.json (v1.10.0 Batch 5)](#android-artifact-relationships-in-code-graphjson-v1100-batch-5) for full behavior, candidate-enumeration, and matching rules.

Additional node kinds: `android-module`, `android-source-set`, `android-manifest-file`, `android-manifest-component`, `android-intent-filter`, `android-permission`, `android-resource-file`, `android-resource-definition`, `android-navigation-graph`, `android-navigation-destination`, `android-navigation-action`, `android-navigation-deep-link`, `android-compose-route`, `android-project` (v1.12.0 Batch 1, the single `android-project:root` node — see below), `android-generated-build-path` (v1.12.0 Batch 2, see below).

Additional edge kinds: `module-contains-source-set`, `manifest-declares-component`, `manifest-component-resolves-to-source`, `component-has-intent-filter`, `component-uses-permission`, `manifest-uses-permission`, `resource-defined-in-file`, `source-references-resource`, `navigation-graph-contains-destination`, `navigation-destination-has-action`, `navigation-action-targets-destination`, `navigation-action-pop-up-to-destination`, `navigation-graph-includes-graph`, `navigation-destination-has-deep-link`, `manifest-deep-link-matches-navigation-deep-link`, `navigation-destination-resolves-to-screen`, `compose-route-resolves-to-screen`, `android-project-contains-module` (v1.12.0 Batch 1), `viewmodel-uses-repository`, `repository-uses-dao`, `repository-uses-service`, `dao-uses-entity`, `room-database-exposes-dao` (v1.12.0 Batch 3 - connect existing `symbol` nodes only, from `android-components.json`'s `dependencyFacts[]`; see [android-components.json](#android-componentsjson-v190-batch-4) below).

### Android project root (v1.12.0 Batch 1)

When Android project evidence is detected, `buildAndroidArtifactRelationships` additively projects exactly one bounded project-root node: `id: 'android-project:root'`, `kind: 'android-project'`, `label: 'Android project'` — backed by `android-project.json`, deterministic, and free of any machine-specific absolute path. One `android-project-contains-module` edge (`android-project:root` → the existing `android-module:<path>` node) is added per current module, reusing the module's existing node identity — never a second module-node type. Absent entirely for a non-Android project.

The classification analyzer (below) additively classifies this root node and every `android-module` node it connects to, projecting the same compact `classificationRoles`/`classificationRefs` shape symbol nodes already use.

### Android generated build paths (v1.12.0 Batch 2)

`buildAndroidArtifactRelationships` also projects one `android-generated-build-path` node per repository-relative path already present in `android-project.json`'s existing `ignoredGeneratedDirectories[]` (a fixed `build`/`.gradle` existence check under the project root and each declared module — never a repository-wide scan). Node ID: `android-generated-build-path:<normalized-relative-path>`; `path` is the same repository-relative string, never an absolute path. No file beneath the directory is enumerated, read, or turned into a node. The node disappears on the next full/incremental rebuild if the directory (and therefore the `ignoredGeneratedDirectories` entry) disappears. Classified `generated-file` / `generated-do-not-edit` / `ready` / `certain` / `generated-build-file-risk`.

## call-graph.json

`call-graph.json` is written when `--call-graph` is requested and call graph data is available.

The call graph records conservative static call edges discovered by supported language adapters.

It is best-effort and conservative. It does not claim complete runtime behavior.

## data-model.json

Artifact kind: `my-dev-kit-v1-data-model`

Schema version: `1.1.0`

Purpose:

- canonical data-model artifact built from normalized extraction records
- separate from `code-graph.json`
- focused on entities, fields, relationships, evidence, and warnings

Top-level fields:

- `artifactKind`
- `schemaVersion`
- `createdAt`
- `entities`
- `relationships`
- `warnings`
- `summary`

Summary fields:

- `entityCount`
- `fieldCount`
- `relationshipCount`
- `warningCount`

### Entity model

Each entity includes:

- `id`
- `name`
- `kind`
- `fields`
- `relationships`
- `sourceRefs`
- `warnings`

Supported entity kinds:

- `canonical-model`
- `schema-model`
- `inferred-model`
- `view-model`
- `unknown`

### Field model

Each field includes:

- `id`
- `name`
- `typeText`
- `optional`
- `nullable`
- `cardinality`
- `sourceRefs`
- `warnings`

Supported field cardinalities:

- `one`
- `many`
- `unknown`

### Relationship model

Each relationship includes:

- `id`
- `kind`
- `fromEntityId`
- `toEntityId`
- `fromFieldId`
- `toFieldId`
- `confidence`
- `sourceRefs`
- `warnings`

Supported relationship kinds:

- `one-to-one`
- `one-to-many`
- `many-to-one`
- `many-to-many`
- `field-reference`
- `derives-from`
- `unknown`

Supported relationship confidence values:

- `explicit`
- `inferred`
- `partial`
- `unknown`

### Source references and warnings

`sourceRefs` can point back to:

- `filePath`
- `symbolId`
- `nodeId`
- `evidenceId`
- `evidenceKind`
- `line`
- `column`

Supported warning kinds:

- `unsupported-pattern`
- `ambiguous-relationship`
- `missing-source`
- `skipped-dynamic-pattern`
- `partial-extraction`

Warnings are used instead of guessed relationships.

### Limitations

- Extraction is conservative and TypeScript-focused.
- Prisma, SQL, Django, SQLAlchemy, TypeORM, and Sequelize are not supported.
- Unsupported or ambiguous patterns are reported as warnings or omitted conservatively.

## data-model-graph.json

Artifact kind: `my-dev-kit-v1-data-model-graph`

Schema version: `1.1.0`

Purpose:

- derived semantic graph of data-model entities and fields
- separate from `code-graph.json`
- separate node and edge ID space

This artifact is a derived semantic graph, not a slice of `code-graph.json`. The code graph describes static source structure. The data-model graph describes the entity and field relationships extracted from that source by the TypeScript model analyzer.

Top-level fields:

- `artifactKind`
- `schemaVersion`
- `createdAt`
- `nodes`
- `edges`
- `warnings`
- `summary`

Summary fields:

- `nodeCount`
- `edgeCount`
- `entityNodeCount`
- `fieldNodeCount`
- `relationshipEdgeCount`
- `warningCount`

### Node conventions

Supported node kinds:

- `entity`
- `field`

Node fields may include:

- `id`
- `kind`
- `label`
- `entityId`
- `fieldId`
- `parentEntityId`
- `sourceRefs`
- `warnings`

### Edge conventions

Supported edge kinds:

- `has-field`
- `relates-to`
- `derives-from`

Edge fields include:

- `id`
- `source`
- `target`
- `kind`
- `relationshipId`
- `sourceRefs`
- `warnings`

Data-model graph edges are not code graph edges. They are not added to `code-graph.json`.

## model-view-lineage.json

Artifact kind: `my-dev-kit-v1-model-view-lineage`

Schema version: `1.1.0`

Purpose:

- conservative static model-to-view lineage artifact
- separate from `code-graph.json`
- built from data-model artifacts plus indexed source evidence

Top-level fields:

- `artifactKind`
- `schemaVersion`
- `createdAt`
- `nodes`
- `edges`
- `warnings`
- `summary`

Summary fields:

- `nodeCount`
- `edgeCount`
- `evidenceCount`
- `warningCount`

### Node conventions

Supported lineage node kinds:

- `data-entity`
- `data-field`
- `transformation`
- `view-model`
- `component`
- `component-prop`
- `rendered-field`
- `unknown`

Each node includes:

- `id`
- `kind`
- `label`
- `confidence`
- `dataModelEntityId`
- `dataModelFieldId`
- `evidenceRefs`
- `warnings`

### Edge conventions

Supported lineage edge kinds:

- `reads-field`
- `derives-field`
- `creates-view-model`
- `passes-prop`
- `renders-field`
- `relates-to`
- `unknown`

Each edge includes:

- `id`
- `kind`
- `source`
- `target`
- `confidence`
- `evidenceRefs`
- `warnings`

### Evidence refs and warnings

Evidence refs can include:

- `filePath`
- `symbolId`
- `line`
- `column`
- `dataModelEntityId`
- `dataModelFieldId`
- `note`

Supported warning kinds:

- `unsupported-pattern`
- `ambiguous-lineage`
- `missing-data-model-artifact`
- `missing-source`
- `skipped-dynamic-pattern`
- `partial-lineage`

Lineage edges represent static evidence. They do not claim runtime execution, route reachability, browser-state behavior, or full React render-flow semantics.

### Supported lineage scope

The current lineage builder supports narrow static cases such as:

- direct transformation functions that return object literals from model field reads
- direct view-model object properties assigned from known model fields
- direct component prop assignments when field identity remains statically obvious
- direct JSX rendering when field identity remains statically obvious in supported local evidence

Unsupported dynamic or ambiguous cases are reported as warnings or omitted conservatively.

## Semantic role schema

Semantic roles are assigned by analyzers and embedded as compact metadata on symbols and nodes.

### SemanticRole

Each role entry includes:

- `role`: the role name
- `subtype`: optional further classification within the role
- `confidence`: `explicit`, `inferred-static`, `partial`, or `unknown`
- `source`: the analyzer that assigned the role
- `artifactRefs`: optional references to detailed semantic artifact entries
- `evidenceRefs`: optional source evidence references

A symbol or node may have more than one semantic role when multiple analyzers classify it.

### Defined role names

The semantic schema defines the following role names:

- `data-entity`
- `data-field`
- `canonical-type`
- `schema-model`
- `database-model`
- `artifact-type`
- `projection-type`
- `view-model`
- `ui-only-state`
- `persistence-adapter`
- `route-handler`
- `react-component`
- `client-component`
- `server-component`
- `test-block`
- `test-fixture`
- `browser-storage-payload`
- `storage-key`
- `rendered-field`
- `unknown`

Currently produced by the `typescript-model-analyzer`: `data-entity`, `data-field`.

Other roles are defined in the schema and available for future analyzers. The schema version is `1.0.0`.

### SemanticArtifactRef

Artifact references link a compact role entry back to a detailed record in a semantic artifact.

Fields:

- `artifact`: artifact file name (e.g. `data-model.json`)
- `artifactKind`: artifact kind identifier, when recorded
- `id`: stable ID of the record within the artifact
- `path`: path of the artifact, when recorded

### SemanticEvidenceRef

Evidence references point to the source location that supported a classification.

Fields:

- `filePath`: source file path
- `symbolId`: indexed symbol ID, when recorded
- `line`: source line number, when recorded
- `endLine`: end line, when recorded
- `source`: analyzer identifier
- `analyzer`: analyzer source value

## Graph slice artifact

Artifact kind: `my-dev-kit-v1-graph-slice`

Main fields:

- `artifactKind`
- `focusNodeId`
- `depth`
- `direction`
- `nodes`
- `edges`
- `summary`
- `artifactPaths`

Nodes in the slice include `semanticRoles` and `artifactRefs` from `code-graph.json` when present.

## Search result artifact

Artifact kind: `my-dev-kit-v1-search-result`

Main fields:

- `artifactKind`
- `version`
- `createdAt`
- `indexDir`
- `query`
- `normalizedTerms`
- `limit`
- `results`
- `summary`
- `artifactPaths`
- `warnings`

Each result item may include `semanticRoles` and `artifactRefs` when present on the matched node or symbol.

## context-capsule.json (v1.6.0)

Written by the `context` command as a bounded, local, deterministic query-to-context artifact for downstream planning workflows. Schema version `"1.0.0"`.

Top-level fields (see `src/context/types.ts` `ContextCapsule` for the authoritative shape): `schemaVersion`, `generatedAt`, `tool` (`{ name, version }`), `request` (`{ originalQuery, normalizedQuery, mode, requestedOutputPath }`), `index` (`{ indexPath, manifestPath, manifestSchemaVersion?, projectRoot?, artifactRefs }`), `limits`, `requiredContext`/`optionalSupportContext`/`droppedContext` (bounded `ContextEntry`/`DroppedContextEntry` lists), `warnings`, `contextAdequacy` (`{ status, summary, assumptions, gaps }`), `queryPlan`, `candidateFiles`, `candidateNodes`, `focus`, `selectedGraph`, `retention`, `selectedSource`, `selectedSourceBundles`, `semanticSummary`, `classificationSummary`, `artifactReferenceSummary`, `pruning`, `conflicts`, `modeEffects`, `sourceControl`.

`mode` is one of `general`, `feature-add`, or `subsystem`, and adjusts candidate ranking deterministically (`modeEffects`). Source evidence can be suppressed with `--no-source` (`selectedSource`/`selectedSourceBundles` become empty, `sourceControl.enabled` is `false`). Candidate files/nodes and selected graph nodes carry the same `semanticRoles`/`artifactRefs`/`classificationRoles`/`classificationRefs` fields used elsewhere in the artifact family. `conflicts` records conservative static edit-guidance conflicts (`status: 'conflict'`) backed by existing classification evidence; `status: 'none'` when no conflict is detected.

The context capsule never embeds a raw graph or artifact dump — all evidence is bounded and reason-tagged (`reasons`, `droppedReason`, `warnings` fields throughout).

## retrieval-audit-record.json (v1.6.0, optional)

Written by the `context` command only when `--audit-out` is requested. Schema version `"1.0.0"`.

Top-level fields (see `src/context/types.ts` `RetrievalAuditRecord`): `schemaVersion`, `generatedAt`, `tool`, `request`, `index` (`{ indexPath, manifestPath, manifestSchemaVersion?, projectRoot? }`), `steps` (ordered `AuditStep[]`), `fallbacks`, `fullFileReadRecommendations`, `warnings`, `contextAdequacy`.

Each `AuditStep` records `id`, `kind` (one of a fixed `AuditStepKind` set covering validation, manifest loading, query normalization, ranking, focus selection, graph/source selection, pruning, and conflict detection), `description`, `inputs`, `outputs`, `status` (`ok`/`skipped`/`failed`), and `warnings`. The record provides a full, ordered trail of how a context capsule was assembled, for auditing and debugging retrieval behavior — it is deterministic and does not itself claim runtime or LLM behavior.

### Additive context schema evolution (v1.10.1)

Version 1.10.1 preserves schema `"1.0.0"` and legacy no-role behavior while adding structured, role-specific repository evidence. It does not introduce a schema-major change.

The capsule additively records `roleContext`, `evidenceGroups`, `selectedOwners`, `selectedContracts`, `selectedTests`, `testInfrastructure`, `responsibilityMappings`, `roleAdequacy`, `freshness`, `budget`, `truncation`, `fullFileFallback`, and `provenance`. The existing `contextAdequacy` field remains readable and retains its established meaning.

The retrieval audit carries the same computed role, responsibility, adequacy, freshness, budget, truncation, fallback, and provenance evidence. Its ordered steps also record candidate selection, changed-surface intake, evidence grouping, test-infrastructure discovery, responsibility mapping, freshness classification, budget application, adequacy evaluation, and provenance recording. This remains one retrieval audit, not a parallel artifact family.

Current generation also writes the same canonical active-index identity to both artifacts: `indexPath`, `manifestPath`, `manifestSchemaVersion`, and `projectRoot`. The source is the already validated index manifest, not process working-directory inference. Before/after identities remain in the shared `freshness.comparedIdentities` array. Before writing a requested pair, the producer validates these identities and every other duplicated readiness summary in deterministic order.

Role adequacy distinguishes nonempty output from sufficient evidence. Architecture requires a plausible owner and relevant contract or extension-point evidence. Implementation additionally requires relevant source and contract evidence. Test implementation requires changed production evidence, related test infrastructure or an explicit missing-test state, and all critical responsibilities mapped.

Freshness is `fresh`, `stale`, or `unknown` and always includes inspectable reasons. Index existence alone never establishes freshness. Serialization preserves stable paths and ordering, reports truncation and bounded full-file fallback, and measures deterministic characters rather than claiming exact model-token counts.

### Additive context readiness fields (v1.10.3, shipped)

The current repository keeps context capsule and retrieval-audit schema version `"1.0.0"` while correcting implementation-role readiness:

- Implementation-role `groupTruncation[]` entries may include optional allocation fields: `required`, `reservation`, `initiallySelectedCount`, `unusedReservationContributed`, `borrowedCapacity`, `requiredOmittedCount`, `optionalOmittedCount`, `adequacyAffected`, `governingHardBound`, `aggregateCapacityUsed`, and `aggregateCapacityRemaining`.
- `reservation` is the group's initial share; `borrowedCapacity` is unused reservation reassigned from other groups. In the published v1.10.3 contract, `requiredOmittedCount` conservatively counts qualified evidence still omitted after spillover. `governingHardBound` is the finite sum of participating reservations, not the request's reporting-only `limits.evidenceGroupEntries` value.
- `responsibilityMappings.duplicateResponsibilityIds` remains the public duplicate diagnostic. Normalization preserves duplicate references until mapping, actual mappings stay unique in first-occurrence order, and duplicate and `unknownResponsibilityIds` diagnostics can both describe the same input.
- `EvidenceItemRef.id` remains the public evidence identity. For directed file-edge classification, a plain file item is matched to the code graph through canonical `file:<path>` node identity; symbol items use their existing symbol node ID. No new public ID format is introduced.
- Retrieval-audit `index.manifestSchemaVersion` and `index.projectRoot` are additive optional fields for schema-major-1 compatibility. Current generation always populates them; old supported-major audits can omit them and remain parseable, with identity unavailable rather than inferred.

These additions are optional for schema-major-1 consumers. Existing fields retain their meanings, legacy no-role output stays compatible, and the retrieval audit carries the same responsibility, allocation/truncation, adequacy, and direction-derived summaries as the capsule.

### Additive role-condition coverage fields (v1.10.4)

The context capsule and retrieval audit remain schema version `"1.0.0"`. Current producer output adds the same ordered `roleConditionCoverage` array to both artifacts. The serialized `RoleConditionCoverage` shape is:

- `conditionId`: stable `RoleConditionId`; currently `implementation.selected-owner` or `implementation.required-contract`.
- `role`, `required`, and `evidenceGroupIds`: the role, requiredness, and associated group identity from the canonical internal `RoleConditionDefinition`.
- `witnessPolicy`: `RoleConditionWitnessPolicy`, currently only `at-least-one`.
- `requiredWitnessCount`, `availableWitnessCount`, and `retainedWitnessCount`: the required minimum and adequate witness counts before and after allocation.
- `retainedWitnessIds`: sorted, deduplicated stable evidence identities (`EvidenceItemRef.id`), never ranking positions or machine-specific absolute paths.
- `conditionSatisfied`: whether retained evidence meets the required minimum.
- `lostRequiredCondition`: true only when the condition is required, enough adequate witnesses existed before allocation, and bounded allocation retained fewer than the required minimum.
- `lossReason`: `bounded-allocation-omitted-required-witnesses` only for that allocation-caused loss, otherwise `null`.
- `evaluationOrder`: the stable canonical condition order.

`RoleConditionDefinition` itself is internal and is not serialized as a separate artifact field. Its canonical owner is `src/context/roleConditionCoverage.ts`; the public artifacts serialize only the evaluated coverage result.

For current condition-aware output, `groupTruncation[].requiredOmittedCount` is the minimum required witness deficit attributable to bounded omission, capped by the group's dropped count. `optionalOmittedCount` is every remaining dropped candidate, so the two counts are nonnegative and sum to `droppedCount`. `adequacyAffected` is true only when the required count is nonzero. A required group may therefore be truncated while all of its dropped candidates are optional surplus.

`TruncationSummary.requiredEvidenceLost` is an additive rollup emitted by current output. It equals whether any `truncation.records[]` entry reports `requiredEvidenceLost: true`; `TruncationSummary.truncated` remains independently true for general bounded overflow.

Legacy schema-major-1 capsule/audit pairs may omit both `roleConditionCoverage` and `TruncationSummary.requiredEvidenceLost`. Both-absent pairs remain readable and use conservative legacy evaluation. One-sided absence or any value/order/witness disagreement is a raw-evidence parity error; absence is never normalized to an empty current result. Current implementation-role generation supplies nonempty owner/contract coverage, and a missing or empty current coverage array fails closed.

## Stable node IDs and compatibility

Node IDs are deterministic and stable across index runs for the same source root configuration. File node IDs use the `file:<relative-path>` form. Symbol node IDs use the `symbol:<relative-path>#<symbol-name>` form.

ID stability depends on path and symbol name stability. Renaming a file or symbol changes its ID.

This stable ID scheme is what the `graph-diff` command (v1.8.0 Batch 4) relies on to compare two index directories: a matching `node.id`/`edge.id` between a `--before` and `--after` index always means the same logical node/edge, so any remaining field differences are genuine metadata changes rather than an artifact of node/edge re-ordering. `graph-diff`'s own output schema (added/removed/changed nodes and edges, manifest/symbol-index/classification/semantic-summary diffs) is documented in `docs/COMMANDS.md` under `graph-diff`, not here — it is command output, not a persisted index artifact.

## android-project.json (v1.9.0 Batch 1)

Artifact kind: `my-dev-kit-v1-android-project`. Written by `index` when static Android/Gradle project evidence is found under `--root`; absent entirely for a non-Android project (not written as an empty/skipped file). Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-project', ... }`, the same registration pattern `classification` uses — there is no dedicated top-level `IndexManifest` field for it.

Top-level fields: `artifactKind`, `schemaVersion` (`"1.0.0"`), `createdAt`, `projectRoot`, `detected`, `confidence` (`"none"`/`"low"`/`"medium"`/`"high"`), `evidence` (sorted paths), `modules` (sorted by `path`), `ignoredGeneratedDirectories` (sorted), `warnings` (sorted), `summary` (`{ moduleCount, appModuleCount, libraryModuleCount, unknownModuleCount }`).

Each module: `id` (`android-module:<path>`), `name`, `path`, `type` (`"app"`/`"library"`/`"unknown"`), `gradleFiles`, `manifestPath`, `sourceSets` (sorted `main` → `test` → `androidTest`, each with `name`/`path`/`manifestPath`/`kotlinRoots`/`javaRoots`/`resourcesPath`/`warnings`), `kotlinSourceRoots`, `javaSourceRoots`, `evidence`, `warnings`.

This is a static detection artifact only: it does not record Kotlin/Java symbols, does not add nodes to `code-graph.json`/`symbol-index.json`, and does not claim the Gradle build succeeds, dependencies resolve, or the manifest is behaviorally valid. Full flag/behavior documentation lives in `docs/COMMANDS.md` under "Android project detection".

## android-components.json (v1.9.0 Batch 4)

Artifact kind: `my-dev-kit-v1-android-components`. Written by `index` only when one or more Android component roles were detected for the already-indexed Kotlin/Java top-level symbols (Batch 2/3) of an already-detected Android project (Batch 1); absent for a non-Android project or an Android project with zero detectable roles. Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-components', ... }`, the same registration pattern `android-project`/`classification` use.

Top-level fields: `artifactKind`, `schemaVersion` (`"1.1.0"` as of v1.12.0 Batch 3, additive from `"1.0.0"`), `createdAt`, `detected`, `components` (sorted by `filePath` → `symbolName` → `role`), `dependencyFacts` (v1.12.0 Batch 3, see below), `summary` (`{ componentCount, highConfidenceCount, mediumConfidenceCount, lowConfidenceCount, roleCounts, dependencyFactCount, resolvedDependencyFactCount, ambiguousDependencyFactCount, unresolvedDependencyFactCount, dependencyFactCountByKind }`), `warnings` (sorted).

Each component entry: `id`, `role` (one of `activity`/`fragment`/`view-model`/`service`/`broadcast-receiver`/`content-provider`/`worker`/`repository`/`use-case`/`room-entity`/`room-dao`/`room-database`/`retrofit-service`/`hilt-module`), `confidence` (`"high"`/`"medium"`/`"low"`), `filePath`, `symbolId`, `symbolName`, `sourceLanguage` (`"kotlin"`/`"java"`), `modulePath`, `sourceSet`, `packageName`, `evidence[]` (sorted by evidence-priority then value; each entry has `kind`, `value`, `source`, `confidence`), `warnings[]`.

Compact projection: a detected role also appears as `androidComponentRoles: [{ role, confidence }]` plus `androidComponentRefs` (pointing back into this artifact) directly on the matching symbol in `symbol-index.json` and the matching `symbol`-kind node in `code-graph.json` — the same compact-projection pattern `classificationRoles`/`classificationRefs` already uses. A symbol with no detected role simply omits both fields.

This is a static detection artifact only: it does not claim a component is declared in `AndroidManifest.xml`, that dependency injection resolves correctly, or any compiled/runtime behavior. Full behavior documentation lives in `docs/COMMANDS.md` under "Android component-role detection".

### dependencyFacts (v1.12.0 Batch 3)

Each entry: `id`, `relationshipKind` (one of `viewmodel-uses-repository`/`repository-uses-dao`/`repository-uses-service`/`dao-uses-entity`/`room-database-exposes-dao`), `sourceComponentId`, `sourceSymbolId`, `sourceRole`, `targetRole`, `declaredTypeName` (the raw statically-visible type text, unwrapped of any supported wrapper for `dao-uses-entity`), `evidenceKind` (`primary-constructor-parameter`/`secondary-constructor-parameter`/`constructor-parameter`/`typed-property`/`typed-field`/`method-parameter`/`method-return`), `sourceRef` (`{ file, line }`, repository-relative), `matchStatus` (`resolved`/`ambiguous`/`unresolved`), `candidateComponentIds[]`, `candidateSymbolIds[]` (empty for `unresolved`, exactly one for `resolved`, two or more for `ambiguous` — every same-tier candidate preserved, no selected winner), `warnings[]`.

Extraction reuses the same bounded, brace-depth-scanned source re-read Retrofit-service role detection already uses (`src/android/boundedSourceBodyScan.ts`) — never a second unbounded scanner, never a Kotlin/Java member-symbol model. Candidate matching is exact and role-restricted: fully-qualified type, then explicit import, then same-package type, then simple class name, stopping at the first tier with any match — never fuzzy, suffix, or case-insensitive. Room DAO entity resolution unwraps only `List<T>`/`Flow<T>`/`StateFlow<T>`/`LiveData<T>` (including nested combinations and nullable `T?`); any other generic wrapper shape is recorded `unresolved` with an explicit warning rather than fabricating a match.

Each resolved/ambiguous fact is additively projected into `code-graph.json` as one edge per candidate (see [Android relationship node and edge kinds](#android-relationship-node-and-edge-kinds-v1100-batch-5)), connecting the already-existing source and target `symbol` nodes — never a new component node, never a second graph. `unresolved` facts never produce an edge. The existing classification merger additionally adds advisory `wrong-layer-risk` (only — edit guidance/readiness/uncertainty never change because of a dependency fact) when a supported dependency is ambiguous, unresolved, or its resolved role confidence is low.

## android-gradle.json (v1.10.0 Batch 1)

Artifact kind: `my-dev-kit-v1-android-gradle`. Written by `index` when detailed static Gradle project evidence (settings, build-file plugins/dependencies/`android {}` configuration, or version catalogs) is found under `--root`; absent entirely for a project with zero qualifying Gradle evidence. Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-gradle', ... }`, the same registration pattern `android-project`/`android-components` use. It extends — and is written alongside — `android-project.json` (v1.9.0 Batch 1), which remains the coarse project/module/source-set summary; `android-gradle.json` is the detailed layer built on top of the same module set via `src/android/parseGradleEvidence.ts` and `src/android/buildAndroidGradleProject.ts`.

Top-level fields: `artifactKind`, `schemaVersion` (`"1.0.0"`), `createdAt`, `projectRoot`, `detected`, `filesExamined` (sorted), `settings` (nullable `AndroidGradleSettingsEvidence`), `modules` (sorted by `directory`), `versionCatalogs` (sorted by `file`), `warnings` (sorted), `summary` (`{ moduleCount, settingsFileCount, buildFileCount, versionCatalogFileCount, warningCount }`).

Each module: `id` (`android-gradle-module:<directory>`), `gradlePath`, `directory`, `buildFile`, `dsl` (`"groovy"`/`"kotlin"`/`null`), `moduleType` (`"app"`/`"library"`/`"test"`/`"dynamic-feature"`/`"unknown"`), `sourceSetRefs` (names only — the full source-set shape stays in `android-project.json`), `plugins[]`, `android` (nullable `AndroidGradleAndroidBlock`), `dependencies[]`, `warnings[]`.

Every SDK/config value that isn't a static literal (`namespace`, `compileSdk`, `applicationId`, `minSdk`, `targetSdk`, `versionCode`, `versionName`, build-type/product-flavor fields, `buildFeatures.*`) is an `AndroidGradleValue<T>` discriminated union: `{ resolved: true, value, raw, source }` for a literal, or `{ resolved: false, raw, source, warning }` for anything computed/dynamic — the raw source text is always preserved, a resolved value is never invented. Dependencies are classified by `kind` (`external-module`/`project`/`version-catalog-alias`/`platform`/`file`/`unknown`); `gradle/libs.versions.toml` (and any settings-referenced catalog file) is parsed into `versions`/`libraries`/`bundles`/`plugins` with the same conservative "preserve raw, warn if unresolved" contract.

This is a bounded, regex/brace-scanning static parser, not a Groovy/Kotlin-DSL evaluator: it never executes Gradle, never resolves dependencies or version-catalog aliases against a network repository, and never computes the final merged variant configuration (build type × product flavor). Incrementally, any change to a settings file, build file, or version-catalog file invalidates the cache and triggers a full `android-gradle.json` regeneration (no partial per-module rebuild in this batch) via the same `configFingerprint` mechanism `android-project.json`'s `androidEvidenceFingerprint` already uses. Full behavior documentation lives in `docs/COMMANDS.md` under "Android project detection".

## android-manifest.json (v1.10.0 Batch 2)

Artifact kind: `my-dev-kit-v1-android-manifest`. Written by `index` when one or more `AndroidManifest.xml` files are discovered for a detected Android module; absent entirely when zero qualifying manifest files exist. Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-manifest', ... }`, the same registration pattern `android-project`/`android-gradle`/`android-components` use. Built via `src/android/discoverAndroidManifests.ts` (discovery) and `src/android/parseAndroidManifest.ts` (per-file parsing), orchestrated by `src/android/buildAndroidManifestProject.ts`. It reuses `android-project.json`'s module/source-set identities and `android-gradle.json`'s namespace/`applicationId`/custom-manifest-path evidence — it does not re-detect modules or re-parse Gradle files.

**Manifest merging is never simulated.** Every `AndroidManifest.xml` discovered for every source set (`main`, `debug`, `release`, product flavors, `test`, `androidTest`, and any custom source set Gradle statically configures) is parsed and preserved as its own independent record — there is no "effective merged manifest" computed anywhere in this artifact.

Top-level fields: `artifactKind`, `schemaVersion` (`"1.0.0"`), `createdAt`, `projectRoot`, `detected`, `filesExamined` (sorted), `manifests[]`, `applications[]`, `components[]`, `intentFilters[]`, `launcherCandidates[]`, `deepLinkCandidates[]`, `permissions[]`, `declaredPermissions[]`, `usesFeatures[]`, `metadata[]`, `warnings[]` (sorted), `summary` (`{ moduleCount, manifestFileCount, applicationCount, componentCount, permissionCount, intentFilterCount, deepLinkCount, warningCount }`). Every array is sorted by its stable `id` (module/source-set-scoped arrays are additionally grouped by module/source-set in that ordering) so output is byte-identical across repeated runs against the same input.

Each `manifests[]` record carries `moduleId`/`gradlePath`/`sourceSet`/`discoverySource` (`"default-convention"` or `"gradle-override"`) provenance, the manifest's own `packageAttr`, the linked `gradleNamespace`/`applicationId` from `android-gradle.json`, and `parsingStatus` (`"parsed"`/`"malformed"`) — a malformed manifest still produces a record (with `warnings` explaining why) rather than being silently dropped or crashing the run.

Every attribute value that isn't a plain string is an `AndroidManifestAttributeValue` discriminated union: `{ kind: 'literal', value }`, `{ kind: 'resource-reference', reference }` (an `@type/name` or `?attr/name` reference, preserved but never resolved to an actual resource value or linked to `android-resources.json` — that cross-artifact relationship is Batch 5's), `{ kind: 'placeholder', raw }` (a `${...}` Gradle manifest placeholder), `{ kind: 'unresolved', raw, warning }`, or `{ kind: 'absent' }`. Component names go through a separate `ResolvedComponentName` (`raw`, `resolved`, `basis`, `warning`): a fully-qualified name (contains a `.` and doesn't start with one) is used as-is; a dot-prefixed or unqualified name is resolved against the manifest's own `package` attribute first, falling back to the Gradle namespace only when no `package` attribute exists — never against `applicationId`, and never invented when neither base is available (the name stays unresolved with a warning instead).

`components[]` covers `activity`/`activity-alias`/`service`/`receiver`/`provider`, each with full provenance (module/source-set/manifest file), an `exported` state (`"true"`/`"false"`/`"unspecified"` plus `exportedExplicit`, never computed from platform-version rules), and child `intentFilterIds`/`metadataIds`. `launcherCandidates[]` and `deepLinkCandidates[]` are derived purely from direct static intent-filter evidence (`MAIN`+`LAUNCHER` / `VIEW`+`BROWSABLE`+`<data>`) — both explicitly warn that manifest merging, aliases, enabled state, and build-variant selection are not evaluated, and neither claims the component is actually reachable at runtime.

Incrementally, `index --incremental`'s config fingerprint now also covers an `androidManifestEvidenceFingerprint`, alongside Batch 1's `androidEvidenceFingerprint`/`androidGradleEvidenceFingerprint`. Any manifest add/edit/delete, Gradle namespace change, or custom-manifest-path change invalidates the cache and regenerates `android-manifest.json` in full (no partial per-manifest rebuild in this batch). Full behavior documentation lives in `docs/COMMANDS.md` under "Android manifest evidence".

## android-resources.json (v1.10.0 Batch 3)

Artifact kind: `my-dev-kit-v1-android-resources`. Written by `index` when one or more `res/` resource files are discovered under a detected Android module's source sets; absent entirely when zero qualifying resource directories exist. Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-resources', ... }`, the same registration pattern `android-manifest`/`android-gradle`/`android-project` use. Built via `src/android/discoverAndroidResourceDirectories.ts` (directory discovery), `src/android/parseResourceDirectoryName.ts` (qualifier parsing), `src/android/parseAndroidValuesResource.ts` (`values*` XML), and `src/android/parseAndroidResourceFile.ts` (layouts, generic file-based XML, FileProvider paths, network-security config), orchestrated by `src/android/buildAndroidResourceProject.ts`. It reuses `android-project.json`'s module/source-set identities and `android-gradle.json`'s custom resource-directory (`res.srcDirs(...)`) evidence, and shares the bounded XML parser (`src/android/xml/parseXml.ts`) Batch 2 added — extended additively with an element `text` field for reading value-resource content, with zero change to Batch 2's manifest-parsing behavior.

**Resource merging, overlay precedence, and device-configuration matching are never simulated.** Every resource directory/file across every source set and qualifier (`values`, `values-es`, `values-night`, `layout-land`, ...) is indexed and preserved as its own independent record; duplicate logical resource names across qualifiers/source sets are never collapsed into a single "effective" definition, and no runtime winner is ever selected.

Top-level fields: `artifactKind`, `schemaVersion` (`"1.0.0"`), `createdAt`, `projectRoot`, `detected`, `filesExamined[]` (sorted), `resourceDirectories[]`, `resourceFiles[]`, `valueDefinitions[]`, `fileDefinitions[]`, `layouts[]`, `idDefinitions[]`, `references[]`, `fileProviderPaths[]`, `networkSecurityRecords[]`, `warnings[]` (sorted), `summary` (`{ moduleCount, sourceSetCount, resourceDirectoryCount, resourceFileCount, valueResourceCount, fileResourceCount, layoutCount, viewIdCount, referenceCount, specializedConfigCount, warningCount }`). Every array is sorted by its stable `id` so output is byte-identical across repeated runs against the same input.

Each resource directory/file/definition carries a `qualifiers` object (`AndroidResourceQualifiers`: `raw[]`, `locale`, `nightMode`, `apiLevel`, `density`, `orientation`, `smallestWidthDp`/`widthDp`/`heightDp`, `unrecognized[]`) parsed conservatively from the directory name — this is evidence preservation, not Android's full qualifier-matching algorithm; an unrecognized segment is kept in `unrecognized[]` rather than discarded or guessed at. Every definition also carries a logical `AndroidResourceKey` (`packageScope`, `type`, `name`, e.g. `string/app_name`) — several definitions legitimately share the same key across source sets/qualifiers/files, and all of them are preserved.

`references[]` covers every `@type/name`, `@+id/name`, `@id/name`, `?attr/name`, `@android:...`, `@package:type/name`, and `@null`/`@empty` form found in resource-file attributes and values, classified by `kind` (`resource`/`id-declaration`/`id-reference`/`theme-attribute`/`framework-resource`/`package-qualified-resource`/`null-or-empty`/`unresolved`). Each reference's `candidateTargetIds[]` lists every statically-known local definition sharing its logical key — enumerated, never narrowed to one "resolved" target; a reference with framework/no-local-candidate is left with an empty list, which is expected, not an error. Manifest resource references (Batch 2) and Kotlin/Java source are *not* linked to these definitions in this batch — that cross-artifact relationship work is Batch 5's.

`fileProviderPaths[]` (from `<paths>` FileProvider XML: `files-path`/`cache-path`/`external-path`/etc.) and `networkSecurityRecords[]` (from `<network-security-config>`: `base-config`/`domain-config`/`domain`/`trust-anchors`/`pin-set`/`pin`/etc., with a `parentId` capturing the containment tree) preserve bounded static structure only — no filesystem path is resolved, no domain is contacted, no certificate or pin is validated, and no security verdict is produced. A `res/navigation/*.xml` file is recorded only as a generic file-based resource (`type: 'navigation'`, root element, bounded references/IDs) within *this* artifact — destination/action/argument/deep-link navigation semantics for that same file are extracted separately into `android-navigation.json` (Batch 4, below); `android-resources.json`'s own record of the file is deliberately unchanged.

Incrementally, `index --incremental`'s config fingerprint now also covers an `androidResourcesEvidenceFingerprint`, alongside the other three Android fingerprints. Because binary resource files (drawables, mipmaps, fonts, raw files) contribute no parsed content to the artifact JSON itself, their evidence fingerprint additionally folds in a content hash per non-XML file so editing a binary file's bytes without touching its path still invalidates the cache. Any resource add/edit/delete or custom Gradle resource-directory change regenerates `android-resources.json` in full (no partial per-file rebuild in this batch). Full behavior documentation lives in `docs/COMMANDS.md` under "Android resource evidence".

## android-navigation.json (v1.10.0 Batch 4)

Artifact kind: `my-dev-kit-v1-android-navigation`. Written by `index` when one or more `res/navigation/*.xml` graphs are discovered, or one or more narrowly-supported static Compose navigation routes are found in indexed Kotlin/Java source; absent entirely when neither exists. Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-navigation', ... }`, the same registration pattern the other three Android analyzers use. Reuses `android-resources.json`'s already-discovered `navigation`-type resource-file records (`src/android/buildAndroidNavigationXmlModel.ts`, no independent directory rescan) and the shared bounded XML parser, additively extended with `findNamespacePrefixForUri` (a generalization of Batch 2's Android-namespace-only lookup, needed for the `app`/`tools` namespaces navigation XML uses) — zero change to Batch 2/3 parsing behavior.

**Two evidence kinds, kept clearly separate and never auto-linked**: XML navigation-graph evidence (`navigationFiles`, `graphs`, `destinations`, `actions`, `arguments`, `xmlDeepLinks`, `includes`) and static Compose route evidence (`composeRoutes`, `screenCandidates`). This batch never infers a relationship between an XML destination and a Compose route from name/string similarity — only Batch 5's cross-artifact relationship work may do that, and only from explicit static evidence.

**XML navigation evidence** is built via `src/android/buildAndroidNavigationXmlModel.ts`, computed early (before the full/incremental build decision, like the other three Android builders) since navigation XML isn't tracked by the normal `--src` changed-file mechanism. Supports nested `<navigation>` graphs, `fragment`/`activity`/`dialog` destinations (any other element name is preserved conservatively as a `custom` destination, with a warning), `<action>` (with `popUpTo`/flags/animation references), `<argument>` (with `argType`/`nullable`/classified `defaultValue`), `<deepLink>` (URI pattern, parsed scheme/host, placeholder detection — never manifest-linked), and `<include>` (candidate target graphs by logical resource key). Every candidate lookup (`startDestination`, action `destination`/`popUpTo`, `include` targets) enumerates **all** statically-matching definitions across source sets/qualifiers/nested scopes — it never selects a single runtime winner, never applies overlay precedence, and never merges an included graph into its parent.

**Compose route evidence** is built via `src/android/buildComposeNavigationRoutes.ts`, computed later — inside the same index-finishing pipeline stage `android-components.json` (v1.9.0 Batch 4) already uses — because it needs the already-built `symbol-index.json` (Kotlin/Java file list). This is deliberately **not** a Compose semantic analyzer: it recognizes exactly `composable(...)`, `navigation(...)`, `dialog(...)`, `activity(...)`, and `NavHost(...)`'s `startDestination`, and resolves only (a) direct string literals, (b) same-file `const val` string constants, and (c) generic type-route arguments (`composable<HomeRoute>`, labeled `type-safe-route`). String interpolation, concatenation, function-call results, and cross-file/cross-module constants are always left `unresolved-recognized-call` with a warning — never invented. A **direct screen candidate** (`screenCandidates[]`) is recorded only when a route's content lambda is *exactly* one top-level PascalCase call expression with no `if`/`when`/`for`/`while`/`try` anywhere in the body — ambiguous content (e.g. an `if`/`else` choosing between two screens) still gets a route record but no screen candidate.

Top-level fields: `artifactKind`, `schemaVersion` (`"1.0.0"`), `createdAt`, `projectRoot`, `detected`, `filesExamined[]` (sorted), `navigationFiles[]`, `graphs[]`, `destinations[]`, `actions[]`, `arguments[]`, `xmlDeepLinks[]`, `includes[]`, `composeRoutes[]`, `screenCandidates[]`, `warnings[]` (sorted), `summary` (`{ moduleCount, sourceSetCount, xmlGraphCount, nestedGraphCount, destinationCount, actionCount, argumentCount, xmlDeepLinkCount, includeCount, composeRouteCount, screenCandidateCount, warningCount }`). Every array is sorted by its stable `id` so output is byte-identical across repeated runs against the same input.

Incrementally, `index --incremental`'s config fingerprint now also covers an `androidNavigationXmlEvidenceFingerprint` (the XML portion only — computed the same early way the other three Android fingerprints are). The Compose-route portion has no separate fingerprint: Kotlin/Java file changes are already covered by the standard `--src` changed-file mechanism, which re-runs the finishing pipeline (and therefore recomputes Compose route evidence fresh) whenever a relevant source file changes — the same reasoning `android-components.json` already relies on. Any navigation XML add/edit/delete or custom Gradle resource-directory change regenerates the XML portion in full; there is no partial per-file/per-graph rebuild in this batch. Full behavior documentation lives in `docs/COMMANDS.md` under "Android navigation evidence".

## android-compose-semantic.json (v1.11.0 Batch 1)

**Current implemented contract:** this is one additive artifact whose current schema is `"1.2.0"`. The Batch 1-3 subsections below preserve the schema's evolution and cumulative field rationale; statements scoped as "in this batch" describe that historical increment, not the final v1.11.0 surface. The current artifact includes declarations/structure, Batch 2 state/effect/ViewModel/UI-marker facts, and Batch 3 click/navigation facts. Batch 4 projects compact nodes/edges into `code-graph.json` and exposes retrieval; Batch 6 renders those projected records. It still owns no route definitions, resource values, test evidence, runtime proof, or Android architecture/data-flow classification.

Artifact kind: `my-dev-kit-v1-android-compose-semantic`. Written by `index` when a detected Android project (Batch 1) has one or more supported named `@Composable` declarations in its already-indexed Kotlin source; absent entirely for a non-Android project, an Android project without Compose evidence, or a Kotlin project with no detected Android evidence at all (this batch gates on Android-project detection, the same prerequisite every other Android artifact requires). Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-compose-semantic', ... }`, the same registration pattern the other Android analyzers use. Built via `src/android/buildAndroidComposeSemanticProject.ts`, computed inside the same index-finishing pipeline stage as `android-navigation.json`'s Compose-route evidence, since it needs the already-built `symbol-index.json` (Kotlin file list); it does not read, modify, or import `src/languages/kotlin/adapter.ts`.

**Declaration-level static evidence only, in this batch.** `android-compose-semantic.json` captures only: named top-level, private top-level, and function-local `@Composable` declarations, `@Preview` classification, visibility, statically available parameter name/type text, complete deterministic source ranges, direct exactly-resolved same-file child-composable calls, and a fixed set of structural UI-region calls (`Scaffold`, `LazyColumn`, `LazyRow`, `Column`, `Row`, `Box`, `NavHost`). At the Batch 1 schema point it did **not** yet extract `remember`/`rememberSaveable`/`collectAsState`/`collectAsStateWithLifecycle` state usage, `LaunchedEffect`/`DisposableEffect` effects, ViewModel references, UI text/string-resource/test-tag evidence, navigation-call sites, or test evidence, and it had no graph/retrieval integration. Those additions were delivered by the later v1.11.0 batches documented below.

**A sibling of `android-navigation.json`, never a replacement for it.** Route declarations, route strings, navigation destinations, navigation graphs, and direct route-to-screen candidates remain exclusively `android-navigation.json`'s (Batch 4, above); this artifact never re-derives or duplicates that evidence, and the two artifacts are never cross-referenced.

**Exact-match only, the same conservative discipline every other Android analyzer uses.** A declaration is recorded only when a recognized `@Composable` (or qualified `...Composable`) annotation directly precedes a named `fun` declaration — never from a function name alone. A child-composable-call record is created only when the callee name exactly matches exactly one other same-file extracted declaration; zero matches are silently omitted (ordinary API calls), and more than one match (an ambiguous same-named function-local declaration in different enclosing functions) is omitted with a warning rather than guessed. Anonymous composable lambdas, composables returned from higher-order functions, member composables declared inside a class/object body, and composables nested more than one function deep in an unsupported enclosing context are conservatively never extracted; a recognizable-but-unsupported case degrades to a warning, never an invented declaration.

Top-level fields: `artifactKind`, `schemaVersion` (`"1.0.0"`), `createdAt`, `projectRoot`, `detected`, `filesExamined[]` (sorted), `declarations[]`, `warnings[]` (sorted), `summary` (`{ declarationCount, previewCount, topLevelCount, functionLocalCount, privateTopLevelCount, childCallCount, structuralRegionCallCount, warningCount }`). Each `declarations[]` entry: `id` (deterministic, derived from normalized file path + enclosing-declaration-name chain + declaration name, with a stable ordinal suffix for the rare same-key-in-one-file collision), `name`, `kind` (`'composable'`), `scope` (`'top-level' | 'function-local'`), `visibility` (`'public' | 'internal' | 'private'`), `isPreview`, `enclosingDeclarationId` (non-null only for `function-local` scope — may reference a non-Composable enclosing function that itself has no `declarations[]` entry), `annotations[]`, `parameters[]` (`{ name, typeText }`, `typeText` `null` when not statically extractable), `sourceRange` (`{ file, startLine, endLine }`, 1-based, spanning annotations through the closing body), `moduleId`/`sourceSet`, `childCalls[]` (`{ calleeDeclarationId, calleeName, line }`), `structuralRegions[]` (`{ kind, line }`), `warnings[]`. `declarations[]` is sorted by `id` so output is byte-identical across repeated runs against the same input.

Incrementally, no new cache or fingerprint was introduced: like `android-navigation.json`'s Compose-route portion, this artifact is recomputed fresh from `symbol-index.json` on every index run that reaches the finishing pipeline (both a full rebuild and a partial-rebuild-eligible `--incremental` run), and is only reused unchanged by the existing `--incremental` no-op fast path when no Kotlin file changed at all — the standard `--src` changed-file mechanism already guarantees correctness here.

### Batch 2 additive fact evidence (v1.11.0 Batch 2, schema `"1.1.0"`)

**Still the same artifact, same builder, same identity rules — additive fields only.** Batch 2 extends `buildAndroidComposeSemanticProject.ts` (no second Compose artifact, parser, index, or command surface) with six new source-grounded, conservative fact arrays, each entry attached to the innermost recognized Batch 1 composable declaration that statically encloses it (`composableId`), never guessed by name or file proximity: `stateFacts[]`, `effectFacts[]`, `viewModelReferences[]`, `testTagFacts[]`, `visibleTextFacts[]`, `stringResourceFacts[]`. A fact found lexically inside a *nested* recognized composable is attributed only to that inner composable — the outer composable's body is scanned with every nested composable's own line range blanked out first, mirroring the innermost-enclosure rule Batch 1 already applies to `enclosingDeclarationId`.

- **`stateFacts[]`** (`{ id, composableId, kind, callName, sourceRange, variableName, bindingForm, staticArguments[], rawArgumentsSummary, status, warnings[] }`): direct `remember`, `rememberSaveable`, `collectAsState`, `collectAsStateWithLifecycle` call sites. `bindingForm` is `'assignment'` (`val x = ...`), `'delegated'` (`val x by ...`), or `null` when no statically visible binding precedes the call (including through a simple same-line member-access chain, e.g. `val x = flow.collectAsState()`). `status` is `'unresolved'` only when a call argument is not a literal/identifier/simple-dotted-token — the call itself is still recorded, never a guessed value.
- **`effectFacts[]`** (`{ id, composableId, kind, sourceRange, keys[], rawKeyExpression, hasOnDispose, status, warnings[] }`): direct `LaunchedEffect`/`DisposableEffect` call sites. `keys[]` (`{ raw, kind: 'literal' | 'identifier' }`) is populated only when every key argument is conservatively representable; otherwise `keys` is empty, `status` is `'unresolved'`, and the full key expression is preserved verbatim (bounded) in `rawKeyExpression` rather than guessed. `hasOnDispose` is `true`/`false` for `DisposableEffect` (a direct `onDispose { ... }` call textually inside the effect lambda) and `null` for `LaunchedEffect`, where the concept does not apply.
- **`viewModelReferences[]`** (`{ id, composableId, kind, variableOrParameterName, typeText, sourceRange, status, warnings[] }`): `kind` is `'viewModel-call'` / `'hiltViewModel-call'` for a direct `viewModel()`/`hiltViewModel()` call (with the assigned local variable name and statically visible type when present), or `'parameter-type'` for a composable parameter whose statically visible type text ends in `ViewModel` (optionally generic/nullable). No dependency-injection correctness, runtime scope, lifecycle, or ViewModel-to-repository relationship is claimed or inferred — that remains v1.12.0 scope.
- **`testTagFacts[]`** (`{ id, composableId, sourceRange, resolvedValue, rawExpression, status, warnings[] }`): direct `Modifier.testTag(...)` call sites. `resolvedValue` is populated for a direct string literal or an unambiguous same-file top-level `val NAME = "literal"` string constant (a duplicate constant name anywhere in the file makes that name permanently unresolved, never guessed which definition wins); any other argument form is recorded with `resolvedValue: null`, `status: 'unresolved'`, and the raw (bounded) argument expression.
- **`visibleTextFacts[]`** (`{ id, composableId, sourceRange, callName, text, warnings[] }`): direct string-literal evidence from the narrow allowlisted call `Text(...)` (as either its first positional argument or a `text = "..."` named argument) — the minimum allowlist this batch supports. No other string literal inside a composable body (route strings, log messages, keys, internal constants) is ever classified as visible text merely because it is a literal.
- **`stringResourceFacts[]`** (`{ id, composableId, sourceRange, resourceName, resourceIdentifierText, rawFormatArguments[], warnings[] }`): direct `stringResource(R.string.<name>, ...)` call sites recognizing only the exact `R.string.<name>` identifier form; any other first-argument shape is omitted (with a declaration-level warning), never guessed. Additional formatting arguments are preserved only as bounded raw expression text in `rawFormatArguments[]` — never interpreted as rendered output, and the underlying Android resource value is never resolved (`android-resources.json` remains the sole resource-definition owner; this batch records usage evidence only).

`summary` gains `stateFactCount`, `effectFactCount`, `viewModelReferenceCount`, `testTagFactCount`, `visibleTextFactCount`, `stringResourceFactCount` — each a deterministic count of the corresponding emitted array, so a byte-identical rebuild produces byte-identical counts. `warningCount` now also covers Batch 2 fact-level and declaration-level warnings; the combined `warnings[]` array remains globally sorted. Every new array is sorted by its own deterministic `id` (`<composableId>::<factKind>#<sequence>@L<line>`, sequence assigned in stable source-scan order — never a process-global counter, filesystem enumeration order, or timestamp), so repeated indexing of byte-identical input produces byte-identical Batch 2 evidence, same as Batch 1.

**Still declaration-level-plus-usage-evidence only at the Batch 2 schema point.** Batch 2 did not yet add code-graph projection/retrieval, click/navigation extraction, or Android test indexing; the later v1.11.0 sections below document those completed additions. Android-specific classification/data-flow analysis (ViewModel-to-repository, repository/DAO/Room/Retrofit/Hilt) remains v1.12.0 work. No runtime claim is ever made: no recomposition, effect ordering/cancellation/lifecycle timing, dependency-injection correctness, or rendered-text/resource value is asserted from static evidence alone.

Incrementally, Batch 2 facts share Batch 1's existing recompute-on-every-finishing-pipeline-run behavior — no new fingerprint, no partial per-fact cache. An old consumer reading only the Batch 1 fields (`declarations`, `warnings`, `summary.declarationCount`, etc.) remains fully valid against the Batch 2 artifact; the new fields are purely additive.

### Batch 3 additive click-handler and navigation-call evidence (v1.11.0 Batch 3, schema `"1.2.0"`)

**Still the same artifact, same builder, same identity rules — two more additive collections.** Batch 3 extends `buildAndroidComposeSemanticProject.ts` with `clickHandlerFacts[]` and `navigationCallFacts[]`, each attached to the innermost recognized composable that statically encloses it, using the same nested-composable-range masking Batch 2 already established. No second Compose artifact, parser, click model, or navigation model is introduced.

- **`clickHandlerFacts[]`** (`{ id, composableId, sourceRange, apiForm, callbackForm, rawCallbackSummary, handlerName, status, navigationCallIds[], warnings[] }`): direct `Modifier.clickable { ... }` and `Modifier.clickable(onClick = ...)` call sites, plus a direct named `onClick = ...` argument on any call inside a recognized composable. `apiForm` is `'clickable-trailing-lambda'`, `'clickable-onClick-arg'`, or `'onClick-arg'`. `callbackForm` is `'lambda'`, `'function-reference'` (`::name`), `'identifier'` (a bare callback variable), or `'unresolved'` for any other expression — the callback is still recorded (never dropped) with a bounded raw summary and `status: 'unresolved'`. A local variable declaration merely named `onClick` (`val onClick = ...`) is never emitted as call-site evidence. `navigationCallIds[]` lists any `navigationCallFacts[]` entries lexically inside this handler's own source range (see below) — always empty when none exist, never inferred.
- **`navigationCallFacts[]`** (`{ id, composableId, clickHandlerId, sourceRange, receiverText, callName, rawRouteExpression, routeClassification, resolvedRoute, typeRouteName, status, candidateIds[], candidateMatchStatus, warnings[] }`): direct `.navigate(...)` and bare `navigate(...)` call sites. `routeClassification` reuses `android-navigation.json`'s own `ComposeRouteEvidenceKind` vocabulary (`'string-route' | 'resolved-local-constant-route' | 'type-safe-route' | 'unresolved-recognized-call'`) so a route *definition* and a route *usage* site are always described with identical terms. Route-argument extraction and literal/local-constant resolution directly reuse `buildComposeNavigationRoutes.ts`'s existing `extractRouteArgument`/`parseStringLiteral`/`collectStringConstants` helpers (exported for this purpose, behavior otherwise unchanged) — not a second, independently-drifting resolver. A `type-safe-route` classification is recorded only when the call's base identifier exactly matches an existing `composeRoutes[].typeRouteName` already known from `android-navigation.json`; otherwise the route stays `'unresolved-recognized-call'` rather than guessing a type-route shape from syntax alone.
- **Candidate cross-reference, never a winner pick.** `candidateIds[]` holds every exact `android-navigation.json` ID (`composeRoutes[].id` for a matched `resolvedRoute`/`typeRouteName`, or `destinations[].id` for a matched `resolvedRoute`) whose own resolved value exactly equals this call's — `candidateMatchStatus` is `'exact-one'` (one candidate), `'ambiguous'` (two or more candidates, every one preserved, never a single one chosen), `'no-match'` (route resolved but nothing in `android-navigation.json` matches it), or `'not-attempted'` (the route itself is `'unresolved-recognized-call'`, so no search is even attempted). Matching is always exact string/identifier equality — never fuzzy or name-similarity based. `android-navigation.json` remains the sole owner of route/destination/graph *definitions*; this artifact records only Compose call-site *usage* evidence and never duplicates or re-derives a definition.
- **Click-to-navigation linkage is lexical containment only.** A `navigationCallFacts[]` entry's `clickHandlerId` is set only when its call site's source position falls inside the *innermost* enclosing `clickHandlerFacts[]` entry's own source range in the same file (mirroring the same innermost-span-wins rule Batch 1 uses for nested function enclosure) — never inferred from naming, proximity across handlers, or cross-file evidence. The relationship means only "this navigation call's source text is inside this click callback's source range" — it does not mean the navigation call executes whenever the callback is invoked, and no click, visibility, or navigation-success runtime claim is ever made.

`summary` gains `clickHandlerFactCount` and `navigationCallFactCount`, both deterministic counts of the corresponding emitted arrays. Both new arrays are sorted by their own deterministic `id` (same `<composableId>::<factKind>#<sequence>@L<line>` convention Batch 2 established), so repeated indexing of byte-identical input produces byte-identical Batch 3 evidence.

**Still no code-graph projection, still no public retrieval selector.** This batch adds no `code-graph.json` Compose/click/navigation nodes or edges, no `search`/`lookup`/`slice`/`source`/`context`/`view` integration, no Android UI-test/instrumented-test/Espresso/Robolectric indexing, and no ViewModel-to-repository or other v1.12.0-scoped data-flow tracing. An old consumer reading only Batch 1/Batch 2 fields remains fully valid against the Batch 3 artifact.

## Android artifact relationships in code-graph.json (v1.10.0 Batch 5)

**No new artifact file.** Batch 5 does not create `android-relationships.json`, a second code graph, a second graph writer, or a separate Android graph cache/retrieval runtime. When Android evidence is detected, `index` calls `src/android/buildAndroidArtifactRelationships.ts` at the end of the same index-finishing pipeline stage `android-components.json`/Compose route extraction already use (after `symbol-index.json`/`code-graph.json` have their Kotlin/Java symbols and role metadata), and additively merges the result into the existing `code-graph.json` via `src/graph/addAndroidRelationshipsToCodeGraph.ts` — the same merge-by-`id` pattern `addFrontendRelationshipsToCodeGraph.ts` already uses for frontend routes. Registered in `manifest.json`'s `analyzers` array as `{ id: 'android-relationships', ... }` with `artifacts: []`, since it produces no new top-level file — only `summary.addedNodeCount`/`summary.addedEdgeCount` describe its effect.

**Node identity is always reused, never re-minted.** Every `android-*` relationship node reuses the stable ID already assigned by the artifact that owns it (e.g. `android-module:<path>` from `android-project.json`, a manifest component's own `id` from `android-manifest.json`, a resource definition's own `id` from `android-resources.json`, a destination/action/deep-link's own `id` from `android-navigation.json`). Kotlin/Java class/function targets are never duplicated as new nodes — every source-side edge endpoint is the existing `symbol`-kind (or, when no matching symbol exists, `file`-kind) node `code-graph.json` already has from structural indexing.

**Candidate enumeration, never winner selection.** For every one-to-many static relationship (a manifest component name matching multiple classes, an `R.type.name` reference matching multiple qualified/source-set definitions, a navigation action's target/`popUpTo` matching multiple destinations, an `<include>` matching multiple graphs, a Compose route matching multiple screen functions), Batch 5 emits one edge per statically-matching candidate rather than selecting a single "resolved" edge. Because `CodeGraphEdge.metadata` only supports scalar values (no arrays), this is the only way to preserve every candidate — there is no array-valued "candidates" field anywhere in this schema.

**Matching is exact only.** Manifest-component-to-class and Compose-route-to-screen resolution match on exact fully-qualified (or exact top-level-declaration) names only — never simple-name or fuzzy matching. `manifest-deep-link-matches-navigation-deep-link` requires exact scheme/host/port/path equality (only trailing-slash path normalization is applied); a manifest `pathPrefix`/`pathPattern` or a navigation deep link with a placeholder is always a non-match, never a partial/best-effort match. No security verdict (about permissions, exported components, or deep links) is ever produced from these edges.

Relationship node kinds, each backed by an existing artifact's own record (`androidArtifactId`/`androidMetadata` name the source): `android-module`, `android-source-set`, `android-manifest-file`, `android-manifest-component`, `android-intent-filter`, `android-permission` (including synthesized `android-permission-ref:<name>` nodes for permissions referenced but not locally declared), `android-resource-file`, `android-resource-definition` (covering `valueDefinitions`, `fileDefinitions`, `layouts`, and `idDefinitions`, since `R.id.*` references need `idDefinitions` as candidates too), `android-navigation-graph`, `android-navigation-destination`, `android-navigation-action`, `android-navigation-deep-link`, `android-compose-route`.

Relationship edge kinds: `module-contains-source-set` (module → source set, names unioned from `android-project.json`/`android-manifest.json`/`android-resources.json`/`android-navigation.json` evidence), `manifest-declares-component` (manifest file → component), `manifest-component-resolves-to-source` (component → symbol/file, exact fully-qualified class name, following `targetActivity` for `activity-alias`), `component-has-intent-filter` (component → intent filter), `component-uses-permission` / `manifest-uses-permission` (component or manifest → permission, literal-valued `android:permission`/`readPermission`/`writePermission`/`<uses-permission>` only — no conclusion drawn about effective enforcement), `resource-defined-in-file` (resource file → resource definition), `source-references-resource` (symbol/file → resource definition, from a bounded, comment/string-literal-stripped `R.type.name` scan of indexed Kotlin/Java source; `android.R.*` framework references are always skipped, never linked), `navigation-graph-contains-destination`, `navigation-destination-has-action`, `navigation-action-targets-destination` / `navigation-action-pop-up-to-destination` (one edge per candidate destination), `navigation-graph-includes-graph` (one edge per candidate included graph), `navigation-destination-has-deep-link`, `manifest-deep-link-matches-navigation-deep-link` (manifest component → navigation deep-link node, exact match only), `navigation-destination-resolves-to-screen` (non-`custom` destination → symbol/file, exact class name), `compose-route-resolves-to-screen` (Compose route → symbol/file, exact top-level declaration name).

Incrementally, relationships have no dedicated fingerprint field of their own: they are recomputed fresh every time the index-finishing pipeline runs, which already happens whenever any of the four upstream Android evidence fingerprints (`androidEvidenceFingerprint`, `androidGradleEvidenceFingerprint`, `androidManifestEvidenceFingerprint`, `androidResourcesEvidenceFingerprint`, `androidNavigationXmlEvidenceFingerprint`) changes, or whenever a tracked Kotlin/Java source file changes via the standard `--src` changed-file mechanism. Stale relationship nodes/edges (e.g. from a deleted navigation graph or removed manifest component) do not persist: because the finishing pipeline always rebuilds `roledCodeGraph` from scratch before Batch 5's merge step runs, a full re-finish naturally drops any node/edge whose source artifact no longer produces it — there is no separate stale-relationship-cleanup pass to reason about. `graph-diff` requires no Batch 5-specific code: it diffs `CodeGraph.nodes`/`.edges` purely by `id` equality, so an added/removed/changed Android relationship node or edge is reported the same way any other code-graph node/edge change is.

## Android retrieval and graph-view integration (v1.10.0 Batch 6)

**No new artifact, no new schema field.** Batch 6 exposes the Batch 5 `android-*` nodes/edges described above through the existing `search`, `lookup`, `source`, `slice`, `context`, and `view` commands (see `docs/COMMANDS.md` for full flag-by-flag behavior). It adds one shared, bounded resolver, `src/android/androidRetrieval.ts`, reused by every command — not a second search index, not a second graph, not a second context builder.

**Selector-to-node identity**: `search --android-route|--permission|--resource|--android-component`, `lookup --android-component`, `source --android-route|--resource`, and `slice --android-route|--android-component` all resolve their input string to one or more existing `code-graph.json` node IDs (Batch 5's `android-navigation-destination`/`android-navigation-graph`/`android-compose-route` for routes; `android-permission` for permissions; `android-resource-definition` for resources; `android-manifest-component` for components) — no new ID scheme, no ID re-minting. `slice`'s Android selectors resolve to a focus node ID and then call the unmodified `sliceGraph` engine, exactly as `--node` does.

**Compact metadata in slices/views**: a resolved Android node keeps its existing `androidArtifactId`/`androidEntityId`/`androidModuleId`/`androidSourceSetId`/`androidMetadata` fields in slice/view output — Batch 6 does not add new node fields, and never inlines a full detailed-artifact record (`android-manifest.json`/`android-resources.json`/etc.) into a slice, view, or search result. `android-compose-route`'s `androidMetadata` carries `typeRouteName` alongside `builder`/`evidenceKind`/`resolvedRoute` (v1.10.0 Batch 7 correction — `android-navigation.json` always recorded `typeRouteName` for a direct type-safe route, but this one field was missing from the compact node metadata until Batch 7's combined integration gate exercised a representative type-safe-route fixture and found the gap).

**Candidate relationship presentation**: search/lookup/source results and the three Android graph views distinguish an exact single match from an exact multi-candidate match using the same `candidate: true/false` edge metadata Batch 5 already writes (e.g. `manifest-component-resolves-to-source`, `navigation-action-targets-destination`) — Batch 6 renders these as-is; it never collapses them into one visual/JSON "resolved" edge.

**`android-module`/`android-manifest`/`android-navigation` graph views** are new `--graph` values on the existing `view` command, added to `GraphArtifactSelection` in `src/graph/adaptGraphArtifact.ts`. Each renders the same `code-graph.json` the `code` graph view renders, filtered to a relevant Batch 5 node-kind seed set and expanded exactly one hop across a fixed, named set of real relationship edge kinds (see `docs/COMMANDS.md`'s `view` section for the exact kind lists) — never a fabricated visual-only edge, never every manifest XML attribute as a node.

**Context consumption**: `search`'s underlying candidate engine (`src/search/searchIndex.ts`) now treats every `android-*` code-graph node as searchable (previously only `file`/`symbol` were), and `context`'s candidate-node ranking (`src/context/candidateRanking.ts`) now accepts these `android-*` kinds into the same generic scoring/graph-expansion/source-selection pipeline `file`/`symbol` candidates already use — not a separate Android ranking model, not a new context command or flag. `resolveFileNodeTarget` (`src/lookup/resolveSourceTarget.ts`), already used by both `source --node` and `context`'s source-slice selection, was additively extended to resolve a bounded excerpt for `android-*` node kinds that carry a `path`/`line` (manifest/intent-filter/resource/navigation/Compose-route nodes) — module/source-set/permission nodes are excluded, since they have no single retrievable declaration site.

**No-runtime-proof boundaries**: every Batch 6 selector, slice, view, and context inclusion is static structural evidence only. None of them claim a component is registered or reachable at runtime, a permission is granted or enforced, a route or deep link resolves at runtime, a resource definition is the runtime-selected value, or a navigation graph is the runtime-merged graph.

## Compose graph projection and retrieval integration (v1.11.0 Batch 4)

**No new artifact, no `android-compose-semantic.json` schema change beyond `"1.2.0"`.** Batch 4 extends the existing Batch 5 `buildAndroidArtifactRelationships.ts`/`addAndroidRelationshipsToCodeGraph.ts` pipeline (a new `androidComposeSemantic` option, optional so pre-Batch-4 callers are unaffected) to project `android-compose-semantic.json`'s composables and Batch 2/3 facts into the existing `code-graph.json`, and extends the same Batch 6 selector/resolver/source-target infrastructure (`src/android/androidRetrieval.ts`, `src/lookup/resolveSourceTarget.ts`) to expose them — not a second graph, second search index, second source runtime, or second slice engine.

**Two node kinds only, per the batch's own compactness contract**: `android-composable` (one per Batch 1 declaration, reusing its declaration ID as the node ID) and `android-compose-fact` (one per Batch 2/3 fact record, plus one per Batch 1 structural UI-region call, reusing each fact's own artifact ID). Fact category is `androidMetadata.factKind` (`state`, `effect`, `viewmodel`, `test-tag`, `visible-text`, `string-resource`, `click-handler`, `navigation-call`, or `ui-region`) — a single generic node kind, not nine top-level kinds. No node ever embeds a full callback body, complete raw expression, complete artifact array, or complete warning list; metadata is bounded scalars only (e.g. `resolvedValue`, `text`, `resourceName`, `status`, `endLine`), matching the existing `androidMetadata: Record<string, string | number | boolean | null>` type.

**Identity is always reused, never re-minted**: a composable/fact node's `id` is exactly its `android-compose-semantic.json` record ID; a `defines-composable` edge's source is the composable's own exact same-file `symbol:<path>#<name>` node when the base structural indexer captured that function symbol, or the existing `file:<path>` node otherwise (always for a `function-local` composable, which has no structural symbol) — never an invented symbol node. A `composable-references-viewmodel` edge's target is an exact simple-class-name match against indexed `class` symbols (a Compose parameter/local type is ordinarily an unqualified name resolved through an import, unlike the fully-qualified names Batch 5's manifest-component resolution already had available) — never a suffix-only ("...ViewModel") or fuzzy match, and no edge at all when the reference has no statically visible type. A `compose-navigation-targets-route`/`click-handler-contains-navigation-call`/`compose-string-references-resource` edge reuses Batch 3's own already-resolved `navigationCallFacts[].candidateIds`/`clickHandlerFacts[].navigationCallIds` or an exact `type/name` match against Batch 3's resource-definition index built earlier in the same pass — the graph builder never independently re-resolves a route or resource expression. Every one-to-many candidate is preserved as a separate edge with `candidate: true`; a candidate ID that doesn't correspond to a graph node (should not occur, since Batch 3 only records IDs it resolved from the same-run `android-navigation.json`) is skipped with a bounded warning rather than inventing a target.

**New edge kinds**: `defines-composable`, `composable-calls-composable` (reprojects Batch 1's `childCalls[]`), `composable-has-fact` (composable → every one of its facts, including UI regions), `composable-references-viewmodel`, `click-handler-contains-navigation-call`, `compose-navigation-targets-route`, `compose-string-references-resource`. New `AndroidArtifactId` value: `android-compose-semantic`.

**New selectors**, all resolved through the same `AndroidSelectorMode`/`AndroidSelectorFlags` dispatcher as the Batch 6 Android selectors (one selector active at a time, exact match only): `search`/`source`/`slice --composable <name>` (composable name or stable declaration ID), `search`/`source --test-tag <tag>` (resolved test-tag value only — a dynamic tag is never selectable), `search`/`source --android-ui <value>` (resolved visible-text literal, resource key, or qualified resource identifier). `source --composable --include-compose-tree` returns a bounded, capped, deterministically root-first multi-block bundle by walking `composable-calls-composable` edges (structurally the same bundle/cap/skipped-block contract `--include-local-component-tree` already established for React). `slice --composable --include-viewmodel`/`--include-navigation` reuse `sliceGraph`'s existing additive `includeEdgeKinds` second pass (the same mechanism `--include-prop-flow`/`--include-event-handlers` already use) to extend reachability along the ViewModel/navigation edge kinds above — direct-only, never a repository/data-flow expansion. Full syntax, JSON shapes, and validation rules are in `docs/COMMANDS.md`.

**Generic integration required no changes**: `search --query`, `context` candidate ranking, and `lookup --node` already treat every `kind.startsWith('android-')` node as eligible (Batch 6's existing generic-prefix design) — Batch 4's two new node kinds participate automatically. The one required extension was `resolveSourceTarget.ts`'s explicit `ANDROID_LINE_RETRIEVABLE_KINDS` allowlist (used by `source --node`/`context`'s source-target resolution), which now also includes `android-composable`/`android-compose-fact` and prefers each node's own recorded `androidMetadata.endLine` over the generic fixed window when present.

**No graph-diff-specific code, no code-graph schema-major change.** `graph-diff` requires no Batch 4-specific handling: it already diffs `CodeGraph.nodes`/`.edges` purely by `id` equality, so a Compose node/edge addition, removal, or metadata change is reported the same way any other code-graph change is — there is no dedicated `android-compose-semantic.json` graph-diff section in this batch.

**No-runtime-proof boundaries**: exactly as Batch 6 established for the other Android selectors — no Compose selector, slice inclusion, or context selection ever claims a composable renders, a child composable is displayed, a click occurs, navigation succeeds, a route is reachable, a ViewModel is scoped correctly, or a string resource resolves to on-screen text.

## android-test-semantic.json (v1.11.0 Batch 5)

Current schema: `"1.0.0"`; artifact kind: `my-dev-kit-v1-android-test-semantic`. It is conditionally registered as the `android-test-semantic` analyzer artifact and removed as a managed stale artifact when no supported test evidence remains. This artifact is separate from `android-compose-semantic.json`, `android-navigation.json`, resources, and the core symbol index; exact candidate IDs connect their compact projections in the one existing `code-graph.json` without merging artifact payloads.

Artifact kind: `my-dev-kit-v1-android-test-semantic`, schema `"1.0.0"`. A **separate** artifact from `android-compose-semantic.json` — that artifact remains the sole owner of production Compose declarations and facts; this one owns only Android `test`/`androidTest` source-set evidence. Written by `index` (analyzer id `android-test-semantic`) when a detected Android project has at least one qualifying `.kt`/`.java` file under a `test`/`androidTest` source-set root; absent for a non-Android project or an Android project with no such files, using the same managed-artifact registration and stale-cleanup convention every other Android analyzer already uses. Built via `src/android/buildAndroidTestSemanticProject.ts`.

**Discovery is source-set-scoped, never a repository-wide scan.** File discovery reuses `android-project.json`'s own already-detected `AndroidSourceSet.kotlinRoots`/`.javaRoots` for the `test` (→ `unit`) and `androidTest` (→ `instrumented`) source sets only — no new detection logic, no scanning outside those roots, and `build`/`generated`/`.gradle`/`node_modules`/`reports`/`test-results`/`coverage`/`tmp` directories are always excluded even if nested under a recognized root. These files are **never** added to `symbol-index.json` and never change the core `--src` boundary — every test node in `code-graph.json` is a genuinely new node, not a reused `file:`/`symbol:` node (unlike production Compose declarations, which do reuse a same-file `symbol:`/`file:` node when one exists).

**Conservative bounded scanning, same discipline as `android-compose-semantic.json`.** A top-level class is recognized only at brace-depth 0 (a nested/inner class is conservatively skipped, never guessed at). A method is recorded only when it carries at least one recognized JUnit/lifecycle annotation (`@Test`, `@Before`, `@After`, `@BeforeClass`, `@AfterClass`, `@BeforeEach`, `@AfterEach`, `@BeforeAll`, `@AfterAll`) — a method named `testFoo` with no annotation is never classified as a test, and an unannotated helper method is never recorded at all. Framework classification (`junit4`, `junit5`, `compose-ui`, `espresso`, `robolectric`, or `unknown` when none matched) is a bounded import/call-site pattern match per file, never inferred from a filename alone.

Top-level fields: `artifactKind`, `schemaVersion`, `createdAt`, `projectRoot`, `detected`, `testFiles[]`, `testClasses[]`, `testMethods[]`, `testRules[]`, `assertionFacts[]`, `routeFacts[]`, `testDoubleFacts[]`, `warnings[]` (sorted), `summary` (`{ testFileCount, unitTestFileCount, instrumentedTestFileCount, testClassCount, testMethodCount, junitAnnotationCount, composeRuleCount, composeUiTestCount, espressoTestCount, robolectricTestCount, visibleTextAssertionCount, testTagAssertionCount, routeReferenceCount, fakeCount, mockCount, unresolvedFactCount, warningCount }`). Every array is sorted by its own deterministic ID (`android-test-file:<path>`, `android-test-class:<path>#<name>`, `android-test-method:<path>#<class>.<method>`, or a fact ID derived from its owner + fact kind + source line + a stable per-owner ordinal — never a process-global counter, filesystem order, or timestamp), so repeated indexing of byte-identical input produces byte-identical output.

**Supported evidence kinds**:
- **`testRules[]`** — Compose test-rule fields: direct `createComposeRule()`/`createAndroidComposeRule<Activity>()`/`createEmptyComposeRule()` factory calls (with the generic Activity type when statically visible) and directly-typed `ComposeContentTestRule`/`AndroidComposeTestRule<...>` declarations. A rule without a directly visible `@Rule`/`@get:Rule` association nearby is still recorded, with a warning — never silently dropped, never claimed to have initialized.
- **`assertionFacts[]`** (`kind: 'visible-text' | 'test-tag'`) — a narrow allowlist only: `onNodeWithText`, `hasText`, `assertTextEquals`, `assertTextContains`, Espresso `withText` (visible-text); `onNodeWithTag`, `hasTestTag` (test-tag). Only a direct string-literal argument resolves; anything else is recorded `status: 'unresolved'` with the bounded raw expression preserved, never guessed.
- **`routeFacts[]`** — direct `navigate(...)`/`assertCurrentRouteEquals(...)`/`setCurrentDestination(...)` call sites, reusing `buildComposeNavigationRoutes.ts`'s own exported `extractRouteArgument`/`parseStringLiteral`/`collectStringConstants` helpers (the same functions Batch 3's `navigate(...)` production-call resolution already reuses) — never a second, independently-drifting route resolver. `routeType` reuses the exact same `ComposeRouteEvidenceKind` vocabulary as `android-navigation.json` and `android-compose-semantic.json`.
- **`testDoubleFacts[]`** (`kind: 'fake' | 'mock' | 'stub' | 'spy' | 'unknown'`) — `mockk<T>()`, `Mockito.mock(T::class.java)`, Mockito-Kotlin-style `mock<T>()`, and `Fake.../Mock.../Stub...` constructor-name declarations, at both class-field and method-local scope.

**Exact static cross-references only, ambiguity always preserved.** A test-tag/visible-text assertion's `candidateProductionFactIds`/`candidateComposableIds` come from an exact-value match against `android-compose-semantic.json`'s already-resolved `testTagFacts[].resolvedValue`/`visibleTextFacts[].text` — zero matches leaves both arrays empty, more than one preserves every match. A route fact's `candidateNavigationIds` come from an exact match against `android-navigation.json`'s `composeRoutes`/`destinations` (same index shape Batch 3 already builds for production `navigate(...)` calls); its `candidateComposableIds` come from production `navigationCallFacts[]` sharing the same resolved route. A mocked/faked dependency's `candidateSymbolIds` come from an exact simple-class-name match against indexed `class` symbols (the same conservative pattern `composable-references-viewmodel` already uses) — never a suffix-only or fuzzy match. A resource-identity-based assertion match (matching a test assertion's `R.string.<name>` reference against `android-resources.json` without resolving the localized value) is not implemented in this batch — a documented, conservative scope reduction, not a silent gap: such an assertion is still recorded as an `unresolved` visible-text/test-tag fact rather than fabricating a match.

**Code-graph projection** (`src/android/buildAndroidArtifactRelationships.ts`, extended with an optional `androidTestSemantic` parameter): four compact node kinds — `android-test-file`, `android-test-class`, `android-test-method`, and a single generic `android-test-fact` covering every rule/assertion/route/test-double record (distinguished by `androidMetadata.factKind`, mirroring Batch 4's `android-compose-fact` compactness convention) — and eight edge kinds: `defines-test-class` (file → class), `test-class-defines-method` (class → method), `test-class-uses-rule` (class → rule fact), `test-method-has-fact` (method → assertion/route fact), `android-test-uses-double` (class or method → double fact), `android-test-references-composable` (assertion/route fact → `android-composable`, exact match only), `android-test-references-route` (route fact → `android-navigation-destination`/`android-compose-route`), `android-test-references-viewmodel` (double fact → `symbol:...`, exact simple-class-name match). Every node/edge ID is reused directly from the artifact record; no candidate ID that fails to resolve to an existing graph node is ever turned into a fabricated edge.

**Generic retrieval required almost no new code.** `search --query`, `context` candidate ranking, and `lookup --node` already treat every `kind.startsWith('android-')` node as eligible (Batch 6's generic-prefix design), so the four new test node kinds participate automatically. The one required extension was adding `android-test-file`/`android-test-class`/`android-test-method`/`android-test-fact` to `resolveSourceTarget.ts`'s `ANDROID_LINE_RETRIEVABLE_KINDS` allowlist, so `source --node`/`context` source-selection can resolve a bounded excerpt for them (preferring each node's own recorded `androidMetadata.endLine`, same as Batch 4's Compose nodes). No new `search`/`lookup`/`source`/`slice` flag, no `--include-tests`, and no top-level test command were added — all retrieval goes through the existing generic paths.

**`--incremental` correctness**: since `test`/`androidTest` files live outside the core `--src` boundary, an edit inside them would not otherwise be noticed by the standard changed-file mechanism. A new early `androidTestEvidenceFingerprint` (every discovered test file's path + content, hashed) was added to `computeConfigFingerprint`'s existing early-fingerprint list (alongside `androidNavigationXmlEvidenceFingerprint` and the other three Android fingerprints) so any test-file add/edit/delete correctly forces a full pipeline re-finish rather than silently reusing a stale `android-test-semantic.json`/stale projected graph facts.

**No graph-diff-specific code, no dedicated `android-test-semantic.json` graph-diff section.** Exactly like Batch 4's Compose projection: `graph-diff` already diffs `CodeGraph.nodes`/`.edges` purely by `id` equality, so an added/removed/changed test node or edge is reported the same way any other code-graph change is.

**No-runtime-proof boundaries**: indexing a test file never executes it. No fact or edge in this artifact claims a test ran, a Compose rule initialized, an Activity launched, a click occurred, navigation succeeded, a UI element was visible, an assertion passed, or a mock/fake was actually injected at runtime — every fact is static source evidence only.

## Compose and Android-test graph views (v1.11.0 Batch 6)

**No new artifact, no new node/edge kind, no source or semantic-artifact reparsing at view time.** Batch 6 adds three `--graph` values to the existing `view` command — `compose-ui`, `compose-navigation`, `android-test` — that filter the already-projected `code-graph.json` exactly the way `android-module`/`android-manifest`/`android-navigation` already do (v1.10.0 Batch 6): a bounded seed-plus-one-hop-expansion selection over nodes/edges that already exist, rendered through the same unmodified `buildRenderableDotGraph`/Graphviz pipeline every other graph choice uses. `code-graph.json` is the sole source of truth at view time; `android-compose-semantic.json`, `android-test-semantic.json`, and `android-navigation.json` are never re-read.

- **`compose-ui`** (`src/graph/adaptComposeUiGraph`): seeds every `android-composable`/`android-compose-fact` node, then expands one hop across `defines-composable`/`composable-calls-composable`/`composable-has-fact`/`composable-references-viewmodel`/`compose-string-references-resource` edges to pull in the composable's defining `file:`/`symbol:` node and any exact ViewModel-symbol/resource-definition node an existing edge already connects. Uses the same generic `filterByRelationship` bounded-expansion helper the three Batch 5 Android views already use — no new traversal engine.
- **`compose-navigation`** (`adaptComposeNavigationGraph`): seeds `android-composable` nodes, existing `android-compose-route`/`android-navigation-destination`/`android-navigation-graph` nodes, and — critically — only the `android-compose-fact` nodes whose `androidMetadata.factKind` is `click-handler` or `navigation-call` (never the state/effect/test-tag/visible-text/string-resource facts on the same composable). This requires a **two-phase selection** distinct from the shared `filterByRelationship` helper: `composable-has-fact` must remain a *displayable* edge kind (so the composable-to-click-handler-fact edge renders) without being an *expansion-eligible* kind (so it can never pull in an unrelated fact as a new seed) — only `defines-composable`/`navigation-destination-resolves-to-screen`/`compose-route-resolves-to-screen` are allowed to introduce a genuinely new node (the defining source, or an exact screen-symbol target). This distinction was found and fixed during this batch's own CLI smoke test, which initially showed every Compose fact leaking into the navigation view before the fix.
- **`android-test`** (`adaptAndroidTestGraph`): seeds all four `android-test-file`/`android-test-class`/`android-test-method`/`android-test-fact` node kinds (every containment edge between them therefore needs no expansion at all - both endpoints are already seeded), then expands across `android-test-uses-double`/`android-test-references-composable`/`android-test-references-route`/`android-test-references-viewmodel` to pull in the exact production nodes a test fact statically references. Reuses `filterByRelationship` directly, like the Batch 5 Android views.

**Node styling** (`codeNodeLabel`/`codeNodeShape` in `adaptGraphArtifact.ts`, extended additively): `android-composable` renders as `shape=component`; `android-compose-fact`/`android-test-fact` render as `shape=note` with a `\n[factKind]` label suffix (e.g. `Welcome back\n[visible-text]`); `android-test-file` renders as `shape=folder` with a `\n[unit|instrumented]` suffix; `android-test-class`/`android-test-method` render as `shape=box3d`/`shape=cds` respectively. Every other existing node kind (`file`, `symbol`, and every pre-Batch-6 `android-*` kind) is completely unaffected — the new branches were added strictly before the existing catch-all, and no existing kind's shape or label changed.

**No legend for the three new views**, matching the exact existing precedent the three Batch 5 Android views already established: `buildRenderableDotGraph` only appends the edge-kind legend when `graph.id === 'code'`, and this batch does not change that condition for any Android/Compose/test graph. `--edge-style semantic`/`labeled`/`minimal` all work unchanged, since edge rendering is entirely driven by `RenderableGraphEdge.kind`/`.label`, not by which specialized view produced the edge list.

**Determinism, empty-view, and Graphviz behavior are entirely inherited, unmodified.** Node/edge sorting (`localeCompare` on `id`), the DOT serializer, SVG/PNG rendering via Graphviz, `--allow-dot-fallback`, and the JSON `GraphViewResult` shape (`nodeCount`/`edgeCount`/`graphvizUsed`/`dotFallbackUsed`/`fallbackStatus`/`warnings`) are the same code path every other `--graph` value already uses — Batch 6 adds no new summary field, and a non-Android/Compose/test-evidence-free index simply produces zero selected nodes and zero edges at exit 0, never an error and never an invented placeholder node.

## Schema limitations

- Symbol end lines are not recorded in `symbol-index.json`.
- `code-graph.json` remains the single structural/relationship graph: core file/symbol structure plus compact frontend/Android/Compose/test projections. Data-model and lineage edges are not added to it.
- `data-model.json` and `data-model-graph.json` are separate downstream artifacts with their own ID space.
- `model-view-lineage.json` is a static evidence artifact, not a runtime UI execution trace.
- Data-model extraction is conservative and currently focused on supported TypeScript patterns.
- Unsupported or ambiguous data-model and lineage patterns produce warnings or are omitted conservatively.
- Search remains keyword-based. No fuzzy or embedding-based search is available.
- `view --graph data-model` renders `data-model-graph.json` when it is referenced by `manifest.json`.
- `view --graph model-view-lineage` renders `model-view-lineage.json` when trace-view has produced and registered it in `manifest.json`.
- `android-project.json` (v1.9.0 Batch 1) is detection-only: no Android component-role classification, no detailed `AndroidManifest.xml` parsing beyond a path-existence check, no Gradle version-catalog plugin-alias resolution, and no custom Gradle `projectDir` remap support.
- Kotlin structural indexing (v1.9.0 Batch 2) extracts top-level declarations only (no class-member functions/properties, matching the existing TypeScript/Python top-level-only extraction), has no call-graph support, and resolves imports to a local file only via the common single-declaration-per-file naming convention.
- Java structural indexing (v1.9.0 Batch 3) has the same shape of limitations as Kotlin: top-level declarations only, no call-graph support, no semantic type resolution or cross-file `extends`/`implements` resolution, and import resolution is a best-effort file-name-matches-type-name heuristic, not a guarantee.
- Android component-role detection (v1.9.0 Batch 4) only evaluates top-level Kotlin/Java symbols (no method/field/constructor-level evidence); `repository`/`use-case` never exceed `medium` confidence (no annotation/superclass evidence tier exists for them); name-suffix-only matches never exceed `low` confidence; it does not parse `AndroidManifest.xml` contents, resolve Gradle version-catalog aliases, or verify that dependency injection/navigation actually works at runtime.
- v1.9.0 Batch 5 added no new artifact, schema field, command, or flag — it only added integration tests and a mixed Kotlin/Java Android fixture proving the schemas above (`android-project.json`, `android-components.json`, `androidComponentRoles`/`androidComponentRefs`) remain correct when read together through `search`/`lookup`/`source`/`slice`/`context`/`graph-diff`.
- `android-manifest.json` (v1.10.0 Batch 2) never simulates Android's manifest-merging algorithm (each source-set manifest is an independent record), never resolves `@type/name`/`?attr/name` resource references to an actual value or links them to `android-resources.json` (that cross-artifact relationship is Batch 5's), never computes an effective `exported` value from Android-version/manifest-merging rules, never proves a deep link is reachable or that domain verification succeeds, and does not implement `android-navigation.json` or any declaration-to-source relationship graph beyond the module/source-set linkage already described above.
- `android-resources.json` (v1.10.0 Batch 3) never simulates resource merging, overlay precedence, or device-configuration matching (every qualified/source-set definition is an independent record); never resolves style/theme inheritance; never decodes binary resource bytes (bitmaps/fonts are indexed by path/qualifier/extension only); never validates FileProvider paths or network-security certificates/pins; and records `res/navigation/*.xml` only as a generic file resource with no destination/action/argument/deep-link navigation semantics (`android-navigation.json`, Batch 4, owns that).
- `android-navigation.json` (v1.10.0 Batch 4) never selects a runtime winner among candidate start-destinations/action-targets/popUpTo-targets/include-targets (every static match is enumerated); never merges an included graph into its parent; never proves runtime navigation reachability or deep-link behavior; is not a Compose semantic analyzer (only `composable`/`navigation`/`dialog`/`activity`/`NavHost` calls with a direct string literal, same-file `const val`, or generic type-route argument are resolved — everything else is left `unresolved-recognized-call`, never invented); records a direct screen candidate only for an unambiguous single top-level call; and does not link XML destinations to Compose routes, or this artifact to `android-manifest.json`'s deep-link evidence — those cross-artifact relationships are Batch 5's.
- Android artifact relationships in `code-graph.json` (v1.10.0 Batch 5) never select a single runtime winner for any one-to-many static match (manifest component → class, resource reference → definition, navigation action/`popUpTo`/include target, Compose route → screen) — every candidate is enumerated as its own edge; matching is always exact (fully-qualified class/route names, exact deep-link scheme/host/port/path) and never fuzzy or simple-name-based; no security verdict is derived from permission or exported-component relationships.
- Android retrieval/graph-view integration (v1.10.0 Batch 6) never introduces fuzzy or case-insensitive matching for routes/permissions/resources/components (an exact-match miss is a miss, not a fallback); never resolves resource overlay/qualifier/source-set precedence (`source --resource`/`search --resource` always preserve every qualified duplicate as a separate candidate); never selects one candidate for an ambiguous `lookup`/`source`/`slice` root (an ambiguous selector returns every candidate ID, never a chosen node); `android-module`/`android-manifest`/`android-navigation` graph views never render a manifest-merge or navigation-graph-merge simulation; and no new top-level Android command, retrieval runtime, or artifact was added — every selector reads the existing `code-graph.json` through the shared `src/android/androidRetrieval.ts` resolver.
