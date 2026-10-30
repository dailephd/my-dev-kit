import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'

type CandidateResolver = (specifier: string, importer: string, files: readonly string[]) => string[]
interface Options {
  links: number
  paths?: { value: Record<string, string[]>; directory: string }
  baseUrl?: string
}

/** Static, repository-contained configuration evidence; never a compiler/module loader. */
export class ConfiguredImportResolver {
  private readonly root: string
  private readonly configs = new Map<string, Options | null>()
  private readonly evidence = new Map<string, string>()
  private readonly configSeen = new Set<string>()
  private readonly diagnostics = new Map<string, string>()

  constructor(repoRoot: string) {
    this.root = fs.realpathSync(repoRoot)
  }

  private contained(file: string): boolean {
    const relative = path.relative(this.root, file)
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) &&
      !relative.toLowerCase().split(path.sep).includes('node_modules')
  }

  /** Check every existing ancestor too: an absent child must not conceal a symlink escape. */
  private safe(file: string): boolean {
    if (!this.contained(file)) return false
    let current = file
    while (true) {
      try {
        const real = fs.realpathSync(current)
        return this.contained(real)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
        // A dangling symlink is untrusted, rather than proof of absence.
        try { if (fs.lstatSync(current).isSymbolicLink()) return false } catch { /* absent */ }
        const parent = path.dirname(current)
        if (parent === current) return false
        current = parent
      }
    }
  }

  private read(file: string): string | null {
    const key = path.relative(this.root, file).replace(/\\/g, '/')
    if (!this.safe(file)) { this.evidence.set(key, 'unsafe'); return null }
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile() || stat.size > 1024 * 1024) { this.evidence.set(key, 'unsupported'); return null }
      const text = fs.readFileSync(file, 'utf8')
      this.evidence.set(key, createHash('sha256').update(text).digest('hex'))
      return text
    } catch (error) {
      this.evidence.set(key, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable')
      return null
    }
  }

  private load(file: string, chain: readonly string[] = []): Options | null {
    if (chain.includes(file) || chain.length > 8) return null
    if (this.configs.has(file)) {
      const cached = this.configs.get(file)!
      return cached && cached.links + chain.length <= 8 ? cached : null
    }
    const text = this.read(file)
    if (text === null) return null
    let parsed: ReturnType<typeof ts.readConfigFile>
    try { parsed = ts.readConfigFile(file.replace(/\\/g, '/'), () => text) } catch { return null }
    if (parsed.error || !parsed.config || typeof parsed.config !== 'object' || Array.isArray(parsed.config)) return null
    const raw = parsed.config
    let effective: Options = { links: 0 }
    if (raw.extends !== undefined) {
      if (typeof raw.extends !== 'string' || !/^\.\.?[\\/]/.test(raw.extends)) return null
      let parent = path.resolve(path.dirname(file), raw.extends)
      if (!path.extname(parent)) parent += '.json'
      const inherited = this.load(parent, [...chain, file])
      if (!inherited) return null
      effective = { ...inherited, links: inherited.links + 1 }
    }
    const compiler = raw.compilerOptions ?? {}
    if (!compiler || typeof compiler !== 'object' || Array.isArray(compiler) ||
        ts.convertCompilerOptionsFromJson(compiler, path.dirname(file)).errors.length) return null
    // Custom suffix probing is outside this selected-source correction. Ignoring
    // it could turn a platform-specific target into an incorrect ordinary edge.
    if (compiler.moduleSuffixes !== undefined && JSON.stringify(compiler.moduleSuffixes) !== '[""]') return null
    if (compiler.baseUrl !== undefined) {
      if (typeof compiler.baseUrl !== 'string') return null
      effective.baseUrl = path.resolve(path.dirname(file), compiler.baseUrl)
      if (!this.safe(effective.baseUrl)) return null
    }
    if (compiler.paths !== undefined) {
      const mappings = compiler.paths
      if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) return null
      if (Object.keys(mappings).length > 256 || Object.entries(mappings).some(([key, targets]) => !key || (key.match(/\*/g)?.length ?? 0) > 1 ||
          !Array.isArray(targets) || !targets.length || targets.length > 32 || targets.some(target => typeof target !== 'string' ||
            !target || (target.match(/\*/g)?.length ?? 0) > 1))) return null
      effective.paths = { value: mappings, directory: path.dirname(file) }
    }
    this.configs.set(file, effective)
    return effective
  }

  private applicable(importer: string): Options | null {
    let directory = path.dirname(path.resolve(this.root, importer))
    if (!this.safe(path.resolve(this.root, importer))) return null
    while (this.contained(directory)) {
      const files = ['tsconfig.json', 'jsconfig.json'].map(name => path.join(directory, name))
      const present = files.filter(file => { this.read(file); return this.evidence.get(path.relative(this.root, file).replace(/\\/g, '/')) !== 'missing' })
      if (present.length) {
        this.configSeen.add(importer)
        return present.length === 1 ? this.load(present[0]) : null
      }
      if (directory === this.root) break
      directory = path.dirname(directory)
    }
    return null
  }

  resolve(specifier: string, importer: string, selected: readonly string[], candidates: CandidateResolver): string[] {
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) return []
    const config = this.applicable(importer)
    const diagnosticKey = `${importer}\0${specifier}`
    this.diagnostics.delete(diagnosticKey)
    const unresolved = () => this.diagnostics.set(diagnosticKey, `Configured import unresolved: ${specifier.slice(0, 160)} (missing, ambiguous, excluded, unsupported or unsafe evidence).`)
    if (!config && this.configSeen.has(importer)) unresolved()
    if (!config?.paths) return []
    const matches = Object.keys(config.paths.value).filter(key => {
      const star = key.indexOf('*')
      return star < 0 ? key === specifier : specifier.length >= key.length - 1 &&
        specifier.startsWith(key.slice(0, star)) && specifier.endsWith(key.slice(star + 1))
    })
    // TypeScript documents exact keys and longest wildcard prefix. Ties lack
    // unique evidence here; object insertion order is not ownership authority.
    if (matches.length) unresolved()
    const rank = (key: string) => [key.includes('*') ? 0 : 1, key.split('*')[0].length]
    matches.sort((a, b) => { const x = rank(a), y = rank(b); return y[0] - x[0] || y[1] - x[1] })
    if (!matches.length || (matches[1] && JSON.stringify(rank(matches[0])) === JSON.stringify(rank(matches[1])))) return []
    const key = matches[0]
    const wildcard = key.includes('*') ? specifier.slice(key.indexOf('*'), specifier.length - (key.length - key.indexOf('*') - 1)) : ''
    for (const target of config.paths.value[key]) {
      if (path.isAbsolute(target) || (!config.baseUrl && !/^\.\.?[\\/]/.test(target)) || (!key.includes('*') && target.includes('*'))) return []
      const absolute = path.resolve(config.baseUrl ?? config.paths.directory, target.replace('*', wildcard))
      if (!this.safe(absolute)) return []
      const base = path.relative(this.root, absolute).replace(/\\/g, '/')
      const relative = './' + path.posix.relative(path.posix.dirname(importer), base)
      // Probe only the existing B05 candidate family. Any earlier excluded/untrusted
      // physical target prevents a later selected fallback from becoming evidence.
      const ext = path.extname(base)
      if (ext && !['.ts', '.tsx', '.js', '.jsx', '.cjs'].includes(ext)) return []
      const probes = [base, ...(!ext ? ['.ts', '.tsx', '.js', '.jsx', '.cjs'].flatMap(e => [base + e, base + '/index' + e])
        : ext === '.js' ? [base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx']
        : ext === '.jsx' ? [base.slice(0, -4) + '.tsx'] : [])]
      // Declaration files and directory package metadata can establish a compiler
      // target outside our source inventory. Do not reinterpret that resolution
      // as an implementation-file edge, or skip it for a later mapping target.
      const blockers = !ext ? [base + '.d.ts', base + '/index.d.ts', base + '/package.json']
        : ext === '.js' ? [base.slice(0, -3) + '.d.ts']
        : ext === '.jsx' ? [base.slice(0, -4) + '.d.ts']
        : ext === '.cjs' ? [base.slice(0, -4) + '.cts', base.slice(0, -4) + '.d.cts'] : []
      const physical: string[] = []
      const presentBlockers: string[] = []
      for (const probe of [...blockers, ...probes]) {
        const file = path.resolve(this.root, probe)
        if (!this.safe(file)) { this.evidence.set('target:' + probe, 'unsafe'); return [] }
        try {
          const stat = fs.statSync(file)
          this.evidence.set('target:' + probe, stat.isFile() ? 'file' : 'directory')
          if (stat.isFile()) {
            if (blockers.includes(probe)) presentBlockers.push(probe)
            else physical.push(probe)
          }
        } catch (error) {
          this.evidence.set('target:' + probe, (error as NodeJS.ErrnoException).code ?? 'unreadable')
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') return []
        }
      }
      const possible = candidates(relative, importer, physical)
      if (presentBlockers.some(probe => {
        if (possible.length !== 1) return true
        const candidate = possible[0]
        if (probe.endsWith('.cts')) return true
        if (probe.endsWith('/package.json')) return candidate.startsWith(base + '/')
        const stem = probe.slice(0, -5) // .d.ts
        if ([stem + '.ts', stem + '.tsx'].includes(candidate)) return false
        // Direct source files precede directory index declarations.
        return !probe.endsWith('/index.d.ts') || candidate.startsWith(base + '/')
      })) return []
      if (!possible.length) continue
      if (possible.length !== 1 || !selected.includes(possible[0])) return []
      this.diagnostics.delete(diagnosticKey)
      return possible
    }
    return []
  }

  diagnostic(specifier: string, importer: string): string | undefined {
    return this.diagnostics.get(`${importer}\0${specifier}`)
  }

  fingerprint(importers: readonly string[], candidates: CandidateResolver): string {
    for (const importer of [...importers].sort()) {
      this.applicable(importer)
      // Preprocess selected source text only; detect JS require syntax too. This
      // fingerprints excluded earlier mapping targets appearing/disappearing,
      // which the selected-source cache alone cannot observe.
      const file = path.resolve(this.root, importer)
      if (!this.safe(file)) continue
      try {
        const source = fs.readFileSync(file, 'utf8')
        for (const entry of ts.preProcessFile(source, true, true).importedFiles) this.resolve(entry.fileName, importer, importers, candidates)
      } catch { this.evidence.set('source:' + importer, 'unreadable') }
    }
    return createHash('sha256').update(JSON.stringify([...this.evidence].sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
  }
}
