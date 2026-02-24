'use client'

import { useTranslations } from 'next-intl'

export function HistoryPage() {
  const t = useTranslations('history')
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <p className="text-muted-foreground">{t('empty')}</p>
    </div>
  )
}
