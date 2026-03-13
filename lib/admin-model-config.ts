import { createAdminClient } from '@/lib/supabase/admin'
import {
  ADMIN_IMAGE_MODEL_CONFIG_KEY,
  sanitizeAdminImageModelConfigs,
  type AdminImageModelConfig,
} from '@/lib/admin-models'

export async function getAdminImageModelConfigs(): Promise<AdminImageModelConfig[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('system_config')
    .select('config_value')
    .eq('config_key', ADMIN_IMAGE_MODEL_CONFIG_KEY)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return sanitizeAdminImageModelConfigs(data?.config_value ?? [])
}

export async function setAdminImageModelConfigs(
  configs: AdminImageModelConfig[],
): Promise<AdminImageModelConfig[]> {
  const admin = createAdminClient()
  const normalized = sanitizeAdminImageModelConfigs(configs)
  const { error } = await admin
    .from('system_config')
    .upsert(
      {
        config_key: ADMIN_IMAGE_MODEL_CONFIG_KEY,
        config_value: normalized,
      },
      { onConflict: 'config_key' },
    )

  if (error) {
    throw new Error(error.message)
  }

  return normalized
}
