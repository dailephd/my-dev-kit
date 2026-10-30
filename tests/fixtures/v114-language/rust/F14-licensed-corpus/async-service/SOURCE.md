# Tokio mini-redis static-analysis fixture

Upstream project: Tokio mini-redis

Repository: https://github.com/tokio-rs/mini-redis

Pinned commit: `3d93b42bc363220f85af4fc9e1bebd35b588a4a3`

Snapshot date: 2026-10-21

Original license identifier(s): MIT

Original license files included: `LICENSE`. Full upstream notices are preserved.

Copied bytes modified: **No**. Each copied file was verified against the pinned upstream Git blob (GitHub Contents API at the full commit SHA), then checked after writing.

## Exact upstream-to-fixture mapping and integrity

Fixture root: `tests/fixtures/v114-language/rust/F14-licensed-corpus/async-service`

| Upstream path | Fixture-relative path | Bytes | SHA-256 | Git blob SHA-1 |
| --- | --- | ---: | --- | --- |
| LICENSE | LICENSE | 1062 | 2b582d811c69024b8fe7e69a25b6359e7291303ef0b30428e214dbf8d9848d35 | 243fcd6c728b181ce88c2eaba54a579dd8e64e45 |
| Cargo.toml | Cargo.toml | 1532 | 6ab3fe0a05aed0f910c502887eb90cd157c6ae25a12350b629b18d72d4ecc5fc | 29e0bfd3e55317de5bd673ca9819459ed14e3209 |
| src/lib.rs | src/lib.rs | 2355 | 693a6d114e8a41fe36c9c1e434a44284a03e9641797c2f5fd3568ab8c30da0d4 | de677737f57a515356d0f35b68faf7557b4988cf |
| src/server.rs | src/server.rs | 15465 | fa167b058427fa716a6874568f5989153d3ac5d0a261485b2f6bcf957f503d4e | cdb2e0545b9ebb28f9fe2e44a9108fd2061860b4 |
| src/db.rs | src/db.rs | 14128 | f42f9dae74de01394de6c2471101c22cbfe27d5f0282ac9144620ec70adc02fd | bf3a72237003624f0d38b210ba83aca0dd4006cf |
| src/shutdown.rs | src/shutdown.rs | 1538 | 411dfa5201b37c5627077ec7b55e68b0dabfaaa4596198f71bb19c2b031d56c4 | d203c05dc0f544b260c21a395b0a67e6ca58a5fd |
| src/connection.rs | src/connection.rs | 10386 | 27cbca440dd79d095b42801db49b2835b8175386c181c2b0f718f594da26fd03 | 26769c4ad49ed2bd21e17ffd39388e43d6c1565f |
| src/frame.rs | src/frame.rs | 8543 | b0e00edf693935a3c1474e9b693cb257868cf4121c0f61014c10d1fd26c150d5 | 8c4cda9c0d803482bf85e97e88a564d64ced9b24 |
| src/parse.rs | src/parse.rs | 4987 | de6f5fd03f2d56c965cd48adb2adb7efb3728c31bee60ce63fefd4a7c53e8caf | 4bb198caf5ea1ff9a5e7dd019e9fbbd2c96bdc2e |

## Scope and limitations

This is a bounded partial source selection, used for static-analysis tests only. It is not a complete upstream checkout. Unselected modules, workspace members, dependency bodies, macro-generated declarations, conditional activation, and runtime behavior remain unresolved. Workspace member lists do not establish selected member ownership. Every selected Rust file is within the 65,536-byte parser envelope. No source was truncated. In particular, tracing/src/macros.rs is not selected.

No compilation, Cargo invocation, upstream installation, build script, CLI application, Tokio runtime, network service, or upstream test execution is asserted or required. These testing fixtures are not authorized npm package contents.
