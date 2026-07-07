import { describe, expect, it } from 'vitest'
import { extractKotlinSource, parseKotlinPackageName, resolveKotlinImportToFile } from '../../src/languages/kotlin/adapter.js'

const FILE = 'app/src/main/kotlin/com/example/Sample.kt'

describe('parseKotlinPackageName', () => {
  it('parses a package declaration', () => {
    expect(parseKotlinPackageName('package com.example.app\n\nclass Foo\n')).toBe('com.example.app')
  })

  it('returns null when there is no package declaration', () => {
    expect(parseKotlinPackageName('import com.example.Bar\n\nclass Foo\n')).toBeNull()
  })
})

describe('extractKotlinSource', () => {
  it('parses package and import declarations', () => {
    const source = 'package com.example.app\n\nimport com.example.Bar\nimport com.example.util.*\n\nclass Foo\n'
    const result = extractKotlinSource(FILE, source)

    expect(result.language).toBe('kotlin')
    expect(result.imports).toEqual(['com.example.Bar', 'com.example.util.*'])
  })

  it('finds a class, interface, object, and enum class', () => {
    const source = [
      'class Foo',
      'interface Bar',
      'object Baz',
      'enum class Color { RED, GREEN, BLUE }',
    ].join('\n')
    const result = extractKotlinSource(FILE, source)

    const byName = Object.fromEntries(result.symbols.map((s) => [s.name, s.kind]))
    expect(byName['Foo']).toBe('class')
    expect(byName['Bar']).toBe('interface')
    expect(byName['Baz']).toBe('object')
    expect(byName['Color']).toBe('enum')
  })

  it('marks a data class and sealed class via the signature text, not a new field', () => {
    const source = 'data class User(val id: String, val name: String)\nsealed class Result\n'
    const result = extractKotlinSource(FILE, source)

    const user = result.symbols.find((s) => s.name === 'User')
    const resultClass = result.symbols.find((s) => s.name === 'Result')
    expect(user?.kind).toBe('class')
    expect(user?.signature).toContain('data class User')
    expect(resultClass?.signature).toContain('sealed class Result')
  })

  it('finds top-level functions and properties', () => {
    const source = 'fun greet(name: String): String {\n    return "hi $name"\n}\n\nval greeting: String = "hi"\nvar counter: Int = 0\n'
    const result = extractKotlinSource(FILE, source)

    const greet = result.symbols.find((s) => s.name === 'greet')
    const greeting = result.symbols.find((s) => s.name === 'greeting')
    const counter = result.symbols.find((s) => s.name === 'counter')
    expect(greet?.kind).toBe('function')
    expect(greeting?.kind).toBe('const')
    expect(counter?.kind).toBe('variable')
  })

  it('finds an extension function and captures the receiver in the signature', () => {
    const source = 'fun String.toSlug(): String {\n    return this.lowercase()\n}\n'
    const result = extractKotlinSource(FILE, source)

    const symbol = result.symbols.find((s) => s.name === 'toSlug')
    expect(symbol).toBeTruthy()
    expect(symbol?.signature).toContain('String.toSlug')
  })

  it('does not extract member functions/properties nested inside a class body (matches existing TS/Python top-level-only precedent)', () => {
    const source = 'class Foo {\n    fun member() {}\n    val memberProp: Int = 1\n}\n'
    const result = extractKotlinSource(FILE, source)

    expect(result.symbols.map((s) => s.name)).toEqual(['Foo'])
  })

  it('records annotations by prepending them to the signature', () => {
    const source = '@Deprecated("use bar")\nfun foo() {}\n'
    const result = extractKotlinSource(FILE, source)

    const symbol = result.symbols.find((s) => s.name === 'foo')
    expect(symbol?.signature).toContain('@Deprecated')
  })

  it('records the suspend marker via the signature text', () => {
    const source = 'suspend fun fetchData(): String {\n    return ""\n}\n'
    const result = extractKotlinSource(FILE, source)

    const symbol = result.symbols.find((s) => s.name === 'fetchData')
    expect(symbol?.signature).toContain('suspend fun fetchData')
  })

  it('records a Flow/StateFlow usage marker via the signature and imports', () => {
    const source = 'import kotlinx.coroutines.flow.Flow\nimport kotlinx.coroutines.flow.StateFlow\n\nval state: StateFlow<Int> = TODO()\nfun observe(): Flow<String> = TODO()\n'
    const result = extractKotlinSource(FILE, source)

    expect(result.imports).toContain('kotlinx.coroutines.flow.Flow')
    expect(result.imports).toContain('kotlinx.coroutines.flow.StateFlow')
    expect(result.symbols.find((s) => s.name === 'state')?.signature).toContain('StateFlow')
    expect(result.symbols.find((s) => s.name === 'observe')?.signature).toContain('Flow')
  })

  it('treats a private top-level declaration as not exported', () => {
    const source = 'private fun helper() {}\nfun publicFn() {}\n'
    const result = extractKotlinSource(FILE, source)

    expect(result.symbols.find((s) => s.name === 'helper')?.exported).toBe(false)
    expect(result.symbols.find((s) => s.name === 'publicFn')?.exported).toBe(true)
    expect(result.exports).toEqual(['publicFn'])
  })

  it('produces deterministic output across repeated calls on the same source', () => {
    const source = 'package com.example\n\nimport com.example.Bar\n\ndata class User(val id: String)\nfun greet() {}\n'
    const first = extractKotlinSource(FILE, source)
    const second = extractKotlinSource(FILE, source)

    expect(first).toEqual(second)
  })

  it('never produces reExportSpecifiers/exportAllSpecifiers (no Kotlin equivalent concept)', () => {
    const result = extractKotlinSource(FILE, 'class Foo\n')
    expect(result.reExportSpecifiers).toEqual([])
    expect(result.exportAllSpecifiers).toEqual([])
  })
})

describe('resolveKotlinImportToFile', () => {
  const knownFiles = ['app/src/main/kotlin/com/example/Bar.kt', 'app/src/main/kotlin/com/example/util/Helpers.kt']

  it('resolves an import to a file following the single-declaration-per-file convention', () => {
    const resolved = resolveKotlinImportToFile('com.example.Bar', FILE, knownFiles)
    expect(resolved).toBe('app/src/main/kotlin/com/example/Bar.kt')
  })

  it('returns null for a wildcard import', () => {
    expect(resolveKotlinImportToFile('com.example.*', FILE, knownFiles)).toBeNull()
  })

  it('returns null when no matching file exists', () => {
    expect(resolveKotlinImportToFile('com.example.Missing', FILE, knownFiles)).toBeNull()
  })

  it('returns null for a specifier with no package prefix', () => {
    expect(resolveKotlinImportToFile('Bar', FILE, knownFiles)).toBeNull()
  })
})
