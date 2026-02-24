'use client'

import { useTranslations } from 'next-intl'

export function ProfilePage() {
  const t = useTranslations('profile')
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <div className="rounded-2xl border p-6 space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">{t('plan')}</p>
          <p className="font-medium">{t('noPlan')}</p>
        </div>
      </div>
    </div>
  )
}
