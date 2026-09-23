import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against the real app. Requires both dev servers already
// running (see README "Running locally" — `uvicorn` on :8000, `npm run dev`
// on :5174/:5173) since the backend is Python and Playwright's `webServer`
// can only launch one process; starting it here would duplicate that setup
// without adding anything. Run with: npm run test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // shares one backend/dataset; parallel runs would race each other's mutations
  workers: 1, // ...and `fullyParallel: false` alone only serializes tests *within* a file — different spec files still ran concurrently and raced each other's mutations (crisis triggers, notification checks) against the one real backend.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
