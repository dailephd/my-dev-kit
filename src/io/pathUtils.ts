/**
 * Shared path helpers for generator scripts.
 *
 * All functions are pure (no I/O) and operate on path strings only.
 * Filesystem existence checks belong in fileSystem.ts, not here.
 */

import * as path from 'path'

/**
 * Converts all backslashes in a path to forward slashes.
 * Useful for producing consistent cross-platform output paths.
 */
export function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Resolves a path relative to the given repo root.
 * If the given path is already absolute, it is normalized and returned as-is.
 * Always returns a forward-slash path.
 */
export function resolveFromRoot(
  repoRoot: string,
  relativePath: string
): string {
  if (path.isAbsolute(relativePath)) {
    return toForwardSlash(path.normalize(relativePath))
  }
  return toForwardSlash(path.resolve(repoRoot, relativePath))
}

/**
 * Returns true if `target` is located inside `root` (or is `root` itself).
 * Both paths are resolved to absolute before comparison so relative inputs
 * work correctly regardless of the current working directory.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const absRoot = path.resolve(root)
  const absTarget = path.resolve(target)
  const rel = path.relative(absRoot, absTarget)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Joins path segments and normalizes to forward slashes.
 * Thin wrapper around `path.join` for consistent cross-platform output.
 */
export function joinPath(...segments: string[]): string {
  return toForwardSlash(path.join(...segments))
}

/**
 * Builds a safe output path by joining `outputRoot` and `subPath`.
 *
 * Throws if the resulting path would escape the output root directory.
 * This is the canonical path-traversal guard for output construction —
 * use it whenever a subpath comes from external input (config files,
 * CLI arguments, user-provided template names) and the write destination
 * must stay inside a known root.
 *
 * Compare with `resolveFromRoot`, which resolves INPUT paths; this function
 * guards OUTPUT paths.
 */
export function buildOutputPath(outputRoot: string, subPath: string): string {
  const full = joinPath(outputRoot, subPath)
  if (!isInsideRoot(outputRoot, full)) {
    throw new Error(
      `Output path "${subPath}" would escape the output root "${outputRoot}"`
    )
  }
  return full
}

