const sibling = require('./language-commonjs.cjs')
const { join } = require('node:path')

function build() {
  return join('a', 'b') + sibling.read
}

exports.build = build
module.exports.VERSION = '1'
