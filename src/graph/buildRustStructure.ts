import type { CodeGraph, CodeGraphEdgeKind, CodeGraphNode } from './codeGraphTypes.js'
import type { FileSummary } from '../symbol-index/types.js'
import { discoverCargoStructure } from '../languages/rust/cargo.js'
import { resolveRustModules, rustPackageId, rustTargetId } from '../languages/rust/moduleResolver.js'

/** Additive projection into the existing graph, shared by full and partial builds. */
export function buildRustStructure(graph: CodeGraph, repoRoot: string, summaries: readonly FileSummary[]): { graph: CodeGraph; warnings: string[]; packageCount: number; workspaceCount: number } {
  if (!summaries.some(f => f.language === 'rust')) return {graph,warnings:[],packageCount:0,workspaceCount:0}
  const cargo = discoverCargoStructure(repoRoot,summaries.filter(f => f.language === 'rust').map(f => f.path))
  const resolved = resolveRustModules(repoRoot,cargo.packages,summaries)
  const nodes = [...graph.nodes], edges = [...graph.edges]
  const ids = new Set(nodes.map(n => n.id)), edgeIds = new Set(edges.map(e => e.id))
  const node = (n: CodeGraphNode) => { if (ids.has(n.id)) throw new Error(`Duplicate Rust graph node: ${n.id}`); ids.add(n.id); nodes.push(n) }
  const edge = (source: string,kind:CodeGraphEdgeKind,target:string, conditional = false) => {
    if (!ids.has(source) || !ids.has(target)) throw new Error(`Invalid Rust graph endpoint: ${source} -> ${target}`)
    const id = `${source}--${kind}-->${target}`
    if (edgeIds.has(id)) throw new Error(`Duplicate Rust graph edge: ${id}`)
    edgeIds.add(id); edges.push({id,source,kind,target,...(conditional ? {metadata:{conditional:true}} : {})})
  }
  for (const pkg of cargo.packages) {
    const packageId = rustPackageId(pkg.manifest)
    node({id:packageId,kind:'rust-package',label:pkg.name,language:'rust',rustMetadata:{origin:'manifest',manifest:pkg.manifest,status:pkg.status,edition:pkg.edition,inheritedMetadata:pkg.inheritedMetadata,workspace:pkg.workspace,dependencies:pkg.dependencies}})
    for (const target of pkg.targets) {
      const targetId = rustTargetId(pkg.manifest,target)
      node({id:targetId,kind:'rust-target',label:target.name,language:'rust',...(target.status === 'RESOLVED' ? {path:target.root,line:1} : {}),rustMetadata:{origin:target.origin,manifest:pkg.manifest,status:target.status,targetKind:target.kind,targetName:target.name,root:target.root,reason:target.reason}})
      edge(packageId,'rust-package-has-target',targetId)
      if (target.status === 'RESOLVED' && ids.has(`file:${target.root}`)) edge(targetId,'rust-target-root-file',`file:${target.root}`)
    }
  }
  for (const m of resolved.modules) node({id:m.id,kind:'rust-module',label:m.modulePath,language:'rust',path:m.file,line:m.line,rustMetadata:{origin:m.origin,status:m.status,modulePath:m.modulePath,endLine:m.endLine,declarationId:m.declarationId,resolvedFile:m.resolvedFile,reason:m.reason,candidates:m.candidates}})
  for (const m of resolved.modules) {
    if (m.origin === 'root') edge(m.targetId,'rust-target-contains-module',m.id,m.status !== 'RESOLVED')
    if (m.parentId) edge(m.parentId,'rust-module-contains-module',m.id,m.status !== 'RESOLVED')
    if (m.origin !== 'external') edge(m.id,'rust-module-defined-in-file',`file:${m.file}`)
    if (m.status === 'RESOLVED' && m.resolvedFile) edge(m.id,'rust-module-resolves-to-file',`file:${m.resolvedFile}`)
  }
  nodes.sort((a,b) => a.id.localeCompare(b.id)); edges.sort((a,b) => a.id.localeCompare(b.id))
  return {graph:{...graph,nodes,edges,summary:{...graph.summary,nodeCount:nodes.length,edgeCount:edges.length}},warnings:[...cargo.warnings,...resolved.warnings],packageCount:cargo.packages.length,workspaceCount:cargo.workspaces.length}
}
