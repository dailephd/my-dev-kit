import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import type { LanguageAdapter, ExtractionResult, SourceFileInput } from '../types.js'
import type { CallGraphEdge, SymbolDefinition } from '../../symbol-index/types.js'

// ---------------------------------------------------------------------------
// Embedded Python scripts (avoids external file dependency in dist/)
// ---------------------------------------------------------------------------

const EXTRACT_SYMBOLS_PY = `
import sys, ast, json

def main():
    source = sys.stdin.read()
    file_path = sys.argv[1] if len(sys.argv) > 1 else "<unknown>"
    try:
        tree = ast.parse(source, filename=file_path)
    except SyntaxError as e:
        sys.stdout.write(json.dumps({"error": "SyntaxError", "message": str(e), "lineno": e.lineno or 0}))
        return
    except Exception as e:
        sys.stdout.write(json.dumps({"error": "ParseError", "message": str(e)}))
        return

    source_lines = source.splitlines()

    def get_sig(lineno):
        idx = lineno - 1
        return source_lines[idx].strip()[:120] if 0 <= idx < len(source_lines) else ""

    def decorator_names(dl):
        names = []
        for d in dl:
            if isinstance(d, ast.Name): names.append(d.id)
            elif isinstance(d, ast.Attribute): names.append(d.attr)
            elif isinstance(d, ast.Call):
                func = d.func
                if isinstance(func, ast.Name): names.append(func.id)
                elif isinstance(func, ast.Attribute): names.append(func.attr)
        return names

    dunder_all = None
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "__all__":
                    if isinstance(node.value, (ast.List, ast.Tuple)):
                        try:
                            dunder_all = [e.value for e in node.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
                        except Exception:
                            dunder_all = None

    def is_exported(name):
        if dunder_all is not None: return name in dunder_all
        return not name.startswith("_")

    def is_all_caps(name):
        alpha = [c for c in name if c.isalpha()]
        return len(alpha) > 0 and all(c.isupper() for c in alpha)

    def has_final(ann):
        if ann is None: return False
        if isinstance(ann, ast.Name) and ann.id == "Final": return True
        if isinstance(ann, ast.Subscript):
            v = ann.value
            if isinstance(v, ast.Name) and v.id == "Final": return True
            if isinstance(v, ast.Attribute) and v.attr == "Final": return True
        if isinstance(ann, ast.Attribute) and ann.attr == "Final": return True
        return False

    symbols = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            name = node.name
            symbols.append({"name": name, "kind": "function", "line": node.lineno,
                "end_line": getattr(node, "end_lineno", None),
                "exported": is_exported(name), "signature": get_sig(node.lineno),
                "decorators": decorator_names(node.decorator_list)})
        elif isinstance(node, ast.ClassDef):
            name = node.name
            symbols.append({"name": name, "kind": "class", "line": node.lineno,
                "end_line": getattr(node, "end_lineno", None),
                "exported": is_exported(name), "signature": get_sig(node.lineno),
                "decorators": decorator_names(node.decorator_list)})
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and is_all_caps(t.id):
                    name = t.id
                    symbols.append({"name": name, "kind": "const", "line": node.lineno,
                        "end_line": getattr(node, "end_lineno", None),
                        "exported": is_exported(name), "signature": get_sig(node.lineno), "decorators": []})
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name):
                name = node.target.id
                if has_final(node.annotation) or is_all_caps(name):
                    symbols.append({"name": name, "kind": "const", "line": node.lineno,
                        "end_line": getattr(node, "end_lineno", None),
                        "exported": is_exported(name), "signature": get_sig(node.lineno), "decorators": []})
    sys.stdout.write(json.dumps({"symbols": symbols}))

main()
`

