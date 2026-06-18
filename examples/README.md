# Examples

These folders are small projects for learning and smoke testing my-dev-kit from a cloned repository or inspected package contents.

- `basic-ts` — a small TypeScript project for code-graph indexing, search, lookup, and source retrieval.
- `basic-python` — a small Python project for code-graph indexing and search behavior.
- `basic-data-model-ts` — a small TypeScript and TSX project for data-model extraction, exact entity and field inspection, and conservative static `trace-view` behavior.
- `basic-react-tsx` — a small React/TSX project for frontend semantic indexing, exact string retrieval, React region retrieval, local component-tree retrieval, and frontend graph views.

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

# React/TSX example
npx @dailephd/my-dev-kit index --root examples/basic-react-tsx --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --contains "workspace-editor-empty-state" --context 5 --format numbered
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit --react-region WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --format numbered
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit --graph react-component --format dot --out examples/basic-react-tsx/.my-dev-kit/react-component.dot
```

See each example's `README.md` for the full workflow.

Generated `.my-dev-kit` directories are local output only and are not tracked in the repository.
