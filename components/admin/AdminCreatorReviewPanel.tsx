'use client'

import { useCallback, useEffect, useState } from 'react'
import { buildCreatorProgramAutoReply } from '@/lib/creator-program'
import type { CreatorProgramStage, CreatorProgramMetricType } from '@/types'

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

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  bilibili: 'B站',
  weibo: '微博',
  wechat_video: '视频号',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  other: '其他',
}

type Attachment = {
  publicUrl: string
  fileName?: string | null
}

type RewardRow = {
  id: string
  feedback_id: string
  user_id: string
  stage: CreatorProgramStage
  metric_type: CreatorProgramMetricType
  metric_value: number
  reward_credits: number
  admin_note: string | null
  created_at: string
}

type CreatorFeedbackRow = {
  id: string
  user_id: string
  user_email: string | null
  message: string
  attachments: Attachment[]
  status: 'open' | 'replied'
  admin_reply: string | null
  admin_replied_at: string | null
  admin_replied_by: string | null
  category: string
  creator_content_url: string | null
  creator_platform: string | null
  creator_published_at: string | null
  created_at: string
  rewards: RewardRow[]
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

function RewardBadge({ reward }: { reward: RewardRow }) {
  const stageLabel = reward.stage === '3d' ? '3天档' : '7天档'
  const metricLabel = reward.metric_type === 'like' ? '点赞' : '收藏'
  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
      <span className="font-medium">{stageLabel}</span>
      {' · '}
      {reward.metric_value} {metricLabel}
      {' · '}
      <span className="font-semibold">{reward.reward_credits} 积分</span>
      {reward.admin_note && (
        <span className="ml-1 text-violet-600">({reward.admin_note})</span>
      )}
      <span className="ml-2 text-violet-500">{fmtTime(reward.created_at)}</span>
    </div>
  )
}

