import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 48

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
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

  const { data, error } = await supabase
    .from('generation_jobs')
    .select('id,type,status,payload,result_data,result_url,error_message,created_at')
    .eq('user_id', authData.user.id)
    .in('type', ['IMAGE_GEN', 'STYLE_REPLICATE'])
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  return NextResponse.json({
    page,
    pageSize,
    hasMore: rows.length === pageSize,
    rows,
  })
}
