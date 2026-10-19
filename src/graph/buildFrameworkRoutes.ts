import type { CodeGraph, CodeGraphNode } from './codeGraphTypes.js'
import type { FileSummary, FrameworkRouteFact } from '../symbol-index/types.js'
import { PythonAdapter } from '../languages/python/adapter.js'

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
  const ids = new Set(nodes.map(node => node.id))
  if (ids.size !== nodes.length || new Set(edges.map(edge => edge.id)).size !== edges.length || edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) throw new Error('Invalid framework route graph identity or endpoint.')
  return { ...graph, nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)), summary: { ...graph.summary, nodeCount: nodes.length, edgeCount: edges.length } }
}
