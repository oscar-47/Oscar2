'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type AdminSupportEmailCardProps = {
  isZh: boolean
  to: string
}

function buildDefaultSubject(isZh: boolean) {
  return isZh
    ? '您的账户已补充积分 / Credits Added to Your Account'
    : 'Credits Added to Your Account / 您的账户已补充积分'
}

function buildDefaultBody() {
  return [
    'Hi,',
    '',
    'Thank you for being one of our early users. We really appreciate your support and patience.',
    '',
    'We reviewed your recent experience and have already returned the affected credits to your account. In addition, we’ve added 500 extra credits as a small thank-you for your continued support.',
    '',
    'Your account has now been updated.',
    '',
    'If you need anything else, feel free to reply to this email and we’ll be happy to help.',
    '',
    'Best,',
    'Shopix AI Support',
    '',
    '您好，',
    '',
    '感谢您成为我们的早期用户，也非常感谢您的支持与耐心。',
    '',
    '我们已经检查了您最近的使用情况，并已将受影响的积分退回到您的账户中。另外，作为一点小小的感谢，我们也额外为您补充了 500 积分。',
    '',
    '您的账户现已更新完成。',
    '',
    '如果您还有任何问题，欢迎直接回复这封邮件，我们会继续为您处理。',
    '',
    'Shopix AI Support',
  ].join('\n')
}

export function AdminSupportEmailCard({ isZh, to }: AdminSupportEmailCardProps) {
  const [subject, setSubject] = useState(buildDefaultSubject(isZh))
  const [text, setText] = useState(buildDefaultBody())
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async () => {
    setSending(true)
    setResult(null)
    setError(null)

    try {
      const response = await fetch('/api/admin/support-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, subject, text }),
      })

      const payload = await response.json().catch(() => null) as { error?: string; id?: string; detail?: unknown } | null

      if (!response.ok) {
        throw new Error(payload?.error || 'EMAIL_SEND_FAILED')
      }

      setResult(
        isZh
          ? `邮件已发送${payload?.id ? `，Resend ID: ${payload.id}` : ''}`
          : `Email sent${payload?.id ? `, Resend ID: ${payload.id}` : ''}`
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'EMAIL_SEND_FAILED')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-border bg-background p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {isZh ? '客服邮件' : 'Support Email'}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {isZh
              ? '从后台直接给当前用户发送一封邮件。默认内容为中英双语，可按需修改。'
              : 'Send an email to this user directly from admin. The default draft is bilingual and editable.'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSubject(buildDefaultSubject(isZh))
            setText(buildDefaultBody())
            setResult(null)
            setError(null)
          }}
          disabled={sending}
        >
          {isZh ? '恢复默认模板' : 'Reset Draft'}
        </Button>
      </div>

      <div className="mt-4 grid gap-4">
        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isZh ? '收件人' : 'Recipient'}
          </span>
          <Input value={to} disabled />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isZh ? '主题' : 'Subject'}
          </span>
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={sending} />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isZh ? '正文' : 'Body'}
          </span>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={sending}
            className="min-h-[360px]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleSend} disabled={sending || !to || !subject.trim() || !text.trim()}>
            {sending ? (isZh ? '发送中...' : 'Sending...') : (isZh ? '发送邮件' : 'Send Email')}
          </Button>
          {result ? <p className="text-sm text-emerald-700">{result}</p> : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>
    </section>
  )
}
