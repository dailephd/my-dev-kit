import * as fs from 'node:fs'
import * as path from 'node:path'
import type { GraphSlice } from './graphSliceTypes.js'

export function writeGraphSlice(outputPath: string, slice: GraphSlice): string {
  const resolved = path.resolve(outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(slice, null, 2)}\n`, 'utf8')
  return resolved.replace(/\\/g, '/')
}
