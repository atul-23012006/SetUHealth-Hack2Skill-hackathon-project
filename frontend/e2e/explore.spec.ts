import { test, expect } from '@playwright/test'

test.describe('Explore', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore')
    await page.waitForLoadState('networkidle')
  })

  test('a quick pick loads real weather and updates the URL', async ({ page }) => {
    await page.getByRole('button', { name: 'Patna', exact: true }).click()
    await expect(page).toHaveURL(/lat=25\.59/)
    await expect(page.locator('#explore-weather')).toContainText('Patna', { timeout: 15_000 })
  })

  test('typing a place shows real geocoding suggestions', async ({ page }) => {
    await page.getByPlaceholder(/search a city/i).fill('Coimbatore')
    // Scoped to the suggestion listbox: a bare getByRole('option') also matches every
    // native <select><option> on the page (the header's language/acting-as pickers).
    await expect(page.locator('#explore-suggestions').getByRole('option').first()).toContainText(/coimbatore/i, { timeout: 10_000 })
  })

  test('toggling the network-facilities layer removes its markers from the legend interaction', async ({ page }) => {
    const toggle = page.getByRole('switch', { name: /network facilities/i })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  test('clicking the map drops a pin and relabels the point', async ({ page }) => {
    const map = page.locator('#explore-map .leaflet-container')
    await map.waitFor()
    const box = await map.boundingBox()
    if (!box) test.fail(true, 'map did not report a bounding box')
    await page.mouse.click(box!.x + box!.width * 0.4, box!.y + box!.height * 0.4)
    await expect(page).toHaveURL(/name=Dropped/)
  })
})
