'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CreatorProgramChipLinkProps {
  className?: string
}

export function CreatorProgramChipLink({ className }: CreatorProgramChipLinkProps) {
  const locale = useLocale()
  const t = useTranslations('creatorProgram.promo')

  return (
    <Link
      href={`/${locale}/profile`}
      className={cn(
        'group relative inline-flex items-center gap-2 overflow-hidden rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/80 px-4 py-2.5 shadow-sm transition-all duration-300',
        'hover:border-amber-300/90 hover:shadow-md hover:-translate-y-0.5',
        className,
      )}
    >
      {/* Subtle animated shimmer */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-amber-100/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

      <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100/80 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
      </span>

      <span className="relative text-[13px] font-semibold tracking-tight text-amber-800">
        {t('moduleChip')}
      </span>
    </Link>
  )
}
