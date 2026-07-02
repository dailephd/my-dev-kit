# basic-data-model-ts

Small TypeScript and TSX project for learning and smoke testing the v1.1.0 data-model workflow.

This example uses only supported static patterns:

- exported interface declarations
- exported object-literal type aliases
- exported classes with property declarations
- direct transformation and JSX usage that can be traced conservatively

From the repository root:

```sh
npx @dailephd/my-dev-kit index --root examples/basic-data-model-ts --src src --out .my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --out examples/basic-data-model-ts/.my-dev-kit --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --entity User --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --trace-view User --json
npx @dailephd/my-dev-kit data-model --index examples/basic-data-model-ts/.my-dev-kit --field User.email --trace-view --json

# v1.5.0 - classification.json is written by every index run; classification
# metadata is surfaced through search/lookup/slice/source, not through data-model.
npx @dailephd/my-dev-kit search --index examples/basic-data-model-ts/.my-dev-kit --query "canonical-type" --limit 5 --json
npx @dailephd/my-dev-kit lookup --index examples/basic-data-model-ts/.my-dev-kit --node "symbol:src/models.ts#User" --depth 1 --resolve-classification --json
```

Generated `.my-dev-kit` directories are local output only and are not meant to be committed.

This example does not require a database, network access, or Graphviz.
