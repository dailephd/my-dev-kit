import * as path from 'node:path'
import type { FileSummary } from '../../symbol-index/types.js'
import { safeRustPath, type CargoPackage, type CargoTarget, type RustResolutionStatus } from './cargo.js'

export interface RustModule {
  id: string
  targetId: string
  modulePath: string
  origin: 'root' | 'inline' | 'external'
  parentId?: string
  file: string
  line: number
  endLine?: number
  declarationId?: string
  resolvedFile?: string
  status: RustResolutionStatus
  reason?: string
  candidates?: string[]
}
export const rustPackageId = (manifest: string) => `rust-package:${encodeURIComponent(manifest)}`
export const rustTargetId = (manifest: string, target: CargoTarget) => `rust-target:${encodeURIComponent(manifest)}#${encodeURIComponent(target.kind)}#${encodeURIComponent(target.name)}#${encodeURIComponent(target.root)}`
export const rustModuleId = (target: string, modulePath: string) => `rust-module:${encodeURIComponent(target)}#${encodeURIComponent(modulePath)}`

/** Consumes persisted B08 facts; never parses Rust text or resolves use imports. */
export function resolveRustModules(repoRoot: string, packages: readonly CargoPackage[], summaries: readonly FileSummary[]): { modules: RustModule[]; warnings: string[] } {
  const files = new Map(summaries.filter(f => f.language === 'rust' && safeRustPath(repoRoot,'',f.path) === f.path).map(f => [f.path,f]))
  const modules: RustModule[] = [], warnings: string[] = []
  const warn = (message: string) => { if (warnings.length < 255) warnings.push(message); else if (warnings.length === 255) warnings.push('Rust module diagnostics truncated at 256') }
  interface Context { file: string; parent: RustModule; dir: string; owner?: string; inline: boolean; ancestors: string[]; depth: number }
  const innerConditional = (file: string, owner?: string) => (files.get(file)?.rustSyntaxFacts ?? []).some(f => f.kind === 'attribute' && f.syntaxKind === 'inner_attribute_item' && f.ownerKey === owner && f.attributes?.some(a => /^#!\s*\[\s*cfg(?:_attr)?\b/.test(a)))
  for (const pkg of packages) for (const target of pkg.targets) {
    if (target.status !== 'RESOLVED' || !files.has(target.root)) continue
    const targetId = rustTargetId(pkg.manifest,target)
    const root: RustModule = {id:rustModuleId(targetId,'crate'),targetId,modulePath:'crate',origin:'root',file:target.root,line:1,endLine:files.get(target.root)!.lineCount,status:'RESOLVED'}
    if (innerConditional(target.root)) { root.status = 'CONDITIONAL'; root.reason = 'Observed file-level cfg/cfg_attr; activation unknown' }
    modules.push(root)
    const pending: Context[] = [{file:target.root,parent:root,dir:path.posix.dirname(target.root),inline:false,ancestors:[target.root],depth:0}]
    while (pending.length) {
      const context = pending.pop()!
      const facts = (files.get(context.file)?.rustSyntaxFacts ?? []).filter(f => f.kind === 'module' && f.ownerKey === context.owner)
      const counts = new Map<string,number>()
      for (const f of facts) { const name = f.name?.replace(/^r#/,'') ?? ''; counts.set(name,(counts.get(name) ?? 0)+1) }
      const children: Context[] = []
      for (const fact of facts) {
        if (modules.length >= 65536 || context.depth >= 128) { warn('Rust module contexts truncated (65536 records / 128 depth)'); pending.length = 0; break }
        if (!fact.name) continue
        const modulePath = `${context.parent.modulePath}::${fact.name.replace(/^r#/, '')}`
        const duplicate = (counts.get(fact.name.replace(/^r#/,'')) ?? 0) > 1
        const suffix = duplicate ? `@${context.file}:${fact.line}:${fact.sourceIndex ?? fact.moduleKey ?? fact.nodeId ?? ''}` : ''
        const record: RustModule = {id:rustModuleId(targetId,modulePath+suffix),targetId,modulePath,origin:fact.inline ? 'inline' : 'external',parentId:context.parent.id,file:context.file,line:fact.line,...(fact.endLine ? {endLine:fact.endLine} : {}),...(fact.nodeId ? {declarationId:fact.nodeId} : {}),status:'RESOLVED'}
        const attrs = fact.attributes ?? []
        const paths = attrs.filter(a => /^#\s*\[\s*path\b/.test(a))
        const conditional = attrs.some(a => /^#\s*\[\s*cfg(?:_attr)?\b/.test(a)) || fact.inline && innerConditional(context.file,fact.moduleKey)
        const unknownAttribute = attrs.some(a => !/^#\s*\[\s*(?:path|cfg|cfg_attr|doc|allow|warn|deny|forbid|expect|deprecated|no_implicit_prelude)\b/.test(a))
        let literalPath: string | undefined
        if (paths.length === 1) {
          const match = /^#\s*\[\s*path\s*=\s*"([^"\\\x00-\x1f]+)"\s*\]$/.exec(paths[0])
          if (match) literalPath = match[1]
        }
        if (fact.status === 'parser-error' || !fact.endLine) { record.status = 'MALFORMED'; record.reason = 'Parser did not prove a complete declaration' }
        else if (duplicate) { record.status = 'AMBIGUOUS'; record.reason = 'Competing module declarations in one lexical scope' }
        else if (conditional || context.parent.status === 'CONDITIONAL') { record.status = 'CONDITIONAL'; record.reason = 'Observed cfg/cfg_attr or conditional ancestor; activation unknown' }
        else if (context.parent.status !== 'RESOLVED') { record.status = context.parent.status; record.reason = 'Unresolved lexical ancestor' }
        else if (unknownAttribute || paths.length > 1 || paths.length && !literalPath) { record.status = 'UNSUPPORTED_SYNTAX'; record.reason = 'Unsupported macro attribute or path expression' }
        const attrBase = context.inline ? context.dir : path.posix.dirname(context.file)
        let nextDir = safeRustPath(repoRoot,context.dir,fact.name.replace(/^r#/,''))
        if (literalPath !== undefined && fact.inline) nextDir = safeRustPath(repoRoot,attrBase,literalPath)
        if (fact.inline) {
          if (nextDir === undefined && record.status === 'RESOLVED') { record.status = 'UNSUPPORTED_SYNTAX'; record.reason = 'Unsafe inline module directory' }
          if (fact.moduleKey && nextDir !== undefined) children.push({...context,parent:record,dir:nextDir,owner:fact.moduleKey,inline:true,depth:context.depth+1})
          else if (!fact.moduleKey) { record.status = 'UNSUPPORTED_SYNTAX'; record.reason = 'Missing parser-owned module key' }
        } else if (record.status === 'RESOLVED') {
          const candidates = literalPath !== undefined ? [safeRustPath(repoRoot,attrBase,literalPath)] : [safeRustPath(repoRoot,context.dir,`${fact.name.replace(/^r#/,'')}.rs`),safeRustPath(repoRoot,context.dir,`${fact.name.replace(/^r#/,'')}/mod.rs`)]
          if (candidates.some(c => c === undefined || !c.endsWith('.rs'))) { record.status = 'UNSUPPORTED_SYNTAX'; record.reason = 'Unsafe or unsupported module file path' }
          else {
            const matches = [...new Set(candidates.filter((c): c is string => c !== undefined && files.has(c)))]
            record.candidates = matches.slice(0,8)
            if (matches.length > 1) { record.status = 'AMBIGUOUS'; record.reason = 'Both module file conventions are selected' }
            else if (!matches.length) { record.status = 'UNRESOLVED_SELECTED_ROOTS'; record.reason = 'No supported selected source target' }
            else if (context.ancestors.includes(matches[0])) { record.status = 'UNSUPPORTED_SYNTAX'; record.reason = 'Recursive module file inclusion' }
            else if (innerConditional(matches[0])) { record.status = 'CONDITIONAL'; record.reason = 'Observed module-file cfg/cfg_attr; activation unknown' }
            else {
              record.resolvedFile = matches[0]
              const file = matches[0]
              const dir = path.posix.basename(file) === 'mod.rs' ? path.posix.dirname(file) : file.slice(0,-3)
              children.push({file,parent:record,dir,inline:false,ancestors:[...context.ancestors,file],depth:context.depth+1})
            }
          }
        }
        if (record.status !== 'RESOLVED') warn(`${record.status}: ${context.file}:${fact.line} ${modulePath}: ${record.reason}`)
        modules.push(record)
      }
      pending.push(...children.reverse())
    }
  }
  return {modules,warnings}
}
