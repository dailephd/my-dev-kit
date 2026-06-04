export interface User {
  email: string
}

export function DynamicUserView(user: User, fieldName: keyof User) {
  const userViewModel = {
    value: user[fieldName],
  }

  return <span>{userViewModel.value}</span>
}
