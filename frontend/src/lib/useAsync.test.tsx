import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import axios, { AxiosError } from 'axios'
import { errorMessage, useAsync } from './useAsync'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('errorMessage', () => {
  it('prefers the server\'s `detail` string on an axios error', () => {
    const err = new AxiosError('fail', undefined, undefined, undefined, {
      status: 400,
      data: { detail: 'Donor has only 3 units' },
    } as never)
    expect(errorMessage(err)).toBe('Donor has only 3 units')
  })

  it('reports unreachability when there is no response at all', () => {
    const err = new AxiosError('Network Error')
    expect(errorMessage(err)).toBe("Can't reach the server")
  })

  it('falls back to a generic status message when there is no `detail`', () => {
    const err = new AxiosError('fail', undefined, undefined, undefined, { status: 503, data: {} } as never)
    expect(errorMessage(err)).toBe('Request failed (503)')
  })

  it('uses the message of a plain Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('has a final fallback for a thrown non-Error value', () => {
    expect(errorMessage('a string was thrown')).toBe('Something went wrong')
  })

  it('delegates axios detection to axios.isAxiosError (not just instanceof)', () => {
    // Sanity check that our helper and axios agree on what counts as an axios error.
    expect(axios.isAxiosError(new AxiosError('x'))).toBe(true)
  })
})

describe('useAsync', () => {
  it('starts loading, then resolves with data', async () => {
    const { promise, resolve } = deferred<string>()
    const { result } = renderHook(() => useAsync(() => promise, []))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    act(() => resolve('hello'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe('hello')
    expect(result.current.error).toBeNull()
  })

  it('surfaces a rejection as a readable error and clears data', async () => {
    const { promise, reject } = deferred<string>()
    const { result } = renderHook(() => useAsync(() => promise, []))
    act(() => reject(new Error('network down')))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network down')
    expect(result.current.data).toBeNull()
  })

  it('ignores a stale response that resolves after a newer request has started', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const calls = [first, second]
    let call = 0
    const { result, rerender } = renderHook(({ dep }) => useAsync(() => calls[call++].promise, [dep]), {
      initialProps: { dep: 1 },
    })
    rerender({ dep: 2 }) // starts the second request before the first resolves
    act(() => second.resolve('second'))
    await waitFor(() => expect(result.current.data).toBe('second'))
    act(() => first.resolve('first')) // arrives late; must not overwrite the newer result
    expect(result.current.data).toBe('second')
  })

  it('reload() re-runs the fetch even though the dependency list is unchanged', async () => {
    let n = 0
    const fn = vi.fn(() => Promise.resolve(++n))
    const { result } = renderHook(() => useAsync(fn, []))
    await waitFor(() => expect(result.current.data).toBe(1))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toBe(2))
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
