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

/** v1.13.0 D2-D: maximum physical lines and characters a declaration-header read may return. */
export const MAX_DECLARATION_HEADER_LINES = 12
export const MAX_DECLARATION_HEADER_CHARS = 1500

export interface BoundedDeclarationHeader {
  /** Header text from `startLine`, at most `MAX_DECLARATION_HEADER_LINES` lines and `MAX_DECLARATION_HEADER_CHARS` characters. */
  text: string
  startLine: number
  endLine: number
  /** True when the file continues past the returned window (the header may be longer than what was read). */
  truncated: boolean
}

/**
 * v1.13.0 D2-D: small, bounded read of a declaration header starting at an
 * already-indexed declaration line. Reuses the same project-root containment
 * as `readBoundedSourceBody` but is not brace-aware: the caller decides where
 * the header ends and must treat `truncated` as "unknown". Never reads a whole
 * file into the result and never searches the file.
 */
export function readBoundedDeclarationHeader(projectRoot: string, filePath: string, startLine: number): BoundedDeclarationHeader | null {
  try {
    const absolutePath = ensureInsideProjectRoot(projectRoot, filePath)
    if (!fs.existsSync(absolutePath)) return null
    const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
    const startIndex = startLine - 1
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= lines.length) return null
    const collected: string[] = []
    let chars = 0
    let truncated = false
    for (let i = startIndex; i < lines.length; i++) {
      if (collected.length >= MAX_DECLARATION_HEADER_LINES) {
        truncated = true
        break
      }
      const line = lines[i] as string
      if (chars + line.length + 1 > MAX_DECLARATION_HEADER_CHARS) {
        truncated = true
        break
      }
      collected.push(line)
      chars += line.length + 1
    }
    if (collected.length === 0) return null
    return { text: collected.join('\n'), startLine, endLine: startLine + collected.length - 1, truncated }
  } catch {
    return null
  }
}
