'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { totalCredits, type Profile } from '@/types'

/** Dispatch a global event to make all useCredits instances refetch */
export function refreshCredits() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('credits:refetch'))
  }
}

interface UseCreditsResult {
  /** null while loading or unauthenticated */
  total: number | null
  subscriptionCredits: number
  purchasedCredits: number
  /** Backward-compatible alias for active subscription */
  isPremium: boolean
  /** Whether the user has any paid history or an active subscription */
  isPaidMember: boolean
  hasActiveSubscription: boolean
  /** Current subscription plan name (monthly/quarterly/yearly) or null */
  subscriptionPlan: string | null
  isLoading: boolean
  /** Manually refetch credits from DB */
  refetch: () => void
}

/**
 * @param userId - Pass if already known (e.g. from server props).
 *                 If omitted, resolves the current session user internally.
 */
export function useCredits(userId?: string): UseCreditsResult {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [hasPaidHistory, setHasPaidHistory] = useState(false)
  const [resolvedId, setResolvedId] = useState<string | null>(userId ?? null)
  const [isLoading, setIsLoading] = useState(true)
  const resolvedIdRef = useRef(resolvedId)
  resolvedIdRef.current = resolvedId

  const refetch = useCallback(async () => {
    const uid = resolvedIdRef.current
    if (!uid) return
    const supabase = createClient()
    const [{ data: profileData }, { data: paidTransactions }] = await Promise.all([
      supabase
        .from('profiles')
        .select('subscription_credits, purchased_credits, subscription_plan, subscription_status')
        .eq('id', uid)
        .single(),
      supabase
        .from('transactions')
        .select('id')
        .eq('user_id', uid)
        .eq('status', 'completed')
        .gt('amount', 0)
        .limit(1),
    ])
    if (profileData) setProfile(profileData as Profile)
    setHasPaidHistory((paidTransactions?.length ?? 0) > 0)
  }, [])

  // Listen to global refetch events so all useCredits instances stay in sync
  useEffect(() => {
    const handler = () => { refetch() }
    window.addEventListener('credits:refetch', handler)
    return () => window.removeEventListener('credits:refetch', handler)
  }, [refetch])

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      try {
        let uid = resolvedId
        if (!uid) {
          const { data: sessionData } = await supabase.auth.getSession()
          uid = sessionData.session?.user?.id ?? null
        }
        if (!uid) {
          // Fallback only when session cache is empty.
          const { data: { user } } = await supabase.auth.getUser()
          uid = user?.id ?? null
        }
        if (uid && !cancelled) setResolvedId(uid)
        if (!uid) {
          if (!cancelled) setIsLoading(false)
          return
        }

        const [{ data: profileData }, { data: paidTransactions }] = await Promise.all([
          supabase
            .from('profiles')
            .select('subscription_credits, purchased_credits, subscription_plan, subscription_status')
            .eq('id', uid)
            .single(),
          supabase
            .from('transactions')
            .select('id')
            .eq('user_id', uid)
            .eq('status', 'completed')
            .gt('amount', 0)
            .limit(1),
        ])

        if (!cancelled) {
          if (profileData) setProfile(profileData as Profile)
          setHasPaidHistory((paidTransactions?.length ?? 0) > 0)
          setIsLoading(false)
        }

        // Subscribe to real-time credit updates
        channel = supabase
          .channel(`profile:${uid}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'profiles',
              filter: `id=eq.${uid}`,
            },
            (payload) => {
              if (!cancelled)
                setProfile((prev) => ({ ...prev, ...payload.new } as Profile))
            }
          )
          .subscribe()
      } catch {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    init()
    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const hasActiveSubscription = !!(profile?.subscription_plan && profile?.subscription_status === 'active')
  const isPaidMember = hasActiveSubscription || hasPaidHistory
  const isPremium = hasActiveSubscription

  return {
    total: profile ? totalCredits(profile) : null,
    subscriptionCredits: profile?.subscription_credits ?? 0,
    purchasedCredits: profile?.purchased_credits ?? 0,
    isPremium,
    isPaidMember,
    hasActiveSubscription,
    subscriptionPlan: profile?.subscription_plan ?? null,
    isLoading,
    refetch,
  }
}
