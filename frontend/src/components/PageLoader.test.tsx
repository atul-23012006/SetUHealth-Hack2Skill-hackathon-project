import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PageLoader from './PageLoader'

describe('PageLoader', () => {
  it('announces the given label to assistive tech via a live region', () => {
    render(<PageLoader label="Loading state summary" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Loading state summary')
  })

  it('defaults to "Loading" when no label is given', () => {
    render(<PageLoader />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })
})
