import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const baseURL = process.env.TA_PRO_E2E_BASE_URL || 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  globalSetup: resolve(__dirname, 'e2e/global.setup.ts'),
  reporter: [['list'], ['html', { open: 'never' }]],
  retries: 0,
  timeout: 20 * 60 * 1000,
  expect: {
    timeout: 60 * 1000,
  },
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    storageState: resolve(__dirname, 'e2e/.auth/ta-pro-admin.json'),
  },
})
