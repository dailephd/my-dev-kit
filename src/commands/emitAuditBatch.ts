import type { Command } from 'commander'

export function assertAuditBatchOptions(command: Command, options: { json?: boolean }): void {
  const allowed = new Set(['index', 'auditBatchFile', 'json'])
  if (!options.json || Object.keys(options).some(key => !allowed.has(key) && command.getOptionValueSource(key) === 'cli')) {
    throw new Error('INVALID_AUDIT_BATCH_SELECTOR: --audit-batch-file requires --json and excludes all other selectors and output options.')
  }
}

export async function emitAuditBatch({ json, complete }: { json: string; complete: boolean }): Promise<void> {
  if (!complete) process.exitCode = 2
  await new Promise<void>((resolve, reject) => {
    process.stdout.once('error', reject)
    process.stdout.write(json, error => {
      if (error) {
        reject(error)
      } else {
        process.stdout.removeListener('error', reject)
        resolve()
      }
    })
  })
}
