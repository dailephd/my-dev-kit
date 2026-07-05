import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeRetrievalRegressionReport } from '../../src/retrievalRegression/reportWriter.js'
import { sampleReport } from './reportFixtures.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function tmpOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-retrieval-regression-report-'))
  tempDirs.push(dir)
  return dir
}

describe('writeRetrievalRegressionReport', () => {
  it('writes retrieval-regression-report.json with matching content', () => {
    const outDir = tmpOutDir()
    const report = sampleReport()
    const paths = writeRetrievalRegressionReport(outDir, report)

    expect(existsSync(paths.jsonReportPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(paths.jsonReportPath, 'utf8'))
    expect(parsed.suiteId).toBe('sample-suite')
    expect(parsed.verdict).toBe('PASS')
    expect(parsed.tasks).toHaveLength(1)
  })

  it('writes retrieval-regression-report.txt with suite/verdict/task lines', () => {
    const outDir = tmpOutDir()
    const report = sampleReport()
    const paths = writeRetrievalRegressionReport(outDir, report)

    expect(existsSync(paths.txtReportPath)).toBe(true)
    const text = readFileSync(paths.txtReportPath, 'utf8')
    expect(text).toContain('sample-suite')
    expect(text).toContain('Verdict: PASS')
    expect(text).toContain('sample-task')
  })

  it('does not include raw content in either report', () => {
    const outDir = tmpOutDir()
    const report = sampleReport()
    const paths = writeRetrievalRegressionReport(outDir, report)

    const jsonText = readFileSync(paths.jsonReportPath, 'utf8')
    const txtText = readFileSync(paths.txtReportPath, 'utf8')
    expect(jsonText).not.toContain('"content":')
    expect(txtText).not.toContain('"content":')
    // No single field should be large enough to plausibly be a raw file/graph dump.
    const parsed = JSON.parse(jsonText)
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string') expect(value.length).toBeLessThan(2000)
    }
  })

  it('creates the output directory when it does not exist', () => {
    const outDir = join(tmpOutDir(), 'nested', 'dir')
    const report = sampleReport()
    const paths = writeRetrievalRegressionReport(outDir, report)
    expect(existsSync(paths.jsonReportPath)).toBe(true)
  })
})
