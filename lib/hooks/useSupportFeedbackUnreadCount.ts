'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function refreshSupportFeedbackUnreadCount() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('support-feedback:refetch'))
  }
}

export function useSupportFeedbackUnreadCount(userId?: string) {
  const [count, setCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const requestIdRef = useRef(0)

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const response = await fetch('/api/support-feedback/unread-count', { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json() as { count?: number }
      if (requestId === requestIdRef.current) {
        setCount(typeof payload.count === 'number' ? payload.count : 0)
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    setCount(0)
    setIsLoading(true)
    requestIdRef.current += 1
  }, [userId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  useEffect(() => {
    const handleRefresh = () => {
      void refetch()
    }

    const handleFocus = () => {
      void refetch()
    }

    window.addEventListener('support-feedback:refetch', handleRefresh)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('support-feedback:refetch', handleRefresh)
      window.removeEventListener('focus', handleFocus)
    }
  }, [refetch])

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`support-feedback:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_feedback',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refetch()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refetch, userId])

  return {
    count,
    isLoading,
    refetch,
  }
}
