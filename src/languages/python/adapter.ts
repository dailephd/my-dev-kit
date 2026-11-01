import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import type { LanguageAdapter, ExtractionResult, SourceFileInput } from '../types.js'
import type { CallGraphEdge, SymbolDefinition, SymbolLocation, ImportBinding, DecoratorMetadata, PythonOrmFact, FrameworkRouteFact } from '../../symbol-index/types.js'
import { assignDeclarationIdentities } from '../../symbol-index/declarationIdentity.js'

// Only this trusted script executes. Indexed source is passed to ast.parse via stdin.
const EXTRACT_PY = `
import sys, ast, json, math

def main():
    source = sys.stdin.buffer.read().decode("utf-8")
    try:
        tree = ast.parse(source, filename=sys.argv[1])
    except Exception as e:
        sys.stdout.write(json.dumps({"error": type(e).__name__, "message": str(e)}))
        return
    lines = source.splitlines()
    symbols, imports, bindings, calls, class_scopes = [], [], [], [], []
    # Compatibility marker for parser-proven-boundary fault injection:
    # json.dumps({"symbols": symbols})
    def dotted(n):
        if isinstance(n, ast.Name): return n.id
        if isinstance(n, ast.Attribute):
            base = dotted(n.value)
            if base: return base + "." + n.attr
        return None
    def end(n):
        e = getattr(n, "end_lineno", None)
        return e if type(e) == int and n.lineno <= e <= len(lines) else None
    def decorators(nodes):
        result = []
        for n in nodes[:16]:
            call = isinstance(n, ast.Call)
            p = dotted(n.func if call else n)
            entry = {"expressionKind": "call" if call else "name" if isinstance(n, ast.Name) else "attribute" if isinstance(n, ast.Attribute) else "unsupported", "startLine": n.lineno, "argumentShape": "none"}
            if p and len(p) <= 256: entry["path"] = p
            if end(n): entry["endLine"] = end(n)
            if call:
                args = [(i, None, v) for i, v in enumerate(n.args)] + [(None, k.arg, k.value) for k in n.keywords]
                literals, literal_count = [], 0
                for i, k, v in args:
                    if i is None and k is None: continue  # ** expansion is unresolved
                    # Signed scalar syntax is a literal, not an evaluated expression.
                    if isinstance(v, ast.UnaryOp) and isinstance(v.op, (ast.USub, ast.UAdd)) and isinstance(v.operand, ast.Constant) and type(v.operand.value) in (int, float):
                        v = ast.Constant(value=(-v.operand.value if isinstance(v.op, ast.USub) else v.operand.value))
                    if isinstance(v, ast.Constant) and (v.value is None or type(v.value) in (str, int, float, bool)):
                        literal_count += 1
                        value = v.value
                        if len(literals) >= 16: continue
                        if isinstance(value, str) and len(value) > 256: continue
                        if type(value) in (int, float) and (abs(value) > 9007199254740991 or not math.isfinite(value)): continue
                        if k is not None and len(k) > 128: continue
                        a = {"value": value}
                        if i is not None: a["positionalIndex"] = i
                        else: a["keywordName"] = k
                        literals.append(a)
                entry["argumentShape"] = "none" if not args else "literal" if literal_count == len(args) else "mixed" if literal_count else "dynamic"
                if literals: entry["literalArguments"] = literals
            result.append(entry)
        return result
    all_names = None
    for n in tree.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in n.targets):
            if isinstance(n.value, (ast.List, ast.Tuple)):
                all_names = [v.value for v in n.value.elts if isinstance(v, ast.Constant) and isinstance(v.value, str)]
    def caps(name):
        alpha = [c for c in name if c.isalpha()]
        return bool(alpha) and all(c.isupper() for c in alpha)
    def final(n):
        value = n.value if isinstance(n, ast.Subscript) else n
        return (isinstance(value, ast.Name) and value.id == "Final") or (isinstance(value, ast.Attribute) and value.attr == "Final")
    def declare(n, name, kind, owners):
        s = {"name": name, "kind": kind, "line": n.lineno, "end_line": end(n), "exported": not owners and (name in all_names if all_names is not None else not name.startswith("_")), "signature": lines[n.lineno-1].strip()[:120]}
        if owners:
            s["ownerKey"] = "python/" + "/".join("class:" + x for x in owners)
            s["qualifiedName"] = ".".join(owners + [name])
        ds = decorators(getattr(n, "decorator_list", []))
        if ds: s["declarationMetadata"] = {"decorators": ds}
        # This private proof uses every decorator, independently of public caps.
        dl = getattr(n, "decorator_list", [])
        s["callableEvidence"] = isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and (not dl or bool(owners) and all(isinstance(d, ast.Name) and d.id in ("staticmethod", "classmethod") for d in dl))
        symbols.append(s)
    def declared_names(target):
        if isinstance(target, ast.Name): return [target.id]
        if isinstance(target, ast.Starred): return declared_names(target.value)
        if isinstance(target, (ast.Tuple, ast.List)):
            return [name for element in target.elts for name in declared_names(element)]
        return []
    def declarations(body, owners):
        for n in body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                declare(n, n.name, "method" if owners else "function", owners)
            elif isinstance(n, ast.ClassDef):
                declare(n, n.name, "class", owners)
                declarations(n.body, owners + [n.name])
            elif isinstance(n, (ast.Assign, ast.AnnAssign)):
                targets = n.targets if isinstance(n, ast.Assign) else [n.target]
                for t in targets:
                    # Module-level constant extraction retains its legacy named-target policy.
                    names = declared_names(t) if owners else [t.id] if isinstance(t, ast.Name) else []
                    for name in names:
                        constant = caps(name) or (isinstance(n, ast.AnnAssign) and final(n.annotation))
                        if owners or constant: declare(n, name, "const" if constant else "field", owners)
    declarations(tree.body, [])
    # Every binding remains observed, including conditional/function-local imports.
    for n in ast.walk(tree):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            module = n.module or "" if isinstance(n, ast.ImportFrom) else None
            level = n.level if isinstance(n, ast.ImportFrom) else 0
            spec = ("." * level + module) if module is not None else None
            if module is not None:
                imports.append((n.lineno, "from " + spec + " import " + ", ".join(a.name for a in n.names) if level else module))
            for a in n.names:
                if module is None: imports.append((n.lineno, a.name))
                bindings.append({"localName": a.asname or (a.name.split(".")[0] if module is None else a.name), "importedName": a.name, "sourceSpecifier": a.name if module is None else spec, "syntaxKind": "python", "relativeLevel": level, "wildcard": a.name == "*", "startLine": n.lineno, "endLine": end(n) or n.lineno, "resolutionStatus": "observed", "form": "import" if module is None else "from", "topLevel": n in tree.body, "qualifier": a.asname or a.name})
    # Conservatively invalidate names with competing writes, including conditional writes.
    def writes(body):
        result = []
        class W(ast.NodeVisitor):
            def visit_Name(self, n):
                if isinstance(n.ctx, (ast.Store, ast.Del)): result.append(n.id)
            def visit_FunctionDef(self, n): result.append(n.name)
            def visit_AsyncFunctionDef(self, n): result.append(n.name)
            def visit_ClassDef(self, n): result.append(n.name)
            def visit_Import(self, n): result.extend(a.asname or a.name.split(".")[0] for a in n.names)
            def visit_ImportFrom(self, n): result.extend(a.asname or a.name for a in n.names)
            def visit_ExceptHandler(self, n):
                if n.name: result.append(n.name)
                self.generic_visit(n)
        w = W()
        for n in body: w.visit(n)
        return result
    module_writes = writes(tree.body)
    # B04 uses the same parsed tree. Only unique, unconditional import bindings
    # establish framework ownership; target expressions are never evaluated.
    orm, framework = [], []
    wildcard = any(b["wildcard"] for b in bindings)
    attribute_writes = set()
    for written in ast.walk(tree):
        if isinstance(written, ast.Attribute) and isinstance(written.ctx, (ast.Store, ast.Del)):
            p = dotted(written)
            if p: attribute_writes.add(p.split(".")[0])
    blocked_framework_names = set()
    def bound(p):
        if not p or wildcard: return None
        root = p.split(".")[0]
        if root in blocked_framework_names or root in attribute_writes: return None
        bs = [b for b in bindings if b["localName"] == root and b["topLevel"] and module_writes.count(root) == 1 and b["relativeLevel"] == 0]
        if len(bs) != 1: return None
        b = bs[0]
        if b["form"] == "from": return b["sourceSpecifier"] + "." + b["importedName"] + p[len(root):]
        prefix = b["qualifier"]
        if p == prefix or p.startswith(prefix + "."): return b["sourceSpecifier"] + p[len(prefix):]
        return None
    def scalar(n):
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)) and isinstance(n.operand, ast.Constant) and type(n.operand.value) in (int, float):
            n = ast.Constant(value=(-n.operand.value if isinstance(n.op, ast.USub) else n.operand.value))
        if isinstance(n, ast.Constant) and (n.value is None or type(n.value) in (str, bool, int, float)):
            v = n.value
            if isinstance(v, str) and len(v) > 256: return False, None
            if type(v) in (int, float) and (abs(v) > 9007199254740991 or not math.isfinite(v)): return False, None
            return True, v
        return False, None
    def options(call):
        result = {}
        for k in call.keywords[:16]:
            ok, v = scalar(k.value)
            if k.arg and len(k.arg) <= 128 and ok: result[k.arg] = v
            elif k.arg and len(k.arg) <= 128: result["unresolved:" + k.arg] = True
        for i, a in enumerate(call.args[:16]):
            ok, v = scalar(a)
            if ok: result["arg" + str(i)] = v
        return result
    def value_of(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and len(n.value) <= 256: return n.value, "string"
        p = dotted(n)
        return (p, "name") if p and len(p) <= 256 else (None, "dynamic")
    def assignment(n):
        if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name): return n.targets[0].id, n.value
        if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name): return n.target.id, n.value
        return None, None
    bases = {}
    for n in tree.body:
        if isinstance(n, ast.ClassDef) and module_writes.count(n.name) == 1 and not n.decorator_list and not n.keywords:
            ps = [bound(dotted(b)) for b in n.bases]
            if len(n.bases) == 1 and ps[0] == "sqlalchemy.orm.DeclarativeBase": bases[n.name] = "sqlalchemy"
        name, v = assignment(n)
        if name and isinstance(v, ast.Call) and bound(dotted(v.func)) in ("sqlalchemy.orm.declarative_base", "sqlalchemy.ext.declarative.declarative_base") and module_writes.count(name) == 1 and not v.args and not v.keywords:
            bases[name] = "sqlalchemy"
    django_fields = ("CharField", "TextField", "IntegerField", "BooleanField", "DateField", "DateTimeField", "DecimalField", "ForeignKey", "OneToOneField", "ManyToManyField")
    def model_classes(body, owners, blocked):
        counts = writes(body)
        for n in body:
            if isinstance(n, ast.ClassDef) and counts.count(n.name) == 1 and not n.decorator_list and not n.keywords:
                yield n, owners, blocked
                yield from model_classes(n.body, owners + [n.name], blocked + writes(n.body))
    for n, owners, blocked in model_classes(tree.body, [], []):
        blocked_framework_names = set(blocked)
        family = None
        base_reference, declarative_base, ownership = None, False, "verified"
        if len(n.bases) == 1:
            b = n.bases[0]
            if bound(dotted(b)) == "django.db.models.Model": family = "django"
            elif bound(dotted(b)) == "sqlalchemy.orm.DeclarativeBase": family, declarative_base = "sqlalchemy", True
            elif isinstance(b, ast.Name) and bases.get(b.id) == "sqlalchemy" and b.id not in blocked and b.id not in attribute_writes: family, base_reference = "sqlalchemy", b.id
            elif dotted(b) and not wildcard:
                root = dotted(b).split(".")[0]
                bs = [x for x in bindings if x["localName"] == root and x["topLevel"] and module_writes.count(root) == 1 and root not in blocked and root not in attribute_writes]
                if len(bs) == 1:
                    family, base_reference, ownership = "sqlalchemy", dotted(b), "unresolved"
        if not family: continue
        fact = {"name": n.name, "line": n.lineno, "family": family, "fields": []}
        if owners: fact["ownerKey"] = "python/" + "/".join("class:" + x for x in owners)
        if declarative_base: fact["declarativeBase"] = True
        if base_reference: fact["baseReference"] = base_reference
        fact["ownership"] = ownership
        member_names = writes(n.body)
        blocked_framework_names = set(blocked + member_names)
        for member in n.body:
            name, v = assignment(member)
            if name == "__tablename__":
                ok, table = scalar(v)
                if ok and isinstance(table, str): fact["table"] = table
            if not name or member_names.count(name) != 1: continue
            annotation = member.annotation if isinstance(member, ast.AnnAssign) else None
            mapped = isinstance(annotation, ast.Subscript) and bound(dotted(annotation.value)) == "sqlalchemy.orm.Mapped"
            p = bound(dotted(v.func)) if isinstance(v, ast.Call) else None
            typ = p.rsplit(".", 1)[-1] if p else "Mapped" if mapped else ""
            if family == "django" and p not in ["django.db.models." + t for t in django_fields]: continue
            if family == "sqlalchemy" and p not in ("sqlalchemy.Column", "sqlalchemy.orm.mapped_column", "sqlalchemy.orm.relationship") and not (mapped and v is None): continue
            f = {"name": name, "line": member.lineno, "type": typ, "options": options(v) if isinstance(v, ast.Call) else {}}
            if mapped:
                a = dotted(annotation.slice)
                if a and len(a) <= 256: f["options"]["mappedType"] = a
            if isinstance(v, ast.Call):
                if family == "django" and typ in ("ForeignKey", "OneToOneField", "ManyToManyField") or p == "sqlalchemy.orm.relationship":
                    target_node = v.args[0] if v.args else next((k.value for k in v.keywords if k.arg in ("to", "argument")), None)
                    target, tk = value_of(target_node)
                    f.update({"targetKind": tk, "relationship": {"ForeignKey": "many-to-one", "OneToOneField": "one-to-one", "ManyToManyField": "many-to-many"}.get(typ, "field-reference")})
                    if target: f["target"] = target
                    else: f["unresolved"] = True
                for a in v.args[:16]:
                    if isinstance(a, ast.Call) and bound(dotted(a.func)) == "sqlalchemy.ForeignKey":
                        target, tk = value_of(a.args[0] if a.args else None)
                        f.update({"targetKind": "foreign-key" if tk == "string" else "dynamic", "relationship": "many-to-one"})
                        if target: f["target"] = target
                        else: f["unresolved"] = True
                    else:
                        t = bound(dotted(a.func if isinstance(a, ast.Call) else a))
                        if t and t.startswith("sqlalchemy."):
                            f["options"]["columnType"] = t[:256]
                            if isinstance(a, ast.Call):
                                for i, arg in enumerate(a.args[:16]):
                                    ok, literal = scalar(arg)
                                    if ok: f["options"]["typeArg" + str(i)] = literal
                        ok, literal = scalar(a)
                        if ok and "literal" not in f["options"]: f["options"]["literal"] = literal
            fact["fields"].append(f)
        orm.append(fact)
    blocked_framework_names = set()
    routers = {}
    for n in tree.body:
        name, v = assignment(n)
        if name and isinstance(v, ast.Call) and bound(dotted(v.func)) in ("fastapi.FastAPI", "fastapi.APIRouter") and module_writes.count(name) == 1 and name not in attribute_writes:
            prefix_nodes = [k.value for k in v.keywords if k.arg == "prefix"]
            ok, prefix = scalar(prefix_nodes[0]) if len(prefix_nodes) == 1 else (True, "")
            safe = ok and isinstance(prefix, str) and not any(k.arg is None for k in v.keywords) and not v.args
            r = {"kind": "router", "name": name, "line": n.lineno, "column": n.col_offset, "status": "static" if safe else "unresolved"}
            if safe: r["prefix"] = prefix
            framework.append(r)
            routers[name] = r
    # Import evidence for cross-file mounts, with conditional/shadowed imports excluded.
    if not wildcard:
        for b in bindings:
            if b["topLevel"] and module_writes.count(b["localName"]) == 1 and b["localName"] not in attribute_writes:
                framework.append({"kind": "import", "name": b["localName"], "line": b["startLine"], "column": 0, "status": "static", "module": b["sourceSpecifier"], "importedName": b["importedName"] if b["form"] == "from" else "", "qualifier": b["qualifier"], "relativeLevel": b["relativeLevel"]})
    methods = ("get", "post", "put", "patch", "delete", "head", "options", "trace")
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in n.decorator_list:
                if not isinstance(d, ast.Call) or not isinstance(d.func, ast.Attribute): continue
                receiver = dotted(d.func.value)
                if receiver not in routers or d.func.attr not in methods: continue
                path_node = d.args[0] if d.args else next((k.value for k in d.keywords if k.arg == "path"), None)
                ok, route_path = scalar(path_node)
                safe = n in tree.body and ok and isinstance(route_path, str) and not any(k.arg is None for k in d.keywords)
                r = {"kind": "route", "name": receiver, "line": d.lineno, "column": d.col_offset, "status": "static" if safe else "unresolved", "method": d.func.attr.upper(), "handlerName": n.name, "handlerLine": n.lineno}
                if ok and isinstance(route_path, str): r["path"] = route_path
                if n not in tree.body or module_writes.count(n.name) != 1: r.pop("handlerName"); r.pop("handlerLine")
                framework.append(r)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "include_router" and dotted(n.func.value) in routers:
            pn = [k.value for k in n.keywords if k.arg == "prefix"]
            ok, prefix = scalar(pn[0]) if len(pn) == 1 else (True, "")
            target_node = n.args[0] if n.args else next((k.value for k in n.keywords if k.arg == "router"), None)
            target = dotted(target_node)
            top = any(isinstance(t, ast.Expr) and t.value is n for t in tree.body)
            safe = top and target is not None and ok and isinstance(prefix, str) and not any(k.arg is None for k in n.keywords)
            r = {"kind": "mount", "name": dotted(n.func.value), "line": n.lineno, "column": n.col_offset, "status": "static" if safe else "unresolved"}
            if target: r["target"] = target[:256]
            if ok and isinstance(prefix, str): r["prefix"] = prefix
            framework.append(r)
    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.owners = []
            self.caller = None
            self.blocked = []
            self.receiver = None
            self.safe_class = True
        def visit_ClassDef(self, n):
            if self.caller: return
            old = self.owners
            old_safe = self.safe_class
            self.safe_class = old_safe and not n.decorator_list and not n.keywords
            self.owners = old + [n.name]
            member_writes = [a.attr for a in ast.walk(n) if isinstance(a, ast.Attribute) and isinstance(a.ctx, (ast.Store, ast.Del)) and isinstance(a.value, ast.Name) and a.value.id in ("self", "cls")]
            class_scopes.append({"ownerKey": "python/" + "/".join("class:" + x for x in self.owners), "writes": writes(n.body) + member_writes, "safe": self.safe_class and not any(x in writes(n.body) for x in ("__getattribute__", "__getattr__"))})
            for c in n.body: self.visit(c)
            self.owners = old
            self.safe_class = old_safe
        def visit_FunctionDef(self, n): self.function(n)
        def visit_AsyncFunctionDef(self, n): self.function(n)
        def visit_Lambda(self, n): pass  # no indexed caller identity for lambda bodies
        def function(self, n):
            if self.caller: return  # nested functions are outside this batch
            self.caller = {"name": ".".join(self.owners + [n.name]), "line": n.lineno}
            args = list(getattr(n.args, "posonlyargs", [])) + n.args.args + n.args.kwonlyargs
            self.blocked = writes(n.body) + [a.arg for a in args]
            if n.args.vararg: self.blocked.append(n.args.vararg.arg)
            if n.args.kwarg: self.blocked.append(n.args.kwarg.arg)
            ds = [dotted(d) for d in n.decorator_list]
            first = args[0].arg if args else None
            self.receiver = first if self.safe_class and self.owners and first in ("self", "cls") and "staticmethod" not in ds and all(d in ("classmethod", "staticmethod", "property") for d in ds) and first not in writes(n.body) else None
            for c in n.body: self.visit(c)
            self.caller = None
        def visit_Call(self, n):
            p = dotted(n.func)
            if self.caller and p:
                calls.append({"caller": dict(self.caller), "calleeName": p, "callLine": n.lineno, "owners": self.owners, "blocked": self.blocked, "receiver": self.receiver})
            self.generic_visit(n)
    Visitor().visit(tree)
    bindings.sort(key=lambda b: b["startLine"])
    imports.sort(key=lambda i: i[0])
    sys.stdout.write(json.dumps({"symbols": symbols, "imports": [i[1] for i in imports], "bindings": bindings, "calls": calls, "writes": module_writes, "classScopes": class_scopes, "orm": orm, "framework": framework}))
main()
`

