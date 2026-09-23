import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.ts (build config) so `vitest`/`vite build` never
// interfere with each other's plugin options.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Thread-pool workers can reuse a JS realm across test files; fake timers
    // (StatCard.test.tsx) or stubbed globals from one file were observed
    // leaking into the next file's jsdom environment ("document is not
    // defined"). Forks give each file a fully separate process instead.
    pool: 'forks',
    globals: false,
    exclude: ['node_modules/**', 'e2e/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'e2e/**', 'src/test/**'],
    },
  },
})
