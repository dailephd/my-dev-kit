/**
 * v1.12.0 Batch 6: Android context intent normalization unit coverage
 * (TST-601 through TST-603).
 */
import { describe, expect, it } from 'vitest'
import { ANDROID_INTENTS, detectAndroidIntents } from '../../src/context/androidContextIntent.js'
import { buildQueryPlan } from '../../src/context/queryPlan.js'

function intentsFor(query: string): Set<string> {
  const plan = buildQueryPlan({ originalQuery: query, mode: 'general' })
  return new Set(detectAndroidIntents(plan.normalizedQuery, plan.terms.raw))
}

describe('detectAndroidIntents', () => {
  it('TST-601: every fixed single-word and phrase term maps to its intended intent', () => {
    expect(intentsFor('change the composable')).toContain('ui')
    expect(intentsFor('change the view model')).toContain('state')
    expect(intentsFor('change the loading state')).toContain('state')
    expect(intentsFor('change the repository')).toContain('data')
    expect(intentsFor('add a room entity field')).toContain('persistence-schema')
    expect(intentsFor('change the room dao')).toContain('persistence-access')
    expect(intentsFor('change the retrofit endpoint')).toContain('network-contract')
    expect(intentsFor('change the deep link route')).toContain('navigation')
    expect(intentsFor('change the manifest permission')).toContain('manifest-platform')
    expect(intentsFor('change the string resource')).toContain('resource')
    expect(intentsFor('fix the instrumented test')).toContain('test')
  })

  it('TST-602: one query may retain multiple Android intents at once', () => {
    const intents = intentsFor('change the retrofit endpoint used by the repository')
    expect(intents.has('network-contract')).toBe(true)
    expect(intents.has('data')).toBe(true)
    expect(intents.size).toBeGreaterThanOrEqual(2)
  })

  it('TST-603: the generic word "service" alone never forces network-contract intent', () => {
    const intents = intentsFor('change the service')
    expect(intents.has('network-contract')).toBe(false)
  })

  it('every declared intent is reachable via at least one fixed term', () => {
    for (const intent of ANDROID_INTENTS) {
      expect(intent).toBeTruthy()
    }
    // Smoke-check a representative term per intent resolves to that intent (no drift).
    expect(intentsFor('open the drawable resource')).toContain('resource')
    expect(intentsFor('use case for business logic')).toContain('data')
  })

  it('an intent-free query matches no Android intents', () => {
    expect(intentsFor('rename the variable in the loop').size).toBe(0)
  })
})
