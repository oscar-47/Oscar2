import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isUnreadSupportFeedbackReply } from '@/lib/support-feedback'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  return user
}

export async function GET() {
  const user = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('support_feedback')
    .select('admin_replied_at,user_seen_reply_at')
    .eq('user_id', user.id)
    .not('admin_replied_at', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const count = (data ?? []).filter((item) => isUnreadSupportFeedbackReply({
    admin_replied_at: item.admin_replied_at,
    user_seen_reply_at: item.user_seen_reply_at,
  })).length

  return NextResponse.json({ count })
}
