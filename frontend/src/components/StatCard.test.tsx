import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AlertTriangle } from 'lucide-react'
import StatCard from './StatCard'

// StatCard animates its number via useCountUp/requestAnimationFrame; fake
// timers (with rAF faked too) let the animation settle without a real wait.
function settle(ms = 1200) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('StatCard', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the label and settles on the numeric value', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    render(<StatCard label="Critical Alerts" value={42} />)
    expect(screen.getByText('Critical Alerts')).toBeInTheDocument()
    settle()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders an icon when given one, and none when omitted', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const { container, rerender } = render(<StatCard label="X" value={1} icon={AlertTriangle} />)
    expect(container.querySelector('svg')).not.toBeNull()
    rerender(<StatCard label="X" value={1} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('only shows the ping ring when pulse is true and an icon is given', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const { container } = render(<StatCard label="X" value={1} icon={AlertTriangle} pulse />)
    expect(container.querySelectorAll('.animate-ping-soft')).toHaveLength(1)
  })

  it('applies the critical tone color to the value', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    render(<StatCard label="X" value={5} tone="critical" />)
    settle()
    expect(screen.getByText('5')).toHaveClass('text-rose-600')
  })
})
