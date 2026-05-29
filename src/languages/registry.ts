import * as path from 'node:path'
import type { LanguageAdapter } from './types.js'
import { TypeScriptAdapter } from './typescript/adapter.js'
import { PythonAdapter } from './python/adapter.js'

export class LanguageRegistry {
  private readonly adapters: LanguageAdapter[] = []

  register(adapter: LanguageAdapter): void {
    this.adapters.push(adapter)
  }

  adapterForFile(filePath: string): LanguageAdapter | null {
    const ext = path.extname(filePath).toLowerCase()
    for (const adapter of this.adapters) {
      if ((adapter.extensions as readonly string[]).includes(ext)) return adapter
    }
    return null
  }

  supportsFile(filename: string): boolean {
    return this.adapterForFile(filename) !== null
  }
}

export function createDefaultRegistry(): LanguageRegistry {
  const registry = new LanguageRegistry()
  registry.register(new TypeScriptAdapter())
  registry.register(new PythonAdapter())
  return registry
}
