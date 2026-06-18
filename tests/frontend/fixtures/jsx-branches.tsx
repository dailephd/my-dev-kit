import React from 'react'

export interface AlertProps {
  type: 'error' | 'info' | 'success'
  message: string
  showClose?: boolean
}

export function Alert({ type, message, showClose }: AlertProps) {
  return (
    <div
      data-testid="alert"
      aria-label={`${type} alert`}
      role="alert"
    >
      {/* Ternary branch */}
      {type === 'error' ? (
        <span data-testid="error-icon">❌</span>
      ) : (
        <span data-testid="ok-icon">✓</span>
      )}

      {/* Logical branch */}
      {showClose && (
        <button aria-label="close" onClick={() => {}}>×</button>
      )}

      <p>{message}</p>
    </div>
  )
}
