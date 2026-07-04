import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { VERSION } from '../version.js'
import type { AuditStep, ContextCapsuleRequest, RetrievalAuditRecord } from './types.js'

export interface BuildRetrievalAuditRecordOptions {
  resolved: ResolvedIndexManifest
  request: ContextCapsuleRequest
  steps: AuditStep[]
}

export function buildRetrievalAuditRecord(options: BuildRetrievalAuditRecordOptions): RetrievalAuditRecord {
  const { resolved, request, steps } = options
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    tool: { name: 'my-dev-kit', version: VERSION },
    request,
    index: {
      indexPath: toForwardSlash(resolved.indexDir),
      manifestPath: toForwardSlash(resolved.manifestPath),
    },
    steps,
    fallbacks: [],
    fullFileReadRecommendations: [],
    warnings: [],
    contextAdequacy: {
      status: 'context sufficient with listed assumptions',
      summary: 'Batch 1 capsule includes request and index/artifact summaries only.',
      assumptions: [
        'No graph focus, source bundles, or ranked candidates are selected yet.',
      ],
      gaps: [],
    },
  }
}

export function writeRetrievalAuditRecord(outputPath: string, record: RetrievalAuditRecord): string {
  const resolved = path.resolve(outputPath)
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new Error(`Failed to write retrieval audit record to ${outputPath}: ${(error as Error).message}`)
  }
  return toForwardSlash(resolved)
}
