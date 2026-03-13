import { defineConfig } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex).trim()
    if (!key || process.env[key]) continue
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    process.env[key] = value
  }
}

loadEnvFile(resolve(__dirname, '.env.local'))
loadEnvFile(resolve(__dirname, '.env'))

const baseURL = process.env.TA_PRO_E2E_BASE_URL || 'http://127.0.0.1:3001'

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
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 2 * 60 * 1000,
  },
})
