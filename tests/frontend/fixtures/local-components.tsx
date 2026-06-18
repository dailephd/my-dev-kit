import React from 'react'

export interface ListProps {
  items: string[]
}

// Local sub-component defined inside parent
export function List({ items }: ListProps) {
  // Local helper component
  function ListItem({ value }: { value: string }) {
    return <li data-testid={`item-${value}`}>{value}</li>
  }

  const EmptyState = () => <p aria-label="empty list">No items</p>

  if (items.length === 0) {
    return <EmptyState />
  }

  return (
    <ul aria-label="item list">
      {items.map((item) => (
        <ListItem key={item} value={item} />
      ))}
    </ul>
  )
}
