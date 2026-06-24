import { useState, useEffect } from 'react'

export interface DashboardNavProps {
  initialAuthToken: string | null
}

/**
 * A small navigation shell demonstrating v1.3 frontend-reachability facts:
 *  - a route-like Link target (`to="/dashboard"`) and an anchor href (`/settings`)
 *  - a localStorage key (`auth_token`) tied to a useState gate (`isLoggedIn`)
 *  - a state-gated UI marker (`data-testid="dashboard-panel"`) and an aria-label
 */
export function DashboardNav({ initialAuthToken }: DashboardNavProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(initialAuthToken !== null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    setIsLoggedIn(token !== null)
  }, [])

  const handleSignOut = () => {
    localStorage.removeItem('auth_token')
    setIsLoggedIn(false)
  }

  return (
    <nav data-testid="dashboard-nav" aria-label="dashboard navigation">
      <a href="/settings" data-testid="settings-link">
        Settings
      </a>
      <a to="/dashboard" data-testid="dashboard-link">
        Dashboard
      </a>
      <button type="button" data-testid="sign-out-button" onClick={handleSignOut}>
        Sign out
      </button>
      {isLoggedIn && (
        <div data-testid="dashboard-panel" aria-label="signed in panel">
          Welcome back
        </div>
      )}
    </nav>
  )
}
