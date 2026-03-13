type SendResendEmailInput = {
  to: string | string[]
  subject: string
  text: string
  from?: string
  replyTo?: string
}

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function textToHtml(text: string) {
  return escapeHtml(text)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br />')
}

function normalizeRecipients(value: string | string[]) {
  const list = Array.isArray(value) ? value : [value]
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)))
}

export function getSupportEmailFromAddress() {
  return process.env.SUPPORT_EMAIL_FROM?.trim() || 'Shopix AI Support <support@shopix-ai.company>'
}

export function getHealthAlertFromAddress() {
  return process.env.HEALTH_ALERT_FROM?.trim() || getSupportEmailFromAddress()
}

export function getDefaultSupportReplyTo() {
  return process.env.SUPPORT_EMAIL_REPLY_TO?.trim() || undefined
}

export async function sendResendEmail(input: SendResendEmailInput) {
  const resendApiKey = process.env.RESEND_API_KEY?.trim()
  if (!resendApiKey) {
    throw new Error('RESEND_NOT_CONFIGURED')
  }

  const to = normalizeRecipients(input.to)
  if (!to.length) {
    throw new Error('RESEND_TO_MISSING')
  }

  const subject = input.subject.trim()
  const text = input.text.trim()
  if (!subject || !text) {
    throw new Error('RESEND_PAYLOAD_INVALID')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from?.trim() || getSupportEmailFromAddress(),
      to,
      subject,
      text,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.7;color:#111;max-width:640px"><p>${textToHtml(text)}</p></div>`,
      reply_to: input.replyTo?.trim() || getDefaultSupportReplyTo(),
    }),
  })

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload) : `status=${response.status}`
    throw new Error(`EMAIL_SEND_FAILED: ${detail}`)
  }

  return {
    id: typeof payload?.id === 'string' ? payload.id : null,
  }
}
