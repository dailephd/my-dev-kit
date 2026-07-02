import type { SourceBundle, SourceExpansionBlock, SkippedBlock } from './sourceBundleTypes.js'

export function renderSourceBundle(bundle: SourceBundle, format: 'json' | 'numbered'): string {
  if (format === 'json') return renderSourceBundleJson(bundle)
  return renderSourceBundleNumbered(bundle)
}

export function renderSourceBundleJson(bundle: SourceBundle): string {
  return JSON.stringify(bundle, null, 2) + '\n'
}

export function renderSourceBundleNumbered(bundle: SourceBundle): string {
  const out: string[] = []

  const allBlocks = [bundle.primaryBlock, ...bundle.expansionBlocks]
  for (const block of allBlocks) {
    out.push(renderBlockHeader(block))
    out.push(renderNumberedContent(block.content, block.startLine))
    out.push('')
  }

  if (bundle.skippedBlocks.length > 0) {
    out.push('--- Skipped Blocks ---')
    for (const s of bundle.skippedBlocks) {
      out.push(renderSkipped(s))
    }
    out.push('')
  }

  if (bundle.warnings.length > 0) {
    out.push('--- Warnings ---')
    for (const w of bundle.warnings) out.push(`  ${w}`)
    out.push('')
  }

  const cursor = bundle.continuationCursors[0]
  if (cursor) {
    if (cursor.exhausted) {
      out.push(`[EOF: ${cursor.filePath} (${cursor.previousEndLine} lines total)]`)
    } else {
      out.push(`[CONTINUE: ${cursor.filePath} from line ${cursor.nextStartLine} (reason: ${cursor.reason})]`)
    }
    out.push('')
  }

  return out.join('\n')
}

function renderBlockHeader(block: SourceExpansionBlock): string {
  const reasons = block.expansionReasons.join(', ')
  return `=== [${block.kind}] ${block.filePath}:${block.startLine}-${block.endLine} (${block.lineCount} lines) — ${reasons} ===`
}

function renderNumberedContent(content: string, startLine: number): string {
  if (!content) return ''
  const lines = content.split('\n')
  return lines
    .map((line, i) => {
      const lineNum = startLine + i
      const pad = String(lineNum).padStart(4, ' ')
      return `${pad}\t${line}`
    })
    .join('\n')
}

function renderSkipped(s: SkippedBlock): string {
  const loc = s.filePath ? ` @ ${s.filePath}${s.sourceStart ? `:${s.sourceStart}` : ''}` : ''
  const owner = s.owner ? ` (owner: ${s.owner})` : ''
  return `  [SKIPPED:${s.kind}${loc}${owner}] ${s.reason} (${s.reasonCode})`
}
