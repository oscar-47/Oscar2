'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { CreatorProgramPanel } from '@/components/creator/CreatorProgramPanel'
import { MembershipCard } from '@/components/profile/MembershipCard'
import { SupportFeedbackPanel } from '@/components/profile/SupportFeedbackPanel'
import { createClient } from '@/lib/supabase/client'
import { createPortalSession } from '@/lib/api/edge-functions'

interface ProfileData {
  email: string | null
  phone: string | null
  full_name: string | null
  subscription_plan: string | null
  subscription_status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'unpaid' | null
  current_period_end: string | null
  subscription_credits: number
  purchased_credits: number
  stripe_customer_id: string | null
}

interface PaidTransaction {
  plan: string | null
  amount: number
  credits: number
  created_at: string
}

export function ProfilePage() {
  const t = useTranslations('profile')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)

  const [hasPaidHistory, setHasPaidHistory] = useState(false)
  const [latestPaidAt, setLatestPaidAt] = useState<string | null>(null)
  const [latestTopupPlan, setLatestTopupPlan] = useState<string | null>(null)
  const [topupPurchaseCount, setTopupPurchaseCount] = useState(0)

  const fetchProfile = useCallback(async () => {
    setError(null)
    setIsLoading(true)
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      let uid = session?.user?.id
      if (!uid) {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        uid = user?.id ?? undefined
      }
      if (!uid) {
        setIsLoading(false)
        return
      }
      setUserId(uid)

      const [
        { data: profileData, error: profileError },
        { data: paidTransactions },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('email, phone, full_name, subscription_plan, subscription_status, current_period_end, subscription_credits, purchased_credits, stripe_customer_id')
          .eq('id', uid)
          .single(),
        supabase
          .from('transactions')
          .select('plan, amount, credits, created_at')
          .eq('user_id', uid)
          .eq('status', 'completed')
          .gt('amount', 0)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      if (profileError) throw profileError

      setProfile(profileData as ProfileData)

      const paidRows = (paidTransactions ?? []) as PaidTransaction[]
      const topupRows = paidRows.filter((row) => row.plan?.startsWith('topup_'))
      setHasPaidHistory(paidRows.length > 0)
      setLatestPaidAt(paidRows[0]?.created_at ?? null)
      setLatestTopupPlan(topupRows[0]?.plan ?? null)
      setTopupPurchaseCount(topupRows.length)
    } catch {
      setError(tCommon('error'))
    } finally {
      setIsLoading(false)
    }
  }, [tCommon])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  async function handleManageSubscription() {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const { url } = await createPortalSession(`/${locale}/profile`)
      window.location.href = url
    } catch {
      setPortalError(t('portalError'))
    } finally {
      setPortalLoading(false)
    }
  }

  const hasSubscription = Boolean(profile?.subscription_plan)
  const secondaryButtonClass = 'inline-flex items-center justify-center rounded-full border border-stone-300 bg-white/85 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-stone-100 disabled:opacity-50'
  const primaryButtonClass = 'inline-flex items-center justify-center rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50'

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
        <div className="w-full max-w-md animate-pulse rounded-2xl border p-4">
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="mt-3 h-6 w-36 rounded bg-muted" />
          <div className="mt-3 flex gap-2">
            <div className="h-10 flex-1 rounded-lg bg-muted" />
            <div className="h-10 flex-1 rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
        <div className="rounded-[1.75rem] border p-6 text-center space-y-3">
          <p className="text-muted-foreground">{error}</p>
          <button
            onClick={fetchProfile}
            className="rounded-full border px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors"
          >
            {tCommon('retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="font-[var(--font-display)] text-[2.2rem] font-extrabold tracking-[-0.04em]">{t('title')}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t('membershipCard.subtitle')}</p>
      </div>

      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="w-full sm:max-w-md">
            <MembershipCard
              profile={profile}
              hasPaidHistory={hasPaidHistory}
              latestPaidAt={latestPaidAt}
              latestTopupPlan={latestTopupPlan}
              topupPurchaseCount={topupPurchaseCount}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {profile?.stripe_customer_id ? (
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className={secondaryButtonClass}
              >
                {portalLoading ? t('managingSubscription') : t('manageSubscription')}
              </button>
            ) : null}

            <Link href={`/${locale}/pricing`} className={hasSubscription ? secondaryButtonClass : primaryButtonClass}>
              {hasSubscription ? t('buyMoreCredits') : t('viewPlans')}
            </Link>

            {portalError ? <p className="text-sm text-red-500">{portalError}</p> : null}
          </div>
        </div>

        {userId ? <CreatorProgramPanel userId={userId} /> : null}
        {userId ? <SupportFeedbackPanel userId={userId} /> : null}
      </div>
    </div>
  )
}

