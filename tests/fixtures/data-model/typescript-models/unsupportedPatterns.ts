export type Flags<T> = {
  [K in keyof T]: boolean
}

export type Selected<T> = T extends string ? T : never

export type PartialUser = Partial<User>

export interface User {
  id: string
}
