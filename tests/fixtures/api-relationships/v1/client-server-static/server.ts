import express from 'express'
import { listItems } from './handlers'
const app = express()
app.get('/items', listItems)
