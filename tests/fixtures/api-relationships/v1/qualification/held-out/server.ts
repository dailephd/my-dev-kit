import express from 'express'
import type { Twin } from './model'
const app = express()
export function ok() { return [] }
export function other() { return [] }
export function ambiguous(): Twin { return {} as Twin }
app.get('/ok', ok)
app.get('/dupe', ok)
app.get('/dupe', other)
app.get('/case', ok)
app.get('/ambiguous', ambiguous)
