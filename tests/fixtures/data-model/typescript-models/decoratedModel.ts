function Entity(): ClassDecorator {
  return () => {}
}

@Entity()
export class UserRecord {
  id!: string
}
