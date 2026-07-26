import { describe, expect, it } from 'vitest'
import {
  buildRawEvidenceIndexIdentity,
  canonicalizeEvidenceIdentityPath,
} from '../../src/context/rawEvidenceIdentity.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'

describe('raw evidence canonical index identity', () => {
  it.each([
    ['c:\\Users\\Dev\\Repo\\', 'C:/Users/Dev/Repo'],
    ['C:/Users/Dev/Repo/.my-dev-kit/../.my-dev-kit/', 'C:/Users/Dev/Repo/.my-dev-kit'],
    ['C:\\Users\\Dev\\Repo With Spaces\\', 'C:/Users/Dev/Repo With Spaces'],
    ['/srv/Repo With Spaces/', '/srv/Repo With Spaces'],
    ['/srv/Repo/../repo', '/srv/repo'],
    ['relative\\index\\', 'relative/index'],
  ])('canonicalizes %s without discarding meaningful case or scope', (input, expected) => {
    expect(canonicalizeEvidenceIdentityPath(input)).toBe(expected)
  })

  it('preserves POSIX case distinctions', () => {
    expect(canonicalizeEvidenceIdentityPath('/srv/Repo')).not.toBe(
      canonicalizeEvidenceIdentityPath('/srv/repo')
    )
  })

  it('builds one frozen identity from validated manifest metadata', () => {
    const resolved = {
      indexDir: 'c:\\work\\repo\\.my-dev-kit\\',
      manifestPath: 'c:\\work\\repo\\.my-dev-kit\\manifest.json',
      manifest: {
        version: '1.0.0',
        projectRoot: 'c:\\work\\repo\\',
      },
    } as unknown as ResolvedIndexManifest

    const identity = buildRawEvidenceIndexIdentity(resolved)

    expect(identity).toEqual({
      projectRoot: 'C:/work/repo',
      indexPath: 'C:/work/repo/.my-dev-kit',
      manifestPath: 'C:/work/repo/.my-dev-kit/manifest.json',
      manifestSchemaVersion: '1.0.0',
    })
    expect(Object.isFrozen(identity)).toBe(true)
  })
})
