import React from 'react'
import { loadUsers, loadMethod } from './client'
export function clickUsers() { return loadUsers() }
export function clickMethod() { return loadMethod() }
export function Users() { return <button onClick={clickUsers}>Load</button> }
