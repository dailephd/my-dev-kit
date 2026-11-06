import express from 'express'
import { User, Account } from './model'
const app = express()
export function listUsers(): User { return new User() }
export function listAccounts(): Account { return new Account() }
app.get('/users', listUsers)
app.get('/removed', listUsers)
app.get('/method', listUsers)
app.get('/handler', listUsers)
