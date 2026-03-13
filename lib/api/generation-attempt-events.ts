export type GenerationAttemptEventStage =
  | 'prepare_inputs'
  | 'prompt_generate'
  | 'image_queue'
  | 'batch_complete'

export type GenerationAttemptEventStatus =
  | 'started'
  | 'success'
  | 'failed'
  | 'partial'

export interface GenerationAttemptEventInput {
  traceId: string
  studioType: string
  stage: GenerationAttemptEventStage
  status: GenerationAttemptEventStatus
  errorCode?: string | null
  errorMessage?: string | null
  httpStatus?: number | null
  metadata?: Record<string, unknown>
}

export async function logGenerationAttemptEvent(
  input: GenerationAttemptEventInput
): Promise<void> {
  try {
    await fetch('/api/generation-attempt-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      keepalive: true,
    })
  } catch {
    // Logging must never break the main generation flow.
  }
}
