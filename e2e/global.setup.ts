import { chromium, type FullConfig } from '@playwright/test'
import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type CookieRecord = {
  name: string
  value: string
  options?: {
    httpOnly?: boolean
    maxAge?: number
    path?: string
    sameSite?: 'lax' | 'strict' | 'none'
    secure?: boolean
  }
}

function requireAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new Error(`Missing required environment variable. Tried: ${names.join(', ')}`)
}

function upsertCookies(store: CookieRecord[], updates: CookieRecord[]) {
  for (const cookie of updates) {
    const index = store.findIndex((entry) => entry.name === cookie.name)
    if (cookie.value) {
      if (index >= 0) {
        store[index] = cookie
      } else {
        store.push(cookie)
      }
      continue
    }

    if (index >= 0) {
      store.splice(index, 1)
    }
  }
}

function mapSameSite(value?: 'lax' | 'strict' | 'none') {
  if (value === 'strict') return 'Strict'
  if (value === 'none') return 'None'
  return 'Lax'
}

async function buildAuthenticatedCookies(email: string, password: string) {
  const supabaseUrl = requireAnyEnv(['NEXT_PUBLIC_SUPABASE_URL'])
  const supabaseAnonKey = requireAnyEnv(['NEXT_PUBLIC_SUPABASE_ANON_KEY'])
  const cookieStore: CookieRecord[] = []
  const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: async () => cookieStore.map(({ name, value }) => ({ name, value })),
      setAll: async (cookies) => upsertCookies(cookieStore, cookies as CookieRecord[]),
    },
    isSingleton: false,
  })

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Failed to authenticate Playwright user via Supabase')
  }

  return cookieStore
}

async function createFallbackUser() {
  const supabaseUrl = requireAnyEnv(['NEXT_PUBLIC_SUPABASE_URL'])
  const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY'])
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const email = `shopix-e2e-${Date.now()}@gmail.com`
  const password = 'ShopixE2E123!'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new Error(error?.message ?? 'Failed to create fallback Playwright user')
  }

  return { email, password }
}

export default async function globalSetup(config: FullConfig) {
  if (process.env.PLAYWRIGHT_SKIP_GLOBAL_SETUP === '1') {
    return
  }

  const email = requireAnyEnv(['TA_PRO_E2E_ADMIN_EMAIL', 'TEST_USER_EMAIL'])
  const password = requireAnyEnv(['TA_PRO_E2E_ADMIN_PASSWORD', 'TEST_USER_PASSWORD'])
  const storageStatePath = resolve(process.cwd(), 'e2e/.auth/ta-pro-admin.json')
  const baseURL = (config.projects[0]?.use?.baseURL as string | undefined) ?? 'http://127.0.0.1:3000'

  mkdirSync(dirname(storageStatePath), { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL })

  let cookies: CookieRecord[]
  try {
    cookies = await buildAuthenticatedCookies(email, password)
  } catch {
    const fallbackUser = await createFallbackUser()
    cookies = await buildAuthenticatedCookies(fallbackUser.email, fallbackUser.password)
  }

  await context.addCookies(
    cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: baseURL,
      httpOnly: Boolean(cookie.options?.httpOnly),
      secure: Boolean(cookie.options?.secure),
      sameSite: mapSameSite(cookie.options?.sameSite),
      expires: cookie.options?.maxAge
        ? Math.floor(Date.now() / 1000) + cookie.options.maxAge
        : -1,
    })),
  )
  await context.storageState({ path: storageStatePath })

  await context.close()
  await browser.close()
}
