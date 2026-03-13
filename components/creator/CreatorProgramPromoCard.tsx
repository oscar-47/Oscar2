'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BadgeCheck, BellDot, ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface CreatorProgramPromoCardProps {
  dismissible?: boolean
  className?: string
}

function buildStorageKey(userId: string | null) {
  return `creator-program:dismissed:${userId ?? 'guest'}`
}

export function CreatorProgramPromoCard({
  dismissible = false,
  className,
}: CreatorProgramPromoCardProps) {
  const tPromo = useTranslations('creatorProgram.promo')
  const tDetail = useTranslations('creatorProgram.detail')
  const locale = useLocale()
  const [userId, setUserId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const storageKey = useMemo(() => buildStorageKey(userId), [userId])

  function dismissCard() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, '1')
    }
    setDismissed(true)
    setIsExpanded(false)
  }

  useEffect(() => {
    let active = true
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      setUserId(data.user?.id ?? null)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!dismissible || typeof window === 'undefined') return
    setDismissed(window.localStorage.getItem(storageKey) === '1')
  }, [dismissible, storageKey])

  if (dismissible && dismissed) return null

  return (
    <section
      className={cn(
        'overflow-hidden rounded-[24px] border border-amber-200/80 bg-[linear-gradient(135deg,#fffaf2_0%,#fff5e5_60%,#fffbf4_100%)] p-4 shadow-[0_18px_40px_-30px_rgba(161,98,7,0.32)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/75 px-3 py-1 text-xs font-semibold text-amber-700">
            <Sparkles className="h-3.5 w-3.5" />
            {tPromo('eyebrow')}
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-700">{tPromo('description')}</p>
        </div>

        {dismissible ? (
          <button
            type="button"
            aria-label={tPromo('dismiss')}
            onClick={dismissCard}
            className="rounded-full border border-amber-200 bg-white/90 p-2 text-amber-700 transition-colors hover:bg-white"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border border-white/75 bg-white/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <BellDot className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-950">{tPromo('peekTitle')}</p>
              <p className="text-sm leading-6 text-slate-700">{tPromo('footnote')}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIsExpanded((current) => !current)}
              className="border-amber-200 bg-white text-amber-800 hover:bg-amber-50"
            >
              {isExpanded ? (
                <>
                  {tPromo('collapse')}
                  <ChevronUp className="ml-1 h-4 w-4" />
                </>
              ) : (
                <>
                  {tPromo('open')}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
            <Link
              href={`/${locale}/profile#creator-program-feedback`}
              className="inline-flex h-8 items-center justify-center rounded-xl bg-slate-950 px-3 text-sm font-medium text-white transition-transform hover:-translate-y-0.5"
            >
              {tPromo('submitCta')}
            </Link>
          </div>
        </div>
      </div>

      {isExpanded ? (
        <div className="mt-4 grid gap-4 rounded-[26px] border border-amber-200/80 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
          <div className="rounded-2xl border border-amber-100 bg-[linear-gradient(180deg,rgba(255,251,235,0.95),rgba(255,255,255,0.92))] p-4">
            <p className="text-sm font-semibold text-slate-950">{tDetail('rules.title')}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(['3d', '7dLight', '7dMid', '7dHigh'] as const).map((key) => (
                <div
                  key={key}
                  className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]"
                >
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                    <BadgeCheck className="h-3 w-3" />
                    {tPromo(`tiers.${key}.label`)}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">
                    {tPromo(`tiers.${key}.title`)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{tPromo(`tiers.${key}.reward`)}</p>
                </div>
              ))}
            </div>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
              <li>{tDetail('rules.metric')}</li>
              <li>{tDetail('rules.stack')}</li>
              <li>{tDetail('rules.nonRepeat')}</li>
            </ul>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-amber-100 bg-white/92 p-4">
              <p className="text-sm font-semibold text-slate-950">{tDetail('steps.title')}</p>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                <li>1. {tDetail('steps.one')}</li>
                <li>2. {tDetail('steps.two')}</li>
                <li>3. {tDetail('steps.three')}</li>
                <li>4. {tDetail('steps.four')}</li>
              </ol>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-sm font-semibold text-amber-950">{tPromo('title')}</p>
              <p className="mt-2 text-sm leading-6 text-amber-900">{tPromo('footnote')}</p>
              {dismissible ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={dismissCard}
                  className="mt-3 h-9 justify-center rounded-xl px-3 text-slate-600 hover:bg-white/70 hover:text-slate-900"
                >
                  {tPromo('dismissAfterReading')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
