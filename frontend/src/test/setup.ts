import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// React Testing Library doesn't auto-cleanup outside its own test-framework
// hooks; Vitest isn't one of the frameworks it detects automatically.
afterEach(() => cleanup())

// jsdom implements neither; several components (HeroOrbLazy, LiveSignalsPanel,
// GuidedTour's host page) call matchMedia or observe intersection/resize.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )

  class MockObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  vi.stubGlobal('IntersectionObserver', MockObserver)
  vi.stubGlobal('ResizeObserver', MockObserver)

  // jsdom's localStorage throws in some sandboxes with cookies disabled; give
  // every test a real, working in-memory implementation instead of guessing
  // which environment it's running in.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  })
})
