import { Router } from 'express'
const first = Router()
const second = Router()
function one() { return 1 }
function two() { return 2 }
first.get('/items', one)
second.get('/items', two)
