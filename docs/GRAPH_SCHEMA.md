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

Core index artifacts:

- `manifest.json`
- `symbol-index.json`
- `code-graph.json`

Optional index artifact:

- `call-graph.json`

Downstream v1.1.0 artifacts:

- `data-model.json`
- `data-model-graph.json`
- `model-view-lineage.json`

Artifact flow:

```text
index
  -> manifest.json
  -> symbol-index.json
  -> code-graph.json
  -> call-graph.json (optional)

data-model
  -> data-model.json
  -> data-model-graph.json
  -> model-view-lineage.json (trace-view mode)
```

The index artifacts remain the base source-structure layer. The data-model and lineage artifacts are separate downstream layers. They do not replace `code-graph.json`.

## Versioned artifact kinds

Current versioned artifact kinds include:

- `my-dev-kit-v1-manifest`
- `my-dev-kit-v1-graph-slice`
- `my-dev-kit-v1-search-result`
- `my-dev-kit-v1-data-model`
- `my-dev-kit-v1-data-model-graph`
- `my-dev-kit-v1-model-view-lineage`

`code-graph.json` remains identified by:

- `code-graph`

## manifest.json

Artifact kind:

- `my-dev-kit-v1-manifest`

Main fields:

- `artifactKind`
- `version`
- `createdAt`
- `projectRoot`
- `sourceRoots`
- `languages`
- `callGraphEnabled`
- `artifacts`
- `summary`
- `warnings`
- `errors`

The `artifacts` object may include:

- `symbolIndex`
- `codeGraph`
- `callGraph`

`manifest.json` is the root metadata artifact for index consumers.

## symbol-index.json

`symbol-index.json` records per-file symbol information extracted during indexing.

Top-level fields include:

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

Current limitation:

- Symbol start lines are recorded.
- Complete symbol end-line bounds are not recorded.

## code-graph.json

Artifact kind:

- `code-graph`

Schema version:

- `1.0.0`

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

It is not a runtime execution graph, and it is not extended with data-model or lineage edges.

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

Artifact kind:

- `my-dev-kit-v1-data-model`

Schema version:

- `1.1.0`

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

### v1.1.0 limitations

- Extraction is currently conservative and TypeScript-focused.
- Prisma, SQL, Django, SQLAlchemy, TypeORM, and Sequelize are not supported.
- Unsupported or ambiguous patterns are reported as warnings or omitted conservatively.

## data-model-graph.json

Artifact kind:

- `my-dev-kit-v1-data-model-graph`

Schema version:

- `1.1.0`

Purpose:

- graph form of the data-model artifact
- separate from `code-graph.json`
- separate node and edge ID space

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

Artifact kind:

- `my-dev-kit-v1-model-view-lineage`

Schema version:

- `1.1.0`

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

### Supported v1.1.0 lineage scope

The current lineage builder supports narrow static cases such as:

- direct transformation functions that return object literals from model field reads
- direct view-model object properties assigned from known model fields
- direct component prop assignments when field identity remains statically obvious
- direct JSX rendering when field identity remains statically obvious in supported local evidence

Unsupported dynamic or ambiguous cases are reported as warnings or omitted conservatively.

## Graph slice artifact

Artifact kind:

- `my-dev-kit-v1-graph-slice`

Main fields:

- `artifactKind`
- `focusNodeId`
- `depth`
- `direction`
- `nodes`
- `edges`
- `summary`
- `artifactPaths`

## Search result artifact

Artifact kind:

- `my-dev-kit-v1-search-result`

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

## Schema limitations

Version 1.1.0 has the following artifact boundaries and limitations:

- Symbol end lines are not recorded in `symbol-index.json`.
- `code-graph.json` remains focused on file and symbol structure only.
- `data-model.json` and `data-model-graph.json` are separate downstream artifacts.
- `model-view-lineage.json` is a static evidence artifact, not a runtime UI execution trace.
- Data-model extraction is conservative and currently focused on supported TypeScript patterns.
- Unsupported or ambiguous data-model and lineage patterns produce warnings or are omitted conservatively.
- Search and lookup remain exact or keyword-based; no fuzzy or semantic search is added in v1.1.0.
