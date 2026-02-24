'use client'

import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { motion } from 'framer-motion'

export function Hero() {
  const t = useTranslations('landing.hero')
  const locale = useLocale()

  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="container mx-auto max-w-5xl px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            {t('title')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            {t('subtitle')}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href={`/${locale}/auth`}
              className="rounded-lg bg-foreground px-8 py-3 text-base font-medium text-background hover:bg-foreground/90 transition-colors"
            >
              {t('cta')}
            </Link>
            <Link
              href={`/${locale}/pricing`}
              className="rounded-lg border px-8 py-3 text-base font-medium hover:bg-secondary transition-colors"
            >
              {t('ctaSecondary')}
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
