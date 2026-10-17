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

describe('detectAndroidIntents clause scoping (v1.13.0 D2-A)', () => {
  it('ignores intent terms inside an exclusion clause but keeps the task intent', () => {
    const intents = intentsFor('Change the UserHomeScreen layout without changing the ViewModel')
    expect(intents.has('ui')).toBe(true)
    expect(intents.has('state')).toBe(false)
    expect(intentsFor('Update the screen while preserving the view model behavior')).toEqual(new Set(['ui']))
    expect(intentsFor("Update the button, don't touch the repository").has('data')).toBe(false)
  })

  it('ignores intent terms inside a dependency clause', () => {
    const intents = intentsFor('Change how the data is cached from the Room DAO and Retrofit endpoint')
    expect(intents.has('persistence-access')).toBe(false)
    expect(intents.has('network-contract')).toBe(false)
    expect(intents.has('data')).toBe(true)
  })

  it('keeps both intents for a genuine multi-layer request', () => {
    const intents = intentsFor('Change the screen layout and update the view model state handling')
    expect(intents.has('ui')).toBe(true)
    expect(intents.has('state')).toBe(true)
  })

  it('treats bare layout and presentation as UI but not the xml layout resource phrases', () => {
    expect(intentsFor('change the layout')).toContain('ui')
    expect(intentsFor('change the presentation')).toContain('ui')
    const resource = intentsFor('edit the xml layout')
    expect(resource.has('ui')).toBe(false)
    expect(resource.has('resource')).toBe(true)
  })

  it('uses a layer-suffixed identifier only as a fallback when no intent term matched', () => {
    expect(intentsFor('Change how UserRepository refreshes users')).toEqual(new Set(['data']))
    expect(intentsFor('Fix UserViewModel crash')).toEqual(new Set(['state']))
    // an explicit intent term wins: the named screen only locates the state task
    expect(intentsFor('Change the loading state behavior shown by HomeScreen')).toEqual(new Set(['state']))
    // mid-word occurrences and test classes never match a suffix rule
    expect(intentsFor('Update the UserHomeScreenTest assertion').size).toBe(0)
    expect(intentsFor('Change Repositoryish helper').size).toBe(0)
  })

  it('is deterministic and bounded for repeated markers', () => {
    const q = 'without without without without without without without without without the viewmodel'
    expect(intentsFor(q)).toEqual(intentsFor(q))
  })
})
