import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type {
  GenerationAttemptEventStage,
  GenerationAttemptEventStatus,
} from '@/lib/api/generation-attempt-events'

type EventRequest = {
  traceId?: unknown
  studioType?: unknown
  stage?: unknown
  status?: unknown
  errorCode?: unknown
  errorMessage?: unknown
  httpStatus?: unknown
  metadata?: unknown
}

const ALLOWED_STAGES = new Set<GenerationAttemptEventStage>([
  'prepare_inputs',
  'prompt_generate',
  'image_queue',
  'batch_complete',
])

const ALLOWED_STATUSES = new Set<GenerationAttemptEventStatus>([
  'started',
  'success',
  'failed',
  'partial',
])

function readTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function readHttpStatus(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const normalized = Math.floor(num)
  return normalized >= 100 && normalized <= 599 ? normalized : null
}

function readMetadata(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as EventRequest | null
  const traceId = readTrimmedString(body?.traceId, 120)
  const studioType = readTrimmedString(body?.studioType, 64)
  const stage = readTrimmedString(body?.stage, 32) as GenerationAttemptEventStage | null
  const status = readTrimmedString(body?.status, 16) as GenerationAttemptEventStatus | null

  if (!traceId || !studioType || !stage || !status || !ALLOWED_STAGES.has(stage) || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error: insertError } = await admin
    .from('generation_attempt_events')
    .insert({
      user_id: user.id,
      trace_id: traceId,
      studio_type: studioType,
      stage,
      status,
      error_code: readTrimmedString(body?.errorCode, 120),
      error_message: readTrimmedString(body?.errorMessage, 1200),
      http_status: readHttpStatus(body?.httpStatus),
      metadata: readMetadata(body?.metadata),
    })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
