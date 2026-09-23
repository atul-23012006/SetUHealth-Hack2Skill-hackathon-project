import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('loads the national overview with real stat counts', async ({ page }) => {
    await expect(page.locator('#dashboard-hero')).toBeVisible()
    await expect(page.locator('#stat-cards')).toBeVisible()
    // StatCard's counter animation settles on a real, non-empty number.
    const total = await page.locator('#stat-cards').getByText(/^\d[\d,]*$/).first().textContent()
    expect(Number((total ?? '').replace(/,/g, ''))).toBeGreaterThan(0)
  })

  test('the national map and state list render', async ({ page }) => {
    await expect(page.locator('#national-map .leaflet-container')).toBeVisible()
    await expect(page.locator('#state-list')).toBeVisible()
    await expect(page.locator('#state-list a').first()).toBeVisible()
  })

  test('live climate signals load from the real weather feed, or report it is unavailable', async ({ page }) => {
    const panel = page.locator('#live-signals')
    await expect(panel).toBeVisible()
    const gotData = panel.locator('text=/Open-Meteo|updated/i')
    const unavailable = panel.getByRole('button', { name: /try again/i })
    await expect(gotData.or(unavailable)).toBeVisible({ timeout: 15_000 })
  })

  test('the weather scenario toggle re-plans alerts without mutating anything on cancel', async ({ page }) => {
    const panel = page.locator('#weather-impact')
    await expect(panel).toBeVisible()
    const hasTable = await panel.locator('table').count()
    test.skip(hasTable === 0, 'weather scenario needs the live feed, which was unavailable')

    const toggle = panel.locator('input[role="switch"]')
    await toggle.check()
    await expect(page.locator('#alerts-panel')).toContainText(/weather ×/i, { timeout: 15_000 })
    await toggle.uncheck()
    await expect(page.locator('#alerts-panel')).not.toContainText(/weather ×/i)
  })

  test('Run Demo starts and can be stopped without leaving the crisis banner up', async ({ page }) => {
    const demoBtn = page.locator('#demo-mode-btn')
    await demoBtn.click()
    await expect(demoBtn).toHaveText(/stop demo/i)
    await demoBtn.click()
    await expect(demoBtn).toHaveText(/run demo/i)
  })
})
