import { chromium, expect, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export default async function globalSetup(config: FullConfig) {
  requireEnv('TA_PRO_E2E_MANIFEST')
  const locale = (process.env.TA_PRO_E2E_LOCALE || 'zh').trim()
  const email = requireEnv('TA_PRO_E2E_ADMIN_EMAIL')
  const password = requireEnv('TA_PRO_E2E_ADMIN_PASSWORD')
  const storageStatePath = resolve(process.cwd(), 'e2e/.auth/ta-pro-admin.json')

  mkdirSync(dirname(storageStatePath), { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({
    baseURL: config.projects[0]?.use?.baseURL as string | undefined,
  })

  await page.goto(`/${locale}/auth`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /sign in|登录|signin/i }).click()
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 60_000 })
  await page.context().storageState({ path: storageStatePath })

  await page.close()
  await browser.close()
}
