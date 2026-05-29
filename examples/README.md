# Examples

These folders are small projects for learning and smoke testing my-dev-kit from a cloned repository or inspected package contents.

- `basic-ts` is a small TypeScript project for learning command behavior and running smoke checks.
- `basic-python` is a small Python project for learning command behavior and running smoke checks.

Normal npm users should run `my-dev-kit` inside their own project:

```sh
cd <your-project>
my-dev-kit index --root . --src src --out .my-dev-kit --json
```

Use these examples when you want a tiny known project:

```sh
my-dev-kit index --root examples/basic-ts --src src --out .my-dev-kit --json
my-dev-kit search --index examples/basic-ts/.my-dev-kit --query "service" --limit 5 --json

my-dev-kit index --root examples/basic-python --src src --language python --out .my-dev-kit --json
my-dev-kit search --index examples/basic-python/.my-dev-kit --query "greet" --limit 5 --json
```