const EXTRACT_IMPORTS_PY = `
import sys, ast, json

def main():
    source = sys.stdin.read()
    file_path = sys.argv[1] if len(sys.argv) > 1 else "<unknown>"
    try:
        tree = ast.parse(source, filename=file_path)
    except SyntaxError as e:
        sys.stdout.write(json.dumps({"error": "SyntaxError", "message": str(e), "lineno": e.lineno or 0}))
        return
    except Exception as e:
        sys.stdout.write(json.dumps({"error": "ParseError", "message": str(e)}))
        return

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                entry = {"form": "import-module-alias" if alias.asname else "import-module",
                    "module": alias.name, "names": [], "level": 0, "line": node.lineno}
                if alias.asname: entry["alias"] = alias.asname
                imports.append(entry)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            level = node.level or 0
            names = [a.name for a in node.names]
            single_alias = node.names[0].asname if len(node.names) == 1 and node.names[0].asname else None
            entry = {"form": "relative-from-import" if level > 0 else "from-import",
                "module": module, "names": names, "level": level, "line": node.lineno}
            if single_alias: entry["alias"] = single_alias
            imports.append(entry)
    imports.sort(key=lambda x: x["line"])
    sys.stdout.write(json.dumps({"imports": imports}))

main()
`

const EXTRACT_CALLS_PY = `
import sys, ast, json

def main():
    source = sys.stdin.read()
    file_path = sys.argv[1] if len(sys.argv) > 1 else "<unknown>"
    try:
        tree = ast.parse(source, filename=file_path)
    except SyntaxError as e:
        sys.stdout.write(json.dumps({"error": "SyntaxError", "message": str(e), "lineno": e.lineno or 0}))
        return
    except Exception as e:
        sys.stdout.write(json.dumps({"error": "ParseError", "message": str(e)}))
        return

    imports = []
    definitions = []

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            definitions.append({"name": node.name, "file": file_path, "line": node.lineno, "kind": "function"})
        elif isinstance(node, ast.ClassDef):
            definitions.append({"name": node.name, "file": file_path, "line": node.lineno, "kind": "class"})
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    definitions.append({"name": node.name + "." + child.name, "file": file_path, "line": child.lineno, "kind": "method"})
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({"form": "import", "module": alias.name, "name": alias.asname or alias.name.split(".")[0]})
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for alias in node.names:
                imports.append({"form": "from", "module": module, "level": node.level or 0, "imported": alias.name, "name": alias.asname or alias.name})

    def callee_name(expr, class_name):
        if isinstance(expr, ast.Name):
            return expr.id
        if isinstance(expr, ast.Attribute):
            parts = []
            cur = expr
            while isinstance(cur, ast.Attribute):
                parts.append(cur.attr)
                cur = cur.value
            if isinstance(cur, ast.Name):
                if cur.id == "self" and class_name:
                    parts.append(class_name)
                else:
                    parts.append(cur.id)
                return ".".join(reversed(parts))
        return None

    edges = []

    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.class_name = None
            self.caller = None

        def visit_ClassDef(self, node):
            old_class = self.class_name
            self.class_name = node.name
            for child in node.body:
                self.visit(child)
            self.class_name = old_class

        def visit_FunctionDef(self, node):
            self._visit_function(node)

        def visit_AsyncFunctionDef(self, node):
            self._visit_function(node)

        def _visit_function(self, node):
            old_caller = self.caller
            name = self.class_name + "." + node.name if self.class_name else node.name
            self.caller = {"file": file_path, "name": name, "line": node.lineno}
            for child in node.body:
                self.visit(child)
            self.caller = old_caller

        def visit_Call(self, node):
            if self.caller:
                name = callee_name(node.func, self.class_name)
                if name:
                    edges.append({"caller": self.caller, "calleeName": name, "callLine": node.lineno})
            self.generic_visit(node)

    Visitor().visit(tree)
    sys.stdout.write(json.dumps({"definitions": definitions, "imports": imports, "edges": edges}))

main()
`

// ---------------------------------------------------------------------------
// Python subprocess helpers
// ---------------------------------------------------------------------------

const PYTHON_TIMEOUT_MS = 15_000

function findPythonCmd(): string | null {
  for (const cmd of ['python', 'python3']) {
    const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: false, timeout: 5000 })
    if (!probe.error && probe.status === 0) return cmd
  }
  return null
}

let _pythonCmd: string | null | undefined = undefined

function getPythonCmd(): string | null {
  if (_pythonCmd === undefined) _pythonCmd = findPythonCmd()
  return _pythonCmd
}

