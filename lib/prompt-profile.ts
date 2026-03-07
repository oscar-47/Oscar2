import type { GenerationModel, PromptProfile, PublicConfig } from '@/types'
import { normalizeGenerationModel } from '@/types'

export const TA_PRO_PROMPT_MODEL: GenerationModel = 'ta-gemini-3-pro'

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  }
  return false
}

export function isTaProPromptProfileEnabled(config: PublicConfig | null | undefined): boolean {
  return coerceBoolean(config?.ta_pro_prompt_profile_enabled)
}

export function resolvePromptProfileForModel(
  model: GenerationModel | string,
  config: PublicConfig | null | undefined,
): PromptProfile {
  return normalizeGenerationModel(model) === TA_PRO_PROMPT_MODEL && isTaProPromptProfileEnabled(config)
    ? 'ta-pro'
    : 'default'
}
