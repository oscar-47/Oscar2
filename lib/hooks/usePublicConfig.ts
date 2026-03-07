'use client'

import { useEffect, useState } from 'react'
import { getPublicConfig } from '@/lib/api/edge-functions'
import type { PublicConfig } from '@/types'

let cachedConfig: PublicConfig | null = null
let pendingConfig: Promise<PublicConfig> | null = null

function loadPublicConfig(): Promise<PublicConfig> {
  if (cachedConfig) return Promise.resolve(cachedConfig)
  if (!pendingConfig) {
    pendingConfig = getPublicConfig()
      .then((config) => {
        cachedConfig = config
        return config
      })
      .finally(() => {
        pendingConfig = null
      })
  }
  return pendingConfig
}

export function usePublicConfig() {
  const [config, setConfig] = useState<PublicConfig | null>(cachedConfig)
  const [isLoading, setIsLoading] = useState(cachedConfig === null)

  useEffect(() => {
    let cancelled = false
    if (cachedConfig) {
      setConfig(cachedConfig)
      setIsLoading(false)
      return
    }
    loadPublicConfig()
      .then((nextConfig) => {
        if (cancelled) return
        setConfig(nextConfig)
      })
      .catch(() => {
        if (cancelled) return
        setConfig(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { config, isLoading }
}
