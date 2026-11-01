import { describe, it, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as cp from 'node:child_process'
import { join } from 'node:path'
import { helper } from './fixtures/helper'

const DETECTOR_ID = 'dup-impl'
const OVERSIZED_ID = 'x'.repeat(10)

export const detectors = { alpha: 1, 'beta-check': 2 }
export const first = { id: 'detector-one' }
export const second = { id: 'detector-one' }
export const bound = { detectorId: DETECTOR_ID }

// it('commented title') and npm run commented
const text = "describe('inside a string')"

describe('suite', () => {
  it('runs a case', () => {
    helper()
  })
  it.skip('skipped case', () => {})
  test.only('focused case', () => {})
  const command = 'npm run build:docs'
  const fixturePath = join(__dirname, 'fixtures', 'sample.json')
  spawnSync('git', ['status'], { shell: true })
  cp.exec('ls')
  const lines = command.split('\n')
  const parts = command.split('\\')
  const slashes = command.split('/')
})

export { text, fixturePath as unusedAlias }
