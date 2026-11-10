import express from 'express'
import { User, Account } from './model'
const app = express()
export function listUsers(): Account { return new Account() }
export function listAccounts(): Account { return new Account() }
app.get('/users-v2', listUsers)
app.get('/added', listAccounts)
app.post('/method', listUsers)
app.get('/handler', listAccounts)
