'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ResultAsset } from '@/types'
import {
  clearResultAssets,
  mergeResultAssets,
  readResultAssetSession,
  splitResultAssetsByActiveBatch,
  subscribeToResultAssetChanges,
  writeResultAssetSession,
  type ResultAssetSessionState,
} from '@/lib/utils/result-assets'

export function useResultAssetSession(key: string) {
  const [sessionState, setSessionState] = useState<ResultAssetSessionState>({ assets: [] })
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    const syncFromStorage = () => {
      setSessionState(readResultAssetSession(key))
    }

    syncFromStorage()
    setRestored(true)

    const unsubscribe = subscribeToResultAssetChanges(key, syncFromStorage)
    const handleFocus = () => syncFromStorage()
    const handleVisibilityChange = () => {
      if (!document.hidden) syncFromStorage()
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('pageshow', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('pageshow', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [key])

  useEffect(() => {
    if (!restored) return
    writeResultAssetSession(key, sessionState)
  }, [key, restored, sessionState])

  const setAssets = useCallback<Dispatch<SetStateAction<ResultAsset[]>>>((value) => {
    setSessionState((prev) => {
      const nextAssets = typeof value === 'function' ? value(prev.assets) : value
      return {
        ...prev,
        assets: mergeResultAssets([], nextAssets),
      }
    })
  }, [])

  const appendAssets = useCallback((
    incoming: ResultAsset[],
    options?: {
      activeBatchId?: string
      activeBatchTimestamp?: number
    },
  ) => {
    setSessionState((prev) => ({
      assets: mergeResultAssets(prev.assets, incoming),
      activeBatchId: options?.activeBatchId ?? prev.activeBatchId,
      activeBatchTimestamp: options?.activeBatchTimestamp ?? prev.activeBatchTimestamp,
    }))
  }, [])

  const clearAssets = useCallback(() => {
    clearResultAssets(key)
    setSessionState({ assets: [] })
  }, [key])

  const { activeAssets, historicalAssets, activeBatchId, activeBatchTimestamp } = splitResultAssetsByActiveBatch(
    sessionState.assets,
    sessionState.activeBatchId,
  )

  return {
    assets: sessionState.assets,
    activeAssets,
    historicalAssets,
    activeBatchId,
    activeBatchTimestamp,
    setAssets,
    appendAssets,
    clearAssets,
    restored,
    storageKey: key,
  }
}
