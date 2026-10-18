# Ecosystem development workflows

## 1. Purpose and ownership

This is the single cross-repository workflow guide for **my-dev-kit**, **my-dev-kit-orchestrator**, **my-dev-kit-lab**, and **my-frontend-observer**. Its canonical location is `dailephd/my-dev-kit/docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md`. Other repositories link here rather than maintain synchronized copies.

Use this guide to select and combine workflows. Use each tool's own command and contract documentation for exact syntax and artifact schemas. Documentation ownership does not change runtime ownership: my-dev-kit remains a static evidence producer, not an orchestrator, browser, test runner, or security scanner.

For dependency-aware future sequencing, shared contract governance, proposed version coordination, compatibility certification, and the gap-to-milestone plan, see [ECOSYSTEM_COORDINATED_ROADMAP.md](ECOSYSTEM_COORDINATED_ROADMAP.md). The coordinated roadmap is planning authority for cross-repository sequencing only; repository-local `ROADMAP.md` files remain normative for their own version scope until explicitly reconciled.

This guide consolidates the former Orchestrator ecosystem guide, the web/full-stack vertical-slice workflow, and the cross-tool recipes below. It preserves onboarding, greenfield work, version batches, patches, coordinated changes, documentation reconciliation, security, release, recovery, and handoff responsibilities. It does not change any roadmap or publish a new product capability.

### Evidence labels

- **Implemented command:** a documented public command in the inspected tool.
- **Library API:** a documented programmatic surface, not a CLI subcommand.
- **Agent composition:** an ordered recipe executed by a person or coding agent using existing tools and project commands. It is not built-in automation or a claim that the whole recipe has passed a cross-repository trial.
- **Planned or unsupported:** not available through the inspected public surface. Record the limitation rather than invent a command.

The recipes in this guide are agent compositions. A successful execution must supply its own evidence.

### Command and contract authorities

