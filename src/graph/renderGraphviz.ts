import { spawnSync } from 'node:child_process'

export function isGraphvizAvailable(): boolean {
  const result = spawnSync('dot', ['-V'], { encoding: 'utf8', shell: false })
  return result.status === 0
}

export function renderGraphviz(dotText: string, format: 'svg' | 'png'): Buffer {
  const result = spawnSync('dot', [`-T${format}`], {
    input: dotText,
    encoding: format === 'svg' ? 'utf8' : 'buffer',
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.error) throw new Error(`Graphviz dot failed: ${result.error.message}`)
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr : result.stderr?.toString('utf8')
    throw new Error(`Graphviz dot failed with exit code ${result.status}: ${stderr ?? ''}`.trim())
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'utf8')
}
