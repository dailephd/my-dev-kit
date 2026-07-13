/**
 * Minimal, bounded, non-executing XML parser for `AndroidManifest.xml`.
 *
 * Deliberately not a general-purpose XML library: no DTD/entity resolution,
 * no external-entity loading, no XPath, no schema validation. It only
 * recognizes the well-formed subset AndroidManifest.xml files actually use —
 * elements, attributes, comments, CDATA, and the XML declaration — and
 * reports a bounded parse error rather than throwing an uncaught exception
 * on malformed input. Chosen over adding a runtime XML dependency because
 * this bounded shape is small and the repository has no existing XML need
 * elsewhere (Batch 1 made the same call for `libs.versions.toml`/TOML).
 */

export interface XmlElement {
  type: 'element'
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  /**
   * Concatenated direct text-node content of this element (entity-decoded),
   * in document order but without regard to interleaving position relative
   * to child elements — a bounded compromise: string resources with simple
   * child markup (e.g. `<b>`) still expose their full text via `children`,
   * this field just isn't precisely interleaved with them. Added for Batch 3
   * resource-value parsing (`android-resources.json`); unused by Batch 2
   * manifest parsing, which never reads element text.
   */
  text: string
  line: number
  column: number
}

export interface ParseXmlResult {
  root: XmlElement | null
  error: string | null
}

const ATTR_PATTERN = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g

/**
 * Parses XML into a minimal element tree. Comments (`<!-- ... -->`), the
 * XML declaration (`<?xml ... ?>`), `<!DOCTYPE ...>`, and CDATA sections are
 * stripped/consumed but not represented as nodes — only elements and their
 * attributes matter for manifest evidence extraction.
 */
export function parseXml(text: string): ParseXmlResult {
  const stripped = stripNonElementConstructs(text)
  if (stripped === null) {
    return { root: null, error: 'Malformed XML: unterminated comment, CDATA section, or declaration.' }
  }

  const stack: XmlElement[] = []
  let root: XmlElement | null = null
  let cursor = 0

  const combinedPattern = /<\/[^\s>]+\s*>|<[^\s/!?>][^\s/>]*(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>/g
  let match: RegExpExecArray | null
  while ((match = combinedPattern.exec(stripped))) {
    const raw = match[0]
    const index = match.index

    if (index > cursor && stack.length > 0) {
      stack[stack.length - 1]!.text += decodeXmlEntities(stripped.slice(cursor, index))
    }
    cursor = combinedPattern.lastIndex

    if (raw.startsWith('</')) {
      const closeMatch = /^<\/([^\s>]+)\s*>$/.exec(raw)
      const closeName = closeMatch?.[1]
      if (!closeName) return { root: null, error: `Malformed closing tag at offset ${index}.` }
      const top = stack.pop()
      if (!top || top.name !== closeName) {
        return { root: null, error: `Mismatched closing tag </${closeName}> at offset ${index}.` }
      }
      continue
    }

    const openMatch = /^<([^\s/!?>][^\s/>]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/.exec(raw)
    if (!openMatch) return { root: null, error: `Malformed tag at offset ${index}.` }
    const [, name, attrsBlob, selfClose] = openMatch
    const attributes: Record<string, string> = {}
    if (attrsBlob) {
      for (const attrMatch of attrsBlob.matchAll(ATTR_PATTERN)) {
        const attrName = attrMatch[1]!
        const value = attrMatch[3] ?? attrMatch[4] ?? ''
        attributes[attrName] = decodeXmlEntities(value)
      }
    }
    const { line, column } = lineColumnAt(stripped, index)
    const element: XmlElement = { type: 'element', name: name!, attributes, children: [], text: '', line, column }

    if (stack.length > 0) {
      stack[stack.length - 1]!.children.push(element)
    } else if (root === null) {
      root = element
    } else {
      return { root: null, error: 'Malformed XML: multiple root elements.' }
    }

    if (!selfClose) stack.push(element)
  }

  if (stack.length > 0) {
    return { root: null, error: `Malformed XML: unclosed element <${stack[stack.length - 1]!.name}>.` }
  }
  if (root === null) {
    return { root: null, error: 'Malformed XML: no root element found.' }
  }

  return { root, error: null }
}

function stripNonElementConstructs(text: string): string | null {
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end === -1) return null
      result += ' '.repeat(end + 3 - i)
      i = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9)
      if (end === -1) return null
      result += ' '.repeat(end + 3 - i)
      i = end + 3
      continue
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2)
      if (end === -1) return null
      result += ' '.repeat(end + 2 - i)
      i = end + 2
      continue
    }
    if (text.startsWith('<!DOCTYPE', i) || text.startsWith('<!doctype', i)) {
      const end = text.indexOf('>', i)
      if (end === -1) return null
      result += ' '.repeat(end + 1 - i)
      i = end + 1
      continue
    }
    result += text[i]
    i++
  }
  return result
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      lastNewline = i
    }
  }
  return { line, column: index - lastNewline }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

const ANDROID_NAMESPACE_URI = 'http://schemas.android.com/apk/res/android'
export const APP_NAMESPACE_URI = 'http://schemas.android.com/apk/res-auto'
export const TOOLS_NAMESPACE_URI = 'http://schemas.android.com/tools'

/**
 * Finds the XML-namespace prefix bound to `uri` on the root element,
 * regardless of the literal prefix chosen in the file (`xmlns:app=...`,
 * `xmlns:auto=...`, etc.) — added in Batch 3/4 for the `app`/`tools`
 * namespaces navigation and resource XML use, generalizing the
 * Android-namespace-only lookup Batch 2 originally added.
 */
export function findNamespacePrefixForUri(root: XmlElement, uri: string): string | null {
  for (const [attrName, value] of Object.entries(root.attributes)) {
    if (value === uri && attrName.startsWith('xmlns:')) {
      return attrName.slice('xmlns:'.length)
    }
  }
  return null
}

/** Finds the XML-namespace prefix bound to the Android namespace URI on the root element (normally `android`, but not assumed). */
export function findAndroidNamespacePrefix(root: XmlElement): string | null {
  return findNamespacePrefixForUri(root, ANDROID_NAMESPACE_URI)
}

/** Reads an Android-namespaced attribute (`<prefix>:localName`) using the namespace prefix resolved from the manifest root, falling back to the conventional `android:` prefix when no `xmlns:*` declaration is present. */
export function getAndroidAttr(element: XmlElement, localName: string, androidPrefix: string | null): string | undefined {
  const prefix = androidPrefix ?? 'android'
  return element.attributes[`${prefix}:${localName}`]
}

export function findChildren(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name)
}

export function findChild(element: XmlElement, name: string): XmlElement | null {
  return element.children.find((child) => child.name === name) ?? null
}
