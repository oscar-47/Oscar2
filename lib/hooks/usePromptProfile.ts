'use client'

import type { GenerationModel, PromptProfile } from '@/types'
import { resolvePromptProfileForModel } from '@/lib/prompt-profile'
import { usePublicConfig } from './usePublicConfig'

export function usePromptProfile(model: GenerationModel | string): {
  promptProfile: PromptProfile
  isLoading: boolean
} {
  const { config, isLoading } = usePublicConfig()
  return {
    promptProfile: resolvePromptProfileForModel(model, config),
    isLoading,
  }
}
