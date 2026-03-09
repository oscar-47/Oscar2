'use client'

import { useTranslations } from 'next-intl'

export function ModelTextHint() {
  const t = useTranslations('studio.common')

  return (
    <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
      {t('modelTextHint')}
    </p>
  )
}
