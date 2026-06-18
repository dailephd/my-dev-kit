import { renderNumberedSource } from './renderSourceOutput.js'
import type { ExactMatchResult } from './findExactMatches.js'
import type { SourceOutputFormat } from './renderSourceOutput.js'

export function renderExactMatchResult(result: ExactMatchResult, format: SourceOutputFormat): string {
  if (format === 'json') return JSON.stringify(result, null, 2) + '\n'
  if (format === 'plain') return renderExactMatchPlain(result)
  return renderExactMatchNumbered(result)
}

function renderExactMatchPlain(result: ExactMatchResult): string {
  if (result.matchCount === 0) return `No matches found for: ${JSON.stringify(result.value)}\n`
  const lines: string[] = []
  for (const file of result.files) {
    lines.push(`FILE: ${file.filePath} (${file.matchCount} match${file.matchCount !== 1 ? 'es' : ''})`)
    for (const match of file.matches) {
      lines.push(`  -- line ${match.line}, col ${match.column}, kind: ${match.matchKind}`)
      if (match.nearestOwner) {
        lines.push(`  -- owner: ${match.nearestOwner.kind} "${match.nearestOwner.name}"`)
      }
      lines.push(match.content)
      lines.push('')
    }
  }
  if (result.truncated) {
    lines.push(`(Results truncated at ${result.limit} matches. Use a more specific query to narrow results.)`)
  }
  return lines.join('\n') + '\n'
}

function renderExactMatchNumbered(result: ExactMatchResult): string {
  if (result.matchCount === 0) return `No matches found for: ${JSON.stringify(result.value)}\n`
  const lines: string[] = []
  for (const file of result.files) {
    lines.push(`FILE: ${file.filePath} (${file.matchCount} match${file.matchCount !== 1 ? 'es' : ''})`)
    for (let i = 0; i < file.matches.length; i++) {
      const match = file.matches[i]
      lines.push(`  Match ${i + 1} — line ${match.line}, col ${match.column}, kind: ${match.matchKind}`)
      if (match.nearestOwner) {
        lines.push(`  Owner: ${match.nearestOwner.kind} "${match.nearestOwner.name}"`)
      }
      lines.push(renderNumberedSource(match.content, match.windowStart))
    }
  }
  if (result.truncated) {
    lines.push(`(Results truncated at ${result.limit} matches. Use a more specific query to narrow results.)`)
  }
  return lines.join('\n') + '\n'
}
