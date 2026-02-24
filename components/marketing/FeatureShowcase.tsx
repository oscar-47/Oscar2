'use client'

import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'

const FEATURES = [
  { key: 'studioGenesis', icon: '✦', path: '/studio-genesis' },
  { key: 'aestheticMirror', icon: '◈', path: '/aesthetic-mirror' },
  { key: 'clothingStudio', icon: '◉', path: '/clothing-studio' },
  { key: 'refinementStudio', icon: '◎', path: '/refinement-studio' },
] as const

export function FeatureShowcase() {
  const t = useTranslations('landing.features')
  const locale = useLocale()

  return (
    <section className="py-20 bg-secondary/30">
      <div className="container mx-auto max-w-6xl px-4">
        <h2 className="text-center text-3xl font-bold mb-12">{t('title')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map(({ key, icon, path }) => (
            <Link
              key={key}
              href={`/${locale}${path}`}
              className="group rounded-2xl border bg-card p-6 hover:shadow-md transition-all hover:-translate-y-1"
            >
              <div className="mb-4 text-3xl">{icon}</div>
              <h3 className="font-semibold mb-2 group-hover:text-foreground">
                {t(`${key}.name` as Parameters<typeof t>[0])}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t(`${key}.description` as Parameters<typeof t>[0])}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
