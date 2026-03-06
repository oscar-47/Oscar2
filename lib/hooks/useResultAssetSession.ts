'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ResultAsset } from '@/types'
import {
  clearResultAssets,
  mergeResultAssets,
  readResultAssets,
  writeResultAssets,
} from '@/lib/utils/result-assets'

export function useResultAssetSession(key: string) {
  const [assets, setAssetsState] = useState<ResultAsset[]>([])
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    setAssetsState(readResultAssets(key))
    setRestored(true)
  }, [key])

  useEffect(() => {
    if (!restored) return
    writeResultAssets(key, assets)
  }, [assets, key, restored])

  const setAssets = useCallback<Dispatch<SetStateAction<ResultAsset[]>>>((value) => {
    setAssetsState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      return mergeResultAssets([], next)
    })
  }, [])

  const appendAssets = useCallback((incoming: ResultAsset[]) => {
    setAssetsState((prev) => mergeResultAssets(prev, incoming))
  }, [])

  const clearAssets = useCallback(() => {
    clearResultAssets(key)
    setAssetsState([])
  }, [key])

  return {
    assets,
    setAssets,
    appendAssets,
    clearAssets,
    restored,
    storageKey: key,
  }
}
