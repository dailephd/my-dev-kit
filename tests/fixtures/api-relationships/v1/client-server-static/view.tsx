import { loadItems } from './client'
export function Items() {
  const onLoad = () => loadItems()
  return <button onClick={onLoad}>Load</button>
}
