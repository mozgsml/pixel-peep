import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test against a real build. `BASE_URL` points it at a deployment; with
 * nothing set it builds and serves locally, so the same file covers CI and the
 * post-deploy check.
 */
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // Uses the Chrome already installed on the machine, so CI and laptops do
    // not need a separate browser download.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
