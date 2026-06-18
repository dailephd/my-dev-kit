import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'

export interface CounterProps {
  initialCount?: number
}

export function Counter({ initialCount = 0 }: CounterProps) {
  const [count, setCount] = useState(initialCount)
  const [label, setLabel] = useState('counter')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    document.title = `Count: ${count}`
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [count])

  const increment = useCallback(() => setCount((c) => c + 1), [])
  const doubled = useMemo(() => count * 2, [count])

  return (
    <div>
      <span data-testid="count-display">{count}</span>
      <span>{doubled}</span>
      <button onClick={increment} aria-label="increment">+</button>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Enter label"
        aria-label="label input"
      />
    </div>
  )
}
