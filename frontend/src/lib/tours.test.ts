import { describe, expect, it } from 'vitest'
import { ALL_TOURS, tourForPath } from './tours'

describe('tourForPath', () => {
  it('matches the dashboard at the root path', () => {
    expect(tourForPath('/')?.id).toBe('dashboard')
  })

  it('matches parameterised routes', () => {
    expect(tourForPath('/states/Maharashtra')?.id).toBe('state')
    expect(tourForPath('/phcs/PHC-0001')?.id).toBe('phc')
    expect(tourForPath('/medicines/Paracetamol%20500mg/states/Bihar')?.id).toBe('medicine-state')
    expect(tourForPath('/public/states/Kerala')?.id).toBe('public-state')
  })

  it('does not match a sub-path it was not given (matchPath end:true)', () => {
    expect(tourForPath('/states/Maharashtra/extra')).toBeNull()
  })

  it('returns null for an unrouted path', () => {
    expect(tourForPath('/nowhere')).toBeNull()
  })

  it('every route has at least one step, and every step has non-empty title and content', () => {
    for (const tour of ALL_TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0)
      for (const step of tour.steps) {
        expect(step.target.length).toBeGreaterThan(0)
        expect(step.title.trim().length).toBeGreaterThan(0)
        expect(step.content.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('every tour id is unique', () => {
    const ids = ALL_TOURS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
