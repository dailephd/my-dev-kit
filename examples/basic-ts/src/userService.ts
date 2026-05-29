import type { User, UserRole } from './userTypes'

export function formatUser(user: User): string {
  return `${user.name} (${user.id})`
}

export function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'Administrator' : 'Member'
}
