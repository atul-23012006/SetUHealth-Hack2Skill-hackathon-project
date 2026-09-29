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

  it('shows a delta chip coloured by whether the change is worse, and none for zero', () => {
    const { rerender } = render(<StatCard label="Critical" value={50} delta={{ value: 12, worseWhen: 'up' }} />)
    const chip = screen.getByText(/\+12/)
    expect(chip.className).toMatch(/rose/)
    expect(screen.getByText(/vs\. before simulation/)).toBeInTheDocument()
    rerender(<StatCard label="Attendance" value={80} delta={{ value: 3, worseWhen: 'down', suffix: ' pts' }} />)
    expect(screen.getByText(/\+3 pts/).className).toMatch(/emerald/)
    rerender(<StatCard label="Critical" value={50} delta={{ value: 0, worseWhen: 'up' }} />)
    expect(screen.queryByText(/vs\. before simulation/)).not.toBeInTheDocument()
  })
})

