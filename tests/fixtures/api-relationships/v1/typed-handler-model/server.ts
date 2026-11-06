import express from 'express'
import { User } from './model'
const app = express()
function listUsers(): User[] { return [] }
app.get('/users', listUsers)
