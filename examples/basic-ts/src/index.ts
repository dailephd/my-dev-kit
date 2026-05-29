import { formatUser, roleLabel } from './userService'
import type { User, UserRole } from './userTypes'

export function describeUser(user: User, role: UserRole): string {
  return `${formatUser(user)} - ${roleLabel(role)}`
}
