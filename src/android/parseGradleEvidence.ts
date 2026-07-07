/**
 * Conservative, regex-based static evidence extraction from Gradle files.
 *
 * Deliberately not a Groovy/Kotlin-DSL parser: it never builds an AST and
 * never evaluates build-script logic. It only recognizes the literal
 * syntactic forms explicitly called out as in-scope evidence. Anything else
 * (programmatic module loops, version-catalog plugin aliases, custom
 * `projectDir` remaps) is silently not captured — never throws, never
 * guesses.
 */

import type { AndroidModuleType } from './androidProjectTypes.js'

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
