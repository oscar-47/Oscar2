'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createCreditCheckout, createOnetimeCheckout, createAlipayCheckout } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import { Gift, Sparkles, Clock } from 'lucide-react'
import { SiVisa, SiMastercard, SiAmericanexpress, SiApplepay } from 'react-icons/si'

type PlanSlug = 'monthly' | 'quarterly' | 'yearly' | 'topup_5' | 'topup_15' | 'topup_30'
type Currency = 'usd' | 'cny' | 'hkd'

interface DbPackage {
  id: string
  name: string
  type: 'subscription' | 'one_time'
  price_usd: number
  credits: number
  first_sub_bonus: number
  stripe_price_id: string | null
  stripe_price_id_cny: string | null
  stripe_price_id_hkd: string | null
  is_popular: boolean
  sort_order: number
}

const PLAN_ORDER: PlanSlug[] = ['topup_5', 'topup_15', 'topup_30', 'monthly', 'quarterly', 'yearly']

const CURRENCY_OPTIONS: { value: Currency; label: string; symbol: string }[] = [
  { value: 'usd', label: 'USD', symbol: '$' },
]

const CNY_PRICES: Record<PlanSlug, number> = {
  topup_5: 36, topup_15: 108, topup_30: 218,
  monthly: 72, quarterly: 202, yearly: 718,
}

const HKD_PRICES: Record<PlanSlug, number> = {
  topup_5: 39, topup_15: 117, topup_30: 234,
  monthly: 77, quarterly: 218, yearly: 772,
}

const PROMO_END = new Date('2026-03-20T23:59:59+08:00')

function formatPrice(value: number, currency: Currency): string {
  const opt = CURRENCY_OPTIONS.find((c) => c.value === currency)!
  if (currency === 'usd') {
    return Number.isInteger(value) ? `${opt.symbol}${value.toFixed(0)}` : `${opt.symbol}${value.toFixed(1)}`
  }
  return `${opt.symbol}${Math.round(value)}`
}

function getDisplayPrice(pkg: DbPackage, currency: Currency): number {
  if (currency === 'cny') return CNY_PRICES[pkg.name as PlanSlug] ?? pkg.price_usd
  if (currency === 'hkd') return HKD_PRICES[pkg.name as PlanSlug] ?? pkg.price_usd
  return pkg.price_usd
}

function hasPriceId(pkg: DbPackage, currency: Currency): boolean {
  if (currency === 'cny') return !!(pkg.stripe_price_id_cny || pkg.stripe_price_id)
  if (currency === 'hkd') return !!(pkg.stripe_price_id_hkd || pkg.stripe_price_id)
  return !!pkg.stripe_price_id
}

function planCycleKey(plan: PlanSlug): 'month' | 'quarter' | 'year' | null {
  if (plan === 'monthly') return 'month'
  if (plan === 'quarterly') return 'quarter'
  if (plan === 'yearly') return 'year'
  return null
}

function AlipayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect width="24" height="24" rx="5" fill="#1677FF" />
      <path d="M17.5 14.2c-1.4-.6-3-1.2-3.8-1.5.5-.9.9-2 1.1-3.1h-2.5v-1h3V7.5h-3V5.8h-1.5v1.7H7.7v1.1h3.1v1h-2.7v1.1h4.8c-.2.7-.5 1.4-.9 2-1.1-.4-2.4-.6-3.5-.2-1.3.5-2 1.6-1.7 2.7.3 1.1 1.5 1.7 2.8 1.4 1-.3 1.8-.9 2.5-1.7.9.4 2.6 1.1 4 1.6l1.4-2.3z M9.8 15.8c-.8.3-1.6 0-1.8-.5-.2-.5.1-1.2.9-1.5.5-.2 1.1-.2 1.7 0-.5.8-1.1 1.6-1.8 2z" fill="white" fillOpacity="0.95" />
    </svg>
  )
}

function useCountdown(targetDate: Date) {
  const calcRemaining = useCallback(() => {
    const diff = targetDate.getTime() - Date.now()
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
      expired: false,
    }
  }, [targetDate])
  const [remaining, setRemaining] = useState(calcRemaining)
  useEffect(() => {
    const id = setInterval(() => setRemaining(calcRemaining()), 1000)
    return () => clearInterval(id)
  }, [calcRemaining])
  return remaining
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-base font-bold tabular-nums text-white backdrop-blur-sm sm:h-10 sm:w-10 sm:text-lg">
        {String(value).padStart(2, '0')}
      </span>
      <span className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-white/60">
        {label}
      </span>
    </div>
  )
}

