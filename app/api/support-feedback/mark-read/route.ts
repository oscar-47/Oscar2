import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUnreadSupportFeedbackReply } from '@/lib/support-feedback'
import { createClient } from '@/lib/supabase/server'

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

export async function POST() {
  const user = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('support_feedback')
    .select('id,admin_replied_at,user_seen_reply_at')
    .eq('user_id', user.id)
    .not('admin_replied_at', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const unreadIds = (data ?? [])
    .filter((item) => isUnreadSupportFeedbackReply({
      admin_replied_at: item.admin_replied_at,
      user_seen_reply_at: item.user_seen_reply_at,
    }))
    .map((item) => item.id)

  if (unreadIds.length === 0) {
    return NextResponse.json({ ok: true, seenAt: null })
  }

  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from('support_feedback')
    .update({ user_seen_reply_at: now })
    .in('id', unreadIds)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, seenAt: now })
}
