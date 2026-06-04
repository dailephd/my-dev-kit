export interface User {
  email: string
}

type UserCardProps = {
  email: string
}

export function UserCard(props: UserCardProps) {
  return <span>{props.email}</span>
}

const sampleUser: User = {
  email: 'user@example.com',
}

const userViewModel = {
  email: sampleUser.email,
}

export function UserSpreadScreen() {
  return <UserCard {...userViewModel} />
}