/* ── Per-plan progressive color tiers ── */
/* Progression: cool slate → warm stone → rich amber/gold */
const CARD_STYLES: Record<PlanSlug, { ring: string; bg: string; accent: string; badge: string; btnClass: string; shadowHover: string }> = {
  /* ── Top-up: slate → stone → amber ── */
  topup_5: {
    ring: 'border-zinc-200',
    bg: 'bg-[linear-gradient(165deg,#f9fafb_0%,#f4f6fa_40%,#ffffff_100%)]',
    accent: 'text-zinc-900',
    badge: 'bg-zinc-800 text-white',
    btnClass: 'bg-zinc-900 text-white hover:bg-zinc-800',
    shadowHover: 'hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.08)]',
  },
  topup_15: {
    ring: 'border-stone-300/60',
    bg: 'bg-[linear-gradient(165deg,#faf8f4_0%,#f3ede4_40%,#fefefe_100%)]',
    accent: 'text-stone-900',
    badge: 'bg-stone-700 text-stone-50',
    btnClass: 'bg-stone-800 text-stone-50 hover:bg-stone-700',
    shadowHover: 'hover:shadow-[0_12px_40px_-12px_rgba(80,55,20,0.10)]',
  },
  topup_30: {
    ring: 'border-amber-300/70',
    bg: 'bg-[linear-gradient(165deg,#fffcf0_0%,#fff4da_32%,#fffdf6_100%)]',
    accent: 'text-amber-950',
    badge: 'bg-amber-900 text-amber-50',
    btnClass: 'bg-gradient-to-r from-amber-900 via-amber-800 to-amber-900 text-amber-50 shadow-sm shadow-amber-900/25 hover:from-amber-800 hover:via-amber-700 hover:to-amber-800',
    shadowHover: 'hover:shadow-[0_16px_48px_-12px_rgba(160,100,20,0.18)]',
  },
  /* ── Subscription: cool navy → warm bronze → rich gold ── */
  monthly: {
    ring: 'border-slate-200',
    bg: 'bg-[linear-gradient(165deg,#f8f9fc_0%,#f0f3f9_40%,#ffffff_100%)]',
    accent: 'text-slate-900',
    badge: 'bg-slate-800 text-white',
    btnClass: 'bg-slate-900 text-white hover:bg-slate-800',
    shadowHover: 'hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.08)]',
  },
  quarterly: {
    ring: 'border-stone-300/60',
    bg: 'bg-[linear-gradient(165deg,#f9f6f2_0%,#f0e9df_40%,#fefefe_100%)]',
    accent: 'text-stone-900',
    badge: 'bg-stone-700 text-stone-50',
    btnClass: 'bg-stone-800 text-stone-50 hover:bg-stone-700',
    shadowHover: 'hover:shadow-[0_12px_40px_-12px_rgba(80,55,20,0.10)]',
  },
  yearly: {
    ring: 'border-amber-300/70',
    bg: 'bg-[linear-gradient(165deg,#fffcf0_0%,#fff4da_32%,#fffdf6_100%)]',
    accent: 'text-amber-950',
    badge: 'bg-amber-900 text-amber-50',
    btnClass: 'bg-gradient-to-r from-amber-900 via-amber-800 to-amber-900 text-amber-50 shadow-sm shadow-amber-900/25 hover:from-amber-800 hover:via-amber-700 hover:to-amber-800',
    shadowHover: 'hover:shadow-[0_16px_48px_-12px_rgba(160,100,20,0.18)]',
  },
}

