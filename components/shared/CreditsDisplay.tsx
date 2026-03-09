'use client'

import { useCredits } from '@/lib/hooks/useCredits'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Coins } from 'lucide-react'

interface CreditsDisplayProps {
  userId: string
}

export function CreditsDisplay({ userId }: CreditsDisplayProps) {
  const t = useTranslations('credits')
  const locale = useLocale()
  const { total, isLoading } = useCredits(userId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
        <span className="text-muted-foreground">—</span>
      </div>
    )
  }

  return (
    <Link
      href={`/${locale}/pricing`}
      className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm hover:bg-muted transition-colors"
    >
      <Coins className="h-3.5 w-3.5 text-amber-500" />
      <span className="font-medium">{total}</span>
    </Link>
  )
}
