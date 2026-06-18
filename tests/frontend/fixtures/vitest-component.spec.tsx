import { describe, it, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('Button component', () => {
  beforeEach(() => {
    // setup
  })

  afterEach(() => {
    // cleanup
  })

  it('renders label text', () => {
    const { getByText } = render(<button>Click me</button>)
    expect(getByText('Click me')).toBeDefined()
  })

  it('handles click events', () => {
    // test click
  })

  describe('when disabled', () => {
    test('does not fire onClick', () => {
      // nested test
    })

    test.skip('accessibility check', () => {
      // skipped
    })
  })
})

test.only('standalone test', () => {
  // exclusive test
})
