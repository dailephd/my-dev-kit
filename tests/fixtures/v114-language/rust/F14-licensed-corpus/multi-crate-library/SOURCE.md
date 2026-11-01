# Tokio tracing static-analysis fixture

Upstream project: Tokio tracing

Repository: https://github.com/tokio-rs/tracing

Pinned commit: `9d0e557728ecb91e467fc29dfe738b9f28cf6684`

Snapshot date: 2026-10-21

Original license identifier(s): MIT

Original license files included: `LICENSE`. Full upstream notices are preserved.

Copied bytes modified: **No**. Each copied file was verified against the pinned upstream Git blob (GitHub Contents API at the full commit SHA), then checked after writing.

## Exact upstream-to-fixture mapping and integrity

Fixture root: `tests/fixtures/v114-language/rust/F14-licensed-corpus/multi-crate-library`

| Upstream path | Fixture-relative path | Bytes | SHA-256 | Git blob SHA-1 |
| --- | --- | ---: | --- | --- |
| LICENSE | LICENSE | 1062 | 898b1ae9821e98daf8964c8d6c7f61641f5f5aa78ad500020771c0939ee0dea1 | cdb28b4b56a4860b3872fa837949cf0db13ecc4c |
| Cargo.toml | Cargo.toml | 685 | 0ecfacd7a666662dac018df4f214ccea8ef573e1cfd7769bb65496cbc84f915d | 282f93bb7503063dba122d3ec81a62ca40699ea3 |
| tracing/Cargo.toml | tracing/Cargo.toml | 2630 | 13aaeffa24118b7a29647a886145616f3cd4b136a81441d4249dc46e2693acac | efb686f75d5035f365bceb4859efb0ca8409fdb3 |
| tracing/src/lib.rs | tracing/src/lib.rs | 49804 | a317f30bc270f8339b793f2a52e654098540bf9fd9f39b26befb3b2ec6a9e506 | eeafa95d9499d21abedd243f2fbb8b5b2a8a534a |
| tracing/src/dispatcher.rs | tracing/src/dispatcher.rs | 5891 | a8732392ffe56b1178f8fd3d6e6e02d40b51475c38bb4600abd9cd170df1bf6c | a84b99f4ebe75ffbce4d8ff233729f90f983f1a6 |
| tracing/src/field.rs | tracing/src/field.rs | 6890 | f4ba4bb680a844733682b21b8fef46773054989b6dd4f31aac38ee39ec287d4d | 862d877428a00ad21332f740364e2e03e74fe2d3 |
| tracing-core/Cargo.toml | tracing-core/Cargo.toml | 1422 | 20e34bb11c91680b2f8ff5c35358c2361690c65eb679410b22e3b86604a46866 | 1a2d2957048ca7cfe82bb1fb486738fc86176e0b |
| tracing-core/src/lib.rs | tracing-core/src/lib.rs | 9496 | d16824b9d2748116de57f5df213a33cae8d8da1c48cd5b1d25d716e72f98d292 | 1e2dd1dc2661b286d5b0c97e6deef6ec1b90437b |
| tracing-core/src/callsite.rs | tracing-core/src/callsite.rs | 23118 | 82d54507e629d231ad58ce33adacadd45654372067a40e082a24b1847bb7eb3e | b578c93291354d019fff216eb321304a58e615a0 |
| tracing-core/src/dispatcher.rs | tracing-core/src/dispatcher.rs | 36090 | d2a0584196c7e053006490baebfa61c6b3145138e3209f82f44d1afbe066acb6 | 535df4a4238550eb1b6ae7ac84639fe7c873474b |

## Scope and limitations

This is a bounded partial source selection, used for static-analysis tests only. It is not a complete upstream checkout. Unselected modules, workspace members, dependency bodies, macro-generated declarations, conditional activation, and runtime behavior remain unresolved. Workspace member lists do not establish selected member ownership. Every selected Rust file is within the 65,536-byte parser envelope. No source was truncated. In particular, tracing/src/macros.rs is not selected.

No compilation, Cargo invocation, upstream installation, build script, CLI application, Tokio runtime, network service, or upstream test execution is asserted or required. These testing fixtures are not authorized npm package contents.
