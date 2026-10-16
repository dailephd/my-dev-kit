/**
 * v1.12.6 Batch 2: pure TypeScript/NodeNext relative-import resolution against an already-indexed
 * file-path inventory. Shared by generic ownership search and test-infrastructure discovery
 * (`context/testInfrastructureDiscovery.ts` re-exports it). It never reads files, traverses
 * directories, parses source, or mutates graph artifacts.
 */
import * as path from 'node:path'

/** TypeScript NodeNext/Node16 moduleResolution requires source files to import each
 * other using the emitted-JS extension (e.g. `./completion.js`) even though the source
 * on disk is `./completion.ts` — the specifier's extension is deliberately not the
 * source file's extension. Maps an emitted-style extension to the source extension(s)
 * that may legitimately produce it, in resolution-preference order. */
const JS_EMIT_EXTENSION_TO_SOURCE_EXTENSIONS: Record<string, readonly string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
}

function stripKnownEmitExtension(value: string): { base: string; ext: string } | null {
  for (const ext of Object.keys(JS_EMIT_EXTENSION_TO_SOURCE_EXTENSIONS)) {
    if (value.endsWith(ext)) return { base: value.slice(0, value.length - ext.length), ext }
  }
  return null
}

/** Resolves a relative (`./`/`../`) import specifier against already-indexed file paths
 * using the same extension/index-file conventions the language adapters use. Non-relative
 * (package) specifiers are never resolved (they can't reach a project-local test/fixture).
 *
 * Handles the NodeNext/Node16 case where the specifier already carries an emitted-JS
 * extension (`./completion.js`) but the real source is TypeScript (`./completion.ts`):
 * the literal specifier target is still tried first (an actual `.js`/`.jsx` file at that
 * exact path takes precedence when one is indexed), then its NodeNext source
 * correspondence, then the pre-existing extensionless-import candidate list. */
export function resolveRelativeSpecifier(fromPath: string, specifier: string, knownPaths: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null
  const fromDir = path.posix.dirname(fromPath)
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier)).replace(/^\.\//, '')
  const candidates = [joined]
  const stripped = stripKnownEmitExtension(joined)
  if (stripped) {
    for (const sourceExt of JS_EMIT_EXTENSION_TO_SOURCE_EXTENSIONS[stripped.ext] ?? []) {
      candidates.push(`${stripped.base}${sourceExt}`)
    }
  }
  candidates.push(
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.mjs`,
    `${joined}.cjs`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
  )
  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) return candidate
  }
  return null
}
