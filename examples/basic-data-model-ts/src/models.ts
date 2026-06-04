export interface User {
  id: string
  email: string
  displayName: string
}

export type UserViewModel = {
  email: string
  displayName: string
}

export class UserRecord {
  id!: string
  email!: string
}

export function buildUserViewModel(user: User): UserViewModel {
  return {
    email: user.email,
    displayName: user.displayName,
  }
}
