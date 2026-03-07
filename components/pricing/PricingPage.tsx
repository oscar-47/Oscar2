'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createCreditCheckout, createOnetimeCheckout } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'

type PlanSlug = 'monthly' | 'quarterly' | 'yearly' | 'topup_5' | 'topup_15' | 'topup_30'

interface DbPackage {
  id: string
  name: string
  type: 'subscription' | 'one_time'
  price_usd: number
  credits: number
  first_sub_bonus: number
  stripe_price_id: string | null
  is_popular: boolean
  sort_order: number
}

const PLAN_ORDER: PlanSlug[] = ['topup_5', 'topup_15', 'topup_30', 'monthly', 'quarterly', 'yearly']

const SECTION_ORDER: Array<{ key: 'oneTime' | 'monthly' | 'quarterly' | 'yearly'; plans: PlanSlug[] }> = [
  { key: 'oneTime', plans: ['topup_5', 'topup_15', 'topup_30'] },
  { key: 'monthly', plans: ['monthly'] },
  { key: 'quarterly', plans: ['quarterly'] },
  { key: 'yearly', plans: ['yearly'] },
]

function formatUsd(value: number): string {
  return Number.isInteger(value) ? `$${value.toFixed(0)}` : `$${value.toFixed(1)}`
}

function planCycleKey(plan: PlanSlug): 'month' | 'quarter' | 'year' | null {
  if (plan === 'monthly') return 'month'
  if (plan === 'quarterly') return 'quarter'
  if (plan === 'yearly') return 'year'
  return null
}

function planLabelKey(plan: PlanSlug): 'monthly' | 'quarterly' | 'yearly' | null {
  if (plan === 'monthly' || plan === 'quarterly' || plan === 'yearly') return plan
  return null
}

export function PricingPage() {
  const t = useTranslations('pricing')
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [packages, setPackages] = useState<DbPackage[]>([])

  const successParam = searchParams.get('success')
  const typeParam = searchParams.get('type')
  const canceledParam = searchParams.get('canceled')

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('packages')
      .select('id,name,type,price_usd,credits,first_sub_bonus,stripe_price_id,is_popular,sort_order')
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setPackages(data as DbPackage[])
      })
  }, [])

  const packageMap = useMemo(() => {
    const entries = packages
      .filter((pkg): pkg is DbPackage & { name: PlanSlug } => PLAN_ORDER.includes(pkg.name as PlanSlug))
      .map((pkg) => [pkg.name, pkg] as const)
    return new Map<PlanSlug, DbPackage>(entries)
  }, [packages])

  async function handleChoosePlan(pkg: DbPackage) {
    if (!pkg.stripe_price_id) return

    setCheckoutError(null)
    setLoading(pkg.id)

    try {
      const returnTo = `/${locale}/pricing`

      if (pkg.type === 'subscription') {
        const { url } = await createCreditCheckout(pkg.id, returnTo)
        window.location.href = url
        return
      }

      const { url } = await createOnetimeCheckout(pkg.id, returnTo)
      window.location.href = url
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : t('paymentSetupHint'))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {successParam && (
        <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {typeParam === 'onetime' ? t('successOnetime') : t('success')}
        </div>
      )}
      {canceledParam && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {t('canceled')}
        </div>
      )}
      {checkoutError && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {checkoutError}
        </div>
      )}

      <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top,#f8efe5,transparent_36%),linear-gradient(180deg,#ffffff_0%,#faf8f4_100%)] p-6 shadow-sm sm:p-10">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            {t('title')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            {t('subtitle')}
          </p>
        </div>

        <div className="mt-10 space-y-8">
          {SECTION_ORDER.map((section) => (
            <section key={section.key} className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    {section.key === 'oneTime' ? 'TOP-UP' : 'SUBSCRIPTION'}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">
                    {t(`groups.${section.key}`)}
                  </h2>
                </div>
              </div>

              <div className={`grid gap-5 ${section.key === 'oneTime' ? 'md:grid-cols-3' : 'md:grid-cols-1'}`}>
                {section.plans.map((planName) => {
                  const pkg = packageMap.get(planName)
                  if (!pkg) return null

                  const cycleKey = planCycleKey(planName)
                  const labelKey = planLabelKey(planName)
                  const isSubscription = pkg.type === 'subscription'
                  const isFeatured = planName === 'yearly'
                  const isDisabled = !pkg.stripe_price_id || loading !== null

                  return (
                    <article
                      key={pkg.id}
                      className={`relative overflow-hidden rounded-[28px] border p-6 ${
                        isFeatured
                          ? 'border-amber-300 bg-[linear-gradient(160deg,#fff7e9_0%,#fffdf8_55%,#ffffff_100%)] shadow-[0_18px_40px_rgba(180,120,28,0.14)]'
                          : 'border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbf9_100%)]'
                      }`}
                    >
                      {labelKey && (
                        <div className="mb-5 flex items-start justify-between gap-3">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                            isFeatured ? 'bg-amber-900 text-amber-50' : 'bg-slate-900 text-white'
                          }`}>
                            {t(`labels.${labelKey}`)}
                          </span>
                          {isFeatured && (
                            <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-700">
                              {t('stickers.saveMore')}
                            </span>
                          )}
                        </div>
                      )}

                      {!labelKey && <div className="mb-5 h-6" />}

                      <div className="space-y-3">
                        <div className="flex items-end gap-2">
                          <span className="text-4xl font-semibold tracking-tight text-slate-950">
                            {formatUsd(pkg.price_usd)}
                          </span>
                          {cycleKey && (
                            <span className="pb-1 text-sm font-medium text-slate-500">
                              {t(`cycles.${cycleKey}`)}
                            </span>
                          )}
                        </div>

                        <p className="text-lg font-semibold text-slate-900">
                          {t('creditsValue', {
                            count: pkg.credits.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US'),
                          })}
                        </p>
                      </div>

                      <div className="mt-6 space-y-3 text-sm text-slate-600">
                        <p>{isSubscription ? t('subscriptionRule') : t('singlePurchase')}</p>
                        {isSubscription && <p>{t('cancelAnytime')}</p>}
                      </div>

                      <div className="mt-8 space-y-3">
                        <button
                          onClick={() => handleChoosePlan(pkg)}
                          disabled={isDisabled}
                          className={`w-full rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                            isFeatured
                              ? 'bg-slate-950 text-white hover:bg-slate-800'
                              : 'bg-slate-100 text-slate-950 hover:bg-slate-200'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {loading === pkg.id
                            ? '...'
                            : isSubscription
                              ? t('buttons.subscribe')
                              : t('buttons.topup')}
                        </button>

                        {!pkg.stripe_price_id && (
                          <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            <p className="font-semibold">{t('paymentSetupPending')}</p>
                            <p className="mt-1">{t('paymentSetupHint')}</p>
                          </div>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">{t('faq.title')}</h2>
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-950">{t('faq.autoRenewQ')}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t('faq.autoRenewA')}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-950">{t('faq.cancelQ')}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t('faq.cancelA')}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-950">{t('faq.expiryQ')}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t('faq.expiryA')}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-slate-950 p-6 text-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">CREDITS</p>
            <h2 className="mt-2 text-xl font-semibold">{t('usage.title')}</h2>
            <div className="mt-6 space-y-3">
              <div className="rounded-2xl bg-white/10 px-4 py-4 text-sm">{t('usage.speed')}</div>
              <div className="rounded-2xl bg-white/10 px-4 py-4 text-sm">{t('usage.balanced')}</div>
              <div className="rounded-2xl bg-white/10 px-4 py-4 text-sm">{t('usage.quality')}</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
