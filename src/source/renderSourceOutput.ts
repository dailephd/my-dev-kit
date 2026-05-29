import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import type { SourceSlice } from '../lookup/sourceSliceTypes.js'

export type SourceOutputFormat = 'json' | 'plain' | 'numbered'

export function parseSourceOutputFormat(value: string): SourceOutputFormat {
  if (value === 'json' || value === 'plain' || value === 'numbered') return value
  throw new Error(`Unsupported --format value "${value}". Supported values: json, plain, numbered.`)
}

export function renderSourceOutput(result: SourceSlice, format: SourceOutputFormat): string {
  if (format === 'json') return JSON.stringify(result, null, 2) + '\n'
  if (format === 'plain') return result.content.endsWith('\n') ? result.content : result.content + '\n'
  return renderNumberedSource(result.content, result.startLine)
}

export function renderNumberedSource(content: string, startLine: number): string {
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const lastLine = startLine + lines.length - 1
  const width = String(lastLine).length
  const numbered = lines.map((line, i) => {
    const num = String(startLine + i).padStart(width)
    return `${num} | ${line}`
  })
  return numbered.join('\n') + '\n'
}

export function writeSourceOutput(outputPath: string, rendered: string): string {
  const resolved = path.resolve(outputPath)
  mkdirSync(path.dirname(resolved), { recursive: true })
  writeFileSync(resolved, rendered, 'utf8')
  return resolved
}
