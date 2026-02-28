'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowRight } from 'lucide-react'

export function Hero() {
  const t = useTranslations('landing.hero')
  const locale = useLocale()

  return (
    <section className="bg-[#f3f3f4] pb-20 pt-16 md:pb-24 md:pt-20">
      <div className="mx-auto max-w-[1240px] px-4 text-center">
        <div className="mx-auto max-w-[920px]">
          <h1 className="text-[52px] font-semibold tracking-[-0.04em] text-[#17181d] md:text-[76px]">
            {t('title')}
          </h1>
          <p className="mx-auto mt-7 max-w-[760px] text-[29px] leading-[1.55] text-[#6f737f] md:text-[32px]">
            {t('subtitle')}
          </p>
          <div className="mt-14 flex flex-wrap items-center justify-center gap-4">
            <Link
              href={`/${locale}/auth`}
              className="inline-flex h-[52px] items-center gap-2 rounded-2xl bg-[#101116] px-9 text-xl font-medium text-white transition-colors hover:bg-[#1a1c24]"
            >
              {t('cta')}
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="#suite-cards"
              className="inline-flex h-[52px] items-center rounded-2xl border border-[#e1e2e7] bg-white px-9 text-xl font-medium text-[#17181d] transition-colors hover:bg-[#f8f8fa]"
            >
              {t('ctaSecondary')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
