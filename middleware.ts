import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { getMaintenanceConfig } from '@/lib/maintenance'
import { getSiteHost } from '@/lib/site'
import { isAdminUser } from '@/types'

const intlMiddleware = createMiddleware(routing)

// Routes that require authentication
const PROTECTED_PATHS = [
  '/studio-genesis',
  '/aesthetic-mirror',
  '/batch-studio',
  '/clothing-studio',
  '/ecom-studio',
  '/refinement-studio',
  '/history',
  '/profile',
  '/image-editor',
]

function isProtectedPath(pathname: string): boolean {
  // Strip locale prefix: /en/studio-genesis → /studio-genesis
  const withoutLocale = pathname.replace(/^\/(en|zh)/, '')
  return PROTECTED_PATHS.some((p) => withoutLocale.startsWith(p))
}

async function safeGetUser(
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ user: { id: string; email: string | null } | null }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return { user: user ? { id: user.id, email: user.email ?? null } : null }
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : null

    if (status === 429) {
      return { user: null }
    }

    throw error
  }
}

function getLocaleFromPath(pathname: string): string {
  const segment = pathname.split('/')[1]
  return routing.locales.includes(segment as (typeof routing.locales)[number])
    ? segment
    : routing.defaultLocale
}

function isMaintenancePath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(en|zh)/, '')
  return withoutLocale === '/maintenance' || withoutLocale.startsWith('/maintenance/')
}

export async function middleware(request: NextRequest) {
  const requestHost = request.headers.get('host')
  const canonicalHost = getSiteHost()

  if (requestHost === `www.${canonicalHost}`) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.host = canonicalHost
    return NextResponse.redirect(redirectUrl, 301)
  }

  // 1. Run next-intl middleware first (handles locale detection & redirects)
  const intlResponse = intlMiddleware(request)

  // 2. Refresh Supabase session
  const response = intlResponse ?? NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let userPromise: Promise<{ user: { id: string; email: string | null } | null }> | null = null
  const getCurrentUser = () => {
    userPromise ??= safeGetUser(supabase)
    return userPromise
  }

  const pathname = request.nextUrl.pathname
  const locale = getLocaleFromPath(pathname)
  const maintenance = await getMaintenanceConfig()

  if (maintenance.enabled && !isMaintenancePath(pathname)) {
    const { user } = await getCurrentUser()
    if (!user || !isAdminUser(user.email)) {
      const maintenanceUrl = new URL(`/${locale}/maintenance`, request.url)
      return NextResponse.redirect(maintenanceUrl)
    }
  }

  // 3. Guard protected routes — only call getUser() when needed (it hits Supabase API)
  if (isProtectedPath(pathname)) {
    const { user } = await getCurrentUser()
    if (!user) {
      const authUrl = new URL(`/${locale}/auth`, request.url)
      authUrl.searchParams.set('returnTo', pathname)
      return NextResponse.redirect(authUrl)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Match root path explicitly
    '/',
    // Match all paths except static files and Next.js internals
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)',
  ],
}
