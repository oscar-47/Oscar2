'use client'

import { useEffect, useRef } from 'react'

/**
 * Persist form state to sessionStorage across page navigations.
 * Restores on mount, saves after every render (once initial restore is done).
 *
 * @param key   Unique storage key (prefixed with 'shopix:')
 * @param getState  Returns the serializable state snapshot to persist
 * @param restore   Called on mount with the previously saved state (if any)
 */
export function useSessionPersistence(
  key: string,
  getState: () => Record<string, unknown>,
  restore: (saved: Record<string, unknown>) => void
) {
  const fullKey = `shopix:${key}`
  const restoredRef = useRef(false)
  const getStateRef = useRef(getState)
  getStateRef.current = getState

  // Restore on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(fullKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') restore(parsed)
      }
    } catch {}
    restoredRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  // Save after every render (skips until restore completes)
  useEffect(() => {
    if (!restoredRef.current) return
    try {
      sessionStorage.setItem(fullKey, JSON.stringify(getStateRef.current()))
    } catch {}
  })
}
