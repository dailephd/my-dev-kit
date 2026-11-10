import express from 'express'
import type { Item } from './model'
const app = express()
function listItems(): Item[] { return [] }
app.get('/items', listItems)
