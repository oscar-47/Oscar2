'use client'

import { useCredits } from '@/lib/hooks/useCredits'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'

interface CreditsDisplayProps {
  userId: string
}

export function CreditsDisplay({ userId }: CreditsDisplayProps) {
  const t = useTranslations('credits')
  const locale = useLocale()
  const { total, isLoading } = useCredits(userId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
        <span className="text-muted-foreground">—</span>
      </div>
    )
  }

  return (
    <Link
      href={`/${locale}/pricing`}
      className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-secondary transition-colors"
    >
      <span>🪙</span>
      <span className="font-medium">{total}</span>
    </Link>
  )
}
