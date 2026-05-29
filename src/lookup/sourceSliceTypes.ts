export type SourceSliceMode = 'line-range' | 'symbol' | 'node'

export interface SourceSlice {
  status: 'ok'
  mode: SourceSliceMode
  indexDir: string
  filePath: string
  absolutePath: string
  symbolName: string | null
  startLine: number
  endLine: number
  lineCount: number
  content: string
  warnings: string[]
}

export interface SourceTarget {
  mode: SourceSliceMode
  filePath: string
  symbolName?: string
  startLine?: number
  endLine?: number
  warnings: string[]
}
