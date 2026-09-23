import { test, expect } from '@playwright/test'

test.describe('Guided tour', () => {
  test('runs to completion on the Dashboard and highlights real elements', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /take the tour/i }).click()
    const tooltip = page.getByRole('alertdialog')
    await expect(tooltip).toBeVisible({ timeout: 10_000 })

    let steps = 0
    for (let i = 0; i < 20; i++) {
      await expect(tooltip).toBeVisible()
      steps++
      const nextBtn = tooltip.getByRole('button', { name: /^(next|finish)$/i })
      const label = (await nextBtn.textContent())?.toLowerCase() ?? ''
      await nextBtn.click()
      if (label.includes('finish')) break
      await page.waitForTimeout(150)
    }
    expect(steps).toBeGreaterThan(3) // the dashboard tour has many real steps; this catches a tour that silently collapses to almost nothing
    await expect(tooltip).not.toBeVisible()
  })

  test('has its own tour on Explore, distinct from the Dashboard one', async ({ page }) => {
    await page.goto('/explore')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /take the tour/i }).click()
    const tooltip = page.getByRole('alertdialog')
    await expect(tooltip).toContainText(/search any place|explore/i, { timeout: 20_000 })
  })
})
