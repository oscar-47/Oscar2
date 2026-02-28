'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { usePathname } from 'next/navigation'
import { LanguageSwitcher } from './LanguageSwitcher'
import { cn } from '@/lib/utils'
import { Layers, Image, Shirt, Paintbrush, Monitor } from 'lucide-react'

const NAV_ITEMS = [
  { key: 'studioGenesis', path: '/studio-genesis', icon: Layers },
  { key: 'aestheticMirror', path: '/aesthetic-mirror', icon: Image },
  { key: 'clothingStudio', path: '/clothing-studio', icon: Shirt },
  { key: 'refinementStudio', path: '/refinement-studio', icon: Paintbrush },
  { key: 'pricing', path: '/pricing', icon: Monitor },
] as const

export function Navbar() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 w-full bg-[#f4f5f7]/92 backdrop-blur supports-[backdrop-filter]:bg-[#f4f5f7]/82">
      <div className="mx-auto flex h-[82px] w-full max-w-6xl items-center justify-between px-5 sm:px-6">
        {/* Logo */}
        <Link href={`/${locale}`} prefetch className="flex shrink-0 items-center gap-2.5 font-bold text-lg">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f1218] text-white shadow-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 0L9.8 5.2L15.6 5.2L10.9 8.8L12.7 14L8 10.4L3.3 14L5.1 8.8L0.4 5.2L6.2 5.2L8 0Z" fill="currentColor"/>
            </svg>
          </span>
          <span className="hidden text-lg tracking-tight text-[#151920] sm:inline">Shopix AI</span>
        </Link>

        {/* Feature nav - same active state style as dashboard */}
        <nav className="hidden items-center gap-1.5 md:flex">
          {NAV_ITEMS.map(({ key, path, icon: Icon }) => {
            const href = `/${locale}${path}`
            const isActive = pathname.startsWith(href)
            return (
              <Link
                key={key}
                href={href}
                prefetch
                className={cn(
                  'flex items-center gap-2 rounded-2xl px-4 py-2 text-[15px] whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-[#11141b] text-white font-semibold shadow-sm'
                    : 'text-[#6d7280] hover:text-[#272b33] hover:bg-[#eceef2]'
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} />
                {t(key as keyof ReturnType<typeof t>)}
              </Link>
            )
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2.5">
          <LanguageSwitcher />
          <Link
            href={`/${locale}/auth`}
            prefetch
            className="inline-flex h-10 items-center rounded-2xl bg-[#11141b] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1b1f2a]"
          >
            {t('signIn')}
          </Link>
        </div>
      </div>
    </header>
  )
}
