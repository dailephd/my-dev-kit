# Coding agent instructions — my-dev-kit

**Mandatory first action:** Before analyzing a task, reading implementation files, indexing this repository, making a change, generating a report, or running tests, read the complete repository-root `manifest.txt`. Also read any accessible local `agents.txt`, `claude.txt`, `CLAUDE.md`, and applicable nested agent files. The local files may be ignored by Git; do not overwrite or replace them.

A coding agent must explicitly state that the manifest was read and identify its repository revision, then verify the Git remote, branch, HEAD, and working-tree status. Follow the manifest's owner map, repository/output placement, public/private boundaries, and pre-edit checklist before performing work.

**Planning is not implementation authority.** Confirm the exact authorized version/batch and inspect `docs/ROADMAP.md`, `docs/PROJECT_PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, and the applicable current-source contracts. The global planner owns architecture and scope; the agent must not add features, new directories, competing mechanisms, or version changes on its own.

**Mandatory targeted retrieval:** For code ownership and source inspection, use the published my-dev-kit search → lookup → slice → source workflow and bounded continuation before direct full-file source/test reads. If full-file reading is necessary, report the exact commands, outputs, and limitation. Do not use an unimplemented command flag or an old index presented as fresh.

**File creation is not implied by investigation.** Indexes, reports, caches, logs, timestamped directories, temporary files, and other ignored outputs are writes. Before any write, identify the existing owner, exact authorized output path, preservation/overwrite rule, and its necessity. Prefer no file output for a read-only investigation unless the user explicitly requests one. Do not create `dev/reports/`, new timestamped `.my-dev-kit-context/indexes/` directories, or other output roots merely for convenience.

Never delete, reset, clean, stash, overwrite, or silently relocate pre-existing local/ignored files. Inspect generated and ignored paths in addition to `git status`. A clean Git status is not proof no files were created.

Do not commit/push/merge, change package versions, release, or publish without explicit authorization. On Windows, keep all execution headless and avoid opening visible shells, consoles, browsers, editors, or other GUIs.

Before completing, report the exact files created/modified/deleted, ignored/generated outputs retained, corresponding manifest owners, focused validations and exit codes, any limitations, and all deviations. If `manifest.txt` is missing or inconsistent with the live tree, stop writes and perform a read-only ownership inventory; do not invent placement or proceed silently.
