import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FacilityCountBenchmark from './FacilityCountBenchmark'
import { LangProvider } from '../lib/LangContext'
import { api } from '../lib/api'
import type { FacilityCountBenchmark as Benchmark } from '../lib/types'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, liveFacilityCountBenchmarks: vi.fn() } }
})

const SAMPLE: Benchmark = {
  source: 'data.gov.in — Ministry of Health & Family Welfare / NHM Rural Health Statistics',
  source_url: 'https://www.data.gov.in/resource/c305c34e-d2d4-4aba-a0bd-a962912acf54',
  as_of: 'March 2012',
  fetched_at: new Date().toISOString(),
  disclaimer: 'Official counts are a historical snapshot, not a live figure.',
  stale: false,
  states: [
    {
      state: 'Maharashtra',
      official: { sub_centres: 10580, phcs: 1811, chcs: 363 },
      network_facility_count: 32,
      network_vs_official_phcs_pct: 1.8,
    },
    {
      state: 'Sikkim',
      official: { sub_centres: 147, phcs: 24, chcs: 2 },
      network_facility_count: null,
      network_vs_official_phcs_pct: null,
    },
  ],
}

function renderPanel() {
  return render(
    <LangProvider>
      <FacilityCountBenchmark />
    </LangProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.liveFacilityCountBenchmarks).mockReset()
})

describe('FacilityCountBenchmark', () => {
  it('renders official and network counts side by side, and labels the row a demo does not model', async () => {
    vi.mocked(api.liveFacilityCountBenchmarks).mockResolvedValue(SAMPLE)
    renderPanel()
    await screen.findByText('Maharashtra')
    expect(screen.getByText('1,811')).toBeInTheDocument() // official PHCs
    expect(screen.getByText('32')).toBeInTheDocument() // this demo's network count
    expect(screen.getByText('1.8%')).toBeInTheDocument()

    const sikkimRow = screen.getByText('Sikkim').closest('tr')!
    // No network row for a state the demo doesn't model — shown as em dashes, not 0 or blank.
    expect(sikkimRow.textContent).toContain('—')
  })

  it('cites the real source and the historical as-of date, never implying a live count', async () => {
    vi.mocked(api.liveFacilityCountBenchmarks).mockResolvedValue(SAMPLE)
    renderPanel()
    await screen.findByText('Maharashtra')
    expect(screen.getByText(/March 2012/)).toBeInTheDocument()
    expect(screen.getByText(/historical snapshot, not a live figure/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /data\.gov\.in/i })).toHaveAttribute('href', SAMPLE.source_url)
  })

  it('the disclaimer is collapsed by default and expands on request', async () => {
    vi.mocked(api.liveFacilityCountBenchmarks).mockResolvedValue(SAMPLE)
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Maharashtra')
    expect(screen.queryByText(SAMPLE.disclaimer)).toBeNull()
    await user.click(screen.getByRole('button', { name: /why is the network count so much smaller/i }))
    expect(await screen.findByText(SAMPLE.disclaimer)).toBeInTheDocument()
  })

  it('shows an error state with a working retry when the feed is unavailable, and never fabricates rows', async () => {
    vi.mocked(api.liveFacilityCountBenchmarks).mockRejectedValueOnce(new Error('data.gov.in unavailable: TimeoutError'))
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText(/unavailable/i)
    expect(screen.queryByRole('table')).toBeNull()

    vi.mocked(api.liveFacilityCountBenchmarks).mockResolvedValueOnce(SAMPLE)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText('Maharashtra')
  })

  it('requests exactly the six states this demo network covers', async () => {
    vi.mocked(api.liveFacilityCountBenchmarks).mockResolvedValue(SAMPLE)
    renderPanel()
    await waitFor(() => expect(api.liveFacilityCountBenchmarks).toHaveBeenCalledWith([
      'Maharashtra', 'Uttar Pradesh', 'Bihar', 'Rajasthan', 'Tamil Nadu', 'Kerala',
    ]))
  })
})
