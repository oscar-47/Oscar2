import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getJobHealthMonitorState, getJobHealthSnapshot } from '@/lib/job-health-monitor'
import { isAdminUser } from '@/types'

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user || !isAdminUser(user.email)) return null
  return user
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const url = new URL(request.url)
  const hours = Math.min(Number(url.searchParams.get('hours') ?? 24), 168) // max 7 days
  const admin = createAdminClient()
  try {
    const [snapshot, monitor] = await Promise.all([
      getJobHealthSnapshot(admin, hours),
      getJobHealthMonitorState(admin),
    ])

    return NextResponse.json({
      ...snapshot,
      monitor,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
