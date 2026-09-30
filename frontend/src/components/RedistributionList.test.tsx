import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RedistributionList from './RedistributionList'
import { LangProvider } from '../lib/LangContext'
import { AuthProvider } from '../lib/AuthContext'
import { api } from '../lib/api'
import type { RedistributionRec } from '../lib/types'

// national_admin has no jurisdiction restriction, matching this file's
// pre-existing assumption that every row's Execute button is always clickable.
// See AuthContext.test.tsx / RedistributionList's own canExecute for the
// (separately tested) scoped-role behavior.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      executeTransfer: vi.fn(),
      authConfig: vi.fn().mockResolvedValue({ mode: 'demo' }),
      listUsers: vi.fn().mockResolvedValue([
        { user_id: 'national_admin', label: 'National Administrator', role: 'national_admin', authorized_phc_ids: [], authorized_states: ['*'] },
      ]),
    },
  }
})

function rec(overrides: Partial<RedistributionRec> = {}): RedistributionRec {
  return {
    medicine: 'Paracetamol 500mg',
    unit: 'strip',
    from_phc_id: 'PHC-1',
    from_phc_name: 'Aurangabad PHC 5',
    from_state: 'Maharashtra',
    from_district: 'Aurangabad',
    to_phc_id: 'PHC-2',
    to_phc_name: 'Aurangabad PHC 2',
    to_state: 'Maharashtra',
    to_district: 'Aurangabad',
    quantity: 40,
    distance_km: 12,
    cross_state: false,
    urgency: 'critical',
    ...overrides,
  }
}

function renderList(recs: RedistributionRec[], onTransferExecuted = vi.fn()) {
  return render(
    <AuthProvider>
      <LangProvider>
        <RedistributionList recs={recs} onTransferExecuted={onTransferExecuted} />
      </LangProvider>
    </AuthProvider>,
  )
}

describe('RedistributionList', () => {
  beforeEach(() => {
    vi.mocked(api.executeTransfer).mockReset()
  })

  it('requires a confirm click before calling executeTransfer', async () => {
    const user = userEvent.setup()
    vi.mocked(api.executeTransfer).mockResolvedValue({} as never)
    renderList([rec()])

    await user.click(screen.getByRole('button', { name: /^execute$/i }))
    expect(api.executeTransfer).not.toHaveBeenCalled()
    expect(screen.getByText(/updates live stock immediately/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(api.executeTransfer).toHaveBeenCalledWith('PHC-1', 'PHC-2', 'Paracetamol 500mg', 40))
  })

  it('cancel returns to the Execute button without calling the API', async () => {
    const user = userEvent.setup()
    renderList([rec()])

    await user.click(screen.getByRole('button', { name: /^execute$/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(api.executeTransfer).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^execute$/i })).toBeInTheDocument()
  })

  it('on success, removes the row, shows a toast, and notifies the parent to refetch', async () => {
    const user = userEvent.setup()
    vi.mocked(api.executeTransfer).mockResolvedValue({} as never)
    const onTransferExecuted = vi.fn()
    renderList([rec()], onTransferExecuted)

    await user.click(screen.getByRole('button', { name: /^execute$/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(screen.getByText(/transferred 40 strip Paracetamol 500mg/i)).toBeInTheDocument())
    // The row itself (identified by its distance marker, not shown in the toast) is gone.
    expect(screen.queryByText('12 km')).not.toBeInTheDocument()
    expect(onTransferExecuted).toHaveBeenCalled()
  })

  it('keeps suppressing an identical recommendation that reappears after a refetch', async () => {
    // Regression: the LP can legitimately re-propose the same-shaped transfer
    // once the donor's new stock level is solved against again. Without
    // suppression this looked exactly like the Execute click having done
    // nothing (the "unlimited quantity" glitch).
    const user = userEvent.setup()
    vi.mocked(api.executeTransfer).mockResolvedValue({} as never)
    const { rerender } = renderList([rec()])

    await user.click(screen.getByRole('button', { name: /^execute$/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(api.executeTransfer).toHaveBeenCalledTimes(1))

    // Parent refetches and the solver proposes the identical pair again.
    rerender(
      <AuthProvider>
        <LangProvider>
          <RedistributionList recs={[rec()]} />
        </LangProvider>
      </AuthProvider>,
    )

    expect(screen.queryByText('12 km')).not.toBeInTheDocument()
    expect(screen.getByText(/all current recommendations were just actioned/i)).toBeInTheDocument()
  })

  it('a different recommendation is not affected by another row being suppressed', async () => {
    const user = userEvent.setup()
    vi.mocked(api.executeTransfer).mockResolvedValue({} as never)
    const other = rec({ medicine: 'ORS Sachets', from_phc_id: 'PHC-3', to_phc_id: 'PHC-4', quantity: 25 })
    const { rerender } = renderList([rec()])

    await user.click(screen.getByRole('button', { name: /^execute$/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(api.executeTransfer).toHaveBeenCalledTimes(1))

    rerender(
      <AuthProvider>
        <LangProvider>
          <RedistributionList recs={[other]} />
        </LangProvider>
      </AuthProvider>,
    )

    expect(screen.getByText('ORS Sachets')).toBeInTheDocument()
  })

  it('shows the server-provided reason and leaves the row in place when execute fails', async () => {
    const user = userEvent.setup()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(api.executeTransfer).mockRejectedValue(
      Object.assign(new Error('fail'), {
        isAxiosError: true,
        response: { data: { detail: 'Donor has only 10 strip' } },
      }),
    )
    renderList([rec()])

    await user.click(screen.getByRole('button', { name: /^execute$/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Donor has only 10 strip')))
    expect(screen.getByText(/aurangabad phc 5/i)).toBeInTheDocument()
    alertSpy.mockRestore()
  })

  it('disables other rows while one is executing, preventing a parallel double-transfer', async () => {
    const user = userEvent.setup()
    let resolveExecute!: () => void
    vi.mocked(api.executeTransfer).mockReturnValue(new Promise((res) => { resolveExecute = () => res({} as never) }))
    const other = rec({ medicine: 'ORS Sachets', from_phc_id: 'PHC-3', to_phc_id: 'PHC-4', quantity: 25 })
    renderList([rec(), other])

    const executeButtons = screen.getAllByRole('button', { name: /^execute$/i })
    await user.click(executeButtons[0])
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(screen.getByRole('button', { name: /^execute$/i })).toBeDisabled()
    resolveExecute()
    await waitFor(() => expect(api.executeTransfer).toHaveBeenCalledTimes(1))
  })
})
