'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { usePathname } from 'next/navigation'
import { LanguageSwitcher } from './LanguageSwitcher'
import { CreditsDisplay } from './CreditsDisplay'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { key: 'studioGenesis', path: '/studio-genesis' },
  { key: 'aestheticMirror', path: '/aesthetic-mirror' },
  { key: 'clothingStudio', path: '/clothing-studio' },
  { key: 'refinementStudio', path: '/refinement-studio' },
] as const

interface DashboardNavbarProps {
  userId: string
}

export function DashboardNavbar({ userId }: DashboardNavbarProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}`)
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href={`/${locale}/studio-genesis`} className="flex items-center gap-2 font-bold text-lg shrink-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background text-sm font-bold">P</span>
          <span className="hidden sm:inline">Picset AI</span>
        </Link>

        {/* Feature nav */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          {NAV_ITEMS.map(({ key, path }) => {
            const href = `/${locale}${path}`
            const isActive = pathname.startsWith(href)
            return (
              <Link
                key={key}
                href={href}
                className={cn(
                  'px-3 py-1.5 rounded-md transition-colors text-sm',
                  isActive
                    ? 'bg-secondary text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                )}
              >
                {t(key as keyof ReturnType<typeof t>)}
              </Link>
            )
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <CreditsDisplay userId={userId} />
          <LanguageSwitcher />
          <Link
            href={`/${locale}/pricing`}
            className="hidden sm:inline-flex rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-secondary transition-colors"
          >
            {t('pricing' as Parameters<typeof t>[0])}
          </Link>
          <button
            onClick={handleSignOut}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('signOut' as Parameters<typeof t>[0])}
          </button>
        </div>
      </div>
    </header>
  )
}
