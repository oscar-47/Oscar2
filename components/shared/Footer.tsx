'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

export function Footer() {
  const t = useTranslations('landing.footer')

  return (
    <footer className="border-t border-[#e4e9f2] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] py-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="text-sm text-[#475569]">{t('copyright')}</p>

        <div className="flex items-center gap-6 text-sm text-[#475569]">
          <Link href="/terms" className="transition-colors hover:text-[#0f172a]">
            {t('terms')}
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-[#0f172a]">
            {t('privacy')}
          </Link>
        </div>
      </div>
    </footer>
  )
}
