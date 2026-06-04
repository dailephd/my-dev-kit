export interface User {
  email: string
  displayName: string
}

export function buildUserViewModel(user: User) {
  return {
    email: user.email,
    displayName: user.displayName,
  }
}

type UserCardProps = {
  email: string
}

export function UserCard(props: UserCardProps) {
  return <span>{props.email}</span>
}

const sampleUser: User = {
  email: 'user@example.com',
  displayName: 'Ada',
}

const userViewModel = buildUserViewModel(sampleUser)

export function UserScreen() {
  return (
    <section>
      <UserCard email={userViewModel.email} />
      <p>{userViewModel.displayName}</p>
    </section>
  )
}
