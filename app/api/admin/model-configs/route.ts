import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminImageModelConfigs, setAdminImageModelConfigs } from '@/lib/admin-model-config'
import { isAdminUser } from '@/types'
import { sanitizeAdminImageModelConfigs } from '@/lib/admin-models'

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

  const configs = await getAdminImageModelConfigs()
  return NextResponse.json({ configs })
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    configs?: unknown
  } | null

  if (!body || !Array.isArray(body.configs)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const configs = sanitizeAdminImageModelConfigs(body.configs)
  const saved = await setAdminImageModelConfigs(configs)
  return NextResponse.json({ configs: saved })
}
