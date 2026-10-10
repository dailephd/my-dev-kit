# Claude instructions — my-dev-kit

## Mandatory first action

**Read the complete repository-root `manifest.txt` before doing any
analysis, indexing, source inspection, coding, testing, report generation or
documentation edits.** Then read `claude.txt`, `AGENTS.md`, `agents.txt`
and any applicable nested/local agent instructions. No assumption that
`.txt` files are automatically loaded is permitted.

Verify the actual Git remote, branch, HEAD, tracked/untracked state and
relevant ignored outputs. If `manifest.txt` is missing, stale or
contradicted by live structure, stop all writes and report the mismatch.

## Required execution discipline

- Consult `docs/ROADMAP.md`, `docs/PROJECT_PROGRESS.md`,
  `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md` and
  `docs/DOCUMENTATION_PRESERVATION_POLICY.md` when relevant.
- Before editing, establish manifest owner, owning function, nearest tests,
  exact approved file set, and public/private boundary. The global planner
  owns scope and architecture; don't make those decisions independently.
- Use the verified published my-dev-kit targeted retrieval sequence before
  full-file source/test reads; explain every full-file fallback.
- A report, fresh index, cache, timestamped directory or ignored file is
  still a write. Use only explicitly approved paths. Do not create
  `dev/reports/` or `.my-dev-kit-context/indexes/` output by convenience.
- Extend current implementation and test owners rather than creating duplicate
  engines, CLI handlers, catch-all helpers or unrequested directories.
- Preserve user files, ignored content, fixtures and historical docs. No
  unapproved cleanup, reset, stash, overwrite, version bump, commit, push,
  merge, tag, release or publish.
- On Windows, work silently through the existing headless agent process;
  do not open visible shells, consoles, browsers, Explorer or editors.

## Completion

Report the manifest revision and agent files read, Git identity, exact
created/changed/deleted paths, ignored/generated outputs, owner/test
justification, validation exit codes or skipped reasons, and unresolved risks.
A clean `git status` does not prove absence of ignored-file changes.

`CLAUDE.md` is the discoverable entrypoint; `claude.txt` is its operating
companion. Both defer placement and safety policy to root `manifest.txt`.