function runPythonScript(
  script: string,
  filePath: string,
  sourceText: string
): { stdout: string; stderr: string; error: string | null } {
  const cmd = getPythonCmd()
  if (!cmd) {
    return { stdout: '', stderr: '', error: 'Python interpreter not found on PATH (tried python, python3).' }
  }
  const result = spawnSync(cmd, ['-c', script, filePath], {
    input: sourceText,
    encoding: 'utf8',
    shell: false,
    timeout: PYTHON_TIMEOUT_MS,
  })
  if (result.error) {
    const e = result.error as NodeJS.ErrnoException
    return { stdout: '', stderr: '', error: `Python subprocess error: ${e.message}` }
  }
  if (result.status === null) {
    return { stdout: '', stderr: '', error: `Python subprocess timed out after ${PYTHON_TIMEOUT_MS}ms` }
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PythonSymbolRaw {
  name: string
  kind: 'function' | 'class' | 'const' | 'variable'
  line: number
  end_line: number | null
  exported: boolean
  signature?: string
}

interface PythonImportRaw {
  form: string
  module: string
  names: string[]
  level: number
  line: number
  alias?: string
}

interface PythonCallDefinitionRaw {
  name: string
  file: string
  line: number
  kind: 'function' | 'class' | 'method'
}

interface PythonCallImportRaw {
  form: 'import' | 'from'
  module: string
  level?: number
  name: string
  imported?: string
}

interface PythonCallEdgeRaw {
  caller: {
    file: string
    name: string
    line: number
  }
  calleeName: string
  callLine: number
}

interface PythonCallExtractionRaw {
  definitions: PythonCallDefinitionRaw[]
  imports: PythonCallImportRaw[]
  edges: PythonCallEdgeRaw[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseJsonOutput(
  raw: string,
  filePath: string,
  context: string
): { data: Record<string, unknown> | null; warning: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { data: null, warning: `python-extraction: no output for ${context} from ${filePath}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { data: null, warning: `python-extraction: could not parse ${context} output for ${filePath}` }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { data: null, warning: `python-extraction: unexpected ${context} output shape for ${filePath}` }
  }
  const obj = parsed as Record<string, unknown>
  if ('error' in obj) {
    const msg = typeof obj['message'] === 'string' ? obj['message'] : String(obj['error'])
    return { data: null, warning: `python-extraction: ${msg} in ${filePath}` }
  }
  return { data: obj, warning: null }
}

function mapPythonKind(kind: string): SymbolDefinition['kind'] {
  if (kind === 'function') return 'function'
  if (kind === 'class') return 'class'
  if (kind === 'const') return 'const'
  return 'variable'
}

function buildImportSpecifier(imp: PythonImportRaw): string {
  if (imp.level > 0) {
    const dots = '.'.repeat(imp.level)
    const mod = imp.module ? `${dots}${imp.module}` : dots
    return imp.names.length > 0 ? `from ${mod} import ${imp.names.join(', ')}` : mod
  }
  if (imp.form === 'import-module' || imp.form === 'import-module-alias') {
    return imp.module
  }
  return imp.module
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)]
}

function buildModulePathMap(knownFiles: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of knownFiles) {
    const norm = f.replace(/\\/g, '/')
    const withoutExt = norm.endsWith('.py')
      ? norm.slice(0, -3)
      : norm.endsWith('/__init__.py')
        ? norm.slice(0, -12)
        : null
    if (withoutExt) {
      const parts = withoutExt.split('/')
      for (let start = parts.length - 1; start >= 0; start--) {
        const key = parts.slice(start).join('.')
        if (!map.has(key)) map.set(key, norm)
      }
    }
  }
  return map
}

function resolveAbsoluteImport(
  module: string,
  knownSet: Set<string>,
  modulePathMap: Map<string, string>
): string | null {
  if (!module) return null
  const direct = modulePathMap.get(module)
  if (direct) return direct
  const asPath = module.replace(/\./g, '/')
  for (const candidate of [asPath + '.py', asPath + '/__init__.py']) {
    if (knownSet.has(candidate)) return candidate
    for (const f of knownSet) {
      if (f.endsWith('/' + candidate) || f === candidate) return f
    }
  }
  return null
}

function resolveRelativeImport(
  imp: PythonImportRaw,
  importingFile: string,
  knownSet: Set<string>
): string | null {
  const norm = importingFile.replace(/\\/g, '/')
  const dir = path.posix.dirname(norm)
  const parts = dir.split('/').filter((p) => p.length > 0)
  const upCount = imp.level - 1
  if (upCount > parts.length) return null
  const baseParts = upCount > 0 ? parts.slice(0, parts.length - upCount) : parts
  const baseDir = baseParts.length > 0 ? baseParts.join('/') : '.'

  if (!imp.module) {
    if (imp.names.length === 0 || imp.names[0] === '*') return null
    const name = imp.names[0]
    for (const c of [baseDir + '/' + name + '.py', baseDir + '/' + name + '/__init__.py']) {
      if (knownSet.has(c)) return c
    }
    return null
  }

  const moduleParts = imp.module.split('.')
  const modulePath = moduleParts.join('/')
  for (const c of [baseDir + '/' + modulePath + '.py', baseDir + '/' + modulePath + '/__init__.py']) {
    if (knownSet.has(c)) return c
  }
  return null
}

function specifierToPythonImport(specifier: string): PythonImportRaw {
  const relMatch = specifier.match(/^from (\.+)([^\s]*)\s+import/)
  if (relMatch) {
    const level = relMatch[1].length
    const module = relMatch[2]
    return { form: 'relative-from-import', module, names: [], level, line: 0 }
  }
  const dotMatch = specifier.match(/^(\.+)(.*)$/)
  if (dotMatch) {
    return { form: 'relative-from-import', module: dotMatch[2], names: [], level: dotMatch[1].length, line: 0 }
  }
  return { form: 'from-import', module: specifier, names: [], level: 0, line: 0 }
}

function resolvePythonImportToFile(
  imp: PythonImportRaw,
  importingFile: string,
  knownFiles: readonly string[]
): string | null {
  const knownSet = new Set(knownFiles)
  const modulePathMap = buildModulePathMap(knownFiles)

  if (imp.level > 0) {
    return resolveRelativeImport(imp, importingFile, knownSet)
  }
  return resolveAbsoluteImport(imp.module, knownSet, modulePathMap)
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PythonAdapter implements LanguageAdapter {
  readonly extensions = ['.py'] as const
  readonly supportsCallGraph = true

  extractFromSource(filePath: string, sourceText: string): ExtractionResult {
    const lineCount = sourceText.split('\n').length
    const warnings: string[] = []
    const symbols: SymbolDefinition[] = []
    const imports: string[] = []
    const exports: string[] = []

    const symResult = runPythonScript(EXTRACT_SYMBOLS_PY, filePath, sourceText)
    if (symResult.error) {
      warnings.push(`python-extraction: ${symResult.error}`)
    } else {
      const parsed = parseJsonOutput(symResult.stdout, filePath, 'symbols')
      if (parsed.warning) {
        warnings.push(parsed.warning)
      } else if (parsed.data) {
        const rawSymbols: PythonSymbolRaw[] = Array.isArray(parsed.data['symbols'])
          ? (parsed.data['symbols'] as PythonSymbolRaw[])
          : []
        for (const s of rawSymbols) {
          if (!s.name || !s.kind) continue
          if (s.exported) exports.push(s.name)
          symbols.push({
            name: s.name,
            kind: mapPythonKind(s.kind),
            location: { file: filePath, line: s.line },
            exported: s.exported,
            signature: s.signature,
          })
        }
      }
    }

    const impResult = runPythonScript(EXTRACT_IMPORTS_PY, filePath, sourceText)
    if (impResult.error) {
      warnings.push(`python-extraction: ${impResult.error}`)
    } else {
      const parsed = parseJsonOutput(impResult.stdout, filePath, 'imports')
      if (parsed.warning) {
        warnings.push(parsed.warning)
      } else if (parsed.data) {
        const rawImports: PythonImportRaw[] = Array.isArray(parsed.data['imports'])
          ? (parsed.data['imports'] as PythonImportRaw[])
          : []
        for (const imp of rawImports) {
          const spec = buildImportSpecifier(imp)
          if (spec) imports.push(spec)
        }
      }
    }

    return {
      language: 'python',
      lineCount,
      imports: dedup(imports),
      exports: dedup(exports),
      symbols,
      reExportSpecifiers: [],
      exportAllSpecifiers: [],
    }
  }

  resolveImportToFile(
    specifier: string,
    importingFile: string,
    knownFiles: readonly string[]
  ): string | null {
    const imp = specifierToPythonImport(specifier)
    return resolvePythonImportToFile(imp, importingFile, knownFiles)
  }

  extractCallGraphEdges(files: readonly SourceFileInput[]): CallGraphEdge[] {
    const extractions = new Map<string, PythonCallExtractionRaw>()
    const definitionsByName = new Map<string, PythonCallDefinitionRaw>()
    const knownFiles = files.map((f) => f.filePath)

    for (const file of files) {
      const result = runPythonScript(EXTRACT_CALLS_PY, file.filePath, file.sourceText)
      if (result.error) continue

      const parsed = parseJsonOutput(result.stdout, file.filePath, 'calls')
      if (!parsed.data || parsed.warning) continue

      const extraction: PythonCallExtractionRaw = {
        definitions: Array.isArray(parsed.data['definitions'])
          ? (parsed.data['definitions'] as PythonCallDefinitionRaw[])
          : [],
        imports: Array.isArray(parsed.data['imports'])
          ? (parsed.data['imports'] as PythonCallImportRaw[])
          : [],
        edges: Array.isArray(parsed.data['edges'])
          ? (parsed.data['edges'] as PythonCallEdgeRaw[])
          : [],
      }
      extractions.set(file.filePath, extraction)
      for (const definition of extraction.definitions) {
        if (!definitionsByName.has(definition.name)) {
          definitionsByName.set(definition.name, definition)
        }
        const shortName = definition.kind === 'method' ? null : definition.name.split('.').at(-1)
        if (shortName && !definitionsByName.has(shortName)) {
          definitionsByName.set(shortName, definition)
        }
      }
    }

    const edges: CallGraphEdge[] = []
    for (const [filePath, extraction] of extractions) {
      const importMap = buildPythonCallImportMap(extraction.imports, filePath, knownFiles)
      for (const rawEdge of extraction.edges) {
        edges.push({
          caller: rawEdge.caller,
          callee: {
            file: resolvePythonCalleeFile(rawEdge.calleeName, importMap, definitionsByName),
            name: rawEdge.calleeName,
          },
          callLine: rawEdge.callLine,
        })
      }
    }

    return dedupCallEdges(edges)
  }
}

function buildPythonCallImportMap(
  imports: readonly PythonCallImportRaw[],
  importingFile: string,
  knownFiles: readonly string[]
): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const imp of imports) {
    if (imp.form === 'import') {
      const file = resolvePythonImportToFile(
        { form: 'import-module', module: imp.module, names: [], level: 0, line: 0 },
        importingFile,
        knownFiles
      )
      map.set(imp.name, file)
      continue
    }

    const file = resolvePythonImportToFile(
      {
        form: (imp.level ?? 0) > 0 ? 'relative-from-import' : 'from-import',
        module: imp.module,
        names: imp.imported ? [imp.imported] : [],
        level: imp.level ?? 0,
        line: 0,
      },
      importingFile,
      knownFiles
    )
    map.set(imp.name, file)
  }
  return map
}

function resolvePythonCalleeFile(
  calleeName: string,
  importMap: Map<string, string | null>,
  definitionsByName: Map<string, PythonCallDefinitionRaw>
): string | null {
  const directDefinition = definitionsByName.get(calleeName)
  if (directDefinition) return directDefinition.file

  const parts = calleeName.split('.')
  const base = parts[0]
  if (importMap.has(base)) return importMap.get(base) ?? null

  if (parts.length === 1) {
    const short = parts[0]
    const shortDefinition = definitionsByName.get(short)
    if (shortDefinition) return shortDefinition.file
  }

  return null
}

function dedupCallEdges(edges: CallGraphEdge[]): CallGraphEdge[] {
  const seen = new Set<string>()
  return edges.filter((edge) => {
    const key = [
      edge.caller.file,
      edge.caller.name,
      edge.caller.line,
      edge.callee.file ?? '',
      edge.callee.name,
      edge.callLine,
    ].join('\0')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
