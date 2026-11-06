import { Router } from 'express'
const router = Router()
declare const path: string
function handler() { return 1 }
router.get(path, handler)
const unrelated = { get: (...args: unknown[]) => args }
unrelated.get('/not-a-route', handler)
function configure() { router.post('/nested', handler) }
