/**
 * Conservative, regex/brace-scanning static evidence extraction from Gradle
 * files (settings, build scripts, and `libs.versions.toml` version
 * catalogs).
 *
 * Deliberately not a Groovy/Kotlin-DSL parser: it never builds a full AST
 * and never evaluates build-script logic. It only recognizes the literal
 * syntactic forms explicitly called out as in-scope evidence (v1.9.0 module
 * detection, v1.10.0 Batch 1 detailed Gradle evidence). Anything else
 * (programmatic module loops, computed values, custom Groovy/Kotlin
 * functions) is preserved as raw, unresolved evidence with a warning —
 * never throws, never invents a resolved value.
 */

import type { AndroidModuleType } from './androidProjectTypes.js'
import type {
  AndroidGradleBuildType,
  AndroidGradleBuildFeatures,
  AndroidGradleAndroidBlock,
  AndroidGradleDependency,
  AndroidGradleDependencyKind,
  AndroidGradleIncludedBuild,
  AndroidGradleIncludedModule,
  AndroidGradlePlugin,
  AndroidGradlePluginId,
  AndroidGradleProductFlavor,
  AndroidGradleSettingsEvidence,
  AndroidGradleSourceRef,
  AndroidGradleSourceSetOverride,
  AndroidGradleValue,
  AndroidGradleVersionCatalog,
  AndroidGradleVersionCatalogBundle,
  AndroidGradleVersionCatalogLibrary,
  AndroidGradleVersionCatalogPlugin,
  AndroidGradleVersionCatalogVersion,
} from './androidGradleTypes.js'

const INCLUDE_STATEMENT_PATTERN = /include\s*\(?\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)?/g
const QUOTED_STRING_PATTERN = /['"]([^'"]+)['"]/g

/**
 * Extracts Gradle module paths from `settings.gradle`/`settings.gradle.kts`
 * `include(...)` declarations (Groovy multi-arg and Kotlin-DSL repeated-call
 * forms). A module spec like `:feature:login` maps to filesystem path
 * `feature/login` under the default Gradle project-directory convention.
 */
export function parseGradleIncludes(settingsText: string): string[] {
  const paths = new Set<string>()
  for (const statementMatch of settingsText.matchAll(INCLUDE_STATEMENT_PATTERN)) {
    const argsBlob = statementMatch[1] ?? ''
    for (const stringMatch of argsBlob.matchAll(QUOTED_STRING_PATTERN)) {
      const spec = stringMatch[1]
      if (!spec) continue
      const path = spec.replace(/^:/, '').split(':').filter(Boolean).join('/')
      if (path) paths.add(path)
    }
  }
  return [...paths].sort()
}

/**
 * Conservative Android plugin-type inference from a build file's raw text.
 * Only the literal plugin-id substrings named in the batch contract are
 * recognized; version-catalog aliases (`alias(libs.plugins.android.application)`)
 * are not resolved in this batch (documented limitation).
 */
export function detectAndroidPluginType(buildFileText: string): AndroidModuleType {
  const hasApplication = buildFileText.includes('com.android.application')
  const hasLibrary = buildFileText.includes('com.android.library')
  if (hasApplication) return 'app'
  if (hasLibrary) return 'library'
  return 'unknown'
}

export function hasKotlinAndroidPluginEvidence(buildFileText: string): boolean {
  return buildFileText.includes('org.jetbrains.kotlin.android') || buildFileText.includes('kotlin-android')
}

/**
 * Finer-grained Android module-type classification for `android-gradle.json`
 * (v1.10.0 Batch 1). Extends `detectAndroidPluginType` with `test` and
 * `dynamic-feature` recognition; falls back to that function's `app`/
 * `library`/`unknown` result otherwise.
 */
export function classifyAndroidGradleModuleType(
  buildFileText: string
): 'app' | 'library' | 'test' | 'dynamic-feature' | 'unknown' {
  if (buildFileText.includes('com.android.dynamic-feature')) return 'dynamic-feature'
  if (buildFileText.includes('com.android.test')) return 'test'
  return detectAndroidPluginType(buildFileText)
}

// ---------------------------------------------------------------------------
// Low-level scanning helpers
// ---------------------------------------------------------------------------

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

function sourceRef(file: string, text: string, index: number): AndroidGradleSourceRef {
  return { file, line: index >= 0 ? lineNumberAt(text, index) : null }
}

/**
 * Finds the first top-level `name { ... }` block (brace-matched, so nested
 * braces inside the block do not terminate it early) starting the search at
 * `fromIndex`. Returns `null` when no such block exists.
 */
function extractBracedBlock(
  text: string,
  name: string,
  fromIndex = 0
): { content: string; contentStart: number; blockStart: number } | null {
  const pattern = new RegExp(`\\b${name}\\s*\\{`, 'g')
  pattern.lastIndex = fromIndex
  const match = pattern.exec(text)
  if (!match) return null
  const braceOpenIndex = match.index + match[0].length - 1
  let depth = 1
  let i = braceOpenIndex + 1
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
  }
  if (depth !== 0) return null
  return { content: text.slice(braceOpenIndex + 1, i - 1), contentStart: braceOpenIndex + 1, blockStart: match.index }
}

