# Examples

These folders are small projects for learning and smoke testing my-dev-kit from a cloned repository or inspected package contents.

Run the commands from the repository root with Node.js and npm available. Python 3.8 or later is required only for `basic-python`; Graphviz is optional because the examples render DOT directly. See the [command reference](../docs/COMMANDS.md) for complete flag details.

- `basic-ts` — a small TypeScript project for code-graph indexing, search, lookup, and source retrieval.
- `basic-python` — a small Python project for code-graph indexing and search behavior.
- `basic-data-model-ts` — a small TypeScript and TSX project for data-model extraction, exact entity and field inspection, conservative static `trace-view` behavior, and (v1.5.0) conservative static classification of its `User` interface.
- `basic-react-tsx` — a small React/TSX project for frontend semantic indexing, exact string retrieval, React region retrieval, local component-tree retrieval, frontend graph views, and v1.3.0 frontend-reachability retrieval (route, browser-storage, UI markers).

Normal users should run `npx @dailephd/my-dev-kit` inside their own project:

```sh
cd <your-project>
npx @dailephd/my-dev-kit index --root . --src src --out .my-dev-kit --json
```

Use these examples when you want a tiny known project:

```sh
# TypeScript graph example
npx @dailephd/my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

# Python graph example
npx @dailephd/my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index examples/basic-python/.my-dev-kit --query "greet" --limit 5 --json

# Data-model example
npx @dailephd/my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --entity User --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --trace-view User --json
npx @dailephd/my-dev-kit context --index examples/basic-data-model-ts/.my-dev-kit --query "add a sibling data model field to User" --out examples/basic-data-model-ts/.my-dev-kit/context-capsule.json --audit-out examples/basic-data-model-ts/.my-dev-kit/retrieval-audit-record.json --mode feature-add --json

# React/TSX example
npx @dailephd/my-dev-kit index --root examples/basic-react-tsx --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --contains "workspace-editor-empty-state" --context 5 --format numbered
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --react-region WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --format numbered
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit --graph react-component --format dot --out examples/basic-react-tsx/.my-dev-kit/react-component.dot

# React/TSX frontend reachability (v1.3.0)
npx @dailephd/my-dev-kit search --index examples/basic-react-tsx/.my-dev-kit --route "/workspaces/new" --json
npx @dailephd/my-dev-kit search --index examples/basic-react-tsx/.my-dev-kit --storage-key "workspace-editor-draft.v1" --json
npx @dailephd/my-dev-kit search --index examples/basic-react-tsx/.my-dev-kit --ui "workspace-editor-empty-state" --json
npx @dailephd/my-dev-kit slice --index examples/basic-react-tsx/.my-dev-kit --route "/workspaces/new" --include-storage --include-ui --include-tests --json
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit --graph ui-reachability --format dot --out examples/basic-react-tsx/.my-dev-kit/ui-reachability.dot

# Source continuation and local dependency expansion (v1.4.0)
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --file "src/WorkspaceEditorShell.tsx" --continue-from 1 --format numbered
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --file "src/WorkspaceEditorShell.tsx" --symbol WorkspaceEditorShell --continue --format json
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --file "src/WorkspaceEditorShell.tsx" --symbol WorkspaceEditorShell --include-local-types --format numbered
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --file "src/WorkspaceEditorShell.tsx" --symbol WorkspaceEditorShell --include-local-deps --max-bundle-lines 200 --format json

# Classification (v1.5.0) - every `index` run produces classification.json; the
# examples below just show it surfaced through existing commands.
npx @dailephd/my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index examples/basic-data-model-ts/.my-dev-kit --query "canonical-type" --limit 5 --json
npx @dailephd/my-dev-kit lookup --index examples/basic-data-model-ts/.my-dev-kit --node "symbol:src/models.ts#User" --depth 1 --resolve-classification --json
npx @dailephd/my-dev-kit source --index examples/basic-data-model-ts/.my-dev-kit --node "symbol:src/models.ts#User" --max-lines 80 --format json
```

Classification is conservative and static: categories, edit guidance, readiness, and risk labels are derived only from file paths, naming conventions, and existing index/semantic evidence, never from runtime or browser behavior. An index built without the classification analyzer (or an older index) is still fully usable — `search`/`lookup`/`slice`/`source` simply omit the classification fields.

See each example's `README.md` for its focused workflow.

Generated `.my-dev-kit` directories are local output only and are not tracked in the repository.

## Clean up

Remove all generated example indexes with this shell-neutral Node.js command:

```sh
node -e "for (const path of ['examples/basic-ts/.my-dev-kit','examples/basic-python/.my-dev-kit','examples/basic-data-model-ts/.my-dev-kit','examples/basic-react-tsx/.my-dev-kit']) require('fs').rmSync(path,{recursive:true,force:true})"
```
