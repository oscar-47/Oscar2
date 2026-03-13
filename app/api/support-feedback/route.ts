import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  SUPPORT_FEEDBACK_EXTENDED_SELECT,
  SUPPORT_FEEDBACK_LEGACY_SELECT,
  isSupportFeedbackExtendedSchemaError,
  normalizeSupportFeedbackAttachments,
  normalizeSupportFeedbackMessage,
  normalizeSupportFeedbackRow,
} from '@/lib/support-feedback'

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
  const query = await admin
    .from('support_feedback')
    .select(SUPPORT_FEEDBACK_EXTENDED_SELECT)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  let data = query.data as Record<string, unknown>[] | null
  let error = query.error

  if (error && isSupportFeedbackExtendedSchemaError(error.message)) {
    const fallback = await admin
      .from('support_feedback')
      .select(SUPPORT_FEEDBACK_LEGACY_SELECT)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    data = fallback.data as Record<string, unknown>[] | null
    error = fallback.error
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rows: (data ?? []).map((row) => normalizeSupportFeedbackRow(row)) })
}

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    message?: unknown
    attachments?: unknown
  } | null

  const normalizedMessage = normalizeSupportFeedbackMessage(body?.message)
  if (!normalizedMessage.ok) {
    return NextResponse.json({ error: normalizedMessage.error }, { status: 400 })
  }

  const normalizedAttachments = normalizeSupportFeedbackAttachments(body?.attachments)
  if (!normalizedAttachments.ok) {
    return NextResponse.json({ error: normalizedAttachments.error }, { status: 400 })
  }

  const admin = createAdminClient()
  const insertResult = await admin
    .from('support_feedback')
    .insert({
      user_id: user.id,
      message: normalizedMessage.value,
      attachments: normalizedAttachments.value,
      category: 'general',
      status: 'open',
    })
    .select(SUPPORT_FEEDBACK_EXTENDED_SELECT)
    .single()
  let data = insertResult.data as Record<string, unknown> | null
  let error = insertResult.error

  if (error && isSupportFeedbackExtendedSchemaError(error.message)) {
    const fallback = await admin
      .from('support_feedback')
      .insert({
        user_id: user.id,
        message: normalizedMessage.value,
        attachments: normalizedAttachments.value,
        status: 'open',
      })
      .select(SUPPORT_FEEDBACK_LEGACY_SELECT)
      .single()
    data = fallback.data as Record<string, unknown> | null
    error = fallback.error
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ row: normalizeSupportFeedbackRow(data ?? {}) }, { status: 201 })
}