/**
 * Scans `blockContent` for top-level `identifier { ... }` sub-blocks (used
 * for `buildTypes { debug { ... } }`, `productFlavors { flavorA { ... } }`,
 * `sourceSets { main { ... } }`). Braces nested inside a sub-block do not
 * split it into multiple entries.
 */
function findNamedSubBlocks(blockContent: string): Array<{ name: string; content: string; start: number }> {
  const results: Array<{ name: string; content: string; start: number }> = []
  const pattern = /\b([A-Za-z_][\w]*)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(blockContent))) {
    const braceOpenIndex = match.index + match[0].length - 1
    let depth = 1
    let i = braceOpenIndex + 1
    for (; i < blockContent.length && depth > 0; i++) {
      if (blockContent[i] === '{') depth++
      else if (blockContent[i] === '}') depth--
    }
    if (depth !== 0) break
    results.push({ name: match[1]!, content: blockContent.slice(braceOpenIndex + 1, i - 1), start: match.index })
    pattern.lastIndex = i
  }
  return results
}

const LITERAL_STRING_PATTERN = /^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$/
const LITERAL_NUMBER_PATTERN = /^-?\d+$/
const LITERAL_BOOLEAN_PATTERN = /^(true|false)$/

function classifyLiteralToken(token: string): { kind: 'string'; value: string } | { kind: 'number'; value: number } | { kind: 'boolean'; value: boolean } | null {
  const stringMatch = token.match(LITERAL_STRING_PATTERN)
  if (stringMatch) return { kind: 'string', value: stringMatch[1] ?? stringMatch[2] ?? '' }
  if (LITERAL_NUMBER_PATTERN.test(token)) return { kind: 'number', value: Number(token) }
  if (LITERAL_BOOLEAN_PATTERN.test(token)) return { kind: 'boolean', value: token === 'true' }
  return null
}

/**
 * Extracts the raw right-hand-side token following a `key` assignment,
 * covering Groovy space-form (`key value`), Groovy/Kotlin `=` form, and a
 * single-argument function-call form (`key("value")` / `key(24)`). Stops at
 * the first `\n`, top-level `,`, or unmatched closing bracket. Never
 * evaluates the token — the caller classifies it as a literal or leaves it
 * as raw/unresolved text.
 */
function extractAssignmentRaw(text: string, keyPattern: string, fromIndex = 0): { raw: string; index: number; keyIndex: number } | null {
  const pattern = new RegExp(`\\b(${keyPattern})\\b\\s*(=)?\\s*`, 'g')
  pattern.lastIndex = fromIndex
  const match = pattern.exec(text)
  if (!match) return null
  let cursor = match.index + match[0].length
  const keyIndex = match.index

  if (text[cursor] === '(') {
    let depth = 1
    let i = cursor + 1
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
    }
    return { raw: text.slice(cursor + 1, i - 1).trim(), index: cursor, keyIndex }
  }

  let i = cursor
  let depth = 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') break
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') {
      if (depth === 0) break
      depth--
    }
    if (ch === ',' && depth === 0) break
    if (ch === '}' && depth === 0) break
  }
  return { raw: text.slice(cursor, i).trim(), index: cursor, keyIndex }
}

function toGradleValue<T>(
  file: string,
  text: string,
  found: { raw: string; index: number } | null,
  expected: 'string' | 'number' | 'boolean',
  unresolvedWarning: string
): AndroidGradleValue<T> | null {
  if (!found || found.raw === '') return null
  const literal = classifyLiteralToken(found.raw)
  if (literal && literal.kind === expected) {
    return {
      resolved: true,
      value: literal.value as unknown as T,
      raw: found.raw,
      source: sourceRef(file, text, found.index),
    }
  }
  return {
    resolved: false,
    raw: found.raw,
    source: sourceRef(file, text, found.index),
    warning: unresolvedWarning,
  }
}

// ---------------------------------------------------------------------------
// Settings evidence (v1.10.0 Batch 1)
// ---------------------------------------------------------------------------

const INCLUDE_BUILD_PATTERN = /includeBuild\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g
const PROJECT_DIR_REMAP_PATTERN = /project\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*projectDir\s*=\s*(?:file|File)?\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g

