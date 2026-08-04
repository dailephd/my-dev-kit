import { resolveArchitectureContract } from './architectureRegistry.js'

export function verifiesArchitectureContract(): boolean {
  return resolveArchitectureContract('fixture').id === 'fixture'
}
