'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { MARKETING_DARK_CTA_BASE } from '@/components/marketing/marketing-styles'

export function Navbar() {
  const t = useTranslations('landing.nav')
  const locale = useLocale()
  const ecomAuthHref = `/${locale}/auth?returnTo=${encodeURIComponent(`/${locale}/ecom-studio`)}`

  return (
    <header className="sticky top-0 z-50 w-full bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-5 sm:px-8">
        <Link href={`/${locale}`} prefetch className="flex items-center gap-2">
          <span className="font-[var(--font-display)] text-xl font-extrabold tracking-tight text-foreground">
            Shopix
          </span>
          <span className="text-xs font-medium text-text-tertiary">AI</span>
        </Link>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            href={ecomAuthHref}
            prefetch
            className={`${MARKETING_DARK_CTA_BASE} h-9 rounded-[0.9rem] px-4 text-sm font-semibold`}
          >
            {t('cta')}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  )
}
