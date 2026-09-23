import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import NotificationBell from './NotificationBell'
import { LangProvider } from '../lib/LangContext'
import { api } from '../lib/api'
import type { AppNotification } from '../lib/types'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      notifications: vi.fn(),
      markNotificationsRead: vi.fn(),
      checkSignalsNow: vi.fn(),
      notificationConfig: vi.fn(),
    },
  }
})

const ALERT: AppNotification = {
  id: 1,
  ts: new Date().toISOString(),
  kind: 'live_signal_high',
  title: 'Uttar Pradesh: Heavy rain / flooding is now HIGH',
  body: '217.5 mm forecast over 7 days.',
  state: 'Uttar Pradesh',
  signal: 'flood',
  level: 'high',
  delivery: 'in-app only',
  read: false,
}

function renderBell() {
  return render(
    <MemoryRouter>
      <LangProvider>
        <NotificationBell />
      </LangProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(api.notifications).mockReset().mockResolvedValue({ items: [], unread: 0 })
  vi.mocked(api.markNotificationsRead).mockReset().mockResolvedValue({ marked: 0, unread: 0 })
  vi.mocked(api.checkSignalsNow).mockReset().mockResolvedValue({ created: [], unread: 0 })
  vi.mocked(api.notificationConfig).mockReset().mockResolvedValue({
    polling_enabled: true,
    poll_minutes: 30,
    webhook_configured: false,
  })
})

describe('NotificationBell', () => {
  it('shows an unread badge in its accessible name when there are unread alerts', async () => {
    vi.mocked(api.notifications).mockResolvedValue({ items: [ALERT], unread: 1 })
    renderBell()
    await waitFor(() => expect(screen.getByRole('button', { name: /1 unread/ })).toBeInTheDocument())
  })

  it('has no unread badge when everything is read', async () => {
    renderBell()
    await waitFor(() => expect(screen.getByRole('button', { name: /0 unread/ })).toBeInTheDocument())
  })

  it('opening it lists the alert and lets the operator mark everything read', async () => {
    vi.mocked(api.notifications).mockResolvedValue({ items: [ALERT], unread: 1 })
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: /1 unread/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ALERT.title)).toBeInTheDocument()
    expect(within(dialog).getByText(/217\.5 mm/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /mark all read/i }))
    expect(api.markNotificationsRead).toHaveBeenCalledWith()
    await waitFor(() => expect(screen.getByRole('button', { name: /0 unread/ })).toBeInTheDocument())
  })

  it('"Check now" reports how many new alerts were created', async () => {
    vi.mocked(api.checkSignalsNow).mockResolvedValue({ created: [{ id: 9, title: 'x' }], unread: 1 })
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: /unread/ }))
    await user.click(await screen.findByRole('button', { name: /check now/i }))
    expect(await screen.findByText(/1 new alert/i)).toBeInTheDocument()
  })

  it('"Check now" reports when nothing new happened', async () => {
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: /unread/ }))
    await user.click(await screen.findByRole('button', { name: /check now/i }))
    expect(await screen.findByText(/no new alerts/i)).toBeInTheDocument()
  })

  it('never reveals the webhook URL, only whether one is configured', async () => {
    vi.mocked(api.notificationConfig).mockResolvedValue({
      polling_enabled: true,
      poll_minutes: 15,
      webhook_configured: true,
    })
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: /unread/ }))
    await screen.findByText(/also sent to the configured webhook/i)
    expect(screen.queryByText(/https?:\/\//)).toBeNull()
  })

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: /unread/ }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
