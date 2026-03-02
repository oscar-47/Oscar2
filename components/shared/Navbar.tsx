'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Navbar() {
  const t = useTranslations('landing.nav')
  const locale = useLocale()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#e4e9f2] bg-white/88 backdrop-blur supports-[backdrop-filter]:bg-white/74">
      <div className="mx-auto flex h-[82px] w-full max-w-[1280px] items-center justify-between px-5 sm:px-8">
        <Link href={`/${locale}`} prefetch className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f172a] text-white shadow-[0_10px_20px_rgba(15,23,42,0.2)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M8 0L9.8 5.2L15.6 5.2L10.9 8.8L12.7 14L8 10.4L3.3 14L5.1 8.8L0.4 5.2L6.2 5.2L8 0Z" fill="currentColor" />
            </svg>
          </span>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight text-[#0f172a] sm:text-lg">Shopix AI</span>
            <span className="hidden text-[11px] font-medium tracking-[0.14em] text-[#64748b] sm:block">{t('tagline')}</span>
          </div>
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <LanguageSwitcher />
          <Link
            href={`/${locale}/auth`}
            prefetch
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#0f172a] px-4 text-sm font-semibold text-white transition-all hover:bg-[#1e293b]"
          >
            {t('cta')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  )
}
