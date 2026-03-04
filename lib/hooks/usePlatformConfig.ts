'use client'

import { useState, useEffect } from 'react'
import { getPublicConfig } from '@/lib/api/edge-functions'
import { PLATFORM_RULES, type PlatformRule, type EcommercePlatform } from '@/types'

interface PlatformConfig {
  version: string
  rules: readonly PlatformRule[]
  getMinImages: (platform: EcommercePlatform) => number
}

const FALLBACK_VERSION = 'hardcoded-v1'

/**
 * Load platform rules from backend config with fallback to hardcoded.
 * Returns versioned platform rules for display and enforcement.
 */
export function usePlatformConfig(): PlatformConfig {
  const [rules, setRules] = useState<readonly PlatformRule[]>(PLATFORM_RULES)
  const [version, setVersion] = useState(FALLBACK_VERSION)

  useEffect(() => {
    let cancelled = false
    getPublicConfig()
      .then((config) => {
        if (cancelled) return
        if (config.platform_rules?.rules && config.platform_rules.rules.length > 0) {
          setRules(config.platform_rules.rules)
          setVersion(config.platform_rules.version || 'remote-v1')
        }
      })
      .catch(() => {
        // Keep fallback — no-op
      })
    return () => { cancelled = true }
  }, [])

  const getMinImages = (platform: EcommercePlatform): number => {
    return rules.find(r => r.value === platform)?.minImages ?? 1
  }

  return { version, rules, getMinImages }
}
