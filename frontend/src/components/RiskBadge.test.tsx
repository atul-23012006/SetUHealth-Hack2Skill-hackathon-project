import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import RiskBadge from './RiskBadge'
import { LangProvider } from '../lib/LangContext'
import type { Risk } from '../lib/types'

function renderBadge(risk: Risk) {
  return render(
    <LangProvider>
      <RiskBadge risk={risk} />
    </LangProvider>,
  )
}

describe('RiskBadge', () => {
  it('shows the translated label for each risk level', () => {
    renderBadge('critical')
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders warning and low with their own text', () => {
    const { unmount } = renderBadge('warning')
    expect(screen.getByText('Warning')).toBeInTheDocument()
    unmount()
    renderBadge('low')
    expect(screen.getByText('Low')).toBeInTheDocument()
  })

  it('only critical gets the pulsing ring (the extra ping span)', () => {
    const { container: criticalContainer } = renderBadge('critical')
    expect(criticalContainer.querySelectorAll('.animate-ping-soft')).toHaveLength(1)

    const { container: lowContainer } = renderBadge('low')
    expect(lowContainer.querySelectorAll('.animate-ping-soft')).toHaveLength(0)
  })
})
