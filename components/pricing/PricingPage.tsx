'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { createCreditCheckout, createOnetimeCheckout } from '@/lib/api/edge-functions'

type Tab = 'subscription' | 'one_time'

const PLANS = [
  { id: 'starter', credits: 250, price: 5, firstSubBonus: 25, modelImages: 83, proModelImages: 50 },
  { id: 'professional', credits: 1200, price: 20, firstSubBonus: 120, modelImages: 400, proModelImages: 240, popular: true },
  { id: 'enterprise', credits: 7000, price: 100, firstSubBonus: 700, modelImages: 2333, proModelImages: 1400 },
]

// Package IDs will come from Codex's packages table — using placeholders until M4
const PACKAGE_IDS: Record<string, { subscription: string; one_time: string }> = {
  starter: { subscription: 'pkg_sub_starter', one_time: 'pkg_ot_250' },
  professional: { subscription: 'pkg_sub_professional', one_time: 'pkg_ot_1200' },
  enterprise: { subscription: 'pkg_sub_enterprise', one_time: 'pkg_ot_7000' },
}

export function PricingPage() {
  const t = useTranslations('pricing')
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>('subscription')
  const [loading, setLoading] = useState<string | null>(null)

  const successParam = searchParams.get('success')
  const typeParam = searchParams.get('type')
  const canceledParam = searchParams.get('canceled')

  async function handleChoosePlan(planId: string) {
    setLoading(planId)
    try {
      const pkgIds = PACKAGE_IDS[planId]
      const returnTo = `/${locale}/pricing`

      if (tab === 'subscription') {
        const { url } = await createCreditCheckout(pkgIds.subscription, returnTo)
        window.location.href = url
      } else {
        const { url } = await createOnetimeCheckout(pkgIds.one_time, returnTo)
        window.location.href = url
      }
    } catch (err) {
      console.error('Checkout failed:', err)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl py-8">
      {/* Success / cancel banners */}
      {successParam && (
        <div className="mb-6 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {typeParam === 'onetime' ? t('successOnetime') : t('success')}
        </div>
      )}
      {canceledParam && (
        <div className="mb-6 rounded-lg bg-secondary px-4 py-3 text-sm text-muted-foreground">
          {t('canceled')}
        </div>
      )}

      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-3">{t('title')}</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">{t('subtitle')}</p>
      </div>

      {/* Tab switcher */}
      <div className="flex justify-center mb-10">
        <div className="inline-flex rounded-xl border bg-card p-1 gap-1">
          <button
            onClick={() => setTab('subscription')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'subscription' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>👑</span> {t('subscriptionPlans')}
          </button>
          <button
            onClick={() => setTab('one_time')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'one_time' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>⚡</span> {t('buyCredits')}
          </button>
        </div>
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`relative rounded-2xl border p-6 ${
              plan.popular ? 'border-foreground shadow-lg' : ''
            }`}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-4 py-0.5 text-xs font-bold text-background">
                {t('mostPopular')}
              </div>
            )}

            {/* Plan header */}
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xl">{plan.popular ? '✦' : '🪙'}</span>
              <h3 className="font-semibold text-lg">
                {tab === 'subscription'
                  ? t(`plans.${plan.id}` as Parameters<typeof t>[0])
                  : `${plan.credits.toLocaleString()} Credits`}
              </h3>
            </div>

            {/* Price */}
            <div className="mb-4">
              <span className="text-4xl font-bold">${plan.price}</span>
              {tab === 'subscription' && (
                <span className="text-muted-foreground text-sm">{t('perMonth')}</span>
              )}
            </div>

            {/* Credits & bonus */}
            <ul className="space-y-2 mb-6 text-sm">
              <li className="flex items-center gap-2">
                <span className="text-foreground">✓</span>
                <span>{plan.credits.toLocaleString()} Credits</span>
              </li>
              {tab === 'subscription' && plan.firstSubBonus > 0 && (
                <li className="flex items-center gap-2 text-amber-600 font-medium">
                  <span>✦</span>
                  <span>{t('firstSubBonus', { bonus: plan.firstSubBonus })}</span>
                </li>
              )}
              <li className="flex items-center gap-2 text-muted-foreground">
                <span>✓</span>
                <span>{t('modelImages', { count: plan.modelImages })}</span>
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <span>✓</span>
                <span>{t('proModelImages', { count: plan.proModelImages })}</span>
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <span>✓</span>
                <span>{t('neverExpires')}</span>
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <span className="opacity-50">✓</span>
                <span className="opacity-50">{t('oneTimePurchase')}</span>
              </li>
            </ul>

            <button
              onClick={() => handleChoosePlan(plan.id)}
              disabled={!!loading}
              className={`w-full rounded-xl py-2.5 text-sm font-medium transition-colors ${
                plan.popular
                  ? 'bg-foreground text-background hover:bg-foreground/90'
                  : 'border hover:bg-secondary'
              } disabled:opacity-50`}
            >
              {loading === plan.id ? '...' : t('choosePlan')}
            </button>
          </div>
        ))}
      </div>

      {/* Included in every plan */}
      <div className="mt-16 text-center">
        <h2 className="text-xl font-bold mb-8">{t('included.title')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto text-left">
          <div className="flex gap-3">
            <span className="text-foreground mt-0.5">✓</span>
            <div>
              <p className="font-medium">{t('included.aiVisualStrategy')}</p>
              <p className="text-sm text-muted-foreground">{t('included.aiVisualStrategyDesc')}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-foreground mt-0.5">✓</span>
            <div>
              <p className="font-medium">{t('included.globalMarketplace')}</p>
              <p className="text-sm text-muted-foreground">{t('included.globalMarketplaceDesc')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
