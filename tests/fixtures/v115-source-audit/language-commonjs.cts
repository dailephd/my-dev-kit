import fs = require('node:fs')
import path = require('node:path')

const read = (file: string): string => fs.readFileSync(path.resolve(file), 'utf8')

export = { read }
