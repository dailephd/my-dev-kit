import { buildUserViewModel, type User } from './models'

type UserCardProps = {
  email: string
}

export function UserCard(props: UserCardProps) {
  return <span>{props.email}</span>
}

const sampleUser: User = {
  id: '1',
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
