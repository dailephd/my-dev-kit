import React from 'react'
import { loadUsers } from './client'
import { handleSubmit } from './handlers'
function handleClick() { return loadUsers() }
export function Users() {
  return <form onSubmit={handleSubmit}><button onClick={handleClick}>Load</button></form>
}
