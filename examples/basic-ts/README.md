# basic-ts

Small TypeScript project for learning and smoke testing my-dev-kit.

From the repository root:

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --call-graph --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "user" --limit 5 --json
my-dev-kit lookup --index examples/basic-ts/.my-dev-kit --node symbol:src/index.ts#describeUser --depth 1 --json
my-dev-kit source --index examples/basic-ts/.my-dev-kit --file src/index.ts --symbol describeUser --format numbered
```

This example is secondary documentation for cloned repositories and package smoke tests. Normal npm users should run `my-dev-kit` inside their own project.
