# Basic Rust workspace example

A tiny Cargo workspace demonstrating static Rust retrieval in my-dev-kit v1.14.0. The v1.13.0 CLI does not index Rust. The commands below use a built v1.14.0 source checkout; an installed v1.14.0 CLI can run equivalent commands against this example when the package is available.

my-dev-kit reads the files in this directory as text. It does not run `cargo`, `rustc`, build scripts or the example program, and it does not need a Rust toolchain.

## Layout

```text
basic-rust-workspace/
  Cargo.toml                      workspace with two local members
  crates/core/                    package basic-rust-core (library)
    Cargo.toml
    src/lib.rs                    library root; declares `tasks` and re-exports Runner and Worker
    src/tasks.rs                  Runner trait, Worker type, an inherent impl and `impl Runner for Worker`
    tests/worker_tests.rs         integration test target
  crates/cli/                     package basic-rust-cli (binary)
    Cargo.toml                    local path dependency on basic-rust-core
    src/main.rs                   binary root; uses Runner and Worker
```

There are no registry dependencies, build scripts, procedural macros or generated files.

## Index the example

Run these from the root of a my-dev-kit source checkout (after `npm install` and `npm run build`). Select the Rust source roots explicitly; my-dev-kit finds the matching `Cargo.toml` files from those selected `.rs` files and does not widen the roots.

```bash
node dist/cli.js index \
  --root examples/basic-rust-workspace \
  --src crates/core/src --src crates/core/tests --src crates/cli/src \
  --out .my-dev-kit-rust-demo
```

A relative `--out` is resolved against `--root`, so the index is written to `examples/basic-rust-workspace/.my-dev-kit-rust-demo/`. That directory is ignored by Git; do not commit it. All commands below use that directory:

```bash
IDX=examples/basic-rust-workspace/.my-dev-kit-rust-demo
```

## Find the owner of `run`

The trait declares `run` and `Worker` implements it, so the name appears twice. Ownership search ranks the implementation for a query that names the impl:

```bash
node dist/cli.js search --index $IDX --query "impl Runner for Worker run" --intent ownership --limit 5
```

The result list includes the implementation method as a qualified ID. For the files as shipped, the implementation method is:

```text
symbolq:crates%2Fcore%2Fsrc%2Ftasks.rs#rust%3Aimpl%3AWorker%3Atrait%3ARunner%4017%3A263#run#0
```

The ID encodes the impl's line and character offset in `tasks.rs`, so it changes if you edit the file above that line. Always use an ID copied from your own search output.

## Look up, slice and read source

```bash
ID='symbolq:crates%2Fcore%2Fsrc%2Ftasks.rs#rust%3Aimpl%3AWorker%3Atrait%3ARunner%4017%3A263#run#0'
node dist/cli.js lookup --index $IDX --node "$ID" --depth 1
node dist/cli.js source --index $IDX --node "$ID" --max-lines 20 --format numbered
```

`source` returns exactly the method's lines (18 to 20 in `tasks.rs`). If a window is capped, the output prints a continuation line; add `--continue` to read the next window.

For the surrounding structure, slice around the impl node:

```bash
node dist/cli.js slice --index $IDX --depth 1 \
  --node 'rust-impl:crates%2Fcore%2Fsrc%2Ftasks.rs#rust%3Aimpl%3AWorker%3Atrait%3ARunner%4017%3A263#0'
```

The slice shows the impl, the `Worker` type it is for, the `Runner` trait it implements and the method it defines.

## Build a context capsule

```bash
node dist/cli.js context --index $IDX --query "impl Runner for Worker run" \
  --out $IDX/context.json
```

The capsule selects the method as its focus and attaches bounded source. Its freshness state is `unknown` because the index records no Git provenance for comparison.

## What the graph contains

- Package, target and module nodes for `basic-rust-core` (library and test targets) and `basic-rust-cli` (binary), with their root files.
- The `tasks` module, resolved to `tasks.rs`, and the `pub use` re-exports of `Runner` and `Worker`.
- The `Worker` type, the `Runner` trait, one inherent impl and one trait impl, each with its own method identity.
- A use relationship from the binary crate to the `tasks` module of the local dependency.

## Known limitations

- Static syntax and uniquely resolved local structure only: no type checking, trait dispatch, macro expansion, feature or `cfg` evaluation, or Cargo dependency resolution.
- No call edges: this version does not infer calls between functions.
- Only the selected source roots are read; files outside them are never inspected.
- Rust sources larger than 64 KiB are not parsed.
