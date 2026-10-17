# Examples

These folders are small projects for learning and smoke testing my-dev-kit from a cloned repository or inspected package contents.

Run the commands from the repository root with Node.js and npm available. Python 3.8 or later is required only for `basic-python`; Graphviz is optional because the examples render DOT directly. See the [command reference](../docs/COMMANDS.md) for complete flag details.

- `basic-ts` — a small TypeScript project for code-graph indexing, search, lookup, and source retrieval.
- `basic-python` — a small Python project for code-graph indexing and search behavior.
- `basic-data-model-ts` — a small TypeScript and TSX project for data-model extraction, exact entity and field inspection, conservative static `trace-view` behavior, and (v1.5.0) conservative static classification of its `User` interface.
- `basic-react-tsx` — a small React/TSX project for frontend semantic indexing, exact string retrieval, React region retrieval, local component-tree retrieval, frontend graph views, and v1.3.0 frontend-reachability retrieval (route, browser-storage, UI markers).
- `basic-android-kotlin` — a small Kotlin, Compose, Room, and Retrofit Android project for static Android retrieval (Compose screens, ViewModel, repository, manifest, navigation, resources, unit and instrumented tests). It is a static retrieval sample; Gradle, the Android SDK, and an emulator are not required and it has not been compiled or run.

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

# Android Kotlin/Compose example (static retrieval sample; see its README)
npx @dailephd/my-dev-kit index --root examples/basic-android-kotlin --src app/src/main --src app/src/test --src app/src/androidTest --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index examples/basic-android-kotlin/.my-dev-kit --composable UserHomeScreen --json

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

### Android example categories

[`basic-android-kotlin`](basic-android-kotlin/README.md) covers seven categories of Android evidence, all retrieved statically from source:

- A minimal Kotlin Android app (`MainActivity`, manifest entry).
- A minimal Compose screen (`UserHomeScreen`, `UserSettingsScreen`).
- Compose + ViewModel + Repository (`UserViewModel`, `UserRepository`).
- A Room entity and DAO (`UserEntity`, `UserDao`, `AppDatabase`).
- A Retrofit service (`UserApiService`).
- Manifest and deep-link evidence (`AndroidManifest.xml`, routes, `strings.xml`).
- Compose UI test and unit test source (`app/src/androidTest`, `app/src/test`).

Index it with all three source roots (`app/src/main`, `app/src/test`, `app/src/androidTest`) as shown above; `--out .my-dev-kit` is relative to `--root`, so the index is `examples/basic-android-kotlin/.my-dev-kit`. It is a public example, not one of the internal Android fixtures under `tests/fixtures/` that the test suite and benchmarks use. It has not been compiled with Gradle, built with the Android SDK, or run on a device or emulator, and its tests have not been executed. It is part of the unreleased v1.13.0 candidate: until a release containing it is published, run it from a built source checkout (`node dist/cli.js` instead of `npx @dailephd/my-dev-kit`). The Android coding-agent workflow using it is Workflow 18 in [WORKFLOWS.md](../docs/WORKFLOWS.md).

See each example's `README.md` for its focused workflow.

Generated `.my-dev-kit` directories are local output only and are not tracked in the repository.

## Clean up

**Deletion safety:** The command below permanently removes example indexes. Run it only for directories created during your current example session, after confirming no earlier or shared data would be lost. Leave pre-existing indexes intact.

Remove all generated example indexes with this shell-neutral Node.js command:

```sh
node -e "for (const path of ['examples/basic-ts/.my-dev-kit','examples/basic-python/.my-dev-kit','examples/basic-data-model-ts/.my-dev-kit','examples/basic-react-tsx/.my-dev-kit','examples/basic-android-kotlin/.my-dev-kit']) require('fs').rmSync(path,{recursive:true,force:true})"
```
