# fd static-analysis fixture

Upstream project: fd

Repository: https://github.com/sharkdp/fd

Pinned commit: `cfed17a2bc4a2a27eeb90932b94f4c5680a78741`

Snapshot date: 2026-10-21

Original license identifier(s): MIT OR Apache-2.0

Original license files included: `LICENSE-MIT`, `LICENSE-APACHE`. Full upstream notices are preserved.

Copied bytes modified: **No**. Each copied file was verified against the pinned upstream Git blob (GitHub Contents API at the full commit SHA), then checked after writing.

## Exact upstream-to-fixture mapping and integrity

Fixture root: `tests/fixtures/v114-language/rust/F14-licensed-corpus/cli`

| Upstream path | Fixture-relative path | Bytes | SHA-256 | Git blob SHA-1 |
| --- | --- | ---: | --- | --- |
| LICENSE-MIT | LICENSE-MIT | 1082 | 322cfc7aa0c774d0eca3b2610f1d414de3ddbd7d8dd4b9dea941a13a6eb07455 | dfc8683cfb605eeb4949f7ca68b4a60352a27e6d |
| LICENSE-APACHE | LICENSE-APACHE | 10838 | 73c83c60d817e7df1943cb3f0af81e4939a8352c9a96c2fd00451b1116fa635c | c9d7204e8fdba6af0aaf780bb023502055e7b8a4 |
| Cargo.toml | Cargo.toml | 2992 | e990d95dcee8a6f362f344970e5c00c70f27a1a3998c6bb32e4290cd35ce3b57 | 106e0b0fd593de05020c141571033c68dc225c74 |
| src/main.rs | src/main.rs | 24174 | 293fce692ef5f9564925431e13e1a8893e4720b47283e9cf7fc9f3c52a634b54 | fd58d5388b0c7b269efbe58fbadde084edbb60ce |
| src/cli.rs | src/cli.rs | 36323 | 4d957fd33d1cd37bb7fca1f82e0b2273a3531c62eb2c9e9ae2e971657b0bbde4 | 2cb9d67bdff7d5c1901162316ace1f40ae5280f3 |
| src/config.rs | src/config.rs | 4966 | 448f224f277ea02a5f1a28f9cdfa93d4227b0981811e4eddb2f63b0dd694338d | a027812a45f0968f027957bdaec0da427cb7559d |
| src/error.rs | src/error.rs | 1211 | 4c421b880c67bcb07e3880815e1904c288e8eba1c361047ebc5fb829079e9f54 | bec1b448b911180646738a8b7d29454806579f0f |
| src/exit_codes.rs | src/exit_codes.rs | 2431 | 02411adc693bf610b077a77d1bf42b9cd95dcb1bc3d707dbbd35c76d187346b5 | 71f8728012f47e7113e06329b503bab6adc1b849 |

## Scope and limitations

This is a bounded partial source selection, used for static-analysis tests only. It is not a complete upstream checkout. Unselected modules, workspace members, dependency bodies, macro-generated declarations, conditional activation, and runtime behavior remain unresolved. Workspace member lists do not establish selected member ownership. Every selected Rust file is within the 65,536-byte parser envelope. No source was truncated. In particular, tracing/src/macros.rs is not selected.

No compilation, Cargo invocation, upstream installation, build script, CLI application, Tokio runtime, network service, or upstream test execution is asserted or required. These testing fixtures are not authorized npm package contents.
