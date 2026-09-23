import { test, expect } from '@playwright/test'

test.describe('Public Portal', () => {
  test('shows real aggregate figures and needs no sign-in', async ({ page }) => {
    await page.goto('/public')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('#public-hero')).toBeVisible()
    const facilities = page.locator('#public-stats').getByText(/^\d[\d,]*$/).first()
    await expect(facilities).toBeVisible()
    expect(Number((await facilities.textContent())?.replace(/,/g, ''))).toBeGreaterThan(0)
  })

  test('clicking a state on the map opens its aggregate-only detail page', async ({ page }) => {
    await page.goto('/public')
    await page.waitForLoadState('networkidle')
    await page.locator('#public-map .leaflet-interactive').first().click()
    await expect(page).toHaveURL(/\/public\/states\//)
    await expect(page.locator('#pub-state-stats')).toBeVisible()
    // The page's own invariant: no facility-level content, ever.
    await expect(page.locator('body')).not.toContainText('PHC-0')
  })

  test('the officer console link and the hero orb (or its static fallback) both render', async ({ page }) => {
    await page.goto('/public')
    await page.waitForLoadState('networkidle')
    // Two links share this name (header nav + hero CTA); either being visible is the real assertion.
    await expect(page.getByRole('link', { name: /officer console/i }).first()).toBeVisible()
    // .first(): the static <img> fallback stays mounted (opacity-0) under the live canvas during the crossfade.
    await expect(page.locator('#public-orb img, #public-orb canvas').first()).toBeVisible()
  })
})
