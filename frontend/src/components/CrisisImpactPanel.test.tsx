import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CrisisImpactPanel from './CrisisImpactPanel'
import { LangProvider } from '../lib/LangContext'
import type { CrisisChange, CrisisImpact } from '../lib/types'

const base = { phc_id: 'PHC-1', phc_name: 'Patna PHC 1', district: 'Patna', state: 'Bihar' }

function impact(crisis_type: string, changes: CrisisChange[]): CrisisImpact {
  return {
    target_type: 'state',
    target_name: 'Bihar',
    crisis_type,
    simulated: true,
    triggered_at: '2026-09-28T10:00:00+00:00',
    totals: {
      facilities_affected: 1, stock_items_changed: 1, stock_units_lost: 170, newly_critical: 1,
      risk_escalations: 1, beds_newly_occupied: 4, extra_opd_visits: 0, cold_chain_alerts_raised: 0,
    },
    rows_total: changes.length,
    changes,
  }
}

const flood = impact('Monsoon Floods', [
  { ...base, kind: 'stock', item: 'ORS Sachets', unit: 'packet', before: 170, after: 0,
    risk_before: 'low', risk_after: 'critical', days_before: 37.7, days_after: 0 },
  { ...base, kind: 'beds', item: 'Beds occupied', unit: 'beds', before: 6, after: 10, capacity: 10 },
])

function renderPanel(impacts: CrisisImpact[]) {
  return render(
    <MemoryRouter>
      <LangProvider>
        <CrisisImpactPanel impacts={impacts} />
      </LangProvider>
    </MemoryRouter>,
  )
}

describe('CrisisImpactPanel', () => {
  it('labels the data as simulated and shows each value before and after', () => {
    renderPanel([flood])
    expect(screen.getByText(/simulated data/i)).toBeInTheDocument()
    const row = screen.getByText('ORS Sachets').closest('tr')!
    expect(within(row).getByText('170')).toHaveClass('line-through')
    expect(within(row).getByText('0', { selector: '.font-bold' })).toBeInTheDocument()
    expect(within(row).getByText(/−170/)).toBeInTheDocument()
    expect(within(row).getByText('Low')).toBeInTheDocument()
    expect(within(row).getByText('Critical')).toBeInTheDocument()
  })

  it('shows only the headline totals that actually moved', () => {
    renderPanel([flood])
    expect(screen.getByText('Beds filled')).toBeInTheDocument()
    expect(screen.queryByText('Extra OPD visits')).not.toBeInTheDocument()
  })

  it('filters rows by change type', () => {
    renderPanel([flood])
    fireEvent.click(screen.getByRole('tab', { name: /beds/i }))
    expect(screen.queryByText('ORS Sachets')).not.toBeInTheDocument()
    expect(screen.getByText('Beds occupied')).toBeInTheDocument()
  })

  it('switches between stacked crises', () => {
    const malaria = impact('Malaria Outbreak', [
      { ...base, kind: 'stock', item: 'Artesunate Injection', unit: 'vial', before: 40, after: 2,
        risk_before: 'warning', risk_after: 'critical', days_before: 5, days_after: 0.2 },
    ])
    renderPanel([malaria, flood])
    expect(screen.getByText('Artesunate Injection')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /monsoon floods/i }))
    expect(screen.getByText('ORS Sachets')).toBeInTheDocument()
  })
})
