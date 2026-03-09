import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 48
const FREE_HISTORY_RETENTION_DAYS = 3
const FREE_HISTORY_RETENTION_MS = FREE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000

type HistoryRow = {
  id: string
  created_at: string
  result_url: string | null
  result_data: unknown | null
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeExpiredResultData(value: unknown): Record<string, unknown> {
  const deletedAt = new Date().toISOString()
  const next: Record<string, unknown> = isRecord(value) ? { ...value } : {}

  delete next.object_path
  delete next.b64_json
  delete next.url

  if (Array.isArray(next.outputs)) {
    next.outputs = next.outputs.map((output) => {
      if (!isRecord(output)) return output
      const cleaned = { ...output }
      delete cleaned.object_path
      delete cleaned.b64_json
      delete cleaned.url
      return cleaned
    })
  }

  next.retention_policy = 'free_3d'
  next.retention_days = FREE_HISTORY_RETENTION_DAYS
  next.retention_deleted_at = deletedAt

  return next
}

async function userHasPaidHistoryAccess(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gt('amount', 0)
    .limit(1)

  if (error) {
    throw new Error(error.message)
  }

  return (data?.length ?? 0) > 0
}

function isFreeHistoryExpired(row: Pick<HistoryRow, 'created_at'>): boolean {
  return new Date(row.created_at).getTime() <= Date.now() - FREE_HISTORY_RETENTION_MS
}

function maskExpiredFreeHistoryRow<T extends HistoryRow>(row: T): T {
  if (!isFreeHistoryExpired(row)) return row
  return {
    ...row,
    result_url: null,
    result_data: sanitizeExpiredResultData(row.result_data),
  }
}

export async function GET(req: NextRequest) {
  const page = clampInt(req.nextUrl.searchParams.get('page'), 0, 10000, 0)
  const pageSize = clampInt(req.nextUrl.searchParams.get('pageSize'), 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
  const from = page * pageSize
  const to = from + pageSize - 1

  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const isPaidUser = await userHasPaidHistoryAccess(authData.user.id)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('generation_jobs')
    .select('id,type,status,payload,result_data,result_url,error_message,created_at')
    .eq('user_id', authData.user.id)
    .in('type', ['IMAGE_GEN', 'STYLE_REPLICATE'])
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = ((data ?? []) as HistoryRow[]).map((row) => (
    isPaidUser ? row : maskExpiredFreeHistoryRow(row)
  ))
  return NextResponse.json({
    page,
    pageSize,
    hasMore: rows.length === pageSize,
    policy: {
      isPaidUser,
      freeRetentionDays: FREE_HISTORY_RETENTION_DAYS,
    },
    rows,
  })
}