function CreatorCard({
  row,
  onReplySuccess,
  onRewardSuccess,
}: {
  row: CreatorFeedbackRow
  onReplySuccess: (id: string, reply: string) => void
  onRewardSuccess: (id: string, reward: RewardRow) => void
}) {
  // Reply state
  const [replyText, setReplyText] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)

  // Reward form state
  const [showRewardForm, setShowRewardForm] = useState(false)
  const [stage, setStage] = useState<CreatorProgramStage>('3d')
  const [metricType, setMetricType] = useState<CreatorProgramMetricType>('like')
  const [metricValue, setMetricValue] = useState('')
  const [rewardCredits, setRewardCredits] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [rewardSubmitting, setRewardSubmitting] = useState(false)
  const [rewardError, setRewardError] = useState<string | null>(null)

  async function handleReply() {
    const trimmed = replyText.trim()
    if (!trimmed) return
    setReplySubmitting(true)
    setReplyError(null)
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
      setReplyError(e instanceof Error ? e.message : 'REPLY_FAILED')
    } finally {
      setReplySubmitting(false)
    }
  }

  async function handleIssueReward() {
    const mv = Number(metricValue)
    const rc = Number(rewardCredits)
    if (!Number.isFinite(mv) || mv < 0) {
      setRewardError('请输入有效的数据值')
      return
    }
    if (!Number.isFinite(rc) || rc <= 0) {
      setRewardError('请输入有效的积分数')
      return
    }

    setRewardSubmitting(true)
    setRewardError(null)
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackId: row.id,
          userId: row.user_id,
          stage,
          metricType,
          metricValue: mv,
          rewardCredits: rc,
          adminNote: adminNote.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? 'REWARD_FAILED')
      }
      const payload = (await res.json()) as { reward: RewardRow }

      onRewardSuccess(row.id, payload.reward)

      // Auto-fill reply with reward info
      const autoReply = buildCreatorProgramAutoReply({
        isZh: true,
        stage,
        metricType,
        metricValue: mv,
        rewardCredits: rc,
        adminNote: adminNote.trim() || null,
      })
      setReplyText(autoReply)

      // Reset reward form
      setMetricValue('')
      setRewardCredits('')
      setAdminNote('')
      setShowRewardForm(false)
    } catch (e) {
      setRewardError(e instanceof Error ? e.message : 'REWARD_FAILED')
    } finally {
      setRewardSubmitting(false)
    }
  }

  const platformLabel = row.creator_platform
    ? PLATFORM_LABELS[row.creator_platform] ?? row.creator_platform
    : '—'

  return (
    <article className="rounded-3xl border border-border bg-background p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{row.user_email ?? row.user_id.slice(0, 8)}</span>
        <span>{fmtTime(row.created_at)}</span>
        <StatusBadge status={row.status} />
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
          创作者计划
        </span>
      </div>

      {/* Content link + platform */}
      <div className="mt-3 space-y-1">
        {row.creator_content_url && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">内容链接：</span>
            <a
              href={row.creator_content_url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-medium text-blue-600 hover:underline"
            >
              {row.creator_content_url}
            </a>
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>平台：<span className="font-medium text-foreground">{platformLabel}</span></span>
          {row.creator_published_at && (
            <span>发布时间：<span className="font-medium text-foreground">{fmtTime(row.creator_published_at)}</span></span>
          )}
        </div>
      </div>

      {/* Message */}
      {row.message && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
          {row.message}
        </p>
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

      {/* Existing rewards */}
      {row.rewards.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">已发放奖励</p>
          {row.rewards.map((reward) => (
            <RewardBadge key={reward.id} reward={reward} />
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

      {/* Issue Reward form */}
      <div className="mt-4">
        <button
          onClick={() => setShowRewardForm(!showRewardForm)}
          className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
        >
          {showRewardForm ? '收起奖励表单' : '发放奖励'}
        </button>

        {showRewardForm && (
          <div className="mt-3 rounded-2xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">档位</span>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value as CreatorProgramStage)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="3d">3天档</option>
                  <option value="7d">7天档</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">指标类型</span>
                <select
                  value={metricType}
                  onChange={(e) => setMetricType(e.target.value as CreatorProgramMetricType)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="like">点赞</option>
                  <option value="favorite">收藏</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">数据值</span>
                <input
                  type="number"
                  min="0"
                  value={metricValue}
                  onChange={(e) => { setMetricValue(e.target.value); setRewardError(null) }}
                  placeholder="如 200"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">发放积分</span>
                <input
                  type="number"
                  min="1"
                  value={rewardCredits}
                  onChange={(e) => { setRewardCredits(e.target.value); setRewardError(null) }}
                  placeholder="如 150"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">备注（可选）</span>
              <input
                type="text"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="如：数据截图已核实"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </label>
            {rewardError && <p className="text-xs text-red-600">{rewardError}</p>}
            <button
              onClick={handleIssueReward}
              disabled={rewardSubmitting || !metricValue || !rewardCredits}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rewardSubmitting ? '发放中...' : '确认发放'}
            </button>
          </div>
        )}
      </div>

      {/* Reply form */}
      <div className="mt-4 space-y-2">
        <textarea
          value={replyText}
          onChange={(e) => { setReplyText(e.target.value); setReplyError(null) }}
          placeholder={row.admin_reply ? '追加/修改回复...' : '输入回复内容...'}
          className="w-full rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          rows={3}
        />
        {replyError && <p className="text-xs text-red-600">{replyError}</p>}
        <button
          onClick={handleReply}
          disabled={replySubmitting || !replyText.trim()}
          className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {replySubmitting ? '提交中...' : '提交回复'}
        </button>
      </div>
    </article>
  )
}

export default function AdminCreatorReviewPanel() {
  const [rows, setRows] = useState<CreatorFeedbackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/feedback?category=creator_program')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { rows?: CreatorFeedbackRow[] }
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

  function handleRewardSuccess(id: string, reward: RewardRow) {
    setRows((current) =>
      current.map((r) =>
        r.id === id
          ? { ...r, rewards: [reward, ...r.rewards] }
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
          创作者计划审核
        </h1>
        <p className="text-sm text-muted-foreground">
          审核创作者投稿，核实数据并发放奖励积分
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
        <div className="mt-12 text-center text-muted-foreground">暂无创作者投稿</div>
      ) : (
        <div className="mt-6 space-y-4">
          {rows.map((row) => (
            <CreatorCard
              key={row.id}
              row={row}
              onReplySuccess={handleReplySuccess}
              onRewardSuccess={handleRewardSuccess}
            />
          ))}
        </div>
      )}
    </div>
  )
}
