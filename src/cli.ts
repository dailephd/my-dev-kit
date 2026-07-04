#!/usr/bin/env node

import { Command } from 'commander'
import { registerIndexCommand } from './commands/indexCommand.js'
import { registerDataModelCommand } from './commands/dataModelCommand.js'
import { registerLookupCommand } from './commands/lookupCommand.js'
import { registerSearchCommand } from './commands/searchCommand.js'
import { registerSliceCommand } from './commands/sliceCommand.js'
import { registerSourceCommand } from './commands/sourceCommand.js'
import { registerViewCommand } from './commands/viewCommand.js'
import { registerContextCommand } from './commands/contextCommand.js'
import { VERSION } from './version.js'

export function createProgram(): Command {
  const program = new Command()

  program
    .name('my-dev-kit')
    .description('Local codebase graph, indexing, slicing, source retrieval, search, and Graphviz visualization CLI.')
    .version(VERSION)

  registerIndexCommand(program)
  registerDataModelCommand(program)
  registerViewCommand(program)
  registerLookupCommand(program)
  registerSourceCommand(program)
  registerSliceCommand(program)
  registerSearchCommand(program)
  registerContextCommand(program)

  return program
}

const program = createProgram()

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 2
})
