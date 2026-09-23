import { test, expect } from '@playwright/test'

test.describe('Command palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('Ctrl+K opens it, filters to a real state, and Enter navigates there', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await page.keyboard.type('maharashtra')
    await expect(dialog.getByRole('option').first()).toContainText(/maharashtra/i)
    await page.keyboard.press('Enter')

    await expect(dialog).not.toBeVisible()
    await expect(page).toHaveURL(/\/states\/Maharashtra/)
  })

  test('finds an individual facility by name', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    await dialog.locator('input').fill('pune phc 1')
    // Anchored + word-boundary: "Pune PHC 1" would otherwise also match "Pune PHC 10",
    // and an unscoped role query would also catch the header's unrelated <select> option
    // that happens to contain the same substring ("PHC Operator — Pune PHC 1 (...)").
    await expect(dialog.getByRole('option', { name: /^pune phc 1\b/i })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('shows a "nothing matches" state for a nonsense query', async ({ page }) => {
    await page.keyboard.press('Control+k')
    await page.getByRole('dialog').locator('input').fill('zzz-nonexistent-zzz')
    await expect(page.getByRole('dialog')).toContainText(/nothing matches/i)
  })
})
