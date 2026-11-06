import express from 'express'
const app = express()
function users() { return [] }
app.get('/users', users)
