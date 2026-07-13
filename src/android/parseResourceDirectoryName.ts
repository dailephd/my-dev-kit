/**
 * Conservative parser for Android resource-directory names
 * (`values-es-rUS-night-v31`, `drawable-hdpi`, `layout-land`, ...).
 *
 * Recognizes the common qualifier categories the batch contract calls out
 * (locale, night mode, API level, density, orientation, smallest-width/
 * width/height) and preserves everything else as `unrecognized` raw
 * segments. Deliberately does not reimplement Android's full qualifier
 * grammar, ordering rules, or device-configuration matching — this is
 * static evidence preservation, not a resource-selection engine.
 */

import type { AndroidResourceBaseType, AndroidResourceDirectoryQualifierInfo, AndroidResourceQualifiers } from './androidResourceTypes.js'

const KNOWN_BASE_TYPES: readonly AndroidResourceBaseType[] = [
  'values',
  'layout',
  'drawable',
  'mipmap',
  'xml',
  'raw',
  'menu',
  'anim',
  'animator',
  'color',
  'font',
  'navigation',
]

const DENSITY_QUALIFIERS = new Set(['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi', 'nodpi', 'tvdpi', 'anydpi'])

export function parseResourceDirectoryName(rawDirectoryName: string): AndroidResourceDirectoryQualifierInfo {
  const segments = rawDirectoryName.split('-').filter(Boolean)
  const baseSegment = segments[0] ?? ''
  const baseType: AndroidResourceBaseType = (KNOWN_BASE_TYPES as string[]).includes(baseSegment)
    ? (baseSegment as AndroidResourceBaseType)
    : 'unknown'
  const qualifierSegments = segments.slice(1)

  const qualifiers = parseQualifierSegments(qualifierSegments)

  return { baseType, rawDirectoryName, qualifiers }
}

function parseQualifierSegments(segments: string[]): AndroidResourceQualifiers {
  const unrecognized: string[] = []
  let locale: string | null = null
  let nightMode: 'night' | 'notnight' | null = null
  let apiLevel: number | null = null
  let density: string | null = null
  let orientation: 'land' | 'port' | null = null
  let smallestWidthDp: number | null = null
  let widthDp: number | null = null
  let heightDp: number | null = null

  let i = 0
  while (i < segments.length) {
    const segment = segments[i]!

    if (segment === 'night' || segment === 'notnight') {
      nightMode = segment
      i++
      continue
    }
    if (segment === 'land' || segment === 'port') {
      orientation = segment
      i++
      continue
    }
    if (DENSITY_QUALIFIERS.has(segment)) {
      density = segment
      i++
      continue
    }
    const apiMatch = /^v(\d+)$/.exec(segment)
    if (apiMatch) {
      apiLevel = Number(apiMatch[1])
      i++
      continue
    }
    const swMatch = /^sw(\d+)dp$/.exec(segment)
    if (swMatch) {
      smallestWidthDp = Number(swMatch[1])
      i++
      continue
    }
    const wMatch = /^w(\d+)dp$/.exec(segment)
    if (wMatch) {
      widthDp = Number(wMatch[1])
      i++
      continue
    }
    const hMatch = /^h(\d+)dp$/.exec(segment)
    if (hMatch) {
      heightDp = Number(hMatch[1])
      i++
      continue
    }
    // BCP47 locale form: b+lang[+SCRIPT][+REGION]
    if (segment.startsWith('b+')) {
      const rest = segments.slice(i).join('-')
      const bcp47Match = /^b\+[A-Za-z0-9+]+/.exec(rest)
      if (bcp47Match) {
        locale = bcp47Match[0]
        i++
        continue
      }
    }
    // Region form: rXX immediately following a 2-3 letter language segment.
    const regionMatch = /^r([A-Z]{2,3})$/.exec(segment)
    if (regionMatch && locale && /^[a-z]{2,3}$/.test(locale)) {
      locale = `${locale}-r${regionMatch[1]}`
      i++
      continue
    }
    // Language form: 2-3 lowercase letters, only treated as locale when not
    // already consumed as something else and it's the qualifier immediately
    // following the base type (locale is conventionally first).
    if (/^[a-z]{2,3}$/.test(segment) && locale === null) {
      locale = segment
      i++
      continue
    }

    unrecognized.push(segment)
    i++
  }

  return {
    raw: segments,
    locale,
    nightMode,
    apiLevel,
    density,
    orientation,
    smallestWidthDp,
    widthDp,
    heightDp,
    unrecognized,
  }
}
