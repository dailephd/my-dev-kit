import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Parser, Language, type Tree } from 'web-tree-sitter'

/** B01-qualified Orchard 0.16.10, commit 40c49d490c866ef6ca41f59b69f714f03c8ac599 (MIT). */
export const RUST_GRAMMAR_SHA256 = 'd98c6aa1db69cfd204bf07dfefb2451b987160cbb2db95ddac8ac04b5f1eb1d0'
export const RUST_PARSER_REVISION = `rust-b08:web-tree-sitter-0.25.10:orchard-0.16.10:${RUST_GRAMMAR_SHA256}:1`
/** B01 qualification envelope: 64 KiB source, one second parse, 512 MiB RSS. */
export const RUST_MAX_SOURCE_BYTES = 65_536
let language: Language | undefined
let preparation: Promise<void> | undefined

export function isRustParserReady(): boolean { return language !== undefined }

/** Explicit asynchronous boundary; synchronous library callers must await this first. */
export function prepareRustParser(): Promise<void> {
  return preparation ??= (async () => {
    try {
      const bytes = readFileSync(new URL('./assets/tree-sitter-rust-orchard.wasm', import.meta.url))
      if (createHash('sha256').update(bytes).digest('hex') !== RUST_GRAMMAR_SHA256) {
        throw new Error('Rust grammar checksum mismatch (expected the B01-qualified Orchard asset)')
      }
      const runtime = createRequire(import.meta.url).resolve('web-tree-sitter/tree-sitter.wasm')
      await Parser.init({ locateFile: () => runtime })
      const loaded = await Language.load(bytes)
      const probe = new Parser()
      try { probe.setLanguage(loaded) } finally { probe.delete() }
      language = loaded
    } catch (error) {
      // No private absolute paths from filesystem/runtime errors in public diagnostics.
      throw new Error(`Rust parser asset preparation failed: ${error instanceof Error && error.message.startsWith('Rust grammar checksum') ? error.message : 'packaged grammar/runtime missing, unreadable or incompatible'}. Reinstall the complete package; no runtime download is supported.`)
    }
  })()
}

/** Owns parser/tree lifetimes; no target code, Cargo or macros are executed. */
export function withRustTree<T>(file: string, source: string, consume: (tree: Tree) => T): T {
  if (!language) throw new Error(`Rust parser not ready for ${file}; await prepareRustParser() before synchronous Rust indexing`)
  if (Buffer.byteLength(source, 'utf8') > RUST_MAX_SOURCE_BYTES) throw new Error(`Rust source exceeds B01-qualified 65536-byte limit: ${file}`)
  if (source.includes('\uFFFD') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) {
    throw new Error(`Rust source has untrusted Unicode encoding: ${file}`)
  }
  if (process.memoryUsage().rss > 512 * 1024 * 1024) throw new Error(`Rust parser B01 RSS envelope exceeded: ${file}`)
  const parser = new Parser()
  let tree: Tree | null = null
  try {
    parser.setLanguage(language)
    const deadline = performance.now() + 1000
    tree = parser.parse(source, null, { progressCallback: () => performance.now() > deadline })
    if (!tree || performance.now() > deadline) throw new Error(`Rust parsing exceeded B01 one-second budget: ${file}`)
    const result = consume(tree)
    if (process.memoryUsage().rss > 512 * 1024 * 1024) throw new Error(`Rust parser B01 RSS envelope exceeded: ${file}`)
    return result
  } finally { tree?.delete(); parser.delete() }
}
