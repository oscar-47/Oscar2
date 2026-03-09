'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { LanguageSwitcher } from './LanguageSwitcher'
import { UserMenu } from './UserMenu'
import { cn } from '@/lib/utils'
import { Layers, Image, Shirt, Paintbrush, Monitor, ShoppingBag, Menu, X } from 'lucide-react'

const NAV_ITEMS = [
  { key: 'studioGenesis', path: '/studio-genesis', icon: Layers },
  { key: 'ecomStudio', path: '/ecom-studio', icon: ShoppingBag },
  { key: 'aestheticMirror', path: '/aesthetic-mirror', icon: Image },
  { key: 'clothingStudio', path: '/clothing-studio', icon: Shirt },
  { key: 'refinementStudio', path: '/refinement-studio', icon: Paintbrush },
  { key: 'pricing', path: '/pricing', icon: Monitor },
] as const

interface DashboardNavbarProps {
  userId: string
  email: string
}

export function DashboardNavbar({ userId, email }: DashboardNavbarProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile nav on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const hrefs = NAV_ITEMS.map(({ path }) => `/${locale}${path}`)
    hrefs.forEach((href) => {
      router.prefetch(href)
    })
  }, [locale, router])

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
        {/* Logo */}
        <Link
          href={`/${locale}`}
          prefetch
          className="flex shrink-0 items-center gap-2"
        >
          <span className="font-[var(--font-display)] text-lg font-extrabold tracking-tight text-foreground">
            Shopix
          </span>
          <span className="text-xs font-medium text-text-tertiary">AI</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main navigation">
          {NAV_ITEMS.map(({ key, path }) => {
            const href = `/${locale}${path}`
            const isActive = pathname.startsWith(href)
            return (
              <Link
                key={key}
                href={href}
                prefetch
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  isActive
                    ? 'bg-foreground text-background font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(key as keyof ReturnType<typeof t>)}
              </Link>
            )
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2.5">
          <LanguageSwitcher />
          <UserMenu userId={userId} email={email} />
          {/* Mobile menu toggle */}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <nav
          id="mobile-nav"
          className="border-t border-border bg-background px-5 pb-4 pt-2 md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ key, path, icon: Icon }) => {
              const href = `/${locale}${path}`
              const isActive = pathname.startsWith(href)
              return (
                <Link
                  key={key}
                  href={href}
                  prefetch
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-foreground text-background font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {t(key as keyof ReturnType<typeof t>)}
                </Link>
              )
            })}
          </div>
        </nav>
      )}
    </header>
  )
}
