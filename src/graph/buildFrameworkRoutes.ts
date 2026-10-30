import type { CodeGraph, CodeGraphNode } from './codeGraphTypes.js'
import type { FileSummary, FrameworkRouteFact } from '../symbol-index/types.js'
import { PythonAdapter } from '../languages/python/adapter.js'
import { resolveJsTsCandidates } from '../languages/typescript/adapter.js'

/** Project observed declarations into the existing graph; never execute routers. */
export function buildFrameworkRoutes(graph: CodeGraph, files: readonly FileSummary[]): CodeGraph {
  const nodes = [...graph.nodes]
  const edges = [...graph.edges]
  const nodeIds = new Set(nodes.map(node => node.id))
  const python = files.filter(file => file.language === 'python').sort((a, b) => a.path.localeCompare(b.path))
  const paths = python.map(file => file.path)
  const adapter = new PythonAdapter()
  type Router = { file: FileSummary; fact: FrameworkRouteFact; key: string }
  const routers: Router[] = python.flatMap(file => (file.frameworkRouteFacts ?? []).filter(fact => fact.kind === 'router').map(fact => ({ file, fact, key: `${file.path}#${fact.name}` })))
  const resolveRouter = (file: FileSummary, name: string): Router | undefined => {
    const local = routers.filter(r => r.file.path === file.path && r.fact.name === name)
    if (local.length) return local.length === 1 ? local[0] : undefined
    const parts = name.split('.')
    const imports = (file.frameworkRouteFacts ?? []).filter(f => f.kind === 'import' && f.name === parts[0])
    if (imports.length !== 1) return undefined
    const binding = imports[0]
    if (!binding.module) return undefined
    const targetName = binding.importedName && parts.length === 1 ? binding.importedName : !binding.importedName && parts.slice(0, -1).join('.') === binding.qualifier ? parts.at(-1) : undefined
    if (!targetName) return undefined
    const targetFile = adapter.resolveImportToFile('.'.repeat(binding.relativeLevel ?? 0) + binding.module.replace(/^\.+/, ''), file.path, paths)
    const matches = routers.filter(r => r.file.path === targetFile && r.fact.name === targetName)
    return matches.length === 1 ? matches[0] : undefined
  }
  const routes: Array<{ router: Router; node: CodeGraphNode }> = []
  for (const file of python) {
    const facts = (file.frameworkRouteFacts ?? []).filter(f => f.kind === 'route').sort((a, b) => a.line - b.line || a.column - b.column)
    for (const [ordinal, fact] of facts.entries()) {
      if (!nodeIds.has(`file:${file.path}`)) continue
      const router = resolveRouter(file, fact.name)
      if (!router) continue
      const handler = fact.handlerId && graph.nodes.find(n => n.id === fact.handlerId && n.kind === 'symbol' && n.path === file.path && n.symbolName === fact.handlerName && n.line === fact.handlerLine)
      const key = fact.handlerId ?? `${fact.line}:${fact.column}`
      const id = 'framework-route:' + [file.path, 'fastapi', key, fact.method ?? 'UNKNOWN', fact.path ?? 'unknown'].map(encodeURIComponent).join('#') + `#${ordinal}`
      const status = fact.status === 'static' && router.fact.status === 'static' ? 'static' : 'unresolved'
      const node: CodeGraphNode = { id, kind: 'framework-route', label: `${fact.method ?? 'UNKNOWN'} ${fact.path ?? '<unresolved>'}`, path: file.path, line: fact.line, language: 'python', routeMetadata: { framework: 'fastapi', method: fact.method ?? 'UNKNOWN', observedPath: fact.path ?? null, line: fact.line, pathStatus: status, routerPrefix: router.fact.prefix ?? null, handlerId: handler ? handler.id : null } }
      nodes.push(node)
      edges.push({ id: `${id}--defined-in-file`, source: id, target: `file:${file.path}`, kind: 'framework-route-defined-in-file' })
      if (handler && fact.status === 'static') edges.push({ id: `${id}--handled-by-symbol`, source: id, target: handler.id, kind: 'framework-route-handled-by-symbol' })
      routes.push({ router, node })
    }
  }
  type Mount = { owner: Router; target: Router; fact: FrameworkRouteFact; identity: string }
  const mounts: Mount[] = []
  for (const file of python) for (const fact of file.frameworkRouteFacts ?? []) {
    if (fact.kind !== 'mount' || fact.status !== 'static' || !fact.target || fact.prefix === undefined) continue
    const owner = resolveRouter(file, fact.name)
    const target = resolveRouter(file, fact.target)
    if (!owner || !target || owner.fact.status !== 'static' || target.fact.status !== 'static') continue
    mounts.push({ owner, target, fact, identity: `${file.path}:${fact.line}:${fact.column}` })
  }
  for (const mount of mounts) {
      const prefix = (mount.owner.fact.prefix ?? '') + mount.fact.prefix + (mount.target.fact.prefix ?? '')
      for (const route of routes.filter(r => r.router.key === mount.target.key)) {
        if (route.node.routeMetadata?.pathStatus !== 'static') continue
        const source = `file:${mount.owner.file.path}`
        if (!nodeIds.has(source)) continue
        const identity = mount.identity
        edges.push({ id: `framework-mount:${encodeURIComponent(identity)}#${encodeURIComponent(route.node.id)}`, source, target: route.node.id, kind: 'framework-router-mounts-route', metadata: { callSite: identity.slice(0, 1024), line: mount.fact.line, column: mount.fact.column, prefix: prefix.slice(0, 1024), status: 'static' } })
      }
  }
  projectJsFrameworks(graph, files, nodes, edges)
  const ids = new Set(nodes.map(node => node.id))
  if (ids.size !== nodes.length || new Set(edges.map(edge => edge.id)).size !== edges.length || edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) throw new Error('Invalid framework route graph identity or endpoint.')
  return { ...graph, nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)), summary: { ...graph.summary, nodeCount: nodes.length, edgeCount: edges.length } }
}