export function PricingPage() {
  const t = useTranslations('pricing')
  const locale = useLocale()
  const isZh = locale === 'zh'
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [packages, setPackages] = useState<DbPackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [currency] = useState<Currency>('usd')
  const countdown = useCountdown(PROMO_END)
  const localeStr = isZh ? 'zh-CN' : 'en-US'

  const successParam = searchParams.get('success')
  const typeParam = searchParams.get('type')
  const canceledParam = searchParams.get('canceled')

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('packages')
      .select('id,name,type,price_usd,credits,first_sub_bonus,stripe_price_id,stripe_price_id_cny,stripe_price_id_hkd,is_popular,sort_order')
      .eq('active', true)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) console.error('packages fetch error:', error)
        if (data) setPackages(data as DbPackage[])
        setPackagesLoading(false)
      })
  }, [])

  const packageMap = useMemo(() => {
    const entries = packages
      .filter((pkg): pkg is DbPackage & { name: PlanSlug } => PLAN_ORDER.includes(pkg.name as PlanSlug))
      .map((pkg) => [pkg.name, pkg] as const)
    return new Map<PlanSlug, DbPackage>(entries)
  }, [packages])

  const topupPlans: PlanSlug[] = ['topup_5', 'topup_15', 'topup_30']
  const subPlans: PlanSlug[] = ['monthly', 'quarterly', 'yearly']

  async function handleChoosePlan(pkg: DbPackage, useAlipay = false) {
    if (!useAlipay && !hasPriceId(pkg, currency)) return
    setCheckoutError(null)
    setLoading(pkg.id)
    try {
      const returnTo = `/${locale}/pricing`
      if (useAlipay) {
        const { url } = await createAlipayCheckout(pkg.id, returnTo)
        window.location.href = url
        return
      }
      if (pkg.type === 'subscription') {
        const { url } = await createCreditCheckout(pkg.id, returnTo, currency)
        window.location.href = url
        return
      }
      const { url } = await createOnetimeCheckout(pkg.id, returnTo, currency)
      window.location.href = url
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : t('paymentSetupHint'))
    } finally {
      setLoading(null)
    }
  }

  function renderPlanCard(planName: PlanSlug) {
    const pkg = packageMap.get(planName)
    if (!pkg) return null

    const cycleKey = planCycleKey(planName)
    const isSubscription = pkg.type === 'subscription'
    const isFeatured = planName === 'yearly' || planName === 'topup_30'
    const isDisabled = loading !== null
    const displayPrice = getDisplayPrice(pkg, currency)
    const bonus = pkg.first_sub_bonus ?? 0
    const totalCredits = pkg.credits + bonus
    const nanoBanana = Math.floor(totalCredits / 15)
    const style = CARD_STYLES[planName]

    return (
      <article
        key={pkg.id}
        className={`relative flex flex-col overflow-hidden rounded-[24px] border ${style.ring} ${style.bg} p-6 transition-all duration-300 hover:-translate-y-1 ${style.shadowHover}`}
      >
        {/* Accent line for premium tiers */}
        {isFeatured && (
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
        )}
        {/* Label badge for subscriptions */}
        {isSubscription && (
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${style.badge}`}>
              {t(`labels.${planName}` as Parameters<typeof t>[0])}
            </span>
            {isFeatured && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
                {t('stickers.bestValue')}
              </span>
            )}
          </div>
        )}

        {/* Plan name for topups */}
        {!isSubscription && (
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t(`planNames.${planName}` as Parameters<typeof t>[0])}
          </p>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1.5">
          <span className={`font-[var(--font-display)] text-[2.4rem] font-extrabold leading-none tracking-[-0.04em] ${style.accent}`}>
            {formatPrice(displayPrice, currency)}
          </span>
          {cycleKey && (
            <span className="text-sm font-medium text-muted-foreground">
              {t(`cycles.${cycleKey}` as Parameters<typeof t>[0])}
            </span>
          )}
        </div>

        {/* Credits + Nano Banana */}
        <div className="mt-4 space-y-1.5">
          <p className="text-[15px] font-semibold text-foreground">
            {totalCredits.toLocaleString(localeStr)} {t('creditsUnit')}
          </p>
          {bonus > 0 && !countdown.expired && (
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
              <Gift className="h-3.5 w-3.5" />
              +{bonus.toLocaleString(localeStr)} {t('bonusLabel')}
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">
            🍌 {isZh ? `约 ${nanoBanana.toLocaleString(localeStr)} 张 Nano Banana` : `~${nanoBanana.toLocaleString(localeStr)} Nano Banana images`}
          </p>
        </div>

        {/* Description */}
        <div className="mt-4 flex-1 space-y-1 text-[13px] leading-5 text-muted-foreground">
          <p>{isSubscription ? t('subscriptionRule') : t('singlePurchase')}</p>
          {isSubscription && <p>{t('cancelAnytime')}</p>}
        </div>

        {/* Payment buttons */}
        <div className="mt-6 space-y-2">
          {hasPriceId(pkg, currency) && (
            <button
              onClick={() => handleChoosePlan(pkg)}
              disabled={isDisabled}
              className={`flex w-full items-center justify-center gap-3 rounded-2xl px-4 py-3 text-[13px] font-semibold transition-all press-scale ${style.btnClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {loading === pkg.id ? (
                t('buttons.processing')
              ) : (
                <>
                  <span className="flex items-center gap-1.5">
                    <SiVisa className="h-[18px] w-auto" color="#4166F5" />
                    <SiMastercard className="h-[16px] w-auto" color="#FF5F00" />
                    <SiAmericanexpress className="h-[15px] w-auto" color="#1A8FFF" />
                    <SiApplepay className="h-[18px] w-auto opacity-80" />
                  </span>
                  <span>{t('buttons.international')}</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={() => handleChoosePlan(pkg, true)}
            disabled={isDisabled}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-white px-4 py-3 text-[13px] font-semibold text-foreground/70 transition-all press-scale hover:border-[#1677FF]/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading === pkg.id ? t('buttons.processing') : (
              <>
                <AlipayIcon className="h-[18px] w-[18px]" />
                <span>{t('buttons.alipay')}</span>
              </>
            )}
          </button>
        </div>
      </article>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Status banners */}
      {successParam && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {typeParam === 'onetime' ? t('successOnetime') : t('success')}
        </div>
      )}
      {canceledParam && (
        <div className="mb-6 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          {t('canceled')}
        </div>
      )}
      {checkoutError && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {checkoutError}
        </div>
      )}

      <div className="space-y-10">
        {/* Promo countdown banner */}
        {!countdown.expired && (
          <div className="overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#1a1a2e_0%,#16213e_40%,#0f3460_100%)] p-6 shadow-[0_8px_32px_-8px_rgba(15,52,96,0.35)] sm:p-8">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
              <div className="text-center sm:text-left">
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  <Sparkles className="h-3 w-3" />
                  {t('promo.badge')}
                </div>
                <h2 className="mt-3 text-lg font-bold text-white sm:text-xl">
                  {t('promo.title')}
                </h2>
                <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/60">
                  {t('promo.subtitle')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CountdownUnit value={countdown.days} label={t('promo.days')} />
                <span className="mt-[-12px] text-base font-bold text-white/30">:</span>
                <CountdownUnit value={countdown.hours} label={t('promo.hours')} />
                <span className="mt-[-12px] text-base font-bold text-white/30">:</span>
                <CountdownUnit value={countdown.minutes} label={t('promo.mins')} />
                <span className="mt-[-12px] text-base font-bold text-white/30">:</span>
                <CountdownUnit value={countdown.seconds} label={t('promo.secs')} />
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-center">
          <h1 className="font-[var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-foreground sm:text-5xl">
            {t('title')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            {t('subtitle')}
          </p>
        </div>

        {/* One-time top-up section */}
        <section>
          <div className="mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              TOP-UP
            </p>
            <h2 className="mt-1.5 text-xl font-bold text-foreground">{t('groups.oneTime')}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('groups.oneTimeHint')}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {packagesLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-[340px] animate-pulse rounded-[24px] bg-muted/40" />
                ))
              : topupPlans.map((plan) => renderPlanCard(plan))}
          </div>
        </section>

        {/* Subscription section */}
        <section>
          <div className="mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              SUBSCRIPTION
            </p>
            <h2 className="mt-1.5 text-xl font-bold text-foreground">{t('groups.subscription')}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('groups.subscriptionHint')}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {packagesLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-[380px] animate-pulse rounded-[24px] bg-muted/40" />
                ))
              : subPlans.map((plan) => renderPlanCard(plan))}
          </div>
        </section>

        {/* Bottom info */}
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[24px] border border-border bg-white p-6">
            <h2 className="text-lg font-bold text-foreground">{t('faq.title')}</h2>
            <div className="mt-4 space-y-3">
              {['autoRenew', 'cancel', 'expiry'].map((key) => (
                <div key={key} className="rounded-2xl bg-surface p-4">
                  <p className="text-sm font-semibold text-foreground">{t(`faq.${key}Q` as Parameters<typeof t>[0])}</p>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{t(`faq.${key}A` as Parameters<typeof t>[0])}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] border border-foreground/10 bg-foreground p-6 text-background">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-background/50" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-background/50">CREDITS</p>
            </div>
            <h2 className="mt-2 text-lg font-bold">{t('usage.title')}</h2>
            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3.5 text-sm">
                <span>{t('usage.fastLabel')}</span>
                <span className="font-bold tabular-nums">15 {t('creditsUnit')}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3.5 text-sm">
                <span>{t('usage.balancedLabel')}</span>
                <span className="font-bold tabular-nums">30 {t('creditsUnit')}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3.5 text-sm">
                <span>{t('usage.qualityLabel')}</span>
                <span className="font-bold tabular-nums">50 {t('creditsUnit')}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
