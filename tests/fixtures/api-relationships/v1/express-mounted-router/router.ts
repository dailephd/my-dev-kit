import { Router } from 'express'
import { listUsers } from './handler'
export const router = Router()
router.get('/users', listUsers)
