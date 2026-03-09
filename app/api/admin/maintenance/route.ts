import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMaintenanceConfig, setMaintenanceConfig } from '@/lib/maintenance'
import { isAdminUser } from '@/types'

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user || !isAdminUser(user.email)) {
    return null
  }

  return user
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const config = await getMaintenanceConfig({ fresh: true })
  return NextResponse.json(config)
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const config = await setMaintenanceConfig({
    enabled: body.enabled,
    updatedBy: user.email ?? null,
  })

  return NextResponse.json(config)
}
