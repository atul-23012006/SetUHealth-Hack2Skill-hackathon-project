import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './AuthContext'
import { api, ACTING_USER_KEY, TOKEN_KEY, SIGNED_OUT_EVENT } from './api'
import type { ActingUser } from './types'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      authConfig: vi.fn(),
      listUsers: vi.fn(),
      login: vi.fn(),
      me: vi.fn(),
    },
  }
})

const ADMIN: ActingUser = {
  user_id: 'national_admin',
  label: 'National Administrator',
  role: 'national_admin',
  authorized_phc_ids: [],
  authorized_states: ['*'],
}
const OPERATOR: ActingUser = {
  user_id: 'phc_operator_001',
  label: 'PHC Operator',
  role: 'phc_operator',
  authorized_phc_ids: ['PHC-0001'],
  authorized_states: [],
}

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>

beforeEach(() => {
  vi.mocked(api.authConfig).mockReset()
  vi.mocked(api.listUsers).mockReset()
  vi.mocked(api.login).mockReset()
  vi.mocked(api.me).mockReset()
})

describe('AuthProvider — demo mode', () => {
  it('defaults to national_admin and loads the roster', async () => {
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'demo' })
    vi.mocked(api.listUsers).mockResolvedValue([ADMIN, OPERATOR])

    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.userId).toBe('national_admin') // set before any network call resolves
    await waitFor(() => expect(result.current.mode).toBe('demo'))
    await waitFor(() => expect(result.current.users).toHaveLength(2))
    expect(result.current.user?.user_id).toBe('national_admin')
    expect(result.current.signedIn).toBe(true) // demo mode is always "signed in"
  })

  it('resumes a previously chosen identity from localStorage', async () => {
    localStorage.setItem(ACTING_USER_KEY, 'phc_operator_001')
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'demo' })
    vi.mocked(api.listUsers).mockResolvedValue([ADMIN, OPERATOR])

    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.userId).toBe('phc_operator_001')
    await waitFor(() => expect(result.current.user?.user_id).toBe('phc_operator_001'))
  })

  it('setUserId updates both state and localStorage, and clearing it removes the key', async () => {
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'demo' })
    vi.mocked(api.listUsers).mockResolvedValue([ADMIN, OPERATOR])
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('demo'))

    act(() => result.current.setUserId('phc_operator_001'))
    expect(result.current.userId).toBe('phc_operator_001')
    expect(localStorage.getItem(ACTING_USER_KEY)).toBe('phc_operator_001')

    act(() => result.current.setUserId(null))
    expect(localStorage.getItem(ACTING_USER_KEY)).toBeNull()
  })

  it('falls back to demo mode if the server is unreachable', async () => {
    vi.mocked(api.authConfig).mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('demo'))
  })
})

describe('AuthProvider — token mode', () => {
  it('starts signed out with no stored session', async () => {
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'token' })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('token'))
    expect(result.current.signedIn).toBe(false)
    expect(result.current.user).toBeNull()
    expect(api.me).not.toHaveBeenCalled() // no point checking a session that doesn't exist
  })

  it('login() stores the token and signs the user in', async () => {
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'token' })
    vi.mocked(api.login).mockResolvedValue({ access_token: 'tok-123', expires_in: 3600, user: ADMIN })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('token'))

    await act(async () => {
      await result.current.login('national_admin', 'the-password')
    })
    expect(api.login).toHaveBeenCalledWith('national_admin', 'the-password')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-123')
    expect(result.current.signedIn).toBe(true)
    expect(result.current.user?.user_id).toBe('national_admin')
  })

  it('resumes a stored session that the server still accepts', async () => {
    localStorage.setItem(TOKEN_KEY, 'still-valid')
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'token' })
    vi.mocked(api.me).mockResolvedValue(OPERATOR)
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.signedIn).toBe(true))
    expect(result.current.user?.user_id).toBe('phc_operator_001')
  })

  it('drops a stored session the server no longer accepts', async () => {
    localStorage.setItem(TOKEN_KEY, 'expired')
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'token' })
    vi.mocked(api.me).mockResolvedValue(null)
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('token'))
    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBeNull())
    expect(result.current.signedIn).toBe(false)
  })

  it('drops a stored session when resuming it errors outright', async () => {
    localStorage.setItem(TOKEN_KEY, 'garbage')
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'token' })
    vi.mocked(api.me).mockRejectedValue(new Error('401'))
    renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBeNull())
  })

  it('logout() clears the token and the session user', async () => {
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'token' })
    vi.mocked(api.login).mockResolvedValue({ access_token: 'tok-123', expires_in: 3600, user: ADMIN })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('token'))
    await act(async () => {
      await result.current.login('national_admin', 'pw')
    })
    expect(result.current.signedIn).toBe(true)

    act(() => result.current.logout())
    expect(result.current.signedIn).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('a global sign-out event (e.g. a 401 from any request) clears the session too', async () => {
    vi.mocked(api.authConfig).mockResolvedValue({ mode: 'token' })
    vi.mocked(api.login).mockResolvedValue({ access_token: 'tok-123', expires_in: 3600, user: ADMIN })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.mode).toBe('token'))
    await act(async () => {
      await result.current.login('national_admin', 'pw')
    })
    expect(result.current.signedIn).toBe(true)

    act(() => window.dispatchEvent(new Event(SIGNED_OUT_EVENT)))
    expect(result.current.signedIn).toBe(false)
  })
})
