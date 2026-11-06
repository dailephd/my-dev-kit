import type { User } from './model'
export function loadUsers(): Promise<User[]> { return fetch('/users') as unknown as Promise<User[]> }
