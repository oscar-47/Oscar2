'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'

export function Footer() {
  const t = useTranslations('landing.footer')
  const locale = useLocale()

  return (
    <footer className="border-t border-border bg-secondary py-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="text-sm text-muted-foreground">{t('copyright')}</p>

        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link href={`/${locale}/terms`} className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline">
            {t('terms')}
          </Link>
          <Link href={`/${locale}/privacy`} className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline">
            {t('privacy')}
          </Link>
        </div>
      </div>
    </footer>
  )
}
