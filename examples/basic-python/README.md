# basic-python

Small Python project for learning and smoke testing my-dev-kit. Python indexing requires `python` or `python3` on `PATH` with Python 3.8 or later.

From the repository root:

```sh
npx @dailephd/my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --call-graph --json
npx @dailephd/my-dev-kit search --index examples/basic-python/.my-dev-kit --query "greet" --limit 5 --json
npx @dailephd/my-dev-kit lookup --index examples/basic-python/.my-dev-kit --node file:src/main.py --depth 1 --json
npx @dailephd/my-dev-kit source --index examples/basic-python/.my-dev-kit --file src/main.py --symbol greet --format numbered
```

This example is secondary documentation for cloned repositories and package smoke tests. Normal npm users should run `npx @dailephd/my-dev-kit` inside their own project.

Clean up the generated index:

```sh
node -e "require('fs').rmSync('examples/basic-python/.my-dev-kit',{recursive:true,force:true})"
```
