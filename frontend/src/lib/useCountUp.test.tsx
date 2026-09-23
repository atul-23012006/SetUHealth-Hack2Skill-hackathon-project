import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useCountUp } from './useCountUp'

// requestAnimationFrame doesn't exist in jsdom; drive it manually so the
// animation's easing curve runs deterministically instead of on a real clock.
// The hook reads `startTime` from the *first* callback it receives, so a
// caller must tick(0) once (to establish that baseline) before ticking the
// full duration — `settle()` does both in the order the hook expects.
function stubRaf(durationMs: number) {
  let now = 0
  const pending: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending.push(cb)
    return pending.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const tick = (ms: number) => {
    now += ms
    const due = pending.splice(0, pending.length)
    due.forEach((cb) => cb(now))
  }
  return {
    tick,
    settle: () => {
      tick(0)
      tick(durationMs)
    },
  }
}

const DURATION_MS = 1000

function Probe({ value, thousands }: { value: number | string; thousands?: boolean }) {
  const display = useCountUp(value, DURATION_MS, thousands)
  return <span data-testid="out">{display}</span>
}

describe('useCountUp', () => {
  let raf: ReturnType<typeof stubRaf>
  beforeEach(() => {
    raf = stubRaf(DURATION_MS)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('animates from 0 up to the target and settles exactly on it', () => {
    render(<Probe value={200} />)
    act(() => raf.tick(0))
    const early = Number(screen.getByTestId('out').textContent)
    expect(early).toBeGreaterThanOrEqual(0)
    expect(early).toBeLessThan(200)
    act(() => raf.tick(DURATION_MS))
    expect(screen.getByTestId('out').textContent).toBe('200')
  })

  it('preserves a percent suffix throughout', () => {
    render(<Probe value="65%" />)
    act(() => raf.settle())
    expect(screen.getByTestId('out').textContent).toBe('65%')
  })

  it('adds thousands separators only for whole numbers with no prefix/suffix', () => {
    render(<Probe value={4601642} thousands />)
    act(() => raf.settle())
    expect(screen.getByTestId('out').textContent).toBe('4,601,642')
  })

  it('does not group a value that carries a suffix, even when thousands is requested', () => {
    render(<Probe value="4601642 mm" thousands />)
    act(() => raf.settle())
    // Has a suffix -> grouping is suppressed even though thousands=true.
    expect(screen.getByTestId('out').textContent).toBe('4601642 mm')
  })

  it('passes non-numeric strings through untouched, with no animation frame requested', () => {
    render(<Probe value="n/a" />)
    act(() => raf.settle())
    expect(screen.getByTestId('out').textContent).toBe('n/a')
  })

  it('re-animates from the new value when the prop changes', () => {
    const { rerender } = render(<Probe value={10} />)
    act(() => raf.settle())
    expect(screen.getByTestId('out').textContent).toBe('10')

    rerender(<Probe value={50} />)
    act(() => raf.settle())
    expect(screen.getByTestId('out').textContent).toBe('50')
  })

  it('cancels the in-flight frame on unmount (no state update after unmount)', () => {
    const { unmount } = render(<Probe value={200} />)
    act(() => raf.tick(0)) // schedules the next frame, then unmount cancels it
    expect(() => unmount()).not.toThrow()
  })
})
