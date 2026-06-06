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

Lineage artifact (written in `data-model --trace-view` mode):

- `model-view-lineage.json`

Artifact flow:

```text
index
  -> manifest.json           (artifact registry, analyzer registry)
  -> symbol-index.json       (symbols with compact semanticRoles, artifactRefs)
  -> code-graph.json         (nodes with compact semanticRoles, artifactRefs)
  -> call-graph.json         (optional)
  -> data-model.json         (when TypeScript model analyzer runs)
  -> data-model-graph.json   (when TypeScript model analyzer runs)

data-model --trace-view
  -> model-view-lineage.json
```

`manifest.json` is the authoritative registry for the current artifact set. Artifacts from previous runs that are no longer produced are removed when `index` refreshes the directory.

## Artifact relationships

There are three artifact layers:

The structural layer (`symbol-index.json`, `code-graph.json`) describes file and symbol structure. These artifacts carry compact semantic role summaries on symbols and nodes when semantic analyzers produce them.

The semantic layer (`data-model.json`, `data-model-graph.json`) carries detailed entity, field, relationship, and source evidence. This is a derived layer separate from the structural layer.

The lineage layer (`model-view-lineage.json`) carries conservative static relationships between data-model fields, transformations, view-model fields, component props, and rendered fields.

The bridge between layers is artifact references (`artifactRefs`) and evidence references (`evidenceRefs`). Compact metadata on structural artifacts links to detailed records in semantic artifacts.

`data-model-graph.json` is a derived semantic graph, not a slice of `code-graph.json`. The code graph describes static source structure. The data-model graph describes data entities and fields. The model-view-lineage artifact describes static usage and flow paths.

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

A null value means the artifact was not produced in the most recent run. A non-null value is a path relative to the artifact directory.

### analyzers

The `analyzers` array records the status of each analyzer that was invoked.

Each entry includes:

- `id`: analyzer identifier (e.g. `syntax`, `call-graph`, `data-model`, `model-view-lineage`)
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

## symbol-index.json

`symbol-index.json` records per-file symbol information extracted during indexing.

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
- `kind`
- `line`
- `exported`
- `signature`
- `semanticRoles`
- `artifactRefs`

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

### semanticRoles and artifactRefs on symbol nodes

Symbol nodes carry compact `semanticRoles` and `artifactRefs` arrays when the TypeScript model analyzer has classified the corresponding symbol. These are the same compact records as on `symbol-index.json` symbols.

File nodes do not carry semantic role metadata.

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

## Stable node IDs and compatibility

Node IDs are deterministic and stable across index runs for the same source root configuration. File node IDs use the `file:<relative-path>` form. Symbol node IDs use the `symbol:<relative-path>#<symbol-name>` form.

ID stability depends on path and symbol name stability. Renaming a file or symbol changes its ID.

## Schema limitations

- Symbol end lines are not recorded in `symbol-index.json`.
- `code-graph.json` remains focused on file and symbol structure only. Data-model and lineage edges are not added to it.
- `data-model.json` and `data-model-graph.json` are separate downstream artifacts with their own ID space.
- `model-view-lineage.json` is a static evidence artifact, not a runtime UI execution trace.
- Data-model extraction is conservative and currently focused on supported TypeScript patterns.
- Unsupported or ambiguous data-model and lineage patterns produce warnings or are omitted conservatively.
- Search remains keyword-based. No fuzzy or embedding-based search is available.
- Graph visualization for `data-model-graph.json` and `model-view-lineage.json` is not yet available in the `view` command.
