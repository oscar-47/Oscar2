'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createCreditCheckout, createOnetimeCheckout } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'

type Tab = 'subscription' | 'one_time'

interface DbPackage {
  id: string
  name: string
  type: 'subscription' | 'one_time'
  price_usd: number
  credits: number
  first_sub_bonus: number
  is_popular: boolean
  sort_order: number
}

// Display metadata (model images count = credits / cost-per-image)
const PLAN_META: Record<number, { modelImages: number; proModelImages: number }> = {
  250: { modelImages: 83, proModelImages: 50 },
  1200: { modelImages: 400, proModelImages: 240 },
  7000: { modelImages: 2333, proModelImages: 1400 },
}

// Map subscription name to plan key for i18n
function planKey(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('starter')) return 'starter'
  if (n.includes('professional')) return 'professional'
  if (n.includes('enterprise')) return 'enterprise'
  return n
}

export function PricingPage() {
  const t = useTranslations('pricing')
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>('one_time')
  const [loading, setLoading] = useState<string | null>(null)
  const [packages, setPackages] = useState<DbPackage[]>([])

  const successParam = searchParams.get('success')
  const typeParam = searchParams.get('type')
  const canceledParam = searchParams.get('canceled')

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('packages')
      .select('id,name,type,price_usd,credits,first_sub_bonus,is_popular,sort_order')
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setPackages(data as DbPackage[])
      })
  }, [])

  const subscriptionPlans = packages.filter((p) => p.type === 'subscription')
  const onetimePlans = packages.filter((p) => p.type === 'one_time')
  const visiblePlans = tab === 'subscription' ? subscriptionPlans : onetimePlans

  async function handleChoosePlan(pkg: DbPackage) {
    setLoading(pkg.id)
    try {
      const returnTo = `/${locale}/pricing`

      if (tab === 'subscription') {
        const { url } = await createCreditCheckout(pkg.id, returnTo)
        window.location.href = url
      } else {
        const { url } = await createOnetimeCheckout(pkg.id, returnTo)
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
            {t('subscriptionPlans')}
          </button>
          <button
            onClick={() => setTab('one_time')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'one_time' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('buyCredits')}
          </button>
        </div>
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {visiblePlans.map((pkg) => {
          const meta = PLAN_META[pkg.credits] ?? { modelImages: Math.round(pkg.credits / 3), proModelImages: Math.round(pkg.credits / 5) }
          const key = planKey(pkg.name)

          return (
            <div
              key={pkg.id}
              className={`relative rounded-2xl border p-6 ${
                pkg.is_popular ? 'border-foreground shadow-lg' : ''
              }`}
            >
              {pkg.is_popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-4 py-0.5 text-xs font-bold text-background">
                  {t('mostPopular')}
                </div>
              )}

              {/* Plan header */}
              <div className="mb-4 flex items-center gap-2">
                <h3 className="font-semibold text-lg">
                  {tab === 'subscription'
                    ? t(`plans.${key}` as Parameters<typeof t>[0])
                    : `${pkg.credits.toLocaleString()} Credits`}
                </h3>
              </div>

              {/* Price */}
              <div className="mb-4">
                <span className="text-4xl font-bold">${pkg.price_usd}</span>
                {tab === 'subscription' && (
                  <span className="text-muted-foreground text-sm">{t('perMonth')}</span>
                )}
              </div>

              {/* Credits & bonus */}
              <ul className="space-y-2 mb-6 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-foreground">✓</span>
                  <span>{pkg.credits.toLocaleString()} Credits</span>
                </li>
                {tab === 'subscription' && pkg.first_sub_bonus > 0 && (
                  <li className="flex items-center gap-2 text-amber-600 font-medium">
                    <span>✦</span>
                    <span>{t('firstSubBonus', { bonus: pkg.first_sub_bonus })}</span>
                  </li>
                )}
                <li className="flex items-center gap-2 text-muted-foreground">
                  <span>✓</span>
                  <span>{t('modelImages', { count: meta.modelImages })}</span>
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <span>✓</span>
                  <span>{t('proModelImages', { count: meta.proModelImages })}</span>
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <span>✓</span>
                  <span>{t('neverExpires')}</span>
                </li>
              </ul>

              <button
                onClick={() => handleChoosePlan(pkg)}
                disabled={!!loading}
                className={`w-full rounded-xl py-2.5 text-sm font-medium transition-colors ${
                  pkg.is_popular
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'border hover:bg-secondary'
                } disabled:opacity-50`}
              >
                {loading === pkg.id ? '...' : t('choosePlan')}
              </button>
            </div>
          )
        })}
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
