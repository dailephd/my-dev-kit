import * as fs from 'node:fs'
import { ensureInsideProjectRoot } from '../lookup/getSourceSlice.js'

/**
 * v1.12.0 Batch 3: extracted from `detectAndroidComponents.ts`'s Retrofit-service
 * body scan (v1.9.0 Batch 4) into a shared helper, reused unchanged by
 * component-dependency extraction (`detectAndroidComponentDependencies.ts`) so
 * both scans share the same bounded line cap, brace-depth termination, and
 * path-boundary safety - never a second unbounded source scanner.
 */
export const MAX_BODY_SCAN_LINES = 400

export function readBoundedSourceBody(projectRoot: string, filePath: string, startLine: number): string | null {
  try {
    const absolutePath = ensureInsideProjectRoot(projectRoot, filePath)
    if (!fs.existsSync(absolutePath)) return null
    const sourceText = fs.readFileSync(absolutePath, 'utf8')
    const lines = sourceText.split(/\r?\n/)
    const startIndex = startLine - 1
    if (startIndex < 0 || startIndex >= lines.length) return null

    let depth = 0
    let sawOpenBrace = false
    const collected: string[] = []
    for (let i = startIndex; i < lines.length && collected.length < MAX_BODY_SCAN_LINES; i++) {
      const line = lines[i]
      collected.push(line)
      for (const char of line) {
        if (char === '{') {
          depth += 1
          sawOpenBrace = true
        } else if (char === '}') {
          depth -= 1
        }
      }
      if (sawOpenBrace && depth <= 0) break
    }
    return collected.join('\n')
  } catch {
    return null
  }
}
