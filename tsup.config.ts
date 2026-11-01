import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// Orchard 0.16.10, npm gitHead 40c49d490c866ef6ca41f59b69f714f03c8ac599.
// Reuse the reviewed B01 asset; building/installing this package never builds a grammar.
const grammarLicense = `The MIT License (MIT)

Copyright (c) 2017 Maxim Sokolov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

tree-sitter-rust-orchard@0.16.10
https://codeberg.org/grammar-orchard/tree-sitter-rust-orchard
gitHead: 40c49d490c866ef6ca41f59b69f714f03c8ac599
WASM SHA-256: d98c6aa1db69cfd204bf07dfefb2451b987160cbb2db95ddac8ac04b5f1eb1d0
`

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  clean: true,
  dts: false,
  sourcemap: false,
  onSuccess: async () => {
    const source = 'src/languages/rust/assets/tree-sitter-rust-orchard.wasm'
    if (createHash('sha256').update(readFileSync(source)).digest('hex') !== 'd98c6aa1db69cfd204bf07dfefb2451b987160cbb2db95ddac8ac04b5f1eb1d0') throw new Error('Qualified Rust grammar checksum mismatch')
    mkdirSync('dist/assets', { recursive: true })
    copyFileSync(source, 'dist/assets/tree-sitter-rust-orchard.wasm')
    writeFileSync('dist/assets/tree-sitter-rust-orchard.LICENSE', grammarLicense)
  },
})
