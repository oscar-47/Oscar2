import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDefaultSupportReplyTo, getSupportEmailFromAddress, sendResendEmail } from '@/lib/email/resend'
import { isAdminUser } from '@/types'

type SupportEmailRequest = {
  to?: unknown
  subject?: unknown
  text?: unknown
  replyTo?: unknown
}

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

function normalizeLine(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  if (!process.env.RESEND_API_KEY?.trim()) {
    return NextResponse.json({ error: 'RESEND_NOT_CONFIGURED' }, { status: 500 })
  }

  const body = await request.json().catch(() => null) as SupportEmailRequest | null
  const to = normalizeLine(body?.to)
  const subject = normalizeLine(body?.subject)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const replyTo = normalizeLine(body?.replyTo) || getDefaultSupportReplyTo()

  if (!to || !subject || !text) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  if (subject.length > 200 || text.length > 20000 || to.length > 320) {
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 400 })
  }

  try {
    const payload = await sendResendEmail({
      from: getSupportEmailFromAddress(),
      to,
      subject,
      text,
      replyTo,
    })

    return NextResponse.json({
      ok: true,
      id: payload.id,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'EMAIL_SEND_FAILED',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 }
    )
  }
}
