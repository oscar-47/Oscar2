import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const intlMiddleware = createMiddleware(routing)

// Routes that require authentication
const PROTECTED_PATHS = [
  '/studio-genesis',
  '/aesthetic-mirror',
  '/clothing-studio',
  '/refinement-studio',
  '/history',
  '/profile',
]

function isProtectedPath(pathname: string): boolean {
  // Strip locale prefix: /en/studio-genesis → /studio-genesis
  const withoutLocale = pathname.replace(/^\/(en|zh)/, '')
  return PROTECTED_PATHS.some((p) => withoutLocale.startsWith(p))
}

export async function middleware(request: NextRequest) {
  // 1. Run next-intl middleware first (handles locale detection & redirects)
  const intlResponse = intlMiddleware(request)

  // 2. Refresh Supabase session
  const response = intlResponse ?? NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 3. Guard protected routes
  if (isProtectedPath(request.nextUrl.pathname) && !user) {
    const locale = request.nextUrl.pathname.split('/')[1] || routing.defaultLocale
    const authUrl = new URL(`/${locale}/auth`, request.url)
    authUrl.searchParams.set('returnTo', request.nextUrl.pathname)
    return NextResponse.redirect(authUrl)
  }

  return response
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
