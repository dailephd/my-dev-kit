import { afterEach, describe, expect, it } from 'vitest'
import {
  extractStorageKeyFacts,
  extractUiReachabilityFacts,
} from '../../src/frontend-reachability/index.js'
import { buildFrontendFixture, cleanupReachabilityTempDirs } from './reachabilityTestHelpers.js'

afterEach(() => cleanupReachabilityTempDirs())

describe('extractUiReachabilityFacts', () => {
  it('extracts a data-testid marker with component ownership', () => {
    const { artifact } = buildFrontendFixture([
      {
        path: 'src/Form.tsx',
        content: `export function Form() {
  return <button data-testid="submit-button">Submit</button>
}
`,
      },
    ])
    const ui = extractUiReachabilityFacts({ frontendArtifact: artifact, storageKeys: [] })
    const submit = ui.find((u) => u.value === 'submit-button')
    expect(submit).toBeDefined()
    expect(submit?.markerKind).toBe('data-testid')
    expect(submit?.id).toBe('ui:data-testid:submit-button')
    expect(submit?.componentId).toBeTruthy()
  })

  it('assigns medium confidence to a marker with no test evidence', () => {
    const { artifact } = buildFrontendFixture([
      {
        path: 'src/Form.tsx',
        content: `export function Form() {
  return <button data-testid="lonely-button">x</button>
}
`,
      },
    ])
    const ui = extractUiReachabilityFacts({ frontendArtifact: artifact, storageKeys: [] })
    const lonely = ui.find((u) => u.value === 'lonely-button')
    expect(lonely?.confidence).toBe('medium')
    expect(lonely?.testEvidenceRefs).toHaveLength(0)
  })

  it('links a Playwright getByTestId locator as test evidence and raises confidence to high', () => {
    const { artifact } = buildFrontendFixture([
      {
        path: 'src/Form.tsx',
        content: `export function Form() {
  return <button data-testid="submit-button">Submit</button>
}
`,
      },
      {
        path: 'src/form.spec.ts',
        content: `import { test, expect } from '@playwright/test'
test('submits the form', async ({ page }) => {
  await page.getByTestId('submit-button').click()
})
`,
      },
    ])
    const ui = extractUiReachabilityFacts({ frontendArtifact: artifact, storageKeys: [] })
    const submit = ui.find((u) => u.value === 'submit-button')
    expect(submit?.testEvidenceRefs.length).toBeGreaterThanOrEqual(1)
    expect(submit?.testEvidenceRefs[0].locatorKind).toBe('getByTestId')
    expect(submit?.testEvidenceRefs[0].locatorValue).toBe('submit-button')
    expect(submit?.confidence).toBe('high')
  })

  it('extracts aria-label markers', () => {
    const { artifact } = buildFrontendFixture([
      {
        path: 'src/Dialog.tsx',
        content: `export function Dialog() {
  return <div aria-label="close dialog">x</div>
}
`,
      },
    ])
    const ui = extractUiReachabilityFacts({ frontendArtifact: artifact, storageKeys: [] })
    expect(ui.some((u) => u.markerKind === 'aria-label' && u.value === 'close dialog')).toBe(true)
  })

  it('returns markers sorted by markerKind then value', () => {
    const { artifact } = buildFrontendFixture([
      {
        path: 'src/Many.tsx',
        content: `export function Many() {
  return (
    <div aria-label="zeta">
      <button data-testid="beta">b</button>
      <button data-testid="alpha">a</button>
    </div>
  )
}
`,
      },
    ])
    const ui = extractUiReachabilityFacts({ frontendArtifact: artifact, storageKeys: [] })
    const ids = ui.map((u) => `${u.markerKind}:${u.value}`)
    const sorted = [...ids].sort((a, b) => a.localeCompare(b))
    expect(ids).toEqual(sorted)
  })

  it('starts gateStorageKeyIds and gateRouteIds empty (populated during edge building)', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Gate.tsx',
        content: `import { useState } from 'react'
export function Gate() {
  const [isLoggedIn] = useState(false)
  localStorage.getItem('auth_token')
  return <div data-testid="panel">{isLoggedIn ? 'in' : 'out'}</div>
}
`,
      },
    ])
    const storageKeys = extractStorageKeyFacts({ frontendArtifact: artifact, repoRoot })
    const ui = extractUiReachabilityFacts({ frontendArtifact: artifact, storageKeys })
    const panel = ui.find((u) => u.value === 'panel')
    expect(panel?.gateStorageKeyIds).toEqual([])
    expect(panel?.gateRouteIds).toEqual([])
  })
})
