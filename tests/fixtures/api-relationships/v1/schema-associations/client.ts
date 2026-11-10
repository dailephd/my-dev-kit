import type { Item } from './model'
export function loadItems(): Promise<Item[]> { return fetch('/items') as unknown as Promise<Item[]> }
export function unknownType(): MissingIdentity { return fetch('/unknown') as unknown as MissingIdentity }
