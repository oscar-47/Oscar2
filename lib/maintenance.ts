import { createClient } from '@supabase/supabase-js'

export const MAINTENANCE_CONFIG_KEY = 'site_maintenance_mode'
const CACHE_TTL_MS = 10_000

export interface MaintenanceConfig {
  enabled: boolean
  updatedAt: string | null
  updatedBy: string | null
}

type MaintenanceCache = {
  value: MaintenanceConfig
  expiresAt: number
}

function defaultConfig(): MaintenanceConfig {
  return {
    enabled: false,
    updatedAt: null,
    updatedBy: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false
  }
  return false
}

function normalizeConfigValue(value: unknown): MaintenanceConfig {
  if (!isRecord(value)) {
    return {
      enabled: readBoolean(value),
      updatedAt: null,
      updatedBy: null,
    }
  }

  return {
    enabled: readBoolean(value.enabled),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : null,
  }
}

function getServiceClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function getGlobalCacheHost(): typeof globalThis & { __shopixMaintenanceCache?: MaintenanceCache } {
  return globalThis as typeof globalThis & { __shopixMaintenanceCache?: MaintenanceCache }
}

export async function getMaintenanceConfig(options?: { fresh?: boolean }): Promise<MaintenanceConfig> {
  const cacheHost = getGlobalCacheHost()
  const now = Date.now()
  if (!options?.fresh && cacheHost.__shopixMaintenanceCache && cacheHost.__shopixMaintenanceCache.expiresAt > now) {
    return cacheHost.__shopixMaintenanceCache.value
  }

  const client = getServiceClient()
  if (!client) return defaultConfig()

  try {
    const { data, error } = await client
      .from('system_config')
      .select('config_value')
      .eq('config_key', MAINTENANCE_CONFIG_KEY)
      .maybeSingle()

    if (error) throw error

    const value = normalizeConfigValue(data?.config_value ?? null)
    cacheHost.__shopixMaintenanceCache = {
      value,
      expiresAt: now + CACHE_TTL_MS,
    }
    return value
  } catch {
    return defaultConfig()
  }
}

export async function setMaintenanceConfig(input: {
  enabled: boolean
  updatedBy: string | null
}): Promise<MaintenanceConfig> {
  const client = getServiceClient()
  if (!client) {
    throw new Error('Maintenance config unavailable')
  }

  const nextValue: MaintenanceConfig = {
    enabled: input.enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
  }

  const { error } = await client
    .from('system_config')
    .upsert({
      config_key: MAINTENANCE_CONFIG_KEY,
      config_value: nextValue,
    }, {
      onConflict: 'config_key',
    })

  if (error) {
    throw new Error(error.message)
  }

  getGlobalCacheHost().__shopixMaintenanceCache = {
    value: nextValue,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }

  return nextValue
}
