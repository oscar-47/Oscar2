import type { GenerationJob } from '@/types'

export type GenerationJobError = Error & {
  code?: string | null
}

export function toGenerationJobError(
  job: Pick<GenerationJob, 'error_code' | 'error_message'>
): GenerationJobError {
  const error = new Error(job.error_message ?? 'Job failed') as GenerationJobError
  error.code = job.error_code ?? null
  return error
}

export function isProviderPolicyBlockedError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return (error as { code?: unknown }).code === 'PROMPT_BLOCKED_BY_PROVIDER_POLICY'
}
