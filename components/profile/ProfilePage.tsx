'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { createPortalSession } from '@/lib/api/edge-functions'
import { refreshCredits } from '@/lib/hooks/useCredits'

type SubscriptionStatus = 'active' | 'canceled' | 'past_due'

interface ProfileData {
  subscription_plan: string | null
  subscription_status: SubscriptionStatus | null
  current_period_end: string | null
  subscription_credits: number
  purchased_credits: number
  stripe_customer_id: string | null
  invite_code: string | null
  invited_by_user_id: string | null
  invite_bound_at: string | null
}

interface RedeemClaim {
  id: string
  code_snapshot: string
  credited_amount: number
  created_at: string
}

interface RpcResult {
  success?: boolean
  code?: string
  message?: string
  credits?: number
}

function subscriptionPlanLabel(
  plan: string | null | undefined,
  t: ReturnType<typeof useTranslations>
) {
  switch (plan) {
    case 'monthly':
      return t('planNames.monthly')
    case 'quarterly':
      return t('planNames.quarterly')
    case 'yearly':
      return t('planNames.yearly')
    default:
      return plan
  }
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

  const [inviteCount, setInviteCount] = useState(0)
  const [inviteRewardTotal, setInviteRewardTotal] = useState(0)
  const [redeemClaims, setRedeemClaims] = useState<RedeemClaim[]>([])

  const [inviteInput, setInviteInput] = useState('')
  const [bindLoading, setBindLoading] = useState(false)
  const [bindMessage, setBindMessage] = useState<string | null>(null)
  const [bindError, setBindError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [redeemInput, setRedeemInput] = useState('')
  const [redeemLoading, setRedeemLoading] = useState(false)
  const [redeemMessage, setRedeemMessage] = useState<string | null>(null)
  const [redeemError, setRedeemError] = useState<string | null>(null)

  const errorMap = useMemo(() => ((t.raw('errors') as Record<string, string>) ?? {}), [t])

  const resolveRpcError = useCallback((result: RpcResult | null | undefined) => {
    if (result?.code && errorMap[result.code]) return errorMap[result.code]
    if (result?.message) return result.message
    return errorMap.INTERNAL_ERROR ?? tCommon('error')
  }, [errorMap, tCommon])

  const fetchProfile = useCallback(async () => {
    setError(null)
    setIsLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      let uid = session?.user?.id
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser()
        uid = user?.id ?? undefined
      }
      if (!uid) {
        setIsLoading(false)
        return
      }
      setUserId(uid)

      const [{ data: profileData, error: profileError }, { data: referralData }, { data: redeemData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('subscription_plan, subscription_status, current_period_end, subscription_credits, purchased_credits, stripe_customer_id, invite_code, invited_by_user_id, invite_bound_at')
          .eq('id', uid)
          .single(),
        supabase
          .from('referral_bindings')
          .select('reward_credits')
          .eq('inviter_user_id', uid),
        supabase
          .from('redeem_code_claims')
          .select('id, code_snapshot, credited_amount, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      if (profileError) throw profileError

      setProfile(profileData as ProfileData)
      const rows = (referralData ?? []) as Array<{ reward_credits: number }>
      setInviteCount(rows.length)
      setInviteRewardTotal(rows.reduce((sum, row) => sum + (row.reward_credits ?? 0), 0))
      setRedeemClaims((redeemData ?? []) as RedeemClaim[])
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

  async function handleCopyInviteCode() {
    if (!profile?.invite_code) return
    try {
      await navigator.clipboard.writeText(profile.invite_code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  async function handleBindInviteCode() {
    const code = inviteInput.trim().toUpperCase()
    if (!code) {
      setBindError(errorMap.INVALID_CODE ?? tCommon('error'))
      setBindMessage(null)
      return
    }

    setBindLoading(true)
    setBindMessage(null)
    setBindError(null)

    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('bind_invite_code', { p_code: code })
      if (rpcError) throw rpcError

      const result = data as RpcResult
      if (!result?.success) {
        setBindError(resolveRpcError(result))
        return
      }

      setBindMessage(t('bindSuccess'))
      setInviteInput('')
      await fetchProfile()
    } catch {
      setBindError(errorMap.INTERNAL_ERROR ?? tCommon('error'))
    } finally {
      setBindLoading(false)
    }
  }

  async function handleRedeemCode() {
    const code = redeemInput.trim().toUpperCase()
    if (!code) {
      setRedeemError(errorMap.INVALID_CODE ?? tCommon('error'))
      setRedeemMessage(null)
      return
    }

    setRedeemLoading(true)
    setRedeemError(null)
    setRedeemMessage(null)

    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('claim_redeem_code', { p_code: code })
      if (rpcError) throw rpcError

      const result = data as RpcResult
      if (!result?.success) {
        setRedeemError(resolveRpcError(result))
        return
      }

      const credits = typeof result.credits === 'number' ? result.credits : 0
      setRedeemMessage(t('redeemSuccess', { credits }))
      setRedeemInput('')
      refreshCredits()
      await fetchProfile()
    } catch {
      setRedeemError(errorMap.INTERNAL_ERROR ?? tCommon('error'))
    } finally {
      setRedeemLoading(false)
    }
  }

  const totalCredits = (profile?.subscription_credits ?? 0) + (profile?.purchased_credits ?? 0)

  const hasSubscription = profile?.subscription_plan && profile?.subscription_status

  const formattedDate = profile?.current_period_end
    ? new Date(profile.current_period_end).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
    : null

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
        <div className="space-y-4">
          <div className="rounded-2xl border p-6 space-y-4 animate-pulse">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-6 w-48 bg-muted rounded" />
            <div className="h-4 w-40 bg-muted rounded" />
          </div>
          <div className="rounded-2xl border p-6 space-y-3 animate-pulse">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-8 w-20 bg-muted rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
        <div className="rounded-2xl border p-6 text-center space-y-3">
          <p className="text-muted-foreground">{error}</p>
          <button
            onClick={fetchProfile}
            className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors"
          >
            {tCommon('retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      <div className="space-y-4">
        <div className="rounded-2xl border p-6 space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{t('plan')}</p>
            {hasSubscription ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-lg">
                    {subscriptionPlanLabel(profile!.subscription_plan, t)}
                  </p>
                  <StatusBadge status={profile!.subscription_status!} t={t} />
                </div>

                {formattedDate && (
                  <p className="text-sm text-muted-foreground">
                    {profile!.subscription_status === 'canceled'
                      ? t('canceledInfo', { date: formattedDate })
                      : t('renewsOn', { date: formattedDate })}
                  </p>
                )}

                {profile!.stripe_customer_id && (
                  <div className="pt-1">
                    <button
                      onClick={handleManageSubscription}
                      disabled={portalLoading}
                      className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      {portalLoading ? t('managingSubscription') : t('manageSubscription')}
                    </button>
                    {portalError && (
                      <p className="text-sm text-red-500 mt-2">{portalError}</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="font-medium">{t('noSubscription')}</p>
                <p className="text-sm text-muted-foreground">{t('noSubscriptionDesc')}</p>
                <Link
                  href={`/${locale}/pricing`}
                  className="inline-block rounded-xl bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
                >
                  {t('viewPlans')}
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border p-6 space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{t('totalCredits')}</p>
            <p className="text-3xl font-bold">{totalCredits.toLocaleString()}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{t('subscriptionCredits')}</p>
              <p className="font-medium">{(profile?.subscription_credits ?? 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('purchasedCredits')}</p>
              <p className="font-medium">{(profile?.purchased_credits ?? 0).toLocaleString()}</p>
            </div>
          </div>

          <Link
            href={`/${locale}/pricing`}
            className="inline-block rounded-xl border px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors"
          >
            {t('buyMoreCredits')}
          </Link>
        </div>

        <div className="rounded-2xl border p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t('myInviteCode')}</p>
            <button
              onClick={handleCopyInviteCode}
              disabled={!profile?.invite_code}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {copied ? t('copied') : t('copyInviteCode')}
            </button>
          </div>
          <p className="rounded-xl bg-secondary px-4 py-3 font-mono text-base tracking-[0.2em]">
            {profile?.invite_code ?? '--------'}
          </p>
        </div>

        <div className="rounded-2xl border p-6 space-y-4">
          <p className="text-sm text-muted-foreground">{t('inviteSummary')}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{t('inviteCount')}</p>
              <p className="text-2xl font-bold">{inviteCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('inviteRewardTotal')}</p>
              <p className="text-2xl font-bold">{inviteRewardTotal.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border p-6 space-y-4">
          <p className="text-sm text-muted-foreground">{t('bindInviteCode')}</p>
          {profile?.invited_by_user_id ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('alreadyBound')}</p>
              <p className="text-xs text-muted-foreground">{t('boundBy', { id: profile.invited_by_user_id })}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value.toUpperCase())}
                  placeholder={t('inviteCodePlaceholder')}
                  className="h-11 w-full rounded-xl border px-3 text-sm uppercase tracking-[0.08em]"
                  maxLength={16}
                />
                <button
                  onClick={handleBindInviteCode}
                  disabled={bindLoading}
                  className="h-11 rounded-xl border px-4 text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {bindLoading ? '...' : t('bindNow')}
                </button>
              </div>
              {bindMessage && <p className="text-sm text-green-600">{bindMessage}</p>}
              {bindError && <p className="text-sm text-red-500">{bindError}</p>}
            </div>
          )}
        </div>

        <div className="rounded-2xl border p-6 space-y-4">
          <p className="text-sm text-muted-foreground">{t('redeemCode')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={redeemInput}
              onChange={(e) => setRedeemInput(e.target.value.toUpperCase())}
              placeholder={t('redeemCodePlaceholder')}
              className="h-11 w-full rounded-xl border px-3 text-sm uppercase tracking-[0.08em]"
              maxLength={32}
            />
            <button
              onClick={handleRedeemCode}
              disabled={redeemLoading || !userId}
              className="h-11 rounded-xl border px-4 text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {redeemLoading ? '...' : t('redeemNow')}
            </button>
          </div>
          {redeemMessage && <p className="text-sm text-green-600">{redeemMessage}</p>}
          {redeemError && <p className="text-sm text-red-500">{redeemError}</p>}

          <div className="pt-2">
            <p className="mb-2 text-sm text-muted-foreground">{t('redeemHistory')}</p>
            {redeemClaims.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('redeemHistoryEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {redeemClaims.map((claim) => {
                  const date = new Date(claim.created_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
                  return (
                    <div key={claim.id} className="rounded-xl border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm tracking-[0.08em]">{claim.code_snapshot}</span>
                        <span className="text-sm font-medium text-green-600">{t('claimedCredits', { credits: claim.credited_amount })}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{t('claimedAt', { date })}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({
  status,
  t,
}: {
  status: SubscriptionStatus
  t: ReturnType<typeof useTranslations<'profile'>>
}) {
  const config: Record<SubscriptionStatus, { label: string; className: string }> = {
    active: {
      label: t('active'),
      className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    },
    canceled: {
      label: t('canceled'),
      className: 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400',
    },
    past_due: {
      label: t('pastDue'),
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    },
  }
  const { label, className } = config[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
