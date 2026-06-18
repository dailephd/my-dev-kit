import React, { useState, useEffect } from 'react'

export interface CardProps {
  title: string
  body: string
  onClick?: () => void
}

export interface HeaderProps {
  children: React.ReactNode
}

// Named exported function component
export function Card({ title, body, onClick }: CardProps) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    document.title = title
  }, [title])

  const handleToggle = () => setExpanded(!expanded)

  return (
    <div data-testid="card" aria-label={title} onClick={handleToggle}>
      <h2>{title}</h2>
      {expanded && <p aria-label="body">{body}</p>}
      {onClick && <button onClick={onClick}>Action</button>}
    </div>
  )
}

// Named exported arrow component
export const Header = ({ children }: HeaderProps) => {
  return <header>{children}</header>
}

// Default exported function component
export default function Footer() {
  return <footer>Footer content</footer>
}

// Local helper (not a component — lowercase)
function formatTitle(title: string): string {
  return title.trim()
}

// Hook-like function (not a component)
function useLocalState() {
  return useState(false)
}
