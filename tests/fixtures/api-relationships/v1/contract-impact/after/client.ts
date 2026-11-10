export function loadUsers() { return fetch('/users-v2') }
export function loadRemoved() { return fetch('/removed') }
export function loadMethod() { return fetch('/method', { method: 'POST' }) }
export function loadHandler() { return fetch('/handler') }
