import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'smol-toml'

export type RustResolutionStatus = 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED_EXTERNAL' | 'UNRESOLVED_SELECTED_ROOTS' | 'CONDITIONAL' | 'UNSUPPORTED_SYNTAX' | 'MALFORMED'
export type RustTargetKind = 'lib' | 'bin' | 'test' | 'example' | 'bench' | 'proc-macro' | 'build-script' | 'unknown'
export interface CargoTarget {
  kind: RustTargetKind
  name: string
  root: string
  origin: 'manifest' | 'conventional'
  status: RustResolutionStatus
  reason?: string
}
export interface CargoDependency {
  /** Absent for an ordinary runtime dependency (compatible B09 shape). */
  dependencyKind?: 'dev' | 'build'
  name: string
  packageName: string
  manifest?: string
  optional: boolean
  conditional: boolean
  selected: boolean
  status: RustResolutionStatus
}
export interface CargoWorkspace {
  manifest: string
  members: string[]
  excludes: string[]
  defaultMembers: string[]
  status: RustResolutionStatus
}
export interface CargoPackage {
  /** Observed external names only; no registry/git body is inspected. */
  externPreludeNames?: string[]
  manifest: string
  name: string
  edition?: string
  inheritedMetadata: Record<string, string | string[] | boolean>
  workspace?: CargoWorkspace
  targets: CargoTarget[]
  dependencies: CargoDependency[]
  status: RustResolutionStatus
}
export interface CargoStructure {
  packages: CargoPackage[]
  workspaces: CargoWorkspace[]
  warnings: string[]
  fingerprint: string
}
type Table = Record<string, unknown>
const table = (v: unknown): v is Table => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length <= 2048)
const literal = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048 && !/[\x00-\x1f]/.test(v)
const slash = (p: string) => p.replace(/\\/g, '/')
const blocked = (p: string) => slash(p).toLowerCase().split('/').some(s => ['target', 'node_modules', '.git'].includes(s) || s.startsWith('.my-dev-kit'))

/** Lexical and physical containment. Missing destinations still check every existing ancestor. */
export function safeRustPath(repoRoot: string, base: string, value: string): string | undefined {
  if (!literal(value) || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes('\\')) return undefined
  const root = path.resolve(repoRoot)
  const dest = path.resolve(root, base, value)
  const rel = slash(path.relative(root, dest))
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel) || blocked(rel)) return undefined
  try {
    const realRoot = fs.realpathSync(root)
    let current = root
    for (const segment of rel.split('/').filter(Boolean)) {
      current = path.join(current, segment)
      if (!fs.existsSync(current)) {
        // existsSync is false for a dangling link; lstat must not accept it.
        try { if (fs.lstatSync(current).isSymbolicLink()) return undefined } catch { /* missing */ }
        break
      }
      const real = path.relative(realRoot, fs.realpathSync(current))
      if (real === '..' || real.startsWith('..' + path.sep) || path.isAbsolute(real)) return undefined
      // Local links are conservatively unsupported too; no aliasing physical identities.
      if (fs.lstatSync(current).isSymbolicLink()) return undefined
    }
    return rel
  } catch { return undefined }
}