export function parseSettingsEvidence(settingsText: string, file: string): AndroidGradleSettingsEvidence {
  const dsl: 'groovy' | 'kotlin' = file.endsWith('.kts') ? 'kotlin' : 'groovy'
  const warnings: string[] = []

  const rootProjectNameFound = extractAssignmentRaw(settingsText, 'rootProject\\s*\\.\\s*name')
  const rootProjectName = toGradleValue<string>(
    file,
    settingsText,
    rootProjectNameFound,
    'string',
    'rootProject.name is not a static string literal.'
  )

  const includePaths = new Map<string, number>()
  for (const statementMatch of settingsText.matchAll(INCLUDE_STATEMENT_PATTERN)) {
    const argsBlob = statementMatch[1] ?? ''
    for (const stringMatch of argsBlob.matchAll(QUOTED_STRING_PATTERN)) {
      const spec = stringMatch[1]
      if (!spec) continue
      const path = spec.replace(/^:/, '').split(':').filter(Boolean).join('/')
      if (path && !includePaths.has(path)) includePaths.set(path, statementMatch.index ?? -1)
    }
  }

  const projectDirRemaps = new Map<string, string>()
  for (const remapMatch of settingsText.matchAll(PROJECT_DIR_REMAP_PATTERN)) {
    const spec = remapMatch[1]
    const dir = remapMatch[2]
    if (!spec || !dir) continue
    const path = spec.replace(/^:/, '').split(':').filter(Boolean).join('/')
    projectDirRemaps.set(path, dir)
  }

  const includedModules: AndroidGradleIncludedModule[] = [...includePaths.entries()]
    .map(([path, index]) => ({
      path,
      projectDir: projectDirRemaps.get(path) ?? null,
      source: sourceRef(file, settingsText, index),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const includedBuilds: AndroidGradleIncludedBuild[] = [...settingsText.matchAll(INCLUDE_BUILD_PATTERN)]
    .map((match) => ({ path: match[1] ?? '', source: sourceRef(file, settingsText, match.index ?? -1) }))
    .filter((entry) => entry.path !== '')
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const versionCatalogFiles = new Set<string>()
  if (/gradle\/libs\.versions\.toml/.test(settingsText) || includePaths.size >= 0) {
    // libs.versions.toml is implicitly wired by Gradle convention; explicit
    // `versionCatalogs { create(...) { from(files("...")) } }` references
    // are additionally captured below when statically visible.
  }
  const versionCatalogFromPattern = /from\s*\(\s*files\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g
  for (const match of settingsText.matchAll(versionCatalogFromPattern)) {
    if (match[1]) versionCatalogFiles.add(match[1])
  }

  return {
    file,
    dsl,
    rootProjectName,
    includedModules,
    includedBuilds,
    versionCatalogFiles: [...versionCatalogFiles].sort(),
    warnings: warnings.sort(),
  }
}

// ---------------------------------------------------------------------------
// Plugin evidence
// ---------------------------------------------------------------------------

const PLUGIN_ID_CALL_PATTERN = /\bid\s*\(\s*['"]([^'"]+)['"]\s*\)\s*(?:version\s*\(?\s*['"]([^'"]+)['"]\s*\)?)?/g
const PLUGIN_ID_SPACE_PATTERN = /\bid\s+['"]([^'"]+)['"]\s*(?:version\s*\(?\s*['"]([^'"]+)['"]\s*\)?)?/g
const PLUGIN_ALIAS_PATTERN = /\balias\s*\(\s*(libs\.plugins\.[\w.]+)\s*\)/g
const APPLY_PLUGIN_MAP_PATTERN = /apply\s+plugin\s*:\s*['"]([^'"]+)['"]/g
const APPLY_PLUGIN_FN_PATTERN = /apply\s*\(\s*plugin\s*=\s*['"]([^'"]+)['"]\s*\)/g

export function parsePlugins(pluginsBlockText: string, file: string, fullText: string, blockOffset: number): AndroidGradlePlugin[] {
  const plugins: AndroidGradlePlugin[] = []
  const seen = new Set<string>()

  const addEntry = (
    plugin: AndroidGradlePluginId,
    version: AndroidGradleValue<string> | null,
    localIndex: number,
    warnings: string[]
  ): void => {
    const key = plugin.resolved ? `id:${plugin.id}` : `alias:${plugin.alias}`
    const dedupeKey = `${key}@${localIndex}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    plugins.push({ plugin, version, source: sourceRef(file, fullText, blockOffset + localIndex), warnings: warnings.sort() })
  }

  for (const match of pluginsBlockText.matchAll(PLUGIN_ID_CALL_PATTERN)) {
    const id = match[1]
    if (!id) continue
    const versionRaw = match[2]
    const version: AndroidGradleValue<string> | null = versionRaw
      ? { resolved: true, value: versionRaw, raw: `"${versionRaw}"`, source: sourceRef(file, fullText, blockOffset + (match.index ?? 0)) }
      : null
    addEntry({ resolved: true, id }, version, match.index ?? 0, [])
  }
  for (const match of pluginsBlockText.matchAll(PLUGIN_ID_SPACE_PATTERN)) {
    const id = match[1]
    if (!id) continue
    const versionRaw = match[2]
    const version: AndroidGradleValue<string> | null = versionRaw
      ? { resolved: true, value: versionRaw, raw: `'${versionRaw}'`, source: sourceRef(file, fullText, blockOffset + (match.index ?? 0)) }
      : null
    addEntry({ resolved: true, id }, version, match.index ?? 0, [])
  }
  for (const match of pluginsBlockText.matchAll(PLUGIN_ALIAS_PATTERN)) {
    const alias = match[1]
    if (!alias) continue
    addEntry({ resolved: false, alias }, null, match.index ?? 0, [
      `Plugin alias "${alias}" was not resolved against a version catalog.`,
    ])
  }
  for (const match of pluginsBlockText.matchAll(APPLY_PLUGIN_MAP_PATTERN)) {
    const id = match[1]
    if (!id) continue
    addEntry({ resolved: true, id }, null, match.index ?? 0, [])
  }
  for (const match of pluginsBlockText.matchAll(APPLY_PLUGIN_FN_PATTERN)) {
    const id = match[1]
    if (!id) continue
    addEntry({ resolved: true, id }, null, match.index ?? 0, [])
  }

  return plugins.sort((a, b) => {
    const aKey = a.plugin.resolved ? a.plugin.id : a.plugin.alias
    const bKey = b.plugin.resolved ? b.plugin.id : b.plugin.alias
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
  })
}

/** Extracts plugin evidence from an entire build-file text: `plugins { ... }` block plus any top-level `apply plugin:`/`apply(plugin = ...)` statements outside it. */
export function parseAllPlugins(buildText: string, file: string): AndroidGradlePlugin[] {
  const pluginsBlock = extractBracedBlock(buildText, 'plugins')
  const fromBlock = pluginsBlock ? parsePlugins(pluginsBlock.content, file, buildText, pluginsBlock.contentStart) : []
  const fromApplyStatements = parsePlugins(buildText, file, buildText, 0).filter(
    (entry) => !fromBlock.some((existing) => JSON.stringify(existing.plugin) === JSON.stringify(entry.plugin))
  )
  const merged = [...fromBlock, ...fromApplyStatements]
  const dedupedById = new Map<string, AndroidGradlePlugin>()
  for (const entry of merged) {
    const key = entry.plugin.resolved ? `id:${entry.plugin.id}` : `alias:${entry.plugin.alias}`
    if (!dedupedById.has(key)) dedupedById.set(key, entry)
  }
  return [...dedupedById.values()].sort((a, b) => {
    const aKey = a.plugin.resolved ? a.plugin.id : a.plugin.alias
    const bKey = b.plugin.resolved ? b.plugin.id : b.plugin.alias
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// Dependency evidence
// ---------------------------------------------------------------------------

const DEPENDENCY_CONFIGURATIONS = [
  'implementation',
  'api',
  'compileOnly',
  'runtimeOnly',
  'testImplementation',
  'testApi',
  'androidTestImplementation',
  'androidTestApi',
  'debugImplementation',
  'releaseImplementation',
  'kapt',
  'ksp',
  'annotationProcessor',
]

/** Strips one layer of wrapping `(...)` only when the leading `(` and the line's final `)` are actually a matched pair — e.g. `(project(":core"))` → `project(":core")`, but `project(':core')` (no wrapping call) is left untouched. */
function unwrapOuterParens(expr: string): string {
  if (!expr.startsWith('(') || !expr.endsWith(')')) return expr
  let depth = 0
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++
    else if (expr[i] === ')') {
      depth--
      if (depth === 0) return i === expr.length - 1 ? expr.slice(1, -1).trim() : expr
    }
  }
  return expr
}

export function parseDependencies(dependenciesBlockText: string, file: string, fullText: string, blockOffset: number): AndroidGradleDependency[] {
  const dependencies: AndroidGradleDependency[] = []
  const lines = dependenciesBlockText.split('\n')
  let cursor = 0
  for (const line of lines) {
    const lineStart = cursor
    cursor += line.length + 1
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('//')) continue
    const configMatch = new RegExp(`^(${DEPENDENCY_CONFIGURATIONS.join('|')})\\b`).exec(trimmed)
    if (!configMatch) continue
    const configuration = configMatch[1]!
    const leadingWs = line.length - line.trimStart().length
    const localIndex = lineStart + leadingWs
    const rest = unwrapOuterParens(trimmed.slice(configuration.length).trim())
    const parsed = classifyDependencyExpression(rest)
    dependencies.push({
      configuration,
      kind: parsed.kind,
      group: parsed.group,
      artifact: parsed.artifact,
      version: parsed.version,
      projectPath: parsed.projectPath,
      catalogAlias: parsed.catalogAlias,
      raw: trimmed,
      source: sourceRef(file, fullText, blockOffset + localIndex),
      warnings: parsed.warnings,
    })
  }
  return dependencies.sort((a, b) => {
    if (a.configuration !== b.configuration) return a.configuration < b.configuration ? -1 : 1
    return a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0
  })
}

/** Extracts dependency evidence from an entire build-file text's `dependencies { ... }` block. */
export function parseAllDependencies(buildText: string, file: string): AndroidGradleDependency[] {
  const block = extractBracedBlock(buildText, 'dependencies')
  if (!block) return []
  return parseDependencies(block.content, file, buildText, block.contentStart)
}

function classifyDependencyExpression(expr: string): {
  kind: AndroidGradleDependencyKind
  group: string | null
  artifact: string | null
  version: string | null
  projectPath: string | null
  catalogAlias: string | null
  warnings: string[]
} {
  const coordinateStringMatch = expr.match(/^['"]([^'"]+)['"]/)
  if (coordinateStringMatch) {
    const coordinate = coordinateStringMatch[1]!
    const parts = coordinate.split(':')
    if (parts.length >= 3) {
      return {
        kind: 'external-module',
        group: parts[0]!,
        artifact: parts[1]!,
        version: parts.slice(2).join(':'),
        projectPath: null,
        catalogAlias: null,
        warnings: [],
      }
    }
    return {
      kind: 'external-module',
      group: null,
      artifact: null,
      version: null,
      projectPath: null,
      catalogAlias: null,
      warnings: [`Dependency coordinate "${coordinate}" does not have group:artifact:version form.`],
    }
  }

  const projectMatch = expr.match(/^project\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (projectMatch) {
    return {
      kind: 'project',
      group: null,
      artifact: null,
      version: null,
      projectPath: projectMatch[1]!,
      catalogAlias: null,
      warnings: [],
    }
  }

  const platformMatch = expr.match(/^(?:enforcedPlatform|platform)\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (platformMatch) {
    const coordinate = platformMatch[1]!
    const parts = coordinate.split(':')
    return {
      kind: 'platform',
      group: parts[0] ?? null,
      artifact: parts[1] ?? null,
      version: parts.slice(2).join(':') || null,
      projectPath: null,
      catalogAlias: null,
      warnings: [],
    }
  }

  const filesMatch = expr.match(/^files\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (filesMatch) {
    return { kind: 'file', group: null, artifact: null, version: null, projectPath: null, catalogAlias: null, warnings: [] }
  }

  const catalogMatch = expr.match(/^(libs\.[\w.]+)/)
  if (catalogMatch) {
    return {
      kind: 'version-catalog-alias',
      group: null,
      artifact: null,
      version: null,
      projectPath: null,
      catalogAlias: catalogMatch[1]!,
      warnings: [],
    }
  }

  return {
    kind: 'unknown',
    group: null,
    artifact: null,
    version: null,
    projectPath: null,
    catalogAlias: null,
    warnings: [`Dependency expression "${expr}" was not statically resolvable.`],
  }
}

// ---------------------------------------------------------------------------
// `android { ... }` block evidence
// ---------------------------------------------------------------------------

export function parseAndroidBlock(buildText: string, file: string): AndroidGradleAndroidBlock | null {
  const androidBlock = extractBracedBlock(buildText, 'android')
  if (!androidBlock) return null
  const { content, contentStart } = androidBlock

  const defaultConfigBlock = extractBracedBlock(content, 'defaultConfig')
  const defaultConfigContent = defaultConfigBlock?.content ?? ''
  const defaultConfigOffset = defaultConfigBlock ? contentStart + defaultConfigBlock.contentStart : contentStart

  const getString = (blockText: string, blockOffset: number, key: string, label: string) =>
    toGradleValue<string>(
      file,
      buildText,
      offsetFound(extractAssignmentRaw(blockText, key), blockOffset),
      'string',
      `${label} is not a static string literal.`
    )
  const getNumber = (blockText: string, blockOffset: number, key: string, label: string) =>
    toGradleValue<number>(
      file,
      buildText,
      offsetFound(extractAssignmentRaw(blockText, key), blockOffset),
      'number',
      `${label} is not a static integer literal.`
    )
  const getBoolean = (blockText: string, blockOffset: number, key: string, label: string) =>
    toGradleValue<boolean>(
      file,
      buildText,
      offsetFound(extractAssignmentRaw(blockText, key), blockOffset),
      'boolean',
      `${label} is not a static boolean literal.`
    )

  const namespace = getString(content, contentStart, 'namespace', 'namespace')
  const compileSdk = getNumber(content, contentStart, 'compileSdk(?:Version)?', 'compileSdk')
  const applicationId =
    getString(defaultConfigContent, defaultConfigOffset, 'applicationId', 'applicationId') ??
    getString(content, contentStart, 'applicationId', 'applicationId')
  const minSdk =
    getNumber(defaultConfigContent, defaultConfigOffset, 'minSdk(?:Version)?', 'minSdk') ??
    getNumber(content, contentStart, 'minSdk(?:Version)?', 'minSdk')
  const targetSdk =
    getNumber(defaultConfigContent, defaultConfigOffset, 'targetSdk(?:Version)?', 'targetSdk') ??
    getNumber(content, contentStart, 'targetSdk(?:Version)?', 'targetSdk')
  const versionCode =
    getNumber(defaultConfigContent, defaultConfigOffset, 'versionCode', 'versionCode') ??
    getNumber(content, contentStart, 'versionCode', 'versionCode')
  const versionName =
    getString(defaultConfigContent, defaultConfigOffset, 'versionName', 'versionName') ??
    getString(content, contentStart, 'versionName', 'versionName')
  const testInstrumentationRunner = getString(
    defaultConfigContent,
    defaultConfigOffset,
    'testInstrumentationRunner',
    'testInstrumentationRunner'
  )

  const buildFeaturesBlock = extractBracedBlock(content, 'buildFeatures')
  const buildFeatures: AndroidGradleBuildFeatures | null = buildFeaturesBlock
    ? {
        compose: getBoolean(buildFeaturesBlock.content, contentStart + buildFeaturesBlock.contentStart, 'compose', 'buildFeatures.compose'),
        viewBinding: getBoolean(
          buildFeaturesBlock.content,
          contentStart + buildFeaturesBlock.contentStart,
          'viewBinding',
          'buildFeatures.viewBinding'
        ),
        dataBinding: getBoolean(
          buildFeaturesBlock.content,
          contentStart + buildFeaturesBlock.contentStart,
          'dataBinding',
          'buildFeatures.dataBinding'
        ),
        buildConfig: getBoolean(
          buildFeaturesBlock.content,
          contentStart + buildFeaturesBlock.contentStart,
          'buildConfig',
          'buildFeatures.buildConfig'
        ),
      }
    : null

  const flavorDimensionsFound = extractAssignmentRaw(content, 'flavorDimensions')
  const flavorDimensions = flavorDimensionsFound
    ? [...flavorDimensionsFound.raw.matchAll(QUOTED_STRING_PATTERN)].map((m) => m[1]!).sort()
    : []

  const buildTypesBlock = extractBracedBlock(content, 'buildTypes')
  const buildTypes: AndroidGradleBuildType[] = buildTypesBlock
    ? findNamedSubBlocks(buildTypesBlock.content)
        .map((sub) => parseBuildType(sub, file, buildText, contentStart + buildTypesBlock.contentStart))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    : []

  const productFlavorsBlock = extractBracedBlock(content, 'productFlavors')
  const productFlavors: AndroidGradleProductFlavor[] = productFlavorsBlock
    ? findNamedSubBlocks(productFlavorsBlock.content)
        .map((sub) => parseProductFlavor(sub, file, buildText, contentStart + productFlavorsBlock.contentStart))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    : []

  const sourceSetsBlock = extractBracedBlock(content, 'sourceSets')
  const sourceSetOverrides: AndroidGradleSourceSetOverride[] = sourceSetsBlock
    ? findNamedSubBlocks(sourceSetsBlock.content)
        .map((sub) => parseSourceSetOverride(sub, file, buildText, contentStart + sourceSetsBlock.contentStart))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    : []

  const signingConfigNamesReferenced = [
    ...new Set(
      [...content.matchAll(/signingConfigs\s*[.[]\s*(?:getByName\s*\(\s*)?['"]?([\w-]+)['"]?\)?/g)]
        .map((m) => m[1])
        .filter((v): v is string => Boolean(v))
    ),
  ].sort()

  return {
    namespace,
    compileSdk,
    applicationId,
    minSdk,
    targetSdk,
    versionCode,
    versionName,
    testInstrumentationRunner,
    buildFeatures,
    flavorDimensions,
    buildTypes,
    productFlavors,
    sourceSetOverrides,
    signingConfigNamesReferenced,
  }
}

function offsetFound(
  found: { raw: string; index: number } | null,
  blockOffset: number
): { raw: string; index: number } | null {
  return found ? { raw: found.raw, index: blockOffset + found.index } : null
}

function parseBuildType(
  sub: { name: string; content: string; start: number },
  file: string,
  fullText: string,
  parentOffset: number
): AndroidGradleBuildType {
  const offset = parentOffset + sub.start
  const getString = (key: string, label: string) =>
    toGradleValue<string>(
      file,
      fullText,
      offsetFound(extractAssignmentRaw(sub.content, key), offset),
      'string',
      `${label} is not a static string literal.`
    )
  const getBoolean = (key: string, label: string) =>
    toGradleValue<boolean>(
      file,
      fullText,
      offsetFound(extractAssignmentRaw(sub.content, key), offset),
      'boolean',
      `${label} is not a static boolean literal.`
    )
  const proguardFiles = [...sub.content.matchAll(/proguardFiles?\s*\(([^)]*)\)/g)]
    .flatMap((m) => [...(m[1] ?? '').matchAll(QUOTED_STRING_PATTERN)].map((sm) => sm[1]!))
    .sort()
  const matchingFallbacks = [...sub.content.matchAll(/matchingFallbacks\s*(?:=|\()?\s*\[?([^)\]\n]*)\]?/g)]
    .flatMap((m) => [...(m[1] ?? '').matchAll(QUOTED_STRING_PATTERN)].map((sm) => sm[1]!))
    .sort()

  return {
    id: `build-type:${sub.name}`,
    name: sub.name,
    source: sourceRef(file, fullText, offset),
    applicationIdSuffix: getString('applicationIdSuffix', 'applicationIdSuffix'),
    versionNameSuffix: getString('versionNameSuffix', 'versionNameSuffix'),
    debuggable: getBoolean('debuggable', 'debuggable'),
    minifyEnabled: getBoolean('minifyEnabled', 'minifyEnabled'),
    shrinkResources: getBoolean('shrinkResources', 'shrinkResources'),
    proguardFiles: [...new Set(proguardFiles)],
    matchingFallbacks: [...new Set(matchingFallbacks)],
  }
}

function parseProductFlavor(
  sub: { name: string; content: string; start: number },
  file: string,
  fullText: string,
  parentOffset: number
): AndroidGradleProductFlavor {
  const offset = parentOffset + sub.start
  const getString = (key: string, label: string) =>
    toGradleValue<string>(
      file,
      fullText,
      offsetFound(extractAssignmentRaw(sub.content, key), offset),
      'string',
      `${label} is not a static string literal.`
    )
  const getNumber = (key: string, label: string) =>
    toGradleValue<number>(
      file,
      fullText,
      offsetFound(extractAssignmentRaw(sub.content, key), offset),
      'number',
      `${label} is not a static integer literal.`
    )

  const dimensionValue = getString('dimension', 'dimension')
  const manifestPlaceholders: Record<string, string> = {}
  const placeholdersBlock = extractBracedBlock(sub.content, 'manifestPlaceholders')
  const placeholdersRaw =
    placeholdersBlock?.content ?? extractAssignmentRaw(sub.content, 'manifestPlaceholders')?.raw ?? ''
  for (const m of placeholdersRaw.matchAll(/['"]?([\w.-]+)['"]?\s*(?:to|:)\s*['"]([^'"]*)['"]/g)) {
    if (m[1]) manifestPlaceholders[m[1]] = m[2] ?? ''
  }

  return {
    id: `product-flavor:${sub.name}`,
    name: sub.name,
    dimension: dimensionValue?.resolved ? dimensionValue.value : null,
    source: sourceRef(file, fullText, offset),
    applicationId: getString('applicationId', 'applicationId'),
    applicationIdSuffix: getString('applicationIdSuffix', 'applicationIdSuffix'),
    versionNameSuffix: getString('versionNameSuffix', 'versionNameSuffix'),
    minSdk: getNumber('minSdk(?:Version)?', 'minSdk'),
    targetSdk: getNumber('targetSdk(?:Version)?', 'targetSdk'),
    manifestPlaceholders,
  }
}

function parseSourceSetOverride(
  sub: { name: string; content: string; start: number },
  file: string,
  fullText: string,
  parentOffset: number
): AndroidGradleSourceSetOverride {
  const offset = parentOffset + sub.start
  const manifestMatch = sub.content.match(/manifest\s*\.\s*srcFile\s*\(?\s*['"]([^'"]+)['"]\s*\)?/)
  const collectDirs = (propertyPattern: string) => {
    const results = new Set<string>()
    const pattern = new RegExp(`\\b${propertyPattern}\\s*\\.\\s*srcDirs?\\s*(?:\\+?=)?\\s*\\(?\\s*\\[?([^)\\]\\n]*)\\]?\\)?`, 'g')
    for (const m of sub.content.matchAll(pattern)) {
      for (const sm of (m[1] ?? '').matchAll(QUOTED_STRING_PATTERN)) results.add(sm[1]!)
    }
    return [...results].sort()
  }

  return {
    name: sub.name,
    manifestSrcFile: manifestMatch?.[1] ?? null,
    javaSrcDirs: collectDirs('java'),
    kotlinSrcDirs: collectDirs('kotlin'),
    resSrcDirs: collectDirs('res'),
    assetsSrcDirs: collectDirs('assets'),
    aidlSrcDirs: collectDirs('aidl'),
    source: sourceRef(file, fullText, offset),
  }
}

// ---------------------------------------------------------------------------
// Version catalog (`gradle/libs.versions.toml`) evidence — minimal bounded
// TOML subset parser covering exactly the shapes libs.versions.toml uses:
// `[section]` headers, `key = "value"`, and single-line inline tables
// `key = { a = "x", b = "y" }`. No external TOML dependency is required for
// this bounded shape.
// ---------------------------------------------------------------------------

function parseInlineTable(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  const inner = raw.trim().replace(/^\{/, '').replace(/\}$/, '')
  const pairPattern = /([\w.-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[\w.]+)/g
  for (const m of inner.matchAll(pairPattern)) {
    const key = m[1]!
    const value = m[2]!
    const stringMatch = value.match(LITERAL_STRING_PATTERN)
    result[key] = stringMatch ? stringMatch[1] ?? stringMatch[2] ?? '' : value
  }
  return result
}

export function parseVersionCatalogToml(tomlText: string, file: string): AndroidGradleVersionCatalog {
  const warnings: string[] = []
  const versions: AndroidGradleVersionCatalogVersion[] = []
  const libraries: AndroidGradleVersionCatalogLibrary[] = []
  const bundles: AndroidGradleVersionCatalogBundle[] = []
  const plugins: AndroidGradleVersionCatalogPlugin[] = []

  const sections = splitTomlSections(tomlText)

  for (const entry of sections.versions) {
    const stringMatch = entry.value.match(LITERAL_STRING_PATTERN)
    if (stringMatch) {
      versions.push({ key: entry.key, value: stringMatch[1] ?? stringMatch[2] ?? '', raw: entry.value, warning: null })
    } else {
      const warning = `Version "${entry.key}" is not a static string literal.`
      versions.push({ key: entry.key, value: null, raw: entry.value, warning })
      warnings.push(warning)
    }
  }

  for (const entry of sections.libraries) {
    const parsed = parseCatalogLibraryEntry(entry.key, entry.value)
    libraries.push(parsed)
    if (parsed.warning) warnings.push(parsed.warning)
  }

  for (const entry of sections.bundles) {
    const members = [...entry.value.matchAll(QUOTED_STRING_PATTERN)].map((m) => m[1]!).sort()
    bundles.push({ alias: entry.key, libraries: members })
  }

  for (const entry of sections.plugins) {
    const parsed = parseCatalogPluginEntry(entry.key, entry.value)
    plugins.push(parsed)
    if (parsed.warning) warnings.push(parsed.warning)
  }

  return {
    file,
    versions: versions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    libraries: libraries.sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0)),
    bundles: bundles.sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0)),
    plugins: plugins.sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0)),
    warnings: [...new Set(warnings)].sort(),
  }
}

interface TomlKeyValue {
  key: string
  value: string
}

function splitTomlSections(tomlText: string): {
  versions: TomlKeyValue[]
  libraries: TomlKeyValue[]
  bundles: TomlKeyValue[]
  plugins: TomlKeyValue[]
} {
  const sectionNames = ['versions', 'libraries', 'bundles', 'plugins'] as const
  const result: Record<(typeof sectionNames)[number], TomlKeyValue[]> = {
    versions: [],
    libraries: [],
    bundles: [],
    plugins: [],
  }

  const lines = tomlText.split('\n')
  let currentSection: (typeof sectionNames)[number] | null = null
  let pendingKey: string | null = null
  let pendingValue = ''
  let depth = 0

  const flushPending = () => {
    if (pendingKey && currentSection) {
      result[currentSection].push({ key: pendingKey, value: pendingValue.trim() })
    }
    pendingKey = null
    pendingValue = ''
    depth = 0
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (depth === 0) {
      if (line === '' || line.startsWith('#')) continue
      const sectionMatch = line.match(/^\[([\w.-]+)\]$/)
      if (sectionMatch) {
        flushPending()
        const name = sectionMatch[1] as (typeof sectionNames)[number]
        currentSection = sectionNames.includes(name) ? name : null
        continue
      }
      if (!currentSection) continue
      const kvMatch = line.match(/^([\w.-]+)\s*=\s*(.*)$/)
      if (!kvMatch) continue
      flushPending()
      pendingKey = kvMatch[1]!
      pendingValue = kvMatch[2]!
      depth += (pendingValue.match(/\{/g) ?? []).length - (pendingValue.match(/\}/g) ?? []).length
      if (depth <= 0) {
        flushPending()
      }
    } else {
      pendingValue += `\n${line}`
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
      if (depth <= 0) flushPending()
    }
  }
  flushPending()

  return result
}

function parseCatalogLibraryEntry(alias: string, value: string): AndroidGradleVersionCatalogLibrary {
  const stringMatch = value.match(LITERAL_STRING_PATTERN)
  if (stringMatch) {
    const coordinate = stringMatch[1] ?? stringMatch[2] ?? ''
    const parts = coordinate.split(':')
    if (parts.length >= 3) {
      return {
        alias,
        group: parts[0]!,
        name: parts[1]!,
        module: `${parts[0]}:${parts[1]}`,
        versionRef: null,
        version: parts.slice(2).join(':'),
        warning: null,
      }
    }
    return { alias, group: null, name: null, module: null, versionRef: null, version: null, warning: `Library "${alias}" coordinate string is not group:artifact:version.` }
  }

  const table = parseInlineTable(value)
  const module = table['module'] ?? null
  const group = table['group'] ?? (module ? module.split(':')[0] ?? null : null)
  const name = table['name'] ?? (module ? module.split(':')[1] ?? null : null)
  const versionRef = table['version.ref'] ?? null
  const version = versionRef ? null : table['version'] ?? null

  if (!module && !group) {
    return { alias, group: null, name: null, module: null, versionRef, version, warning: `Library "${alias}" entry has no statically recognizable module/group.` }
  }

  return { alias, group, name, module: module ?? (group && name ? `${group}:${name}` : null), versionRef, version, warning: null }
}

function parseCatalogPluginEntry(alias: string, value: string): AndroidGradleVersionCatalogPlugin {
  const table = parseInlineTable(value)
  const id = table['id'] ?? null
  const versionRef = table['version.ref'] ?? null
  const version = versionRef ? null : table['version'] ?? null
  if (!id) {
    return { alias, id: null, versionRef, version, warning: `Plugin "${alias}" entry has no statically recognizable id.` }
  }
  return { alias, id, versionRef, version, warning: null }
}