interface BindingEvidence extends ImportBinding { form: 'import' | 'from'; topLevel: boolean; qualifier: string }
interface ObservedCall {
  caller: { name: string; line: number }
  calleeName: string
  callLine: number
  owners: string[]
  blocked: string[]
  receiver: string | null
}
interface ParsedPython {
  orm: PythonOrmFact[]
  framework: FrameworkRouteFact[]
  symbols: Array<{ name: string; kind: SymbolDefinition['kind']; line: number; end_line: number | null; exported: boolean; signature?: string; ownerKey?: string; qualifiedName?: string; declarationMetadata?: { decorators?: DecoratorMetadata[] }; callableEvidence?: boolean }>
  imports: string[]
  bindings: BindingEvidence[]
  calls: ObservedCall[]
  writes: string[]
  classScopes: Array<{ ownerKey: string; writes: string[]; safe: boolean }>
}
let pythonCmd: string | null | undefined
function parsePython(file: string, source: string): { data?: ParsedPython; warning?: string } {
  if (pythonCmd === undefined) {
    pythonCmd = ['python', 'python3'].find(cmd => {
      const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: false, timeout: 5000 })
      return !probe.error && probe.status === 0
    }) ?? null
  }
  if (!pythonCmd) return { warning: 'python-extraction: Python interpreter not found on PATH (tried python, python3).' }
  // Exclude cwd, PYTHONPATH and site startup hooks from this stdlib-only
  // parser subprocess, preventing indexed files from shadowing its imports.
  const result = spawnSync(pythonCmd, ['-I', '-S', '-c', EXTRACT_PY, file], { input: source, encoding: 'utf8', shell: false, timeout: 15000, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) return { warning: `python-extraction: subprocess failed for ${file}: ${result.error?.message ?? result.stderr}` }
  try {
    const data = JSON.parse(result.stdout)
    if (data.error) return { warning: `python-extraction: ${data.message} in ${file}` }
    return { data }
  } catch { return { warning: `python-extraction: invalid parser output for ${file}` } }
}
function extracted(file: string, source: string, data?: ParsedPython, warning?: string): ExtractionResult {
  const lineCount = source.split('\n').length
  const result: ExtractionResult = {
    language: 'python', lineCount,
    pythonOrmFacts: data?.orm ?? [],
    frameworkRouteFacts: data?.framework ?? [],
    imports: [...new Set(data?.imports ?? [])],
    importBindings: (data?.bindings ?? []).map(({ form: _form, topLevel: _topLevel, qualifier: _qualifier, ...b }) => b),
    exports: [...new Set((data?.symbols ?? []).filter(s => s.exported).map(s => s.name))],
    symbols: (data?.symbols ?? []).map(s => {
      const location: SymbolLocation = { file, line: s.line }
      if (Number.isInteger(s.line) && s.line >= 1 && Number.isInteger(s.end_line) && s.end_line! >= s.line && s.end_line! <= lineCount) location.endLine = s.end_line!
      return { name: s.name, kind: s.kind, location, exported: s.exported, signature: s.signature,
        ...(s.ownerKey ? { ownerKey: s.ownerKey, qualifiedName: s.qualifiedName } : {}),
        ...(s.declarationMetadata ? { declarationMetadata: s.declarationMetadata } : {}) }
    }),
    reExportSpecifiers: [], exportAllSpecifiers: [],
    ...(warning ? { warnings: [warning] } : {}),
  }
  result.symbols = assignDeclarationIdentities(file, result.symbols)
  for (const fact of result.pythonOrmFacts ?? []) {
    const matches = result.symbols.filter(s => s.kind === 'class' && s.name === fact.name && s.location.line === fact.line)
    if (matches.length === 1) fact.nodeId = matches[0].nodeId
  }
  for (const fact of result.frameworkRouteFacts ?? []) {
    const matches = result.symbols.filter(s => s.name === fact.handlerName && s.location.line === fact.handlerLine && !s.ownerKey)
    if (matches.length === 1) fact.handlerId = matches[0].nodeId
  }
  return result
}