/** Static bounded Cargo evidence. Selected source paths are the only source authority. */
export function discoverCargoStructure(repoRoot: string, selectedPaths: readonly string[]): CargoStructure {
  const selected = new Set(selectedPaths.filter(p => p.endsWith('.rs') && safeRustPath(repoRoot, '', p) === p).sort())
  const warnings: string[] = []
  const warn = (message: string) => { if (warnings.length < 255) warnings.push(message); else if (warnings.length === 255) warnings.push('Cargo diagnostics truncated at 256') }
  const docs = new Map<string, Table | null>()
  const evidence = new Map<string, string>()
  const owners = new Map<string, string>()
  const read = (manifest: string): Table | undefined => {
    if (docs.has(manifest)) return docs.get(manifest) ?? undefined
    if (docs.size >= 512) { warn('Cargo manifest inspection truncated at 512'); return undefined }
    if (safeRustPath(repoRoot, '', manifest) !== manifest) { warn(`Unsafe Cargo manifest: ${manifest}`); return undefined }
    const absolute = path.join(repoRoot, manifest)
    try {
      const stat = fs.statSync(absolute)
      if (!stat.isFile() || stat.size > 1024 * 1024) { evidence.set(manifest, 'oversize-or-not-file'); warn(`Cargo manifest unsupported size/type: ${manifest}`); docs.set(manifest, null); return undefined }
      const bytes = fs.readFileSync(absolute)
      if (bytes.length > 1024 * 1024) throw new Error('size changed')
      evidence.set(manifest, createHash('sha256').update(bytes).digest('hex'))
      const value: unknown = parse(bytes.toString('utf8'))
      if (!table(value)) throw new Error('not a table')
      if (value.package === undefined && value.workspace === undefined) warn(`Cargo manifest has no package/workspace table: ${manifest}`)
      docs.set(manifest, value)
      return value
    } catch {
      if (!evidence.has(manifest)) evidence.set(manifest, fs.existsSync(absolute) ? 'unreadable' : 'missing')
      if (fs.existsSync(absolute)) warn(`Malformed or unreadable Cargo manifest: ${manifest}`)
      docs.set(manifest, null)
      return undefined
    }
  }
  if (!selected.size) return { packages: [], workspaces: [], warnings, fingerprint: 'no-selected-rust' }
  for (const source of selected) {
    let dir = path.posix.dirname(source), nearest: string | undefined
    for (let depth = 0; depth < 8; depth++) {
      const manifest = path.posix.join(dir, 'Cargo.toml')
      const doc = read(manifest)
      if (!nearest && (doc || fs.existsSync(path.join(repoRoot, manifest)))) nearest = manifest
      if (dir === '.') break
      if (depth === 7) warn(`Cargo ancestry truncated at eight levels: ${source}`)
      dir = path.posix.dirname(dir)
    }
    if (nearest) owners.set(source, nearest)
  }
  const workspaces: CargoWorkspace[] = []
  const workspaceDocs = new Map<string, Table>()
  const membership = new Map<string, CargoWorkspace[]>()
  const excluded = new Set<string>()
  // Supported globs are bounded path segments with * and ?. Recursive/bracket/brace globs stay unknown.
  const expand = (base: string, patterns: string[], workspace: CargoWorkspace): string[] => {
    const found = new Set<string>()
    for (const pattern of patterns) {
      if (!literal(pattern) || /[\[\]{}!\\]/.test(pattern) || pattern.includes('**') || pattern.split('/').length > 8) {
        workspace.status = 'UNSUPPORTED_SYNTAX'; warn(`Unsupported workspace glob in ${workspace.manifest}`); continue
      }
      let dirs = [base]
      for (const segment of pattern.split('/')) {
        const next: string[] = []
        for (const dir of dirs) {
          if (!/[?*]/.test(segment)) {
            const safe = safeRustPath(repoRoot, dir, segment || '.')
            if (safe !== undefined) next.push(safe)
            else { workspace.status = 'UNSUPPORTED_SYNTAX'; warn(`Unsafe workspace member path: ${workspace.manifest}`) }
          } else {
            const expression = new RegExp('^' + segment.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$')
            try {
              const entries = fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))
              if (entries.length > 4096) { workspace.status = 'UNSUPPORTED_SYNTAX'; warn(`Workspace directory inspection truncated: ${workspace.manifest}`) }
              for (const entry of entries.slice(0,4096)) if (entry.isDirectory() && expression.test(entry.name)) {
                const safe = safeRustPath(repoRoot, dir, entry.name)
                if (safe !== undefined) next.push(safe)
              }
            } catch { /* missing supported directory */ }
          }
        }
        if (next.length > 256) { workspace.status = 'UNSUPPORTED_SYNTAX'; warn(`Workspace members truncated at 256: ${workspace.manifest}`) }
        dirs = [...new Set(next)].sort().slice(0,256)
      }
      for (const dir of dirs) found.add(path.posix.join(dir, 'Cargo.toml'))
      if (found.size > 256) { workspace.status = 'UNSUPPORTED_SYNTAX'; warn(`Workspace members truncated at 256: ${workspace.manifest}`); break }
    }
    return [...found].sort().slice(0,256)
  }
  for (const [manifest, doc] of [...docs].sort(([a],[b]) => a.localeCompare(b))) {
    if (!doc || !('workspace' in doc)) continue
    if (!table(doc.workspace)) { warn(`Malformed workspace table: ${manifest}`); continue }
    const ws = doc.workspace
    const record: CargoWorkspace = { manifest, members: [], excludes: [], defaultMembers: [], status: 'RESOLVED' }
    for (const key of ['members','exclude','default-members']) if (ws[key] !== undefined && !strings(ws[key])) { record.status = 'MALFORMED'; warn(`Malformed workspace ${key}: ${manifest}`) }
    const base = path.posix.dirname(manifest)
    record.excludes = expand(base, strings(ws.exclude) ? ws.exclude : [], record)
    record.members = expand(base, strings(ws.members) ? ws.members : [], record).filter(m => !record.excludes.includes(m))
    if (table(doc.package) && !record.excludes.includes(manifest)) record.members.unshift(manifest)
    record.defaultMembers = expand(base, strings(ws['default-members']) ? ws['default-members'] : [], record)
    record.members = [...new Set(record.members)].sort().slice(0,256)
    workspaces.push(record); workspaceDocs.set(manifest, ws)
    for (const m of record.excludes) excluded.add(m)
    for (let i = 0; i < record.members.length; i++) {
      const member = record.members[i]
      const memberDoc = read(member)
      if (!memberDoc) { record.status = 'UNSUPPORTED_SYNTAX'; warn(`Workspace member unavailable: ${member}`); continue }
      // Supported local path dependencies inside this workspace are implicit members.
      for (const section of ['dependencies','dev-dependencies','build-dependencies']) {
        const deps = memberDoc[section]
        if (!table(deps)) continue
        for (const value of Object.values(deps).slice(0,256)) if (table(value) && literal(value.path)) {
          const dep = safeRustPath(repoRoot, path.posix.dirname(member), value.path)
          const depManifest = dep === undefined ? undefined : path.posix.join(dep, 'Cargo.toml')
          if (depManifest && (base === '.' || depManifest.startsWith(base + '/')) && !record.excludes.includes(depManifest) && !record.members.includes(depManifest)) {
            if (record.members.length >= 256) { record.status = 'UNSUPPORTED_SYNTAX'; warn(`Workspace dependency members truncated: ${manifest}`) }
            else record.members.push(depManifest)
          }
        }
      }
    }
    record.members.sort()
    if (record.defaultMembers.some(member => !record.members.includes(member))) {
      record.status = 'UNSUPPORTED_SYNTAX'; warn(`Unproven workspace default-member selection: ${manifest}`)
    }
    if (!record.members.length) { record.status = 'UNSUPPORTED_SYNTAX'; warn(`Workspace has no supported members: ${manifest}`) }
    for (const member of record.members) membership.set(member, [...(membership.get(member) ?? []), record])
  }
  const packages: CargoPackage[] = []
  for (const [manifest, doc] of [...docs].sort(([a],[b]) => a.localeCompare(b))) {
    if (!doc || doc.package === undefined || excluded.has(manifest)) continue
    if (!table(doc.package) || !literal(doc.package.name) || !/^[\p{L}\p{N}_-]+$/u.test(doc.package.name)) { warn(`Malformed package name/table: ${manifest}`); continue }
    if (packages.length >= 256) { warn('Cargo package records truncated at 256'); break }
    const pkg = doc.package, name = pkg.name as string
    if ((pkg.edition !== undefined && !literal(pkg.edition) && !(table(pkg.edition) && pkg.edition.workspace === true)) ||
        ['autolib','autobins','autotests','autoexamples','autobenches'].some(key => pkg[key] !== undefined && typeof pkg[key] !== 'boolean')) {
      warn(`Malformed package edition/auto-target types: ${manifest}`)
      continue
    }
    const candidates = membership.get(manifest) ?? []
    let workspace = candidates.length === 1 ? candidates[0] : undefined
    if (pkg.workspace !== undefined) {
      const declared = literal(pkg.workspace) ? safeRustPath(repoRoot, path.posix.dirname(manifest), pkg.workspace) : undefined
      if (declared === undefined || workspace?.manifest !== path.posix.join(declared, 'Cargo.toml')) { workspace = undefined; warn(`Unsupported package.workspace: ${manifest}`) }
    }
    if (candidates.length > 1) { workspace = undefined; warn(`Ambiguous nested workspace membership: ${manifest}`) }
    const inheritedMetadata: CargoPackage['inheritedMetadata'] = {}
    const workspacePackage = workspaceDocs.get(workspace?.manifest ?? '')?.package
    for (const [key,value] of Object.entries(pkg)) if (table(value) && value.workspace === true) {
      const inherited = table(workspacePackage) ? workspacePackage[key] : undefined
      const supportedKey = ['version','edition','description','license','repository','rust-version','authors','keywords','categories','publish','homepage','documentation','readme','license-file','include','exclude'].includes(key)
      if (!supportedKey || !(typeof inherited === 'string' && inherited.length <= 2048 || typeof inherited === 'boolean' || strings(inherited) && inherited.length <= 64)) {
        warn(`Unsupported or truncated inherited package metadata ${key}: ${manifest}`)
        continue
      }
      if ((key === 'readme' || key === 'license-file') && typeof inherited === 'string') {
        const normalized = workspace && safeRustPath(repoRoot,path.posix.dirname(workspace.manifest),inherited)
        if (normalized === undefined) { warn(`Unsafe inherited package metadata ${key}: ${manifest}`); continue }
        inheritedMetadata[key] = normalized
      } else if ((key === 'include' || key === 'exclude') && strings(inherited) && inherited.some(p => path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.includes('\\'))) {
        warn(`Unsafe inherited package patterns ${key}: ${manifest}`)
      } else inheritedMetadata[key] = inherited
    }
    const edition = pkg.edition === undefined ? '2015' : typeof pkg.edition === 'string' ? pkg.edition : inheritedMetadata.edition
    const validEdition = typeof edition === 'string' && ['2015','2018','2021','2024'].includes(edition)
    const record: CargoPackage = { manifest, name, ...(validEdition ? { edition } : {}), inheritedMetadata, ...(workspace ? { workspace } : {}), targets: [], dependencies: [], status: validEdition ? 'RESOLVED' : 'UNSUPPORTED_SYNTAX' }
    if (!validEdition) warn(`Unsupported package edition: ${manifest}`)
    const containingWorkspace = workspaces.some(ws => {
      const dir = path.posix.dirname(ws.manifest)
      return ws.manifest !== manifest && (dir === '.' || manifest.startsWith(dir + '/'))
    })
    if ((!workspace && containingWorkspace) || candidates.length > 1) {
      record.status = 'UNSUPPORTED_SYNTAX'
      warn(`Unproven workspace package ownership: ${manifest}`)
      packages.push(record)
      continue
    }
    const base = path.posix.dirname(manifest)
    const conventional = new Map<RustTargetKind, Array<{name:string;root:string}>>()
    const observed = (kind: RustTargetKind, targetName: string, root: string) => {
      if (!safeRustPath(repoRoot, '', root)) return
      try { if (!fs.statSync(path.join(repoRoot,root)).isFile()) return } catch { return }
      const list = conventional.get(kind) ?? []; if (!list.some(t => t.root === root)) list.push({name:targetName,root}); conventional.set(kind,list)
    }
    observed('lib', name.replace(/-/g,'_'), path.posix.join(base,'src/lib.rs'))
    observed('bin', name, path.posix.join(base,'src/main.rs'))
    for (const file of selected) {
      if (owners.get(file) !== manifest) continue
      const rel = path.posix.relative(base,file)
      const match = /^(src\/bin|examples|tests|benches)\/([^/]+)(?:\.rs|\/main\.rs)$/.exec(rel)
      if (match) observed(({ 'src/bin':'bin',examples:'example',tests:'test',benches:'bench' } as const)[match[1] as 'tests'], match[2], file)
    }
    const explicitCount = ['lib','bin','test','example','bench'].filter(k => doc[k] !== undefined).length
    const otherTestRoles = new Set<string>()
    for (const kind of ['lib','bin','example','bench']) {
      const declarations = kind === 'lib' ? [doc.lib] : Array.isArray(doc[kind]) ? doc[kind] : []
      for (const declaration of declarations as unknown[]) if (table(declaration) && literal(declaration.path)) {
        const root = safeRustPath(repoRoot,base,declaration.path)
        if (root !== undefined) otherTestRoles.add(root)
      }
    }
    if (literal(pkg.build)) { const root = safeRustPath(repoRoot,base,pkg.build); if (root !== undefined) otherTestRoles.add(root) }
    const add = (kind: RustTargetKind, targetName: string, rawRoot: string, origin: CargoTarget['origin'], condition = false) => {
      if (record.targets.length >= 128) { warn(`Cargo targets truncated at 128: ${manifest}`); record.status = 'UNSUPPORTED_SYNTAX'; return }
      const root = safeRustPath(repoRoot,base,rawRoot)
      if (!root || !root.endsWith('.rs') || !literal(targetName)) { warn(`Unsupported target path/name: ${manifest}`); return }
      const conflictingOwner = selected.has(root) && owners.get(root) !== manifest
      record.targets.push({kind,name:targetName,root,origin,status: conflictingOwner ? 'AMBIGUOUS' : condition ? 'CONDITIONAL' : selected.has(root) ? 'RESOLVED' : 'UNRESOLVED_SELECTED_ROOTS', ...(conflictingOwner ? {reason:'Conflicting physical package owner'} : condition ? {reason:'required-features'} : {})})
    }
    for (const kind of ['lib','bin','test','example','bench'] as const) {
      const declarations = kind === 'lib' ? doc.lib === undefined ? [] : [doc.lib] : doc[kind] === undefined ? [] : Array.isArray(doc[kind]) ? doc[kind] : [null]
      const explicitNames = new Set<string>()
      for (const declaration of declarations as unknown[]) {
        if (!table(declaration) || (declaration.path !== undefined && !literal(declaration.path)) || (declaration.name !== undefined && !literal(declaration.name)) || (declaration['proc-macro'] !== undefined && typeof declaration['proc-macro'] !== 'boolean') || (declaration['crate-type'] !== undefined && !strings(declaration['crate-type'])) || (declaration['required-features'] !== undefined && !strings(declaration['required-features']))) { warn(`Malformed ${kind} target: ${manifest}`); continue }
        const targetName = typeof declaration.name === 'string' ? declaration.name : kind === 'lib' ? name.replace(/-/g,'_') : undefined
        if (!targetName) { warn(`Unsupported unnamed ${kind} target: ${manifest}`); continue }
        explicitNames.add(targetName)
        const roots = (conventional.get(kind) ?? []).filter(t => kind === 'lib' || t.name === targetName)
        const root = typeof declaration.path === 'string' ? declaration.path : kind === 'lib' ? 'src/lib.rs' : roots.length === 1 ? path.posix.relative(base,roots[0].root) : undefined
        if (!root) { warn(`Unresolved ${kind} target root: ${manifest}#${targetName}`); record.targets.push({kind,name:targetName,root:'',origin:'manifest',status:roots.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED_SELECTED_ROOTS',reason:'No unique supported root'}); continue }
        const macro = kind === 'lib' && (declaration['proc-macro'] === true || strings(declaration['crate-type']) && declaration['crate-type'].includes('proc-macro'))
        add(macro ? 'proc-macro' : kind,targetName,root,'manifest',strings(declaration['required-features']) && declaration['required-features'].length > 0)
      }
      const control = pkg['auto' + (kind === 'lib' ? 'lib' : kind === 'bin' ? 'bins' : kind === 'test' ? 'tests' : kind === 'example' ? 'examples' : 'benches')]
      if (control !== undefined && typeof control !== 'boolean') { warn(`Malformed auto-target control: ${manifest}`); continue }
      const enabled = control ?? (validEdition && !(edition === '2015' && explicitCount > 0))
      if (enabled && !(kind === 'lib' && declarations.length)) for (const target of conventional.get(kind) ?? []) if (!explicitNames.has(target.name) && !(kind === 'test' && otherTestRoles.has(target.root))) add(kind,target.name,path.posix.relative(base,target.root),'conventional')
    }
    if (pkg.build !== undefined && typeof pkg.build !== 'boolean' && !literal(pkg.build)) warn(`Malformed build script: ${manifest}`)
    else if (typeof pkg.build === 'string') add('build-script','build-script-build',pkg.build,'manifest')
    else if (pkg.build !== false && safeRustPath(repoRoot,base,'build.rs') && fs.existsSync(path.join(repoRoot,base,'build.rs'))) add('build-script','build-script-build','build.rs','conventional')
    const groups = new Map<string,CargoTarget[]>()
    for (const t of record.targets) { const k = `${t.kind}#${t.name}`; groups.set(k,[...(groups.get(k) ?? []),t]) }
    for (const group of groups.values()) if (group.length > 1) { for (const t of group) { t.status = 'AMBIGUOUS'; t.reason = 'conflicting target declarations' }; warn(`Conflicting Cargo targets: ${manifest}`) }
    record.targets = record.targets.filter((t,i,a) => a.findIndex(x => x.kind === t.kind && x.name === t.name && x.root === t.root) === i)
    const dependencyTables: Array<{values:unknown;conditional:boolean;dependencyKind?: 'dev' | 'build'}> = ['dependencies','dev-dependencies','build-dependencies'].map(k => ({values:doc[k],conditional:false,...(k === 'dev-dependencies' ? {dependencyKind:'dev' as const} : k === 'build-dependencies' ? {dependencyKind:'build' as const} : {})}))
    if (table(doc.target)) {
      if (Object.keys(doc.target).length > 256) { record.status = 'UNSUPPORTED_SYNTAX'; warn(`Cargo conditional dependency tables truncated at 256: ${manifest}`) }
      for (const value of Object.values(doc.target).slice(0,256)) if (table(value)) for (const k of ['dependencies','dev-dependencies','build-dependencies']) dependencyTables.push({values:value[k],conditional:true,...(k === 'dev-dependencies' ? {dependencyKind:'dev' as const} : k === 'build-dependencies' ? {dependencyKind:'build' as const} : {})})
    }
    let dependencyObservations = 0
    for (const section of dependencyTables) if (table(section.values)) for (const [depName,declared] of Object.entries(section.values)) {
      if (++dependencyObservations > 256) { record.status = 'UNSUPPORTED_SYNTAX'; warn(`Cargo dependency observations truncated at 256: ${manifest}`); break }
      if (!literal(depName)) { record.status = 'UNSUPPORTED_SYNTAX'; warn(`Unsupported dependency name: ${manifest}`); continue }
      if (!table(declared)) { (record.externPreludeNames ??= []).push(depName); continue }
      let value = declared
      if (declared.workspace === true) { const shared = workspaceDocs.get(workspace?.manifest ?? '')?.dependencies; const entry = table(shared) ? shared[depName] : undefined; if (table(entry)) value = {...entry,...declared} }
      if (value.path === undefined) { (record.externPreludeNames ??= []).push(depName); continue }
      const depBase = declared.workspace === true && workspace ? path.posix.dirname(workspace.manifest) : base
      const dep = literal(value.path) ? safeRustPath(repoRoot,depBase,value.path) : undefined
      const depManifest = dep === undefined ? undefined : path.posix.join(dep,'Cargo.toml')
      const isSelected = depManifest !== undefined && [...owners.values()].includes(depManifest)
      const malformed = value.optional !== undefined && typeof value.optional !== 'boolean' || value.package !== undefined && !literal(value.package)
      record.dependencies.push({name:depName,packageName:literal(value.package) ? value.package : depName, ...(section.dependencyKind ? {dependencyKind:section.dependencyKind} : {}), ...(depManifest ? {manifest:depManifest} : {}), optional:value.optional === true,conditional:section.conditional,selected:isSelected,status: malformed ? 'MALFORMED' : !depManifest ? 'UNSUPPORTED_SYNTAX' : section.conditional || value.optional === true ? 'CONDITIONAL' : isSelected ? 'RESOLVED' : 'UNRESOLVED_SELECTED_ROOTS'})
      if (malformed) warn(`Malformed local dependency metadata: ${manifest}#${depName}`)
      if (!depManifest) warn(`Unsafe or unsupported local dependency: ${manifest}#${depName}`)
    }
    packages.push(record)
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({evidence:[...evidence].sort(([a],[b]) => a.localeCompare(b)),workspaces,packages,warnings})).digest('hex')
  return {packages,workspaces,warnings,fingerprint}
}
