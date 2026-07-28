# basic-ts

Small TypeScript project for learning and smoke testing my-dev-kit.

From the repository root:

```sh
npx @dailephd/my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --call-graph --json
npx @dailephd/my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "user" --limit 5 --json
npx @dailephd/my-dev-kit lookup --index examples/basic-ts/.my-dev-kit --node symbol:src/index.ts#describeUser --depth 1 --json
npx @dailephd/my-dev-kit source --index examples/basic-ts/.my-dev-kit --file src/index.ts --symbol describeUser --format numbered
```

This example is secondary documentation for cloned repositories and package smoke tests. Normal users should run `npx @dailephd/my-dev-kit` inside their own project.

Clean up the generated index:

```sh
node -e "require('fs').rmSync('examples/basic-ts/.my-dev-kit',{recursive:true,force:true})"
```