function projectJsFrameworks(graph: CodeGraph, files: readonly FileSummary[], nodes: CodeGraphNode[], edges: CodeGraph['edges']): void {
  const selected = files.filter(f => f.language === 'javascript' || f.language === 'typescript').sort((a, b) => a.path.localeCompare(b.path))
  const known = selected.map(f => f.path)
  const nodeIds = new Set(graph.nodes.map(n => n.id))
  type Binding = { file: FileSummary; name: string; handlerLine?: number }
  const exportedBinding = (file: FileSummary, name: string): Binding | undefined => {
    const exports = (file.frameworkRouteFacts ?? []).filter(f => f.kind === 'export' && (f.name === name || name === 'default' && f.name === '*' && f.provenance === 'commonjs') && f.status === 'static')
    return exports.length === 1 && exports[0].target ? { file, name: exports[0].target, handlerLine: exports[0].handlerLine } : undefined
  }
  const importedBinding = (file: FileSummary, name: string): Binding | undefined => {
    const bindings = (file.importBindings ?? []).filter(b => b.localName === name && b.resolutionStatus !== 'unresolved' && b.resolutionStatus !== 'ambiguous')
    if (bindings.length !== 1) return
    const binding = bindings[0]
    const targets = resolveJsTsCandidates(binding.sourceSpecifier, file.path, known)
    if (targets.length !== 1) return
    const target = selected.find(f => f.path === targets[0])!
    return exportedBinding(target, binding.importedName)
  }
  const router = (file: FileSummary, name: string, seen = new Set<string>()): Binding | undefined => {
    const key = `${file.path}#${name}`
    if (seen.has(key)) return
    seen.add(key)
    const local = (file.frameworkRouteFacts ?? []).filter(f => f.framework === 'express' && f.kind === 'router' && f.name === name && f.status === 'static')
    if (local.length === 1) return local[0].target ? router(file, local[0].target, seen) : { file, name }
    if (local.length > 1) return
    const imported = importedBinding(file, name)
    return imported ? router(imported.file, imported.name, seen) : undefined
  }
  const routes: Array<{ binding?: Binding; node: CodeGraphNode }> = []
  for (const file of selected) {
    const facts = (file.frameworkRouteFacts ?? []).filter(f => f.kind === 'route' && (f.framework === 'express' || f.framework === 'nestjs')).sort((a, b) => a.line - b.line || a.column - b.column)
    for (const [ordinal, fact] of facts.entries()) {
      if (!nodeIds.has(`file:${file.path}`)) continue
      const binding = fact.framework === 'express' ? router(file, fact.name) : undefined
      if (fact.framework === 'express' && !binding) continue
      let handler = fact.handlerId ? graph.nodes.find(n => n.id === fact.handlerId && n.kind === 'symbol' && n.path === file.path && n.symbolName === fact.handlerName && n.line === fact.handlerLine && n.ownerKey === fact.ownerKey) : undefined
      if (!handler && fact.framework === 'express' && fact.handlerName && fact.handlerLine === undefined) {
        const imported = importedBinding(file, fact.handlerName)
        const matches = imported?.handlerLine !== undefined ? imported.file.symbols.filter(s => s.name === imported.name && !s.ownerKey && s.location.line === imported.handlerLine && ['function', 'const'].includes(s.kind)) : []
        if (matches.length === 1) handler = graph.nodes.find(n => n.kind === 'symbol' && n.id === matches[0].nodeId && n.path === imported!.file.path)
      }
      const key = handler?.id ?? `${fact.line}:${fact.column}`
      const id = 'framework-route:' + [file.path, fact.framework!, key, fact.method ?? 'UNKNOWN', fact.path ?? 'unknown'].map(encodeURIComponent).join('#') + `#${ordinal}`
      const composed = fact.framework === 'nestjs' && fact.prefix !== undefined && fact.path !== undefined ? '/' + [fact.prefix, fact.path].map(p => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/') : null
      const node: CodeGraphNode = { id, kind: 'framework-route', label: `${fact.method ?? 'UNKNOWN'} ${fact.path ?? '<unresolved>'}`, path: file.path, line: fact.line, language: file.language, routeMetadata: { framework: fact.framework!, method: fact.method ?? 'UNKNOWN', observedPath: fact.path ?? null, line: fact.line, column: fact.column, endLine: fact.endLine ?? null, pathStatus: fact.status, ownerBinding: fact.name, handlerId: handler?.id ?? null, handlerStatus: handler ? 'resolved' : 'unresolved', provenance: fact.provenance ?? null, syntax: (fact.syntax ?? []).join(' | ').slice(0, 2560), warnings: (fact.warnings ?? []).join(' | ').slice(0, 1024), ...(fact.framework === 'nestjs' ? { controllerId: fact.controllerId ?? null, controllerPrefix: fact.prefix ?? null, composedPath: composed, compositionStatus: composed === null ? 'unresolved' : 'static-source-composition' } : { routerPrefix: binding ? '' : null }) } }
      nodes.push(node)
      edges.push({ id: `${id}--defined-in-file`, source: id, target: `file:${file.path}`, kind: 'framework-route-defined-in-file' })
      if (handler && fact.status === 'static') edges.push({ id: `${id}--handled-by-symbol`, source: id, target: handler.id, kind: 'framework-route-handled-by-symbol' })
      node.routeMetadata!.syntaxStatus = 'observed-source-only'
      routes.push({ binding, node })
    }
  }
  for (const file of selected) for (const fact of file.frameworkRouteFacts ?? []) {
    if (fact.framework !== 'express' || fact.kind !== 'mount' || fact.status !== 'static' || !fact.target || fact.prefix === undefined || !nodeIds.has(`file:${file.path}`) || !router(file, fact.name)) continue
    const target = router(file, fact.target)
    if (!target) continue
    for (const route of routes) {
      if (route.binding?.file.path !== target.file.path || route.binding.name !== target.name || route.node.routeMetadata?.pathStatus !== 'static') continue
      const callSite = `${file.path}:${fact.line}:${fact.column}`
      edges.push({ id: `framework-mount:${encodeURIComponent(callSite)}#${encodeURIComponent(route.node.id)}`, source: `file:${file.path}`, target: route.node.id, kind: 'framework-router-mounts-route', metadata: { callSite, line: fact.line, column: fact.column, prefix: fact.prefix, status: 'static', framework: 'express' } })
    }
  }
}
