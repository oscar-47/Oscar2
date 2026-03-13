'use client'

import { useEffect, useState } from 'react'
import { isAdminUser } from '@/types'
import {
  clearRegisteredAdminImageModels,
  registerAdminImageModels,
  type AdminImageModelConfig,
} from '@/lib/admin-models'

let cachedAdminModels: AdminImageModelConfig[] | null = null
let pendingAdminModels: Promise<AdminImageModelConfig[]> | null = null

async function loadAdminImageModels(): Promise<AdminImageModelConfig[]> {
  if (cachedAdminModels) return cachedAdminModels
  if (!pendingAdminModels) {
    pendingAdminModels = fetch('/api/admin/model-configs', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`REQUEST_FAILED_${response.status}`)
        }
        const payload = (await response.json()) as { configs?: AdminImageModelConfig[] }
        const configs = Array.isArray(payload.configs) ? payload.configs : []
        cachedAdminModels = registerAdminImageModels(configs)
        return cachedAdminModels
      })
      .finally(() => {
        pendingAdminModels = null
      })
  }
  return pendingAdminModels
}

export function useAdminImageModels(email: string | null | undefined) {
  const isAdmin = isAdminUser(email)
  const [configs, setConfigs] = useState<AdminImageModelConfig[]>(isAdmin ? cachedAdminModels ?? [] : [])
  const [isLoading, setIsLoading] = useState(isAdmin && cachedAdminModels === null)

  useEffect(() => {
    let cancelled = false

    if (!isAdmin) {
      clearRegisteredAdminImageModels()
      cachedAdminModels = null
      setConfigs([])
      setIsLoading(false)
      return
    }

    setIsLoading(cachedAdminModels === null)
    loadAdminImageModels()
      .then((nextConfigs) => {
        if (cancelled) return
        setConfigs(nextConfigs)
      })
      .catch(() => {
        if (cancelled) return
        clearRegisteredAdminImageModels()
        cachedAdminModels = []
        setConfigs([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isAdmin])

  return { configs, isLoading }
}