// Candidate sets deliberately include both module.py and module/__init__.py.
// No suffix candidate wins merely because it was encountered first.
function moduleCandidates(spec: string, level: number, file: string, files: readonly string[]): string[] {
  const modulePath = spec.replace(/\./g, '/')
  if (level) {
    const dirs = path.posix.dirname(file).split('/').filter(p => p !== '.')
    if (level - 1 > dirs.length) return []
    const base = dirs.slice(0, dirs.length - level + 1).join('/')
    const p = [base, modulePath].filter(Boolean).join('/')
    return files.filter(f => f === p + '.py' || f === p + '/__init__.py').sort()
  }
  if (!spec) return []
  return files.filter(f => [modulePath + '.py', modulePath + '/__init__.py'].some(p => f === p || f.endsWith('/' + p))).sort()
}
function unique<T>(items: T[]): T | undefined { return items.length === 1 ? items[0] : undefined }
function callable(s: SymbolDefinition, data: ParsedPython): boolean {
  if (s.kind !== 'function' && s.kind !== 'method') return false
  return data.symbols.some(raw => raw.line === s.location.line && raw.name === s.name && raw.ownerKey === s.ownerKey && raw.callableEvidence === true)
}

export class PythonAdapter implements LanguageAdapter {
  readonly extensions = ['.py'] as const
  readonly supportsCallGraph = true
  extractFromSource(filePath: string, sourceText: string): ExtractionResult {
    const { data, warning } = parsePython(filePath, sourceText)
    return extracted(filePath, sourceText, data, warning)
  }
  resolveImportToFile(specifier: string, importingFile: string, knownFiles: readonly string[]): string | null {
    const from = specifier.match(/^from (\.+)([^\s]*)\s+import\s+(.+)$/)
    if (from) {
      const spec = from[2] || (from[3].includes(',') || from[3] === '*' ? '' : from[3])
      return unique(moduleCandidates(spec, from[1].length, importingFile, knownFiles)) ?? null
    }
    const dots = specifier.match(/^(\.+)(.*)$/)
    return unique(moduleCandidates(dots ? dots[2] : specifier, dots ? dots[1].length : 0, importingFile, knownFiles)) ?? null
  }
  extractCallGraphEdges(files: readonly SourceFileInput[]): CallGraphEdge[] {
    const parsed = new Map<string, { data: ParsedPython; symbols: SymbolDefinition[] }>()
    for (const f of files) {
      const { data } = parsePython(f.filePath, f.sourceText)
      if (data) parsed.set(f.filePath, { data, symbols: assignDeclarationIdentities(f.filePath, extracted(f.filePath, f.sourceText, data).symbols) })
    }
    // A malformed selected module still participates in path ambiguity.
    const known = files.map(f => f.filePath)
    const edges: CallGraphEdge[] = []
    for (const [file, { data, symbols }] of parsed) {
      const writeCount = (name: string) => data.writes.filter(n => n === name).length
      const hasWildcard = data.bindings.some(b => b.wildcard)
      const top = (name: string) => hasWildcard ? undefined : unique(symbols.filter(s => !s.ownerKey && s.name === name && writeCount(name) === 1))
      const method = (ownerKey: string, name: string) => {
        const scope = unique(data.classScopes.filter(s => s.ownerKey === ownerKey))
        if (!scope?.safe || scope.writes.filter(n => n === name).length !== 1) return undefined
        const candidate = unique(symbols.filter(s => s.ownerKey === ownerKey && s.name === name))
        return candidate && callable(candidate, data) ? candidate : undefined
      }
      const inModule = (targetFile: string, name: string) => {
        const target = parsed.get(targetFile)
        if (!target) return undefined
        if (target.data.writes.includes('__getattr__')) return undefined
        return unique(target.symbols.filter(s => !s.ownerKey && s.name === name && target.data.writes.filter(n => n === name).length === 1 && callable(s, target.data)))
      }
      for (const c of data.calls) {
        const caller = unique(symbols.filter(s => (s.qualifiedName ?? s.name) === c.caller.name && s.location.line === c.caller.line))
        const parts = c.calleeName.split('.')
        const base = parts[0]
        let target: SymbolDefinition | undefined
        if (caller && parts.length === 2 && c.receiver === base && c.owners.length) {
          const ownerKey = 'python/' + c.owners.map(n => 'class:' + n).join('/')
          target = method(ownerKey, parts[1])
        } else if (!c.blocked.includes(base)) {
          if (parts.length === 1) {
            const local = top(base)
            if (local && callable(local, data) && !data.bindings.some(b => b.wildcard)) target = local
          } else if (parts.length === 2) {
            const cls = top(base)
            if (cls?.kind === 'class' && !cls.declarationMetadata?.decorators?.length) {
              const candidate = method('python/class:' + base, parts[1])
              if (candidate?.declarationMetadata?.decorators?.some(d => d.path === 'staticmethod' || d.path === 'classmethod')) target = candidate
            }
          }
          if (!target && !hasWildcard && writeCount(base) === 1) {
            const binding = unique(data.bindings.filter(b => b.localName === base && b.topLevel && !b.wildcard))
            if (binding) {
              let spec = binding.sourceSpecifier.replace(/^\.+/, '')
              let name: string | undefined
              if (binding.form === 'from' && parts.length === 1) name = binding.importedName
              if (binding.form === 'import') {
                const prefix = binding.qualifier.split('.')
                if (parts.length === prefix.length + 1 && prefix.every((p, i) => p === parts[i])) name = parts.at(-1)
              }
              if (binding.form === 'from' && parts.length === 2) {
                // A package attribute can replace a same-named child module.
                // Without a unique unshadowed package binding, do not choose it.
                const parents = moduleCandidates(spec, binding.relativeLevel ?? 0, file, known)
                if (parents.length <= 1 && !parents.some(p => {
                  const parent = parsed.get(p)
                  return !parent || parent.data.writes.includes(binding.importedName) || parent.data.writes.includes('__getattr__')
                })) {
                  spec = [spec, binding.importedName].filter(Boolean).join('.')
                  name = parts[1]
                }
              }
              if (name) {
                const targetFile = unique(moduleCandidates(spec, binding.relativeLevel ?? 0, file, known))
                if (targetFile) target = inModule(targetFile, name)
              }
            }
          }
        }
        const observedName = c.receiver === base && parts.length === 2 ? [...c.owners, parts[1]].join('.') : c.calleeName
        edges.push({ caller: { file, ...c.caller }, callee: { file: target?.location.file ?? null, name: observedName }, callLine: c.callLine,
          ...(caller?.nodeId ? { callerNodeId: caller.nodeId } : {}),
          ...(caller?.nodeId && target?.nodeId ? { calleeNodeId: target.nodeId } : {}) })
      }
    }
    const seen = new Set<string>()
    return edges.filter(edge => {
      // The existing edge contract has line, but no expression column.
      const key = JSON.stringify([edge.callerNodeId, edge.calleeNodeId, edge.caller, edge.callee, edge.callLine])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => a.caller.file.localeCompare(b.caller.file) || a.callLine - b.callLine || a.callee.name.localeCompare(b.callee.name))
  }
}
