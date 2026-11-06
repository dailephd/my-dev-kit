export function loadItems() {
  return fetch('/items', { method: 'GET' })
}
