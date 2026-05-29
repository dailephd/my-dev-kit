import * as fs from 'node:fs'
import * as path from 'node:path'

export function writeGraphView(outputPath: string, content: string | Buffer): string {
  const resolved = path.resolve(outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content)
  return resolved.replace(/\\/g, '/')
}
