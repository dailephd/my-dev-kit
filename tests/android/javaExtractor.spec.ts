import { describe, expect, it } from 'vitest'
import { extractJavaSource, parseJavaPackageName, resolveJavaImportToFile } from '../../src/languages/java/adapter.js'

const FILE = 'app/src/main/java/com/example/Sample.java'

describe('parseJavaPackageName', () => {
  it('parses a package declaration', () => {
    expect(parseJavaPackageName('package com.example.app;\n\nclass Foo {}\n')).toBe('com.example.app')
  })

  it('returns null when there is no package declaration', () => {
    expect(parseJavaPackageName('import com.example.Bar;\n\nclass Foo {}\n')).toBeNull()
  })
})

describe('extractJavaSource', () => {
  it('parses package, normal imports, static imports, and wildcard imports', () => {
    const source = [
      'package com.example.app;',
      '',
      'import com.example.Bar;',
      'import static com.example.Util.helper;',
      'import com.example.other.*;',
      '',
      'class Foo {}',
    ].join('\n')
    const result = extractJavaSource(FILE, source)

    expect(result.language).toBe('java')
    expect(result.imports).toEqual(['com.example.Bar', 'com.example.Util.helper', 'com.example.other.*'])
  })

  it('extracts a top-level class', () => {
    const result = extractJavaSource(FILE, 'public class Foo {\n}\n')
    expect(result.symbols).toEqual([
      {
        name: 'Foo',
        kind: 'class',
        location: { file: FILE, line: 1 },
        exported: true,
        signature: 'public class Foo {',
      },
    ])
  })

  it('extracts a top-level interface', () => {
    const result = extractJavaSource(FILE, 'public interface Repository {\n}\n')
    expect(result.symbols[0].kind).toBe('interface')
    expect(result.symbols[0].name).toBe('Repository')
  })

  it('extracts a top-level enum', () => {
    const result = extractJavaSource(FILE, 'public enum Status {\n    ACTIVE, INACTIVE\n}\n')
    expect(result.symbols[0].kind).toBe('enum')
    expect(result.symbols[0].name).toBe('Status')
  })

  it('extracts an annotation type declaration as kind interface', () => {
    const result = extractJavaSource(FILE, '@interface Important {\n}\n')
    expect(result.symbols).toHaveLength(1)
    expect(result.symbols[0].kind).toBe('interface')
    expect(result.symbols[0].name).toBe('Important')
    expect(result.symbols[0].signature).toContain('@interface Important')
  })

  it('extracts a record declaration as kind class', () => {
    const result = extractJavaSource(FILE, 'public record User(String id, String name) {\n}\n')
    expect(result.symbols[0].kind).toBe('class')
    expect(result.symbols[0].name).toBe('User')
    expect(result.symbols[0].signature).toContain('record User')
  })

  it('captures extends and implements targets via the signature text', () => {
    const result = extractJavaSource(FILE, 'public class Widget extends BaseWidget implements Sized, Named {\n}\n')
    expect(result.symbols[0].signature).toContain('extends BaseWidget implements Sized, Named')
  })

  it('records a class-level annotation by prepending it to the signature', () => {
    const source = '@Deprecated\npublic class Old {\n}\n'
    const result = extractJavaSource(FILE, source)
    expect(result.symbols[0].signature).toContain('@Deprecated')
    expect(result.symbols[0].signature).toContain('public class Old')
  })

  it('does not extract members nested inside a class body (matches existing top-level-only precedent)', () => {
    const source = 'public class Foo {\n    public void member() {}\n    private int memberField = 1;\n}\n'
    const result = extractJavaSource(FILE, source)
    expect(result.symbols.map((s) => s.name)).toEqual(['Foo'])
  })

  it('finds multiple top-level declarations in one file', () => {
    const source = 'sealed interface Result permits Success {\n}\n\nfinal class Success implements Result {\n}\n'
    const result = extractJavaSource(FILE, source)
    expect(result.symbols.map((s) => s.name)).toEqual(['Result', 'Success'])
    expect(result.symbols.map((s) => s.kind)).toEqual(['interface', 'class'])
  })

  it('produces deterministic output across repeated calls on the same source', () => {
    const source = 'package com.example;\n\nimport com.example.Bar;\n\npublic class Foo {\n}\n'
    const first = extractJavaSource(FILE, source)
    const second = extractJavaSource(FILE, source)
    expect(first).toEqual(second)
  })

  it('never produces reExportSpecifiers/exportAllSpecifiers (no Java equivalent concept)', () => {
    const result = extractJavaSource(FILE, 'class Foo {}\n')
    expect(result.reExportSpecifiers).toEqual([])
    expect(result.exportAllSpecifiers).toEqual([])
  })
})

describe('resolveJavaImportToFile', () => {
  const knownFiles = ['app/src/main/java/com/example/Bar.java', 'app/src/main/java/com/example/util/Helpers.java']

  it('resolves an import to a file using the file-name-matches-type convention', () => {
    expect(resolveJavaImportToFile('com.example.Bar', FILE, knownFiles)).toBe('app/src/main/java/com/example/Bar.java')
  })

  it('returns null for a wildcard import', () => {
    expect(resolveJavaImportToFile('com.example.*', FILE, knownFiles)).toBeNull()
  })

  it('returns null for a static wildcard import', () => {
    expect(resolveJavaImportToFile('com.example.Util.*', FILE, knownFiles)).toBeNull()
  })

  it('returns null when no matching file exists', () => {
    expect(resolveJavaImportToFile('com.example.Missing', FILE, knownFiles)).toBeNull()
  })
})
