# basic-react-tsx

Small React/TSX project for learning and smoke testing the v1.2 frontend retrieval workflows.

This example uses a realistic but small TSX component (`WorkspaceEditorShell`) that includes:

- An exported component with `useState` and `useEffect` hooks
- Two local child components (`Toolbar`, `EmptyState`) with typed props
- Named event handlers and inline event handlers
- A JSX conditional branch controlled by state
- `data-testid` and `aria-label` attributes
- Repeated string literals (`"structured-content"`, `"workspace-editor-empty-state"`)
- Callback props passed to local child components

## Index the example

From the repository root:

```sh
npx @dailephd/my-dev-kit index --root examples/basic-react-tsx --src src --out .my-dev-kit-index --json
```

## Search for UI facts

```sh
npx @dailephd/my-dev-kit search --index examples/basic-react-tsx/.my-dev-kit-index --query "workspace editor toolbar" --limit 10 --json
```

## Exact string retrieval

Find all occurrences of a literal string across all indexed files:

```sh
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit-index --contains "workspace-editor-empty-state" --context 5 --format numbered
```

Find repeated occurrences of a string:

```sh
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit-index --contains "structured-content" --context 3 --format json
```

## React region retrieval

Retrieve the exported component by name:

```sh
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit-index --react-region WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --format numbered
```

Retrieve a local component by name:

```sh
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit-index --react-region EmptyState --file "src/WorkspaceEditorShell.tsx" --format numbered
```

## Local component-tree retrieval

Retrieve the component and its local children as connected source blocks:

```sh
npx @dailephd/my-dev-kit source --index examples/basic-react-tsx/.my-dev-kit-index --symbol WorkspaceEditorShell --file "src/WorkspaceEditorShell.tsx" --include-local-component-tree --format numbered
```

## Frontend graph views

Render the React component structure graph (components, local components, prop types):

```sh
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit-index --graph react-component --format dot --out examples/basic-react-tsx/.my-dev-kit-index/react-component.dot
```

Render all flow facts (hooks, handlers, JSX regions, relationships):

```sh
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit-index --graph react-flow --format dot --out examples/basic-react-tsx/.my-dev-kit-index/react-flow.dot
```

Render only prop and event flow relationships:

```sh
npx @dailephd/my-dev-kit view --index examples/basic-react-tsx/.my-dev-kit-index --graph react-prop-event-flow --format dot --out examples/basic-react-tsx/.my-dev-kit-index/react-prop-event-flow.dot
```

DOT output does not require Graphviz. All graph views are backed by the `frontend-semantic.json` artifact and render static facts extracted from the source. They do not claim runtime React behavior.

## Notes

- Generated `.my-dev-kit-index` output is local only and is not tracked.
- This example does not require a database, network access, or Graphviz.
- The `view --graph frontend-test` view will produce an empty graph for this example because the base indexer excludes `.test.` files from default discovery.

Clean up after the workflow:

```sh
node -e "require('fs').rmSync('examples/basic-react-tsx/.my-dev-kit-index',{recursive:true,force:true})"
```

See the [full command reference](../../docs/COMMANDS.md) for flag details.