- my-dev-kit: [Commands](COMMANDS.md), [tool-local workflows](WORKFLOWS.md), [contracts](https://github.com/dailephd/my-dev-kit/blob/main/docs/CONTRACTS.md), [graph and artifact schemas](GRAPH_SCHEMA.md).
- Orchestrator: [Commands](https://github.com/dailephd/my-dev-kit-orchestrator/blob/main/docs/COMMANDS.md), [native workflows](https://github.com/dailephd/my-dev-kit-orchestrator/blob/main/docs/WORKFLOWS.md), [artifacts](https://github.com/dailephd/my-dev-kit-orchestrator/blob/main/docs/ARTIFACTS.md), [contracts](https://github.com/dailephd/my-dev-kit-orchestrator/blob/main/docs/CONTRACTS.md).
- Lab: [Commands](https://github.com/dailephd/my-dev-kit-lab/blob/main/docs/COMMANDS.md), [workflows](https://github.com/dailephd/my-dev-kit-lab/blob/main/docs/WORKFLOWS.md), [security validation](https://github.com/dailephd/my-dev-kit-lab/blob/main/docs/security-validation-framework.md).
- Observer: [Commands](https://github.com/dailephd/my-frontend-observer/blob/master/docs/COMMANDS.md), [workflows](https://github.com/dailephd/my-frontend-observer/blob/master/docs/WORKFLOWS.md), [contracts](https://github.com/dailephd/my-frontend-observer/blob/master/docs/CONTRACTS.md).

The original documentation review used my-dev-kit `1.12.3`, Orchestrator `1.4.1`, Lab `0.5.0`, and Observer `0.8.1`. Preserve that historical review separately from the current release snapshot below.

### Current reviewed releases — 2026-10-17

| Tool | Published version | Reviewed default-branch commit | Current scope relevant to this guide |
| --- | --- | --- | --- |
| my-dev-kit | [1.13.0](https://github.com/dailephd/my-dev-kit/releases/tag/v1.13.0) | `67c2f6c7d79eab0acc186b23b123fa40bfc50dbf` | Static retrieval, Android/Compose ownership and test evidence, incremental refresh, Android benchmarks/examples/workflows. |
| Orchestrator | [1.7.0](https://github.com/dailephd/my-dev-kit-orchestrator/releases/tag/v1.7.0) | `b9b5288af2600b84b29b28edd69470927ad6676c` | Lifecycle/telemetry plus generic evidence requirements, inspection, and readiness integration with specific native adapters. |
| Lab | [0.9.3](https://github.com/dailephd/my-dev-kit-lab/releases/tag/v0.9.3) | `24994168a7ba9cada40915d08a736b4b4902d1a3` | Eight experiments, explicit real-agent campaigns, saved prompt comparison, multi-source galleries, audits/security/tutorials. |
| Observer | [0.10.1](https://github.com/dailephd/my-frontend-observer/releases/tag/v0.10.1) | `ad18f1830b3c26d25f08ff1edcf60b724dfcc575` | Browser/reference contracts, project checks, bounded context, human-controlled visual-request correction and acceptance. |

Orchestrator's v1.7.0 release tag points to `074091ec4f898970bc95d1422705d77f62ee4827`; the reviewed default branch contains later documentation changes. These are dated inspection facts, not permanent installation pins. Record the installed package and source identities for each run and keep them fixed during that run.

**This latest-release snapshot is not a tested or certified four-tool bundle.** Orchestrator 1.7.0's generic native adapters accept exactly Kit **1.12.5** and Observer **0.10.0**. Latest Kit 1.13.0 and Observer 0.10.1 do not satisfy those adapter pins. A run has one native subject identity; Kit static and Observer runtime subjects cannot be merged or relabeled into one identity. Lab 0.10.0 / LAB-EVIDENCE-01 remains the planned producer prerequisite for ECO-01. See the compatibility map and compatibility rehearsal below before attempting evidence intake.

## 2. Responsibility and execution boundaries

**The planner** defines the user outcome, scope, behavior, compatibility boundaries, required layers, test responsibilities, visual intent, execution mode, and Git authority. The implementation prompt contains these requirements directly. A coding agent must not need the planner's private template library to understand its assignment.

**The coding agent** obtains evidence, edits the authorized target, runs actual project commands, tests the integrated result, repairs bounded failures, and reports the outcome. Neither command generation nor a stage-completion mark proves that this work ran.

**my-dev-kit** owns indexing, search, exact lookup, bounded source, slices, graph views, data-model/lineage evidence, context capsules, and graph differences. Classification and graph edges are conservative static evidence, not runtime reachability, security findings, or complete test coverage.

**Orchestrator** owns staged prompts, native artifacts, readiness, lifecycle, judge/correction routing, and export. It does not run the agent, my-dev-kit, Docker, databases, project tests, Observer, Lab, or publication. Its bounded Observer consumer and native-evidence adapters validate explicit inputs; `status --json` and `check --json` inspect the selected run, while library APIs persist a run evidence snapshot. Neither path launches a browser or executes a producer.

**Observer** owns local browser observations, comparisons, executable frontend contracts, external-reference evidence and fidelity, bounded runtime context, explicit runtime/static correlation, and the human-controlled visual-request lifecycle. It never edits target source. Runtime target identity, reference-region identity, and static source identity remain different concepts.

**Lab** owns supported experiments, audits, automated security validation, and reports. It supplements rather than replaces project tests and browser evidence. It is not a mandatory per-edit step, a generic web penetration tester, or a universal consumer of arbitrary ecosystem feedback files.

**Git, GitHub, and the package registry** own history, review, CI, releases, and publication. Permission to implement a feature does not authorize a release, deployment, destructive database action, or force push.

## 3. Shared run contract

Before execution, the planner supplies the following task-specific values. Resolve them once, not differently in every phase.

```text
TASK: <descriptive task slug and user outcome>
TARGET: <repository or explicit source/target repository pair>
BASE: <branch and expected commit, or a rule to resolve them safely>
EXECUTION_MODE: DIRECT_IMPLEMENTATION | FULL_STAGE_CONTEXT
SCOPE: <included behavior and explicit exclusions>
REQUIRED_LAYERS: <data, backend, boundary, client state, UI as applicable>
USER_FLOW: <entry action -> real processing -> observable result>
PRESERVED_BEHAVIOR: <existing contracts and neighboring journeys>
TEST_RESPONSIBILITIES: <planner-authored positive, negative and boundary cases>
VISUAL_INTENT: NONE | PRESERVE_CURRENT | MATCH_EXISTING | REFERENCE
VISUAL_INPUTS: <precedent, reference and selected requirements when applicable>
RUNTIME_EVIDENCE: <routes, states, viewports, targets and required checks>
ASSURANCE: <required Lab/project checks, optional checks, failure thresholds>
CORRECTION_LIMIT: <default three failed-candidate correction cycles>
AUTHORITY: <separate edit, commit, push, merge, release and deployment permissions>
DOCUMENTATION_OWNER: <existing canonical document for any required update>
REPORT: FINAL_RESPONSE_ONLY | <exact authorized project-owned report path>
FEEDBACK: FINAL_RESPONSE_ONLY | <exact authorized project-owned feedback path>
EVIDENCE_ROOT: <exact authorized project/tool output path, or NONE>
OUTPUT_POLICY: <create/reuse/overwrite, ignore/track, retention and cleanup rules>
```

Read the project's placement manifest and applicable agent instructions first. Reuse the existing owner and resolve exact paths before a write, including whether a directory may be created and whether existing output may be reused or overwritten. The default report and feedback destination is the final response unless a task explicitly requires a persisted file under an established owner. Native Orchestrator run artifacts remain required when full staging is selected; the final-response default does not waive its native contracts. Example paths in this guide illustrate tool syntax and do not independently authorize new folders.

Generated indexes, observations, logs, test data, and temporary configuration belong in the authorized ignored evidence root or established tool directory. Some Lab external-local experiments require output outside the immutable target; declare a separate experiment workspace and its exact paths before execution. Preserve native tool filenames, artifact IDs, and existing evidence. Do not invent parallel documentation/report owners.

Use dedicated test data and a non-production database. Preserve pre-existing work and untracked files. Do not reset, clean, stash, force push, rewrite a user's branch, or delete another task's evidence. Never remove the before-index or approved browser baseline while later checks still reference it. Do not commit secrets, session credentials, private browser captures, raw context dumps, package archives, or generated logs.

### Installed commands versus source-checkout tooling

Use the installed public binaries for normal product use. Resolve installation and browser prerequisites once. Observer currently uses the scoped package **`@dailephd/my-frontend-observer`**. Its executable remains `my-frontend-observer`. Earlier unscoped package examples are historical and must not select a different package silently.

```powershell
npx @dailephd/my-dev-kit --help
npx @dailephd/my-dev-kit-orchestrator --help
npx @dailephd/my-dev-kit-lab --help
npx @dailephd/my-frontend-observer --help
```

Verify versions and command-specific help from the actual installation before using an example. A local dependency can determine what `npx` resolves. Record that identity rather than assuming `npx` always downloads the newest release.

Lab `security validate`, `audit`, the `tutorial` family, and experiment discovery/execution are installed CLI commands in the reviewed `0.9.3` surface. `npm run security:validate` and `npm run audit` are contributor aliases run from a Lab checkout, not commands to run in an arbitrary target project. Lab's global `--workspace` precedes the command:

```powershell
npx @dailephd/my-dev-kit-lab --workspace ".my-dev-kit-workflows/<task>/lab" audit --target "<absolute-target>" --types code-rot --format text,json --fail-on none
npx @dailephd/my-dev-kit-lab --workspace ".my-dev-kit-workflows/<task>/lab" security validate --target "<absolute-target>" --profile npm-package --format text,json
```

Select a profile appropriate to the target. Use `--out` explicitly when separate executions need separate reports. An audit with `--fail-on none` collects findings but is not an acceptance gate by exit status. Lab's low-level `security deps`, `security package`, `security codeql`, `security semgrep`, and `security fuzz` are not installed CLI routes in this baseline. Do not invent them.

The installed Lab experiment surface includes:

```powershell
my-dev-kit-lab experiment list
my-dev-kit-lab experiment describe --experiment warm-index-reuse
my-dev-kit-lab experiment run --experiment warm-index-reuse [options]
```

The registered Lab plugins are `context-strategy-comparison`, `warm-index-reuse`, `incremental-change-staleness`, `context-window-scaling`, `retrieval-precision-recall`, `retrieval-query-strategy-comparison`, `context-pack-generation`, and `agent-success-rate`.

`--kit-command <command>` is supported by the seven Kit-backed plugins, with `agent-success-rate` accepting it only in explicit real mode. It is not a `context-strategy-comparison` option. Inspect `experiment describe` and the [Lab command reference](https://github.com/dailephd/my-dev-kit-lab/blob/main/docs/COMMANDS.md) for each plugin's mutually exclusive fixture/external-local/real-mode inputs.

The ordinary warm-index experiment prepares one my-dev-kit index per benchmark-project group and reuses it across that group's tasks. Each task also receives a matched raw-full-file baseline. Its default fake-agent correctness/token evidence is deterministic harness telemetry, not provider billing telemetry. Since Lab 0.5.2, explicit real warm-index campaigns are also supported: `--campaign codex-full|claude-full|codex-timeout-isolation --include-real-agents` selects one provider and the frozen bundled production corpus. Campaign mode does not accept an external `--target`; optional `--case` and `--timeout-ms` constrain the run. This is separate from the `agent-success-rate` campaign/checkpoint interface. Real provider execution requires explicit selection and authorization; saved-report review does not.

Warm-index executions produce bounded `report.json`, `report.txt`, and `report.html` outputs with the warm-index evidence section. Plot generation supports four warm-index families: amortized index cost, raw versus retrieved context size, agent correctness, and cumulative agent token usage. Ordinary fake-agent runs retain simulated telemetry; explicit real campaigns report the selected provider evidence and preserve unavailable metrics.

Lab's installed tutorial surface is also current in this baseline:

```powershell
npx @dailephd/my-dev-kit-lab tutorial validate --scenario "<scenario.json>" --target-contract "<target-contract.json>" --json
npx @dailephd/my-dev-kit-lab tutorial run --scenario "<scenario.json>" --target-contract "<target-contract.json>" --out "<run-root>" --json
```

`tutorial validate` is contract validation and does not require Chromium. `tutorial run` requires a compatible locally installed Chromium; Lab does not download the browser automatically. A successful tutorial produces assertion-backed runtime evidence plus synchronized `tutorial.webm`, requested screenshots, SRT/VTT subtitles, Markdown, and `tutorial-manifest.json`. Product-specific scenarios and demo targets remain owned by the product repository. Video is reviewable documentation, not a substitute for passing assertions.

## 4. Selecting direct or staged execution

Choose the execution mode before writing an implementation prompt. The coding agent does not choose it.

`DIRECT_IMPLEMENTATION` is the default for bounded continuation work with known architecture, established owners and extension points, explicit tests, and proportionate validation. It does not start an Orchestrator run or require its supplemental artifacts. Use current, bounded repository evidence. A safe direct-read fallback is permitted when the selected retrieval path is inadequate, but record the limitation and do not relabel the producer's readiness result.

`FULL_STAGE_CONTEXT` is appropriate for unresolved ownership, competing layers, a new subsystem or cross-repository contract, a major migration/extraction, previous material context failures, integrity-sensitive changes, or an explicit request for formal staging. Select the native mode separately: `feature`, `repair`, `test`, `refactor`, `harden`, `extraction`, or `greenfield`.

These two labels are planner policies, not Orchestrator CLI modes. Do not build a hybrid prompt that silently adds a complete native lifecycle to direct implementation.

A single continuous coding-agent session may advance through multiple native stages, but only in the order and under the gates the tool actually provides. The feature lifecycle still has separate `implementation` and `test-implementation` stages. One session is not permission to collapse stages, pre-mark artifacts, bypass readiness, or make tests optional.

If bounded inspection exposes a genuine unresolved architectural decision, preserve completed evidence and report the exact decision. Do not substitute an arbitrary owner or automatically restart an entire workflow.

### Tool-local starting points

A useful task may need only one tool. Start with its existing local workflow and add another authority only when the task needs its evidence:

- **Kit:** resolve an implementation owner, retrieve bounded dependency/test evidence, or choose changed-files versus affected-neighborhood incremental refresh. The Android coding-agent walkthrough also exercises wrong-layer choices and ambiguity. See [Kit workflows](WORKFLOWS.md).
- **Orchestrator:** inspect and recover a saved native run, or use proof-only for a declared verification responsibility without a planned production change. Prompt generation and lifecycle completion remain distinct from execution. See [Orchestrator workflows](https://github.com/dailephd/my-dev-kit-orchestrator/blob/main/docs/WORKFLOWS.md).
- **Lab:** validate the deterministic agent-success harness before an explicit real campaign, or compare completed prompt-template campaigns with `report compare-prompts` and browse them through `gallery build --source`. Saved-report comparison invokes no provider and must retain `INCOMPARABLE`/`UNVERIFIED` evidence. See [Lab workflows](https://github.com/dailephd/my-dev-kit-lab/blob/main/docs/WORKFLOWS.md).
- **Observer:** rehearse a contract with a deliberately failing protected-area candidate and then a corrected candidate against the same frozen baseline. This tests whether the declared guard catches the intended regression before relying on it for routine changes. See [Observer workflows](https://github.com/dailephd/my-frontend-observer/blob/master/docs/WORKFLOWS.md).

## 5. Static context and evidence refresh

### Stable index and snapshots

Determine source roots from the actual repository. Include required test roots. Use a stable working index and refresh it in place. Create separate before/after indexes only when an immutable comparison or experiment requires them. A matching directory name, package version, or timestamp does not prove freshness.

```powershell
npx @dailephd/my-dev-kit index --root . --src src --src tests --out .my-dev-kit --call-graph --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --query "<owner or behavior>" --limit 20 --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --node "<returned-node-id>" --depth 1 --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<returned-node-id>" --depth 2 --direction both --json
npx @dailephd/my-dev-kit source --index .my-dev-kit --node "<returned-source-node-id>" --format numbered
```

Use exact source, continuation, same-file dependency expansion, and bounded ranges before broad reads. Choose commands because they answer a question, not to complete a ritual. Record whole-file fallbacks with the file, line count, prior retrieval, missing information, conclusion, and implementation impact.

Use full indexing for an initial index, wrong roots, corrupted evidence, changed source-root contracts, or unproven reuse. Use `--incremental` when the current supported contract makes reuse appropriate. Inspect the manifest and reported fallback. Call-graph fallback, missing language support, and optional omissions must remain explicit.

### Stage-role context refresh

```powershell
npx @dailephd/my-dev-kit context --index .my-dev-kit --query "<architecture question>" --role architecture --out ".my-dev-kit-workflows/<task>/architecture.json" --audit-out ".my-dev-kit-workflows/<task>/architecture-audit.json" --json
npx @dailephd/my-dev-kit context --request "<current-context-request.json>" --json
```

Architecture context establishes the owner, extension point or grounded no-extension conclusion, contracts, and test evidence or an explicit gap. Implementation context refreshes exact owners, dependencies, validators, constants, errors, serializers, command boundaries, and closest tests immediately before editing. Test-implementation context follows actual production changes and maps planner-authored responsibilities to changed code, test locations, expected-result evidence, infrastructure, and commands.

Use the current `ContextRequest` schema. `testResponsibilityRefs` contains string IDs, not embedded criticality objects. Before/after inputs appear as a coherent pair and the active index must match the intended current state. Never invent freshness by copying an old capsule.

Inspect role adequacy, context adequacy, freshness, identity, condition coverage, required-evidence loss, unresolved issues, and capsule/audit agreement. Optional bounded truncation alone is not a failure. Missing required evidence, stale identities, or contradictory outputs cannot become a PASS through prose. Regenerate both artifacts from a corrected request and index.

For staged work, use the native supplemental paths and schemas returned by Orchestrator, including its implementation/test packets and retrieval reports. They are not extra native stages. Re-run `status`, `check`, and the affected `prompt` after refresh. A library consumer or manually written summary must not override either producer truth or `RunIntegrityGate`.

## 6. Existing-project onboarding workflow

An unfamiliar project needs Architecture Assimilation before task-level planning. One feature query does not establish project-wide understanding. An already-understood continuation does not need the same broad onboarding again.

Inspect repository identity, branch and worktree, tracked documentation, source roots, packages and entry points, actual architectural layers, canonical versus derived state, extension mechanisms, important input/output flows, public contracts, test infrastructure, configuration, operational constraints, and recurring conventions. Compare current documentation with implementation in both directions. Preserve roadmap scope and release history separately from current code facts.

Create an **Architecture Assimilation Report** covering:

1. Repository, commit, versions, source roots, index identity, and documentation sources.
2. Major subsystems, owners, dependencies, contracts, and analogous implementations.
3. Canonical/persisted state versus projections, artifacts, UI state, fixtures, and generated files.
4. Registration/wiring paths and extension points that must not be duplicated.
5. Relevant control/data flows, static limitations, tests, commands, and operational boundaries.
6. Safe edit guidance, unresolved questions, contradictions, and targeted retrieval/fallback evidence.

The **Architecture Assimilation Gate** has two manual workflow outcomes:

```text
ARCHITECTURE_ASSIMILATION_PASS
ARCHITECTURE_ASSIMILATION_INCOMPLETE
```

A pass requires grounded answers for the likely change area:

```text
Existing owner:
Existing extension point:
Existing analogous implementation:
Canonical contracts/state:
Important dependencies:
Layers that must not own this behavior:
Existing tests to extend:
Architecture that must not be duplicated:
Remaining uncertainty:
```

Do not guess a missing critical owner, contract, or canonical representation. A small, explicit noncritical uncertainty may remain. Resolve evidence gaps with bounded inspection. Product decisions that sources cannot answer return to the planner.

After a pass, select direct or staged execution and carry only the relevant findings into the next prompt. Reuse the model for ordinary continuation. Partially repeat assimilation after a framework change, new state/persistence layer, major subsystem replacement, public-contract change, repository restructuring, or evidence that the old map is wrong.

## 7. Greenfield: two planning files to first working slice

Preserve `project-description.txt` and `project-milestones.txt` as planning inputs. The planner translates their goals, constraints, non-goals, ordering, dependencies, and unresolved decisions into operational artifacts. The tools do not automatically ingest these two filenames.

```powershell
npx @dailephd/my-dev-kit-orchestrator init
npx @dailephd/my-dev-kit-orchestrator start --mode greenfield "<bounded project goal and constraints>"
npx @dailephd/my-dev-kit-orchestrator prompt
```

Follow the generated sequence: idea brief, product boundary, stack decision, starter profile, bootstrap bundle, project documents, scaffold plan, scaffold implementation, first vertical slice, verification, initial index, judge, and final report. Use generated artifact paths, not an invented parallel catalog.

The reviewed profiles are `typescript-cli`, `nextjs-app`, `android-compose`, and `python-cli`. Full-stack web support is the bounded Next.js/PostgreSQL/Prisma/Docker capability attached to `nextjs-app`, not a `nextjs-fullstack` profile. There are no `--profile`, `--project-type`, or `--framework` CLI flags for selecting it. Python CLI is not a Python web/server profile. Unsupported or ambiguous platform intent stays unresolved.

The agent creates the files and runs setup and verification. The common agent instructions (`agents.txt`, `claude.txt`, `AGENTS.md`, `CLAUDE.md`) are separate from the standardized public project-document baseline. Follow the generated contract rather than copying a source project's credentials, ports, models, or domain content.

For a selected full-stack environment, verify host/container addressing, secret scopes, development/test database separation, schema and committed migrations, client generation, readiness, safe non-production reset, no-seed default, and migration-before-traffic responsibility. Do not run destructive reset or deployment without separate authority.

Index only after meaningful source exists. Verify the first actual user flow with project tests and Observer where applicable. Then transfer exact repository identity, environment commands, owners, contracts, tests, and runtime evidence into normal feature work. Greenfield-to-feature handoff is an agent composition here, not a claim that the deferred native handoff capability has shipped.

## 8. Continuous full-stack vertical slice

**Use when:** one user outcome crosses application layers. **Finish when:** all required layers, wiring, applicable cases, protected behavior, and final-state evidence pass. Backend-only or unwired frontend work is never completion.

### 8.1 Map owners and test responsibilities

Before editing, trace the smallest complete path:

```text
user action -> UI -> client/state -> API or server boundary
            -> backend/service -> persistence where applicable
            -> response/state -> rendered result
```

Identify current owners or justified new extension points for every required layer, shared types, validators, errors, and neighboring consumers. Graph evidence can be partial. Verify missing links through bounded source inspection rather than claim universal full-stack tracing or use Android-only flags on a web graph.

Create a use-case matrix from the planner's tests and current contracts. Evaluate normal success, invalid input, empty/missing data, loading, failure, authorization, retry/duplicate action, limits, stale/partial data, and affected responsive/layout behavior. Each applicable case needs an expected result, responsible layer, and test level. Mark inapplicable cases with a reason. Consider meaningful combinations such as a repeated submission while a request is pending. Do not claim exhaustive coverage of every possible state.

### 8.2 Freeze runtime and visual acceptance

Record route, viewport, theme, authenticated state, application state, deterministic test data, target definitions, baseline identity, comparison settings, and contracts before editing behavior that could affect them. Backend changes can affect the baseline too, so capture it before such changes, not only before CSS edits.

Observer's state-file records caller declarations. It does not log in, seed a database, click a form, or establish that state. The project's browser test/setup commands or an authorized human must establish it. Observer's documented action surface includes bounded scrolling, not an arbitrary multi-action user-journey runner.

For a new UI element, configure its intended stable target in both observations when appearance is the contract. Protect existing surrounding regions. Do not demand that a nonexistent new element already render in the baseline.

Visual modes:

- `PRESERVE_CURRENT`: freeze protected/preserved properties of existing targets.
- `MATCH_EXISTING`: identify a named component/route and its actual design-system source. Express the selected measurable relationships and token requirements explicitly.
- `REFERENCE`: use a selected external image plus explicit regions, requirements, applicability, tolerances, and bindings. Import is not approval. Approval follows the user's or planner's actual selection, never a command-success inference.
- `NONE`: follow existing conventions, but do not claim exact visual fidelity.

Observer reference fidelity covers its supported structured geometry/relationship requirements. A passing result does not establish unmeasured font, color, asset, animation, accessibility, or aesthetic preferences. Verify those through explicit project tests or human review where required. A raw screenshot is useful design input, but not a complete executable acceptance contract.

### 8.3 Implement and test without a layer handoff

Implement all required layers and their wiring in one continuous agent session. Dependency order may be data -> backend -> boundary -> client state -> UI, but every item is an intermediate step. Add focused tests as behavior is implemented. Do not postpone discovering all failures until the final check.

Exercise the real integration path. A frontend mock, hardcoded successful response, unused endpoint, or duplicate client-only business rule cannot satisfy required backend integration. Browser tests must perform the user action and verify the intended observable result. Where persistence is required, verify it through a project-owned database-backed test or safe read-back.

Refresh test context after production changes. Complete the use-case and regression tests against that current state. Do not request another prompt merely because backend work finished.

### 8.4 Observer evaluation and correction

Use Observer 0.10.1's project workflow, introduced in 0.8.1, for ordinary repeated coding-agent checks. Resolve configuration once, freeze its acceptance inputs, and retain the same baseline alias throughout the task:

```powershell
npx @dailephd/my-frontend-observer init --url "http://127.0.0.1:<port>/<route>" --viewport 1280x720 --targets-file "<targets.json>"
npx @dailephd/my-frontend-observer capture baseline
# Implement the complete slice outside Observer and run project tests.
npx @dailephd/my-frontend-observer check baseline --json
npx @dailephd/my-frontend-observer view --no-open
```

The schema-1.1.0 project configuration can explicitly reference `acceptance.comparisonConfigFile`, the paired `acceptance.contract.baselineArtifact` and `changeArtifact`, and `acceptance.reference.approvedArtifact` plus optional `bindingsFile`. Use the exact current project schema and safe project-relative paths. Do not invent acceptance CLI flags. Contract/reference preparation remains explicit. `capture baseline` alone does not define executable acceptance.

`check` captures a new immutable current candidate, invokes the canonical comparison, and evaluates configured acceptance. Its bounded JSON results and exit codes are `PASS`/0, `FAIL`/1, `REVIEW_REQUIRED`/2, and `BLOCKED`/3. Comparison alone is `REVIEW_REQUIRED`, even when there are no differences. Do not convert it to PASS or replace the baseline alias to conceal a failure. Configure all required acceptance before relying on this gate.

The advanced standalone commands remain useful for existing evidence, custom state/scroll captures, and explicit multi-state orchestration. Use the actual artifact roots they return. The following is a syntax skeleton, not runnable until placeholders and contract files are resolved:

```powershell
npx @dailephd/my-frontend-observer observe --url "http://localhost:<port>/<route>" --viewport 1280x720 --targets-file "<targets.json>" --output "<evidence>/observations"
npx @dailephd/my-frontend-observer compare --before "<baseline-observation-root>" --after "<candidate-observation-root>" --output "<evidence>/comparisons"
npx @dailephd/my-frontend-observer evaluate-contract --before "<baseline-observation-root>" --after "<candidate-observation-root>" --comparison "<comparison-root>" --baseline "<approved-baseline-contract-root>" --change "<change-contract-root>" --output "<evidence>/evaluations" --enforce
```

Baseline and change contracts are prepared with `approve-baseline` and `save-change-contract` using the documented schemas. A fresh candidate uses the frozen conditions. Evaluate requested changes and active protected/preserved clauses together.

Reference-driven work additionally uses `import-reference`, `approve-reference`, and `evaluate-reference-fidelity --reference <root> --candidate <root> --bindings-file <file> --enforce`. Fidelity must pass **and** preservation contracts must pass. The reference is not the before-observation.

Read semantic results, not only exit codes. `observe` may persist partial evidence at exit 0. `compare` may return an incomparable result at exit 0. Reference fidelity can be `not-evaluated` at exit 0 even with `--enforce`. Missing required evidence cannot pass the outer acceptance gate.

On failure, preserve the candidate, obtain fresh bounded runtime/static evidence, repair the smallest justified source surface, rerun affected tests, and observe again. Evaluate each attempt against the same approved baseline. Do not weaken assertions, tolerances, targets, or requirements to obtain PASS. Reproducible target-definition errors require a recorded contract correction, not a hidden rebaseline.

`projectBoundedAgentContext`, runtime/static correlation, `prepareReferenceCorrection`, and `reviewReferenceCorrectionAttempt` are library APIs. Use an existing, validated adapter when present. The project `check` command already composes capture, comparison, and configured acceptance. Use its result instead of inventing an adapter for that supported path. Report any additional manual bridging actually needed for static correlation or unsupported multi-state execution. Do not invent corresponding CLI commands or a second evaluator.

### 8.5 Final-state acceptance

Refresh the final index, inspect Git changes and graph differences where applicable, and run newly implicated regression tests. Run the repository's final validation once, without duplicating expensive suites hidden inside `verify`. Run required risk-based assurance separately.

Any later production edit invalidates affected test, browser, and correlation evidence. Re-run the dependent gates. Required assurance must pass. An optional skip may be reported, but a required skip/block never coexists with an overall PASS.

The outer workflow verdict is `PASS_FULL_STACK_VERTICAL_SLICE` only after the complete user flow and all required evidence pass. This is a workflow report value, not a new native Orchestrator judge verdict. In a staged run, native verification, accepted judge PASS, readiness, and final-report eligibility still apply.

## 9. Cross-tool recipe catalog

Each recipe below states its inputs, sequence, output, and limit. Reuse sections 3-5 and 16 rather than paste their entire text into every task prompt.

### 9.1 Runtime-to-source repair

**Input:** a reproducible visible failure, URL/state, expected behavior, and an exact source revision. Capture Observer evidence, identify the failed stable target or contract clause, retrieve candidate source through my-dev-kit search/lookup/slice/source, and check explicit runtime/static correlation when available. Use Orchestrator `repair` when formal diagnosis and correction routing help. Implement a bounded repair, add a regression test, and recapture/evaluate.

**Output:** corrected behavior plus a reproducible failure-to-source explanation. Correlation may be ambiguous or unavailable and never proves causality. A fresh manual source investigation is not silently labeled an automatic bridge.

### 9.2 Shared-component safe change or refactor

**Input:** the shared component and preserved public behavior. Retrieve direct consumers, routes, local prop/event flows, and related tests. Supplement static discovery with route configuration and known critical journeys because the graph is not exhaustive. Capture baselines for affected existing routes and a small protected sentinel set. Use `refactor` only for behavior-preserving work, otherwise `feature` or `repair`.

Change the shared owner, test each affected contract, inspect graph/Git differences, and evaluate each protected route against its own matching baseline. **Output:** intended change with no observed regression in the declared consumer set. An untested route is not protected merely because discovery omitted it.

### 9.3 Visual-reference implementation

**Input:** the user's selected reference or existing design precedent. Import and explicitly approve the reference, author only the design requirements that matter, bind reference regions to runtime targets, and retrieve the responsible component and style precedent. Implement, capture the candidate, evaluate fidelity and preservation, then correct from failed evidence.

**Output:** evidence-backed agreement with selected measurable requirements. Use `view` for optional human inspection. Passive viewer inspection does not change the evidence. Explicit project-aware annotation, activation, handoff, check, correction, and acceptance actions can persist their documented authoring/workflow artifacts; they never edit target source. The viewer is not an automatic annotation author, screenshot-cloning engine, or approval substitute. Record unsupported styling requirements rather than claim a complete visual match.

### 9.4 Golden runtime extraction

**Input:** read-only source repository, separate target repository, desired behavior, and a do-not-port list. Use native `extraction` for source architecture, workflow/porting maps, golden behavior, and target architecture when staged work is warranted. Keep source and target indexes separate. Capture source runtime evidence. A selected source screenshot may become an approved external reference for the target.

Implement the behavior with the target's chosen architecture, run target tests, and evaluate target contracts and applicable reference requirements. **Output:** a tested port without importing unrelated source architecture. Do not use ordinary before/after comparison across incompatible application URLs. Visual similarity does not prove functional equivalence or authorize copying unrelated assets.

### 9.5 API and data-contract migration

**Input:** a field/API/schema change and compatibility policy. Use `data-model --entity`, `--field`, and `--trace-view` where supported, then source/graph inspection to identify storage, transformations, boundary types, client state, and UI consumers. Record dynamic or unresolved paths. Define old/new client compatibility, missing/null values, serialization, validation, and migration/read-back tests before editing.

Implement the connected slice, run database/API/client tests, inspect changed evidence, and observe affected UI. **Output:** a verified contract transition through the actual consumer path. Static lineage does not validate a migration, server execution, or complete cross-service flow.

### 9.6 Edge-case hardening matrix

**Input:** a component and its failure assumptions. Combine Orchestrator `harden`, current validators/errors/constants from my-dev-kit, and project-owned test state setup. Turn applicable success, error, loading, authorization, retry, concurrency, limits, stale data, and layout cases into explicit expected outcomes. Run narrow tests and selected state combinations. Observe rendered states and bounded scroll scenarios where useful.

**Output:** reproducible behavior and tests for the declared risk set. Do not claim exhaustive use-case coverage. Observer state declarations do not create authenticated/error/loading states, and Lab fuzz checks are not a general application-state explorer.

### 9.7 Dependency-upgrade impact review

**Input:** locked baseline and one bounded upgrade. Record dependency/package findings and working tests, capture critical UI baselines, upgrade in the authorized branch, and run build, type, contract, integration, and affected browser checks. Use Git/package-lock changes as well as graph differences. Re-run applicable Lab checks.

**Output:** upgrade evidence, compatibility findings, and rollback information. Runtime behavior can change with no source-graph difference. A clean graph diff or `npm audit` alone is not approval.

### 9.8 Pre-pull-request evidence convergence

**Input:** final candidate revision, actual changed surface, and acceptance responsibilities. Match test reports, current context, Observer candidates/contracts, and selected assurance results to that same revision and state. Check required responsibilities, skipped checks, unexpected changes, and evidence invalidated by later edits. In a staged run, consult `check`, canonical readiness, judge acceptance, and final eligibility.

**Output:** a review packet whose claims refer to one candidate. Do not average independent failures into a score or let one tool's PASS override another required failure.

### 9.9 Greenfield-to-first-feature handoff

**Input:** verified scaffold and first slice. Reuse the completed run, source index, environment commands, tests, and approved behavior. Confirm architecture and project identity, then create a normal bounded feature contract and execute the vertical slice. Refresh only affected architecture domains.

**Output:** continuation without respecifying the project or treating the scaffold as a finished app. This is manual coordination, not the deferred native greenfield handoff implementation.

### 9.10 Commit-to-commit regression localization

**Input:** known-good and known-bad revisions, deterministic setup, and one reproducible symptom. Use separately authorized disposable worktrees or checkouts, not a destructive reset of user work. Build matching indexes, record Git changes, capture runtime states, and compare them. Ordinary Observer comparison requires compatible URLs/viewports/browser conditions, so replay revisions sequentially at the same loopback URL or report incompatibility.

Intersect changed static candidates with affected runtime targets, test hypotheses, and use `repair` for the smallest established defect. **Output:** narrowed suspects and a verified repair. Neither co-change nor correlation proves causality. A rename may appear as removal/addition. Do not hide either limitation.

### 9.11 Critical-journey contract bank

**Input:** selected important routes/states, stable targets, approved baselines, contracts, and setup commands. Maintain these as reviewed project test assets, excluding secrets and private captures. For each risky change, select implicated journeys from static evidence **plus** an always-run critical sentinel set. Run project browser actions, capture Observer evidence, and evaluate each state against its matching baseline.

**Output:** reusable regression protection for the declared journey bank. Observer does not discover all routes or execute arbitrary journeys. A loop/script selecting tests is an agent/project adapter, not a new Observer engine. Baseline promotion is explicit and never automatic after PASS.

### 9.12 Security-sensitive user flow

**Input:** trust boundaries and a specific security requirement. Retrieve validation, authorization, data access, secret handling, and UI exposure owners. Add real allowed/denied/error-path tests and verify the integrated flow. Observe browser-visible consequences only where useful. Run applicable Lab checks under a declared profile/threshold.

**Output:** scoped source, runtime, and security evidence. Hiding a button does not prove server authorization. An authenticated-state label does not prove a login. Unsupported application-security checks remain a limitation and may require separate review.

### 9.13 Release-candidate runtime assurance

**Input:** exact release candidate and the critical-journey bank. Run source/package readiness and risk-based Lab assurance, then project browser tests and Observer contracts against that candidate. Preserve deterministic environment and data setup. If a fix follows, invalidate and repeat affected gates before release authorization.

**Output:** browser regression evidence added to release readiness, not a replacement for CI, installed-package validation, security, or publication checks. This recipe never publishes by itself.

### 9.14 Field failure to ecosystem improvement

**Input:** the feedback records defined in section 16. Group reproducible observations by responsible tool, workflow, failure mechanism, version, and cost. Separate implementation defects, misuse, environment failures, documented limitations, and confirmed product defects. Select a representative sanitized case before proposing a tool change.

Where the question fits Lab's existing experiment contracts, use `experiment list`, `experiment describe`, and `experiment run` or its documented library strategy inputs. Otherwise use a separately authorized project test/experiment adapter. Lab does not automatically ingest arbitrary feedback Markdown or arbitrary full-stack edit campaigns.

Compare matched baselines and candidates with identical tasks, revisions, agent settings, budgets, and acceptance criteria. Keep independent sessions, frozen arm reports, and neutral adjudication. Separate cold-index setup from warm retrieval effort. **Output:** an improvement proposal supported by reproduction, regression tests, measured cost, and replay of the original failure. Report raw counts and limitations, not invented savings or a universal winner.

### 9.15 Verification-only or proof-only evidence

**Input:** a bounded claim about behavior that should be verified without a planned production-code change. Define the exact verification responsibility first. Use current repository evidence and project-owned verification commands, and use Orchestrator proof-only only when the formal lifecycle, readiness, judge, and final-report gates add value.

When formal staging is useful:

```powershell
npx @dailephd/my-dev-kit-orchestrator start --proof-only --verification-responsibility artifacts/proof.txt "verify the existing behavior"
```

The responsibility path must be safe and explicit, and the proof artifact must satisfy the current Orchestrator proof contract, including the exact `Proof result: PASS` evidence when required. An empty Git diff never implies proof-only automatically. A verification task that discovers a real implementation defect must return to an authorized implementation or repair workflow rather than silently edit production code under proof-only authority.

**Output:** reproducible evidence for the declared responsibility with no unnecessary source change. Report the exact revision, commands, proof artifact, skips, and remaining limits. Proof-only does not bypass repository-context readiness, lifecycle, judge integrity, or final-report eligibility.

### 9.16 Existing Android or Compose feature, repair, refactor, or hardening

**Input:** an existing Android/Kotlin/Java project, a bounded behavior change or defect, actual module/source roots, and project-owned build/test commands. Use my-dev-kit Android and Compose evidence to locate current ownership before editing. Select the Orchestrator mode by intent: `feature` for changed behavior, `repair` for a reproduced divergence, `refactor` for behavior-preserving structure, and `harden` for guards and failure handling.

Typical bounded retrieval includes:

```powershell
npx @dailephd/my-dev-kit index --root . --src app/src/main/kotlin --src app/src/main/java --out .my-dev-kit --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --composable HomeScreen --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --android-role view-model --json
npx @dailephd/my-dev-kit search --index .my-dev-kit --test-tag login_button --json
npx @dailephd/my-dev-kit lookup --index .my-dev-kit --android-component com.example.MainActivity --json
npx @dailephd/my-dev-kit slice --index .my-dev-kit --node "<returned-viewmodel-node-id>" --depth 2 --include-data-flow --include-tests --json
```

Use the returned Activity, Composable, ViewModel, Repository, navigation, resource, manifest, Gradle, and test evidence only where supported and applicable. Preserve ambiguity instead of guessing ownership. Static Android evidence does not prove merged manifests, Gradle resolution, runtime resource selection, dependency injection, navigation, rendering, or test execution.

Implement through the established owners and run the target project's real Gradle/build/unit/instrumented checks as required by the task. my-dev-kit does not run Gradle. Orchestrator's `android-compose` identifier is a greenfield starter profile, not a Lab security profile. Lab's security profile is `android`, and its default Android validation starts no Gradle, external-tool, or network operation unless explicitly requested. Observer is a browser/frontend evidence tool and is not a native Android UI runtime verifier.

**Output:** a verified Android change grounded in current static ownership plus project-owned runtime/build/test evidence, with optional Lab Android assurance when the task requires it.

### 9.17 Assertion-backed browser tutorial generation

**Input:** a verified local browser workflow, a product-owned declarative `TutorialScenarioV1`, and a matching trusted `TutorialTargetContractV1`. Use this after the behavior to demonstrate is already implemented and stable enough to document. Product repositories own product-specific demo pages, selectors, scenarios, and target contracts; Lab owns the generic tutorial runtime.

Validate before execution:

```powershell
npx @dailephd/my-dev-kit-lab tutorial validate --scenario "<scenario.json>" --target-contract "<target-contract.json>" --json
```

Then run with a compatible locally installed Chromium:

```powershell
npx @dailephd/my-dev-kit-lab tutorial run --scenario "<scenario.json>" --target-contract "<target-contract.json>" --out "<run-root>" --json
```

The current declarative action vocabulary includes `goto`, `click`, `fill`, `press`, `hover`, element-to-element `drag`, `wait-for`, and locator-anchored `pointer-click`/`pointer-drag` using normalized fraction coordinates. Use the scenario's assertions as the acceptance evidence; visible cursor/callout/highlight presentation and the resulting video do not become application state.

Inspect the run result and canonical artifacts: `artifacts/tutorial.webm`, requested `screenshots/`, `artifacts/tutorial.srt`, `artifacts/tutorial.vtt`, `artifacts/tutorial.md`, and `artifacts/tutorial-manifest.json`. A tutorial succeeds only when required actions/assertions and required artifacts succeed and cleanup remains acceptable. Missing Chromium is an explicit unavailable/failure result with setup guidance; Lab does not silently download it.

**Output:** assertion-backed runtime evidence plus synchronized human-facing tutorial artifacts. The WebM is reviewable documentation, not proof by itself. Tutorial generation does not replace project tests, Observer acceptance contracts, security validation, or release authorization.

<a id="915-command-surface-compatibility-map"></a>

### 9.18 Command-surface compatibility map

This section comes from a command-by-command review of all four current public surfaces, not only their named workflow guides. Use these five compatibility classes when composing tools:

- **Direct file or CLI handoff:** the downstream command explicitly accepts the upstream file/artifact type.
- **Programmatic adapter:** the downstream library contract accepts a mapped form of the upstream evidence, but there is no direct CLI pipe.
- **Manual synthesis:** a coding agent or human must author the downstream contract/report from the upstream evidence.
- **Complementary evidence:** both tools inspect the same candidate but neither consumes the other's artifact.
- **Not directly compatible:** similar-looking paths or JSON are different contracts and must not be connected without a documented adapter.

#### my-dev-kit to Orchestrator

- **Manual synthesis:** `my-dev-kit context --out ... --audit-out ...` produces the raw capsule/audit evidence referenced by Orchestrator's implementation/test supplemental packet and retrieval-report contracts. Orchestrator does not accept a raw context capsule as a native artifact. The agent populates the fixed supplemental wrappers, preserving producer identity, freshness, adequacy, truncation, responsibility mappings, and the raw evidence paths.
- **Manual synthesis:** `search`, `lookup`, `slice`, and `source` evidence can support `reports/architecture-context-retrieval-report.txt` and `artifacts/architecture-context-packet.txt`. One top-ranked result is not a completed architecture packet.
- **Manual synthesis:** `graph-diff --before ... --after ... --json` is useful verification/judge evidence for changed ownership and relationships, but Orchestrator has no direct graph-diff ingestion command.
- **Version-pinned evidence adapter:** Orchestrator 1.7.0 can inspect a generic evidence envelope that references an accepted native Kit capsule/audit pair and can persist a run snapshot through `replaceRunEcosystemEvidence(...)`. Its native adapter requires Kit 1.12.5. Generic evidence augments readiness; it does not turn the capsule into a native implementation packet, execute a test, or certify a tuple.

#### my-dev-kit to Observer

- **Programmatic adapter:** Observer's released `deriveRuntimeStaticCorrelations(...)` / `attachRuntimeStaticCorrelations(...)` library surface accepts plain caller-supplied static candidate records. A small adapter may map my-dev-kit file/symbol IDs and evidence references into those records. Do not pass raw my-dev-kit search/lookup/context JSON directly.
- **Manual synthesis:** Observer target IDs, test IDs, visible text, or failure diagnostics can become my-dev-kit `search --ui`, `source --contains`, ordinary `search --query`, or exact-node follow-up questions. This is a runtime-to-source investigation, not automatic causal ownership.
- **Not directly compatible:** Observer `view --context-file` accepts exactly one Observer `BoundedAgentContextArtifact` schema value. It does **not** accept a my-dev-kit context capsule or retrieval audit.

#### Observer to Orchestrator

- **Direct programmatic handoff:** Orchestrator's pure `consumeBoundedObserverEvidence(...)` validates the Observer-owned `my-frontend-observer/bounded-agent-context` schema `1.0.0`, producer name and nonempty version, native identity, bounds, and frontend-change-review projection. It does not impose the generic ECO adapter's 0.10.0 pin, so a valid 0.10.1 artifact can use this separate library boundary. Its readiness result does not establish installed-pair certification.
- **Version-pinned generic ECO intake:** Orchestrator 1.7.0's separate generic adapter accepts exactly Observer 0.10.0 native context. `status --json` and `check --json` expose the selected run's `ecosystem` projection; `replaceRunEcosystemEvidence(...)` persists its evidence snapshot. There is no standalone `check --ecosystem-evidence` flag. Neither interface launches Observer, and 0.10.1 does not pass this generic adapter's exact-version requirement.
- **Manual synthesis:** Observer `check [baseline] --json` is concise final-candidate runtime acceptance evidence for Orchestrator verification/final reporting. No current Orchestrator CLI parses that JSON automatically.

#### my-dev-kit and Orchestrator to Lab

- **Programmatic adapter:** Lab's released stage-context experiment support can consume explicit my-dev-kit context-capsule/retrieval-audit paths and Orchestrator `WorkflowInstructionPacket` inputs through its documented `v043StrategyInputs` / `v043RunAssurance` programmatic configuration.
- There are **no installed CLI flags** that turn arbitrary live capsule/audit/packet paths into that six-strategy stage-context experiment. Use the programmatic experiment path or a separately authorized source-checkout adapter.
- **Direct experiment ownership:** Lab's `context-strategy-comparison` plugin owns the `raw-full-file` versus `my-dev-kit-guided` comparison. A caller should not pre-run both strategies and then relabel unrelated outputs as one Lab experiment.
- **Direct command injection exists only where documented:** `my-dev-kit-lab demo final ... --kit-command <command>` accepts an explicit my-dev-kit-compatible command for the final-demo pipeline, and the seven Kit-backed experiment plugins accept `--kit-command` under their own mode constraints (`agent-success-rate` requires real mode). Context-strategy-comparison does not expose `--kit-command`.

#### Lab to my-dev-kit

- **Manual synthesis:** JSON/text findings from `audit --types code-rot|security` and `security validate` can supply file paths, categories, or candidate surfaces for my-dev-kit `search`, `lookup`, `slice`, and bounded `source` inspection.
- A Lab code-rot finding is a candidate, not deletion authority. Use graph/source evidence to check consumers and ownership before changing code.
- A Lab security finding is not a source owner. Use my-dev-kit to find validators, boundaries, callers, data paths, manifest/component evidence, or tests before repair.

#### Lab to Observer

- **Direct file-type handoff:** Lab tutorial runs can emit PNG screenshots. A deliberately selected tutorial screenshot can be supplied to Observer `import-reference <image-file>`, because that command accepts PNG/JPEG/WebP input. It becomes only an imported external reference until explicitly approved and supplied with selected requirements/bindings.
- This is useful for source-to-target extraction or UI reconstruction when the tutorial state is the selected visual precedent. The screenshot does not transfer tutorial assertions, behavior, authentication, or application state.
- **Not directly compatible:** Lab tutorial manifests, experiment reports, security reports, and audit reports are not Observer observation/comparison/contract artifacts.
- **Lab-local gallery handoff:** Lab 0.9.3 `gallery build --source <path>` consumes supported Lab outputs, including tutorial manifests, warm-index outputs, and saved prompt comparisons. Its legacy `--visualizations` input refers to Lab visualization-demo artifacts. Neither route makes arbitrary Kit graph SVG/DOT directories or Observer evidence roots into supported gallery inputs.

#### Observer to Lab

- **Complementary evidence:** run Observer project acceptance and Lab security/audit against the same exact candidate revision when both runtime presentation and risk evidence matter.
- **Not directly compatible:** Lab report renderers, plot generators, galleries, and experiment commands do not generically ingest Observer observation/comparison/evaluation artifacts.
- A future experiment may deliberately model Observer evidence, but do not claim that integration until a registered experiment/adapter exists.

#### Orchestrator to Lab and Observer

- **Manual synthesis:** Orchestrator's verification/final-report stages may reference Lab security/audit outputs and Observer project-check results. They remain independent authorities with their own pass/block semantics.
- **Not directly compatible:** `my-dev-kit-orchestrator export` is a human/coding-agent handoff document, not a machine input accepted by my-dev-kit, Lab, or Observer.
- **Complementary evidence:** an Orchestrator `harden`, `repair`, `refactor`, `feature`, or `extraction` run can coordinate the other tools, but the coding agent executes those commands externally and records exact evidence.

#### Same-target convergence

Several of the most useful compositions have no artifact pipe at all:

- my-dev-kit indexes and maps the exact source candidate.
- Observer evaluates the exact browser-visible candidate.
- Lab audits or security-validates the exact filesystem candidate.
- Orchestrator, when selected, governs lifecycle/readiness around those independent results.
- Project tests remain the authority for executed application behavior that none of the static/browser/audit tools prove alone.

Record the same Git commit/worktree identity and deterministic runtime/test data for all of them. Never combine evidence from different candidates into one PASS.

#### Pairwise coverage checklist

The command-surface audit explicitly checked every directed pair among the four tools:

- **my-dev-kit → Orchestrator:** manual supplemental wrapper/synthesis around raw capsule/audit and architecture evidence, plus exact-version native evidence inspection through the 1.7.0 generic intake contract.
- **Orchestrator → my-dev-kit:** manual query/request derivation from the active stage, supplemental template, blocker, or correction target. No Orchestrator artifact is a direct my-dev-kit CLI input.
- **my-dev-kit → Observer:** programmatic static-candidate adapter for runtime/static correlation, plus manual source lookup from known runtime identifiers.
- **Observer → my-dev-kit:** manual runtime-target/test-id/text/route-to-static investigation. No Observer artifact is a direct my-dev-kit CLI input.
- **my-dev-kit → Lab:** Lab-owned guided-retrieval and warm-index experiments plus explicit `demo final --kit-command`; stage-context capsule/audit consumption is programmatic rather than a generic installed-file flag.
- **Lab → my-dev-kit:** manual finding-to-owner/dependency investigation.
- **Orchestrator → Observer:** external execution coordinated by the coding agent; Orchestrator does not launch Observer.
- **Observer → Orchestrator:** pure bounded-agent-context consumption plus separately version-pinned generic evidence inspection; Observer `check --json` results remain manually cited.
- **Orchestrator → Lab:** programmatic `WorkflowInstructionPacket` / stage-context experiment inputs, plus ordinary external assurance execution.
- **Lab → Orchestrator:** manual verification/final-report references to security/audit/experiment evidence; no generic report importer.
- **Observer → Lab:** complementary same-candidate evidence only in the current public surfaces; no generic Observer-artifact experiment/report input.
- **Lab → Observer:** direct image-file compatibility for deliberately selected tutorial screenshots into `import-reference`; other Lab artifacts are not Observer inputs.

This pairwise inventory records the reviewed handoff classes; it is not an execution test of all twelve directed pairs. Re-run it whenever a tool adds a command, artifact family, installed CLI route, or public library handoff.

<a id="916-audit-finding-to-dependency-safe-repair"></a>

### 9.19 Audit finding to dependency-safe repair

**Use when:** Lab reports a code-rot or security candidate and you need to decide what actually owns the behavior before editing.

1. Run Lab against the exact target, preferably with JSON plus text output. For exploratory code-rot collection, `--fail-on none` prevents the report threshold from becoming a release gate.
2. Take the reported path/category/candidate term into my-dev-kit `search`.
3. Resolve exact nodes with `lookup`, inspect bounded callers/dependencies with `slice`, and retrieve only the necessary source.
4. For Android findings, add the relevant manifest/resource/component/data-flow selectors rather than treating a text hit as the owner.
5. Decide whether the finding is confirmed, benign, unsupported, or needs a bounded repair. Use Orchestrator `repair` or `harden` only when formal staging adds value.
6. Add the regression/security test, rerun project tests, refresh the index, rerun the same Lab check, and compare the changed static surface.

**Output:** a repair justified by both the original finding and the actual source dependency/ownership evidence. A Lab candidate alone is never permission to delete or rewrite code.

<a id="917-runtime-failure-to-source-candidate-to-correlated-context"></a>

### 9.20 Runtime failure to source candidate to correlated context

**Use when:** Observer reports a failing target/contract/reference result and a coding agent needs a small source candidate set.

1. Preserve the Observer baseline, failing candidate, target IDs, diagnostics, and contract/reference result.
2. Translate only observable identifiers into my-dev-kit questions: stable test ID, visible text, route, component term, or exact known symbol. Use `search --ui`, ordinary search, `source --contains`, then exact lookup/slice/source.
3. Keep multiple plausible static candidates when evidence is ambiguous.
4. When a programmatic adapter is available, map those file/symbol candidates into Observer's plain static-evidence records and call `deriveRuntimeStaticCorrelations(...)` / `attachRuntimeStaticCorrelations(...)`.
5. Produce the Observer-owned `BoundedAgentContextArtifact` with correlated/ambiguous/unavailable status preserved.
6. Optionally inspect that exact artifact with `my-frontend-observer view --context-file <artifact.json>`.
7. In staged work, pass the valid native artifact through Orchestrator's pure `consumeBoundedObserverEvidence(...)` boundary and record its independent readiness result. This pure API validates the bounded schema/projection without the separate generic ECO adapter's exact-version pin. Use the generic intake only when its stronger version/subject requirements also hold; never change producer metadata to make them hold.

**Output:** bounded runtime evidence plus a conservative static candidate set. "Correlated" still means evidence association, not proven causal ownership.

<a id="918-real-stage-context-experiment-from-current-workflow-evidence"></a>

### 9.21 Real stage-context experiment from current workflow evidence

**Use when:** evaluating whether my-dev-kit context and/or Orchestrator instruction packets actually improve coding-agent work.

1. Freeze one target commit and task.
2. Generate the required my-dev-kit capsule/audit pair from that exact target.
3. Create the relevant Orchestrator run and preserve the exact `WorkflowInstructionPacket` sidecar for the stage being studied.
4. Use Lab's programmatic `context-strategy-comparison` stage-context configuration with explicit `v043StrategyInputs` and expectation fixture. Do not invent installed CLI flags for these artifact paths.
5. Run matched strategies with identical target, agent, task, budgets, and acceptance criteria.
6. Keep cold indexing/setup cost separate from warm retrieval/agent cost.
7. Freeze each arm before cross-arm adjudication and retain partial/time-out/unavailable outcomes.

**Output:** an evidence-backed comparison of actual stage-context strategies. This is the correct ecosystem path for testing context usefulness, not an informal comparison of unrelated transcripts.

<a id="919-interaction-heavy-runtime-evidence-plus-visual-acceptance"></a>

### 9.22 Interaction-heavy runtime evidence plus visual acceptance

**Use when:** a user flow needs real clicks/fills/drags plus a stable visual/layout contract.

1. Use Lab `tutorial validate` and `tutorial run` for the declared interaction sequence and assertion-backed runtime recording when its `TutorialScenarioV1` vocabulary fits the flow.
2. Use project setup commands to establish deterministic data/state. Do not treat an Observer state declaration as setup.
3. At the visual checkpoint, use Observer's project workflow (`init`, `capture baseline`, `check baseline --json`) for layout/contract/reference acceptance.
4. If a tutorial screenshot is deliberately selected as a design precedent for another target, feed that PNG to Observer `import-reference`, then explicitly approve/select requirements and bindings.
5. Use my-dev-kit to map failing runtime identifiers or tutorial locators/test IDs back to source candidates when needed.

**Output:** separate behavioral-interaction proof and frontend visual/contract proof for the same candidate. Do not pipe the tutorial manifest into Observer or merge the two verdict systems.

<a id="920-android-static-ownership-plus-android-security-validation"></a>

### 9.23 Android static ownership plus Android security validation

**Use when:** changing Android permissions, exported components, deep links, repositories/data paths, or security-sensitive platform behavior.

1. Index the Android source with my-dev-kit and retrieve the relevant `--permission`, `--android-component`, `--android-route`, resource, role, Compose, and bounded data-flow/test evidence.
2. Run Lab `security validate --profile android` against the same target. Android defaults remain static unless explicit Gradle/external-tool/network operations are requested.
3. For exploratory auditing, use Lab `audit --types security --android`; preserve the underlying security report.
4. Reconcile each Lab finding with the actual my-dev-kit owner/dependency evidence before editing.
5. Run the project's real Android tests/build checks required by the change. If explicitly authorized and useful, select Lab's closed Android Gradle operations, but do not assume they replace project CI.
6. Refresh static evidence and rerun the same Lab profile after the repair.

**Output:** Android change evidence that combines architecture/ownership with security checks while keeping each tool's limits explicit.

<a id="921-final-candidate-multi-tool-evidence-packet"></a>

### 9.24 Final-candidate multi-tool evidence packet

**Use when:** a coding agent, reviewer, or release gate needs one concise record of a final candidate without inventing a universal ecosystem verdict.

Collect, for one exact source revision:

- Git diff and relevant project test/build results.
- my-dev-kit current index identity plus focused lookup/slice/source evidence and graph-diff when it materially explains the change.
- Observer `check <baseline> --json` result for each required frontend journey/state.
- Lab security/audit reports required by risk or release policy.
- Orchestrator status/check/judge/final eligibility when staged execution was selected.

The implementation/final report references these artifacts and records each independent semantic result. A required failure remains a failure. A missing required result remains missing. There is no command that averages them into one score.

### 9.25 Consumer compatibility rehearsal before a producer upgrade

**Use when:** deciding whether a new Kit or Observer release can feed an Orchestrator run through the generic ECO evidence path. This checks the consumer contract independently of whether the producer works correctly by itself.

1. Select one capability and one native producer subject. For the reviewed Orchestrator 1.7.0 adapters, use Kit 1.12.5 static context or Observer 0.10.0 frontend-change-review evidence. Preserve package, native schema, artifact identity, freshness, and original bytes. Never relabel a 1.13.0 or 0.10.1 artifact as an older producer.
2. Activate the required contract with `start --ecosystem-requirements <requirements.json>` or the library `createRun` input `ecosystemRequirementsDocument`. Then use the library-only `replaceRunEcosystemEvidence(runFolder, document)` to store a complete current evidence snapshot. There is no CLI replacement command. Requirements become immutable for the run.
3. Keep the requirements subject equal to the envelope and native subject. Kit uses its static project identity; Observer uses its runtime context identity. Separate runs can attest separate native subjects. Neither current adapter attests an execution environment, so a context-only requirement may omit the optional environment; an environment-dependent claim needs another assurance path.
4. Inspect the selected run with the implemented CLI:

```powershell
npx @dailephd/my-dev-kit-orchestrator@1.7.0 status --root "<project-root>" --run "<run-id>" --json
npx @dailephd/my-dev-kit-orchestrator@1.7.0 check --root "<project-root>" --run "<run-id>" --all --strict --json
```

`--json` changes the output projection; it does not select all checks. The example explicitly adds `--all --strict` for the broader run check.

5. From an exact Orchestrator source checkout, exercise its existing consumer-owned positive and negative fixtures (these are tests, not installed CLI inputs) for unsupported producer version, stale evidence, subject mismatch, environment requirements, unavailable native files, and conflicting evidence. Record the exact failure codes and native file hashes. An unsuitable applicable item can keep a requirement unmet even when a positive item is also present; replace the complete snapshot after a real refresh rather than accumulating stale items.
6. Confirm that satisfied ECO evidence still cannot manufacture project test success, judge acceptance, or final-report eligibility. Shared run loading may reconcile derived lifecycle state in `run.json`; inspection does not execute the project or producer.

**Output:** a reproducible compatibility result for one exact consumer/producer/capability tuple, plus the precise upgrade gap. Consumer fixture success is not ECO-01 certification. Lab's generic producer/adapter remains planned for 0.10.0, and no latest-four-tool certified bundle is established by this recipe. Native adapter and gate authority: [Orchestrator contracts](https://github.com/dailephd/my-dev-kit-orchestrator/blob/main/docs/CONTRACTS.md).

### 9.26 Matched retrieval quality, context-pack, and budget review

**Use when:** a real repository produces noisy retrieval, large context, or uncertain coverage, and the team needs evidence before selecting a retrieval approach. Lab 0.9.3 can run the three retrieval/context-pack plugins and context-window scaling on the same explicit external-local subject.

Freeze one local Git worktree and a reviewed `LocalRepositorySubjectConfigV1` outside that immutable target. The config owns `subjectId`, cases, source roots, queries, expected files/symbols, raw include globs, and a complete deterministic `answerKey` with expected facts and file/symbol targets. Use the detailed [Lab command contract](https://github.com/dailephd/my-dev-kit-lab/blob/main/docs/COMMANDS.md) rather than guessing the ground-truth shape. Fix the installed Kit command and record both package versions.

With exact output roots authorized outside the target repository, run:

```powershell
my-dev-kit-lab experiment run --experiment retrieval-precision-recall --target "<local-git-root>" --local-subject-config "<subject.json>" --kit-command "<exact-kit-command>" --out "<experiment-workspace>/precision"
my-dev-kit-lab experiment run --experiment retrieval-query-strategy-comparison --target "<local-git-root>" --local-subject-config "<subject.json>" --kit-command "<exact-kit-command>" --out "<experiment-workspace>/query-strategies"
my-dev-kit-lab experiment run --experiment context-pack-generation --target "<local-git-root>" --local-subject-config "<subject.json>" --kit-command "<exact-kit-command>" --out "<experiment-workspace>/context-packs"
my-dev-kit-lab experiment run --experiment context-window-scaling --target "<local-git-root>" --local-subject-config "<subject.json>" --kit-command "<exact-kit-command>" --context-budgets 8k,16k,32k,64k --out "<experiment-workspace>/budgets"
```

Do not add `--case`, `--benchmark-project`, or an invented strategy selector in this external-local mode; the config and plugin treatments own those choices. Confirm target immutability after each run. These plugins invoke Kit retrieval but no coding provider. External-local reports redact durable identities and do not persist context-pack bodies.

Compare each plugin's actual measures separately: retrieval precision/recall, query-treatment differences, fact coverage and context size, and budget fit. Keep cases with missing/unavailable evidence visible. The plugins have different treatments; sharing a subject does not create a new paired agent-success trial or prove that the best retrieval score improves edits. Follow up with an explicitly authorized matched agent experiment only when that separate question matters. Current `agent-success-rate` uses the bundled self-target corpus; it does not accept this external-local subject. A trial on that repository requires a separately authorized experiment adapter rather than invented `--target` support.

**Output:** a repository-specific choice supported by named cases and ground truth, with measured quality/size tradeoffs and unresolved cases. This is a composition of existing experiments, not an automatic strategy selector or direct pipe between their outputs.

### 9.27 Visual request to bounded handoff, correction, and human acceptance

**Use when:** a frontend request needs a frozen actual/reference acceptance contract, an external coding-agent handoff, and a reviewable correction history. Observer 0.10.1 owns the visual-request state machine; Kit can supply source ownership and Orchestrator can optionally govern the coding work.

For an initialized Observer project with the required contract/reference acceptance already configured, capture or select the exact baseline observation and start the project-aware viewer without automatically opening a browser. Capturing an observation does not approve it:

```powershell
my-frontend-observer capture baseline
my-frontend-observer view --no-open
```

Open the returned local URL deliberately. Do not add an explicit `--root` for this project-aware authoring path. In the viewer, create the draft, confirm annotation intent, create the actual/reference workflow, and explicitly activate acceptance. Workflow creation freezes acceptance inputs; activation validates that frozen selection and updates project acceptance. The workflow retains the prior acceptance selection for explicit restoration. Restore checks that the activated selection is still current and preserves unrelated project configuration edits.

Use **Prepare handoff** to create the Observer-owned `VisualChangeAgentHandoff` and its canonical primary bounded context. Supplied supplemental context remains independent and unchanged. Feed observed IDs/text/targets into Kit search → lookup → slice → bounded source to identify plausible edit owners. The external actor makes authorized source changes and runs project tests; Observer never edits the application. If native staging adds value, use Orchestrator's ordinary workflow and keep newer Observer outputs as manual evidence unless the receiving adapter explicitly supports them.

Run the handoff's expected post-edit command, `my-frontend-observer check <baseline-alias> --json`, for canonical acceptance. To record a visual-workflow attempt, use the viewer's explicit **Run check** action; a standalone CLI check is not itself a promise to attach a `VisualChangeAttempt`. Review the latest pending attempt, request correction when needed, and accept only a latest PASS through the explicit human action. Comparison-only or review-required results cannot become accepted PASS by prose.

Baseline/reference approval is a separate governance operation using the existing `approve-baseline` or `approve-reference` command and its documented inputs. The viewer records already-completed governance; neither an accepted attempt nor a PASS silently promotes a baseline. Restore acceptance explicitly when the temporary project configuration should end. There is no `visual-request` CLI command: drafting, activation, handoff, attempt review, governance recording, and restore are the documented project-aware viewer actions.

**Output:** an auditable request → frozen acceptance → source change → recorded check → human disposition chain, with separate source, runtime, and lifecycle authorities. Exact action prerequisites and transitions remain in [Observer workflows](https://github.com/dailephd/my-frontend-observer/blob/master/docs/WORKFLOWS.md).

## 10. Version, patch, extraction, and coordinated work

### Feature-version workflow

Preserve the roadmap's version goal, exclusions, and dependencies. Inspect current code before freezing batches. Group changes by shared owners, contracts, fixtures, and tests rather than equal-sized lists. Each prompt includes inherited state, bounded scope, exact edit areas, planner-authored tests, validation, Git authority, report paths, and stop conditions. Do not recreate earlier batches.

Use one coherent version branch where appropriate. Commit/push only when authorized. Do not require a new pull request or a package version bump for each internal batch. After all batches, run implementation completeness and documentation reconciliation, then separate readiness, release preparation, and publication. Keep batch logs out of the roadmap.

### Patch and hotfix workflow

Reproduce the defect on the exact published artifact and record tag, peeled commit, package identity, platform, and invocation. Separate a broken promised behavior from a new enhancement. Identify the responsible tool or target application. Make the smallest repair with a failing-before/passing-after regression test, validate the packed consumer path, reconcile affected documents, and run patch readiness. Severity does not grant publication permission or authorize pulling unrelated unreleased features into the patch.

### Multi-repository coordinated workflow

Record every repository/commit pair, package/API/schema dependency, compatibility rule, and release order before editing. Keep separate repository histories and edit scopes. Validate each candidate locally, then test actual producer-consumer artifacts using exact packs or commits. Observer-to-Orchestrator consumption and historical Lab replay are separate evidence claims. Do not claim a fresh four-tool replay from an older fixed fixture.

After explicit release authorization, publish upstream-first where dependencies require it. Reinstall and validate the exact published upstream in the consumer before releasing the consumer. No single current command coordinates all repository releases.

## 11. Documentation reconciliation and preservation

Inventory current implementation, scripts, commands, schemas, examples, package contents, and tracked documents. Compare both ways: unsupported documentation and implemented-but-undocumented behavior. Verify exact command names and flag combinations, installed-versus-checkout usage, output/exit semantics, links, and current-versus-planned status. Only then improve structure and language.

Use Git history, tags, release evidence, and earlier comprehensive documents for forensic recovery. Recover meaning without restoring superseded facts as current. Preserve separate roadmap versions, goals, dependencies, exclusions, deferred work, product pillars, command families, schemas, and release history. Relocation requires a documented destination and navigation, not silent deletion.

This guide owns cross-tool composition. Each local `WORKFLOWS.md` owns that tool's operational sequences. Each local `COMMANDS.md` owns that executable's exact interface. Do not replicate a full foreign command manual here or add a second ecosystem catalog elsewhere.

Run configured documentation, link, and preservation checks. Update narrowly scoped preservation metadata when an explicitly authorized relocation changes the canonical path. Do not disable checks to hide loss. Documentation-only work does not authorize product changes, new capabilities, version bumps, or publication. A required package-file inclusion or documentation-test adjustment must be named explicitly in the task scope.

## 12. Assurance and experiments

### Project and package validation

Read the target's actual scripts. `verify` may include build/type/docs but omit tests, or include expensive smokes. Run each required responsibility, not a mechanically duplicated command list. Separate focused checks, final project checks, installed-package checks, cross-platform CI, and security evidence.

For installed/source parity, inspect the exact `npm pack` tarball, install outside the source checkout, resolve the actual binary, and exercise advertised commands with a consumer working directory. Ensure repository files and development dependencies cannot satisfy missing runtime assets. Check docs, examples, templates, schemas, and prompts as well as command registration. For this deliberate isolation test, an external disposable workspace is an explicit exception to normal project-contained generated state.

### Lab security and code-rot checks

Use the installed `security validate` or `audit` command for normal target inspection. Supported audit types are `code-rot`, `security`, and their combination. `quality`, `project`, and `all` are not implemented audit types in the reviewed baseline. Security profiles include `node-cli-package`, `local-tool`, `npm-package`, and `android`. Do not confuse Orchestrator's `android-compose` profile with a Lab profile.

Check target identity and pre/post source state. Reports go to an explicit safe output/workspace, not the installed package. Optional missing scanners remain skipped. Required failures or an inconclusive required environment block acceptance. Code-rot findings are candidate evidence, not automatic proof of dead code or complete coverage. Static Android checks do not build or launch the app.

Lab contributor self-validation remains a separate checkout workflow. `npm test` and `npm run verify` have distinct responsibilities in the inspected Lab package. Do not run the entire Lab self-suite for each target feature unless the task is validating Lab itself.

### Experiments and reporting

The eight registered experiment plugins and their Kit-command boundaries are listed in section 3. Inspect the selected plugin before choosing cases, strategies, or target modes. Seven Kit-backed plugins support `--kit-command` with plugin-specific constraints; context-strategy-comparison does not accept it. CLI strategies and programmatic stage-context inputs are distinct. The fixed context-integrity smoke is a historical/frozen-fixture developer workflow, not a configurable arbitrary-run replay CLI.

Warm-index-reuse is a Lab-owned experiment/reporting capability: Lab evaluates the experiment, audits/security checks, and reports, while my-dev-kit remains the index/search producer and the ecosystem does not make warm-index-reuse a mandatory orchestration workflow.

Preserve partial agent outcomes, timeouts, usage limits, target immutability, missing metrics, and unmatched evidence. Use `report render`, `plots generate`, and `gallery build` only with the artifact families they support. Do not feed raw Observer or workflow-feedback files into a Lab renderer and assume compatibility.

## 13. Readiness, release, and publication

Implementation completeness, readiness, release preparation, and publication are different states. A feature or documentation task does not authorize moving between them automatically. Consult the target's [release guide](RELEASE.md) and its own CI/security rules.

Readiness pins an exact candidate and runs required install/type/build/test/docs/benchmark gates, exact-tarball inspection and isolated consumer smokes, path-with-spaces and JSON/diagnostic behavior, deterministic checks, supported platform CI, applicable security/code-rot checks, and runtime assurance where relevant. Local Linux success is not Windows/macOS validation. Do not change the supported Node matrix from memory.

With explicit publication authority, preserve this ordering:

1. Create the release branch from the validated implementation candidate.
2. Finalize versions and intended release-document state, preserving future roadmap scope.
3. Validate locally, inspect the exact package and packaged docs, then push and create the release pull request.
4. Require exact-head PR checks and review, merge through repository policy, then require exact merged-main checks.
5. Create the annotated tag on that verified commit, check its peeled target, and require any applicable tag workflow.
6. Create and verify the GitHub Release and release-channel parity.
7. Finish cleanup and every other GitHub/file mutation before npm publication.
8. Confirm target version availability and clean state, then run the separately authorized `npm publish --access public` as the final state-changing action.
9. Perform read-only registry, release, tag, and repository verification afterward.

Prepare publication-neutral or final intended release documentation in the candidate so the tagged package does not permanently contain stale preparation prose. Reports must still distinguish intended release state from actual registry verification. Do not claim publication before it succeeds.

On partial publication, record exactly which external actions completed. Do not republish blindly, move tags, force history, or repair released content without new authority. Authentication is handled in the local terminal, never by requesting tokens in chat. All temporary installs and consumer smokes belong before the final publish action under this policy.

## 14. Recovery and handoff

Resume at the earliest invalidated evidence or lifecycle gate. Preserve the branch, exact candidate, requests, indexes, failed artifacts, diagnostics, and completed work.

For stale/wrong-root indexes, rebuild only the necessary current evidence. For capsule/audit contradiction, regenerate the pair rather than hand-edit either side. For inadequate architecture or unclear contracts, resolve the precise missing decision. For a failed test/CI/package/security gate, correct the authorized cause and rerun dependent checks. Do not turn optional truncation into an entire workflow restart.

In staged work, `status`, `check`, `prompt`, and correction routing remain authoritative. Artifact presence, `mark complete`, or an authored judge PASS cannot bypass canonical readiness or final-report eligibility. Orchestrator 1.7.0 supports `status --json` and `check --json`. Shared run loading can reconcile derived lifecycle state and atomically persist `run.json`; these commands do not execute agents or project commands, author missing stage artifacts, or manually mark stages. Avoid custom `start --output-dir` runs when subsequent commands cannot rediscover them.

A continuation handoff records repository/branch/commit, tool versions, run ID and stage, worktree state, validated outcomes, reports and raw-evidence paths, accepted architecture, current blockers, authorization, exact next action, and remaining roadmap without reordering it. Export a native run when eligible, but retain project-level context that export does not supply. If using the existing future-heavy handoff convention, target 50% remaining plan, 30% reusable workflow, 10% completed history, and 10% current state/risks. This is a writing convention, not an artifact schema.

## 15. Compact prompt assembly

Do not paste this whole guide into an implementation prompt. Select one recipe and the shared requirements it actually needs. Include:

```text
1. Identity, exact scope, inherited state and separate Git authority.
2. Required user flow/layers and current owners or evidence questions.
3. Planner-authored behavior, boundaries, examples and test responsibilities.
4. Runtime/visual acceptance inputs and protected behavior when applicable.
5. Ordered continuous execution and bounded correction rules.
6. Exact project validation commands and final-state acceptance.
7. Report and ecosystem-feedback paths, failure record, and stop conditions.
```

Provide code-shaped examples and exact constants for design-critical planner-owned interfaces. Do not transfer unresolved product decisions to the implementer. A self-contained prompt can reference accessible current repository files, but must not assume access to private planner templates or absent local ecosystem text files.

One prompt may cover one complete vertical slice. If size or context genuinely requires more than one execution, split by independently testable user outcomes, not backend versus frontend. Report the actual extra handoff and unfinished layers rather than label partial work complete.

## 16. Failure feedback and improvement planning

Report material failures **when they happen**, before a workaround obscures them. Keep ordinary implementation/test failures in the implementation report. Add a complete feedback record for workflow/tool/specification/environment failures, unexpected manual work, late-discovered important cases, repeated regressions, or interrupted full-stack continuation. Deduplicate retries of the same cause and retain attempt references.

### Failure record

```text
ID: <task-slug>/<plain-English failure name>
STAGE: <actual stage or operation>
CLASS: IMPLEMENTATION_DEFECT | REPOSITORY_DEFECT | MY_DEV_KIT_GAP |
       ORCHESTRATOR_GAP | FRONTEND_OBSERVER_GAP | LAB_GAP |
       CROSS_TOOL_INTEGRATION_GAP | SPECIFICATION_GAP | ENVIRONMENT_GAP
DIAGNOSIS: CONFIRMED_DEFECT | DOCUMENTED_LIMITATION | MISUSE |
           ENVIRONMENT | UNRESOLVED
IMPACT: BLOCKING | DEGRADED | INFORMATIONAL
IDENTITY: <target commit/worktree identity, tool versions, index/artifact IDs>
REPRODUCTION: <smallest safe setup and exact command/working directory>
EXPECTED: <required behavior and its contract/source>
ACTUAL: <observed output, exit status, semantic result and diagnostic>
EVIDENCE: <report/artifact paths and relevant test/node/target IDs>
FALLBACK: <bounded fallback or NONE, and acceptance preserved>
COST: <measured extra reads/calls/retries/time or NOT_MEASURED>
RISK: <what missing evidence could conceal>
OWNER: <responsible tool/workflow/application or UNKNOWN>
IMPROVEMENT: <capability-level proposal, not an invented implementation>
STATUS: OPEN | WORKED_AROUND | RESOLVED_DURING_RUN | BLOCKING
FLAGS: extra-prompt, broad-source-read, manual-layer-mapping,
       manual-runtime-correlation, extra-correction, late-edge-case,
       late-regression, unresolved-visual-intent = YES | NO | NOT_MEASURED
```

A manual step that is intentionally documented is not automatically a product defect. An unsupported capability can still be a valuable enhancement candidate. A new component having no existing test is not itself a retrieval failure. Preserve these distinctions before assigning a tool owner.

A safe fallback may allow the feature to continue, but cannot erase the gap, mutate generated verdicts, weaken requirements, or override a staged readiness blocker. Never fabricate a compatibility file, test command, source owner, browser state, or approval to satisfy a gate.

### End-of-run feedback

Return the feedback record even on a block or an otherwise successful feature. Persist it only when REPORT/FEEDBACK names an authorized path; otherwise include it in the final response. Include total material issues, blocking/degraded/informational counts, counts by class and owner, unique causes versus retry count, tool/version identities, the complete records, and the smallest next action. Zero issues is a valid result. Do not manufacture suggestions or precision.

Keep separate outcomes:

```text
FEATURE_RESULT: PASS_FULL_STACK_VERTICAL_SLICE | NEEDS_CORRECTION | BLOCKED
ECOSYSTEM_RESULT: PASS | DEGRADED | BLOCKED | NOT_EVALUATED
```

`FEATURE_RESULT: PASS_FULL_STACK_VERTICAL_SLICE` can coexist with `ECOSYSTEM_RESULT: DEGRADED` only when all feature acceptance is genuinely met through a documented safe fallback. It cannot coexist with a missing required assurance or runtime gate.

To design an improvement plan, group confirmed reproductions and documented limitations, retain raw counts and cost evidence, identify the responsible repository, define a failing regression case, and compare the corrected tool against the same case. Do not reorder the product roadmap automatically from an agent's suggestion.

## 17. Final report and review checklist

Report the exact candidate and actual result, not only a list of files. Include user-flow proof, completed/unfinished layers, API/client wiring evidence, scenario/test results, baseline and final candidate identities, semantic Observer results, correction attempts, final impact review, required assurance, remaining skips/risks, Git actions, and authorized report paths or the final-response-only destination.

Before accepting PASS, verify:

- No required layer, scenario, protected behavior, test, or assurance gate is skipped, failed, blocked, or not evaluated.
- Evidence describes the final source and deterministic runtime state.
- Source absence is not presented as runtime absence, and source edges are not presented as executed behavior.
- Observer exit 0 is not substituted for comparable/complete/passing required evidence.
- Cross-tool correlation is not presented as causal source ownership.
- No baseline, selector, tolerance, fixture, or test was weakened to manufacture success.
- No generated/private state or unrelated work was committed.
- Workarounds and missing capabilities appear in feedback even when the feature passed.
- Native Orchestrator completion rules remain intact when a staged run was used.

## 18. Maintenance and migration notes

The former Orchestrator `docs/ECOSYSTEM_DEVELOPMENT_WORKFLOWS.md` is intentionally removed from that repository's tracked tree. Its historical content remains in Git history. The destination here owns ecosystem composition, including Architecture Assimilation and all lifecycle families formerly documented there. Orchestrator retains its native workflow, artifact, readiness, and command documentation and links here for cross-tool use.

Other repositories should link to this file, not copy it, regenerate it through a hidden sync script, or require private `.txt` references. The installed my-dev-kit package should include this guide under its explicit package-files policy. Repository changes do not retroactively modify an already published npm tarball.

Update recipes only after inspecting the relevant current command/contract owners. Keep facts, manual policies, trial results, limitations, and proposed improvements distinguishable. A newly documented composition becomes empirically verified only when an actual matched execution and its evidence are recorded.
