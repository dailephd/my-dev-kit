/**
 * Shared filesystem helpers for generator scripts.
 *
 * Side effects are intentional and explicit here — this module is the
 * single place where generator scripts perform actual I/O.
 * Application logic must not be embedded in these helpers.
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * Reads a UTF-8 text file and returns its contents as a string.
 * Throws with a descriptive message if the file cannot be read.
 */
export function readTextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(
      `Failed to read file "${filePath}": ${(err as Error).message}`
    )
  }
}

/**
 * Writes `content` to a UTF-8 text file.
 * Creates parent directories automatically if they do not exist.
 * Throws with a descriptive message on failure.
 */
export function writeTextFile(filePath: string, content: string): void {
  try {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, content, 'utf-8')
  } catch (err) {
    throw new Error(
      `Failed to write file "${filePath}": ${(err as Error).message}`
    )
  }
}

/**
 * Writes `content` to a file only when the existing content differs.
 * Returns `true` if the file was written, `false` if it was unchanged.
 *
 * Useful for avoiding unnecessary filesystem churn when regenerating docs.
 */
export function writeTextFileIfChanged(
  filePath: string,
  content: string
): boolean {
  if (pathExists(filePath)) {
    const existing = readTextFile(filePath)
    if (existing === content) {
      return false
    }
  }
  writeTextFile(filePath, content)
  return true
}

/**
 * Ensures that a directory and all its parent directories exist.
 * No-ops silently if the directory is already present.
 * Throws with a descriptive message on failure.
 */
export function ensureDir(dirPath: string): void {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
  } catch (err) {
    throw new Error(
      `Failed to create directory "${dirPath}": ${(err as Error).message}`
    )
  }
}

/**
 * Returns `true` if a file or directory exists at the given path.
 */
export function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

/**
 * Returns `true` if the path exists and refers to a directory.
 */
export function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

/**
 * Lists all regular files (non-recursive) within a directory.
 * Returns an empty array if the directory does not exist or is not a directory.
 * Throws with a descriptive message on unexpected read failures.
 */
export function listFiles(dirPath: string): string[] {
  if (!pathExists(dirPath) || !isDirectory(dirPath)) {
    return []
  }
  try {
    return fs.readdirSync(dirPath).filter((entry) => {
      return fs.statSync(path.join(dirPath, entry)).isFile()
    })
  } catch (err) {
    throw new Error(
      `Failed to list files in "${dirPath}": ${(err as Error).message}`
    )
  }
}

