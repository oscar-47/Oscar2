'use client'

import { useCallback, useEffect, useState } from 'react'

const TIME_ZONE = 'Asia/Hong_Kong'

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(new Date(iso))
}

type Attachment = {
  publicUrl: string
  fileName?: string | null
}

type FeedbackRow = {
  id: string
  user_id: string
  user_email: string | null
  message: string
  attachments: Attachment[]
  status: 'open' | 'replied'
  admin_reply: string | null
  admin_replied_at: string | null
  admin_replied_by: string | null
  created_at: string
}

function StatusBadge({ status }: { status: 'open' | 'replied' }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        status === 'replied'
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {status === 'replied' ? '已回复' : '待处理'}
    </span>
  )
}

function FeedbackCard({
  row,
  onReplySuccess,
}: {
  row: FeedbackRow
  onReplySuccess: (id: string, reply: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shouldTruncate = row.message.length > 200
  const displayMessage = shouldTruncate && !expanded
    ? row.message.slice(0, 200) + '...'
    : row.message

  async function handleReply() {
    const trimmed = replyText.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, adminReply: trimmed }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? 'REPLY_FAILED')
      }
      onReplySuccess(row.id, trimmed)
      setReplyText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'REPLY_FAILED')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="rounded-3xl border border-border bg-background p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{row.user_email ?? row.user_id.slice(0, 8)}</span>
        <span>{fmtTime(row.created_at)}</span>
        <StatusBadge status={row.status} />
      </div>

      {/* Message */}
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
        {displayMessage}
      </p>
      {shouldTruncate && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs font-medium text-blue-600 hover:underline"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}

      {/* Attachments */}
      {row.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {row.attachments.map((att, index) => (
            <a
              key={`${row.id}_att_${index}`}
              href={att.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-2xl border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.publicUrl}
                alt={att.fileName ?? `attachment-${index + 1}`}
                className="h-24 w-24 object-cover transition-transform duration-200 group-hover:scale-105"
              />
            </a>
          ))}
        </div>
      )}

      {/* Existing admin reply */}
      {row.admin_reply && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <p className="text-xs font-medium text-emerald-700">
            管理员回复 ({row.admin_replied_by ?? '—'}, {row.admin_replied_at ? fmtTime(row.admin_replied_at) : '—'})
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-950">
            {row.admin_reply}
          </p>
        </div>
      )}

      {/* Reply form */}
      <div className="mt-4 space-y-2">
        <textarea
          value={replyText}
          onChange={(e) => { setReplyText(e.target.value); setError(null) }}
          placeholder={row.admin_reply ? '追加/修改回复...' : '输入回复内容...'}
          className="w-full rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          rows={3}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleReply}
          disabled={submitting || !replyText.trim()}
          className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '提交中...' : '提交回复'}
        </button>
      </div>
    </article>
  )
}

export default function AdminFeedbackPanel() {
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/feedback?category=general')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { rows?: FeedbackRow[] }
      setRows(json.rows ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  function handleReplySuccess(id: string, reply: string) {
    setRows((current) =>
      current.map((r) =>
        r.id === id
          ? {
              ...r,
              admin_reply: reply,
              admin_replied_at: new Date().toISOString(),
              status: 'replied' as const,
            }
          : r,
      ),
    )
  }

  return (
    <div className="mx-auto w-full max-w-[90rem] px-5 py-8 sm:px-6">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          管理员
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          用户反馈管理
        </h1>
        <p className="text-sm text-muted-foreground">
          查看和回复用户提交的一般反馈（不含创作者计划）
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => { setLoading(true); fetchData() }}
          className="rounded-xl border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          刷新
        </button>
        <span className="text-sm text-muted-foreground">
          共 {rows.length} 条
        </span>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="mt-12 text-center text-muted-foreground">加载中...</div>
      ) : rows.length === 0 ? (
        <div className="mt-12 text-center text-muted-foreground">暂无反馈</div>
      ) : (
        <div className="mt-6 space-y-4">
          {rows.map((row) => (
            <FeedbackCard
              key={row.id}
              row={row}
              onReplySuccess={handleReplySuccess}
            />
          ))}
        </div>
      )}
    </div>
  )
}
