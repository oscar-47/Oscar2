'use client'

import { useCallback, useEffect, useState } from 'react'

type DurationStat = {
  count: number
  avg: number
  min: number
  max: number
  p50: number
}

type FailedJob = {
  id: string
  type: string
  error_code: string | null
  error_message: string | null
  created_at: string
  user_email?: string
  studio_type?: string
  image_count?: number
}

type ProcessingJob = {
  id: string
  type: string
  created_at: string
  age_min: number
}

type SubmissionFailure = {
  id: string
  user_id: string
  trace_id: string
  studio_type: string
  error_code: string | null
  error_message: string | null
  created_at: string
  user_email?: string
}

type HealthData = {
  hours: number
  since: string
  windowStart: string
  windowEnd: string
  total: number
  successCount: number
  failedCount: number
  processingCount: number
  successRate: number
  byStatus: Record<string, number>
  byTypeStatus: Record<string, number>
  byErrorCode: Record<string, number>
  durationStats: Record<string, DurationStat>
  wallClockStats: Record<string, DurationStat>
  queueOverheadStats: Record<string, DurationStat>
  recentFailed: FailedJob[]
  processing: ProcessingJob[]
  stuckJobs: ProcessingJob[]
  submissionFailureCount: number
  recentSubmissionFailures: SubmissionFailure[]
  lastImageGenOrStyleReplicateAt: string | null
  minutesSinceLastGeneration: number | null
  monitor: {
    lastCheckedAt: string | null
    lastIncidentFingerprint: string | null
    lastIncidentType: string | null
    lastAlertSentAt: string | null
    lastAlertSummary: string | null
    cooldownUntil: string | null
  }
}

const TIME_ZONE = 'Asia/Shanghai'

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(new Date(iso))
}

function fmtMaybeTime(iso: string | null | undefined) {
  return iso ? fmtTime(iso) : '—'
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800',
    processing: 'bg-amber-100 text-amber-800',
    pending: 'bg-gray-100 text-gray-700',
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  )
}

function RateIndicator({ rate }: { rate: number }) {
  const color = rate >= 95 ? 'text-emerald-600' : rate >= 80 ? 'text-amber-600' : 'text-red-600'
  return <span className={`text-4xl font-bold ${color}`}>{rate}%</span>
}

function IncidentBadge({ type, isZh }: { type: string | null; isZh: boolean }) {
  const labels: Record<string, string> = {
    success_rate: isZh ? '成功率异常' : 'Success rate',
    image_gen_failures: isZh ? '生图失败激增' : 'Image failures',
    stuck_jobs: isZh ? '任务卡住' : 'Stuck jobs',
    error_code_spike: isZh ? '错误码激增' : 'Error spike',
    submission_failures: isZh ? '提交失败' : 'Submission failures',
    generation_drought: isZh ? '出图中断' : 'Generation drought',
  }

  return (
    <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      {type ? (labels[type] ?? type) : (isZh ? '无' : 'None')}
    </span>
  )
}

export default function JobHealthDashboard({ locale }: { locale: string }) {
  const isZh = locale === 'zh'
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hours, setHours] = useState(1)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const REFRESH_INTERVAL = 60_000 // 60 seconds

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/job-health?hours=${hours}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [hours])

  useEffect(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchData, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [autoRefresh, fetchData])

  const stuckJobs = data?.stuckJobs ?? []
  const isCoolingDown = data?.monitor.cooldownUntil
    ? new Date(data.monitor.cooldownUntil).getTime() > Date.now()
    : false

  return (
    <div className="mx-auto w-full max-w-[90rem] px-5 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {isZh ? '管理员监控' : 'Admin Monitor'}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {isZh ? '队列任务健康' : 'Queue Job Health'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lastRefresh
              ? `${isZh ? '上次刷新' : 'Last refresh'}: ${lastRefresh.toLocaleTimeString()}`
              : ''}
            {autoRefresh ? ` · ${isZh ? '每分钟自动刷新' : 'auto-refresh 1min'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range */}
          {[1, 6, 24].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                hours === h
                  ? 'bg-foreground text-background'
                  : 'border border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              {h}h
            </button>
          ))}
          <div className="mx-1 h-6 w-px bg-border" />
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
              autoRefresh
                ? 'bg-emerald-100 text-emerald-800'
                : 'border border-border bg-background text-muted-foreground'
            }`}
          >
            {autoRefresh ? (isZh ? '自动' : 'Auto') : (isZh ? '手动' : 'Manual')}
          </button>
          <button
            onClick={() => { setLoading(true); fetchData() }}
            className="rounded-xl border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {isZh ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="mt-12 text-center text-muted-foreground">{isZh ? '加载中...' : 'Loading...'}</div>
      ) : data ? (
        <>
          <div className="mt-6 rounded-3xl border border-border bg-background p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {isZh ? '队列监控状态' : 'Queue Monitor Status'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isZh
                    ? '每 15 分钟巡检 generation_jobs + generation_attempt_events（含排队前提交失败检测）。'
                    : 'Checks generation_jobs + generation_attempt_events every 15 minutes (includes pre-queue submission failure detection).'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <IncidentBadge type={data.monitor.lastIncidentType} isZh={isZh} />
                {isCoolingDown && (
                  <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    {isZh ? '已告警，冷却中' : 'Alerted, cooling down'}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-muted/50 px-4 py-3">
                <p className="text-xs text-muted-foreground">{isZh ? '最近检查' : 'Last check'}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{fmtMaybeTime(data.monitor.lastCheckedAt)}</p>
              </div>
              <div className="rounded-2xl bg-muted/50 px-4 py-3">
                <p className="text-xs text-muted-foreground">{isZh ? '最近告警' : 'Last alert'}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{fmtMaybeTime(data.monitor.lastAlertSentAt)}</p>
              </div>
              <div className="rounded-2xl bg-muted/50 px-4 py-3">
                <p className="text-xs text-muted-foreground">{isZh ? '冷却到' : 'Cooldown until'}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{fmtMaybeTime(data.monitor.cooldownUntil)}</p>
              </div>
              <div className="rounded-2xl bg-muted/50 px-4 py-3">
                <p className="text-xs text-muted-foreground">{isZh ? '监控窗口' : 'Window'}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">15m</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-border/60 px-4 py-3">
              <p className="text-xs text-muted-foreground">{isZh ? '最近告警摘要' : 'Latest alert summary'}</p>
              <p className="mt-1 text-sm text-foreground">
                {data.monitor.lastAlertSummary ?? (isZh ? '暂无告警记录' : 'No alert has been sent yet.')}
              </p>
            </div>
          </div>

          {/* Alert: stuck jobs */}
          {stuckJobs.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">
                {isZh
                  ? `${stuckJobs.length} 个任务疑似卡住 (>10min)`
                  : `${stuckJobs.length} job(s) appear stuck (>10min)`}
              </p>
              <div className="mt-1 space-y-0.5">
                {stuckJobs.map((j) => (
                  <p key={j.id} className="text-xs text-amber-800 font-mono">
                    {j.id.slice(0, 8)}... {j.type} — {j.age_min}min
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Alert: submission failures (pre-queue) */}
          {(data.submissionFailureCount ?? 0) > 0 && (
            <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-900">
                {isZh
                  ? `${data.submissionFailureCount} 次排队前提交失败（generation_attempt_events）`
                  : `${data.submissionFailureCount} pre-queue submission failure(s) (generation_attempt_events)`}
              </p>
              <p className="mt-0.5 text-xs text-red-700">
                {isZh
                  ? '这些错误发生在 job 写入数据库之前，不会出现在 generation_jobs 表中。'
                  : 'These errors occur before job rows are created — invisible to generation_jobs monitoring.'}
              </p>
              <div className="mt-2 space-y-0.5">
                {data.recentSubmissionFailures?.slice(0, 5).map((sf) => (
                  <p key={sf.id} className="text-xs text-red-800 font-mono">
                    {fmtTime(sf.created_at)} {sf.studio_type} {sf.error_code ?? 'UNKNOWN'} — {sf.user_email ?? sf.user_id.slice(0, 8)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Alert: generation drought */}
          {data.minutesSinceLastGeneration != null && data.minutesSinceLastGeneration >= 30 && (
            <div className="mt-4 rounded-2xl border border-orange-300 bg-orange-50 px-4 py-3">
              <p className="text-sm font-semibold text-orange-900">
                {isZh
                  ? `已 ${data.minutesSinceLastGeneration} 分钟没有 IMAGE_GEN / STYLE_REPLICATE 任务`
                  : `No IMAGE_GEN / STYLE_REPLICATE jobs for ${data.minutesSinceLastGeneration} minutes`}
              </p>
              <p className="mt-0.5 text-xs text-orange-700">
                {isZh
                  ? '如果有 ANALYSIS 在成功但没有出图任务，可能所有出图入队调用都在失败。'
                  : 'If ANALYSIS jobs succeed but no generation jobs appear, all generation enqueue calls may be failing.'}
              </p>
            </div>
          )}

          {/* Stats Cards */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-3xl border border-border bg-background p-5">
              <p className="text-sm text-muted-foreground">{isZh ? '成功率' : 'Success Rate'}</p>
              <div className="mt-2">
                <RateIndicator rate={data.successRate} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.successCount}/{data.total} {isZh ? '个任务' : 'jobs'}
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-background p-5">
              <p className="text-sm text-muted-foreground">{isZh ? '总任务数' : 'Total Jobs'}</p>
              <p className="mt-2 text-4xl font-bold text-foreground">{data.total}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh ? `最近 ${data.hours} 小时` : `Last ${data.hours}h`}
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-background p-5">
              <p className="text-sm text-muted-foreground">{isZh ? '失败数' : 'Failed'}</p>
              <p className={`mt-2 text-4xl font-bold ${data.failedCount > 0 ? 'text-red-600' : 'text-foreground'}`}>
                {data.failedCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh ? '处理中' : 'processing'}: {data.processingCount}
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-background p-5">
              <p className="text-sm text-muted-foreground">{isZh ? '平均执行耗时' : 'Avg Exec Duration'}</p>
              <div className="mt-2 space-y-1">
                {Object.entries(data.durationStats).map(([type, stat]) => (
                  <div key={type} className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">{type}</span>
                    <span className="text-sm font-semibold text-foreground">{stat.avg}s</span>
                  </div>
                ))}
                {Object.keys(data.durationStats).length === 0 && (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {isZh ? '仅统计 worker 实际执行时间（duration_ms）' : 'Worker execution only (duration_ms)'}
              </p>
            </div>
          </div>

          {/* Type x Status breakdown */}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-border bg-background p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {isZh ? '类型 × 状态' : 'Type x Status'}
              </h2>
              <div className="mt-3 space-y-1.5">
                {Object.entries(data.byTypeStatus)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, count]) => {
                    const [type, status] = key.split('/')
                    return (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{type}</span>
                          <StatusBadge status={status} />
                        </div>
                        <span className="font-semibold text-foreground">{count}</span>
                      </div>
                    )
                  })}
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-background p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {isZh ? '错误分布' : 'Error Breakdown'}
              </h2>
              {Object.keys(data.byErrorCode).length === 0 ? (
                <p className="mt-3 text-sm text-emerald-600">{isZh ? '无错误' : 'No errors'}</p>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {Object.entries(data.byErrorCode)
                    .sort(([, a], [, b]) => b - a)
                    .map(([code, count]) => (
                      <div key={code} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-red-700">{code}</span>
                        <span className="font-semibold text-red-600">{count}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Duration details */}
          {Object.keys(data.durationStats).length > 0 && (
            <div className="mt-6 rounded-3xl border border-border bg-background p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {isZh ? '执行耗时详情（已完成任务）' : 'Execution Duration Details (completed)'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh
                  ? '基于 generation_jobs.duration_ms，不包含排队、退避重试和等待 worker 的时间。'
                  : 'Based on generation_jobs.duration_ms. Excludes queue wait, backoff retries, and worker scheduling time.'}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{isZh ? '类型' : 'Type'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '数量' : 'Count'}</th>
                      <th className="px-3 py-2 font-medium">Avg</th>
                      <th className="px-3 py-2 font-medium">P50</th>
                      <th className="px-3 py-2 font-medium">Min</th>
                      <th className="px-3 py-2 font-medium">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.durationStats).map(([type, s]) => (
                      <tr key={type} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-foreground">{type}</td>
                        <td className="px-3 py-2 text-foreground">{s.count}</td>
                        <td className="px-3 py-2 font-semibold text-foreground">{s.avg}s</td>
                        <td className="px-3 py-2 text-foreground">{s.p50}s</td>
                        <td className="px-3 py-2 text-emerald-600">{s.min}s</td>
                        <td className="px-3 py-2 text-amber-600">{s.max}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {Object.keys(data.wallClockStats).length > 0 && (
            <div className="mt-6 rounded-3xl border border-border bg-background p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {isZh ? '端到端耗时详情（已完成任务）' : 'Wall-Clock Duration Details (completed)'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh
                  ? '基于 created_at -> updated_at，会包含排队、重试退避和队列调度时间。'
                  : 'Based on created_at -> updated_at. Includes queueing, retry backoff, and scheduler delay.'}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{isZh ? '类型' : 'Type'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '数量' : 'Count'}</th>
                      <th className="px-3 py-2 font-medium">Avg</th>
                      <th className="px-3 py-2 font-medium">P50</th>
                      <th className="px-3 py-2 font-medium">Min</th>
                      <th className="px-3 py-2 font-medium">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.wallClockStats).map(([type, s]) => (
                      <tr key={type} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-foreground">{type}</td>
                        <td className="px-3 py-2 text-foreground">{s.count}</td>
                        <td className="px-3 py-2 font-semibold text-foreground">{s.avg}s</td>
                        <td className="px-3 py-2 text-foreground">{s.p50}s</td>
                        <td className="px-3 py-2 text-emerald-600">{s.min}s</td>
                        <td className="px-3 py-2 text-amber-600">{s.max}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {Object.keys(data.queueOverheadStats).length > 0 && (
            <div className="mt-6 rounded-3xl border border-border bg-background p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {isZh ? '排队/重试额外耗时' : 'Queue/Retry Overhead'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh
                  ? '计算方式：端到端耗时减去执行耗时。这个值高，通常意味着排队、worker 容量或重试在拖慢。'
                  : 'Computed as wall-clock minus execution duration. High values usually indicate queueing, worker capacity pressure, or retries.'}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{isZh ? '类型' : 'Type'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '数量' : 'Count'}</th>
                      <th className="px-3 py-2 font-medium">Avg</th>
                      <th className="px-3 py-2 font-medium">P50</th>
                      <th className="px-3 py-2 font-medium">Min</th>
                      <th className="px-3 py-2 font-medium">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.queueOverheadStats).map(([type, s]) => (
                      <tr key={type} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-foreground">{type}</td>
                        <td className="px-3 py-2 text-foreground">{s.count}</td>
                        <td className="px-3 py-2 font-semibold text-foreground">{s.avg}s</td>
                        <td className="px-3 py-2 text-foreground">{s.p50}s</td>
                        <td className="px-3 py-2 text-emerald-600">{s.min}s</td>
                        <td className="px-3 py-2 text-amber-600">{s.max}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent failed jobs */}
          <div className="mt-6 rounded-3xl border border-border bg-background p-5">
            <h2 className="text-sm font-semibold text-foreground">
              {isZh ? '近期失败任务' : 'Recent Failed Jobs'}
              {data.recentFailed.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({data.recentFailed.length})
                </span>
              )}
            </h2>
            {data.recentFailed.length === 0 ? (
              <p className="mt-3 text-sm text-emerald-600">{isZh ? '无失败任务' : 'No failures'}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{isZh ? '时间' : 'Time'}</th>
                      <th className="px-3 py-2 font-medium">ID</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '类型' : 'Type'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '错误码' : 'Error'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '详情' : 'Details'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '用户' : 'User'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentFailed.map((f) => (
                      <tr key={f.id} className="border-t border-border align-top">
                        <td className="whitespace-nowrap px-3 py-2 text-foreground">
                          {fmtTime(f.created_at)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {f.id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-foreground">{f.type}</span>
                          {f.studio_type && (
                            <span className="ml-1 text-xs text-muted-foreground">/{f.studio_type}</span>
                          )}
                          {f.image_count != null && (
                            <span className="ml-1 text-xs text-muted-foreground">({f.image_count}img)</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs text-red-700">
                            {f.error_code ?? '—'}
                          </span>
                        </td>
                        <td className="max-w-[300px] truncate px-3 py-2 text-xs text-muted-foreground" title={f.error_message ?? ''}>
                          {f.error_message ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {f.user_email ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {/* Recent submission failures (pre-queue) */}
          <div className="mt-6 rounded-3xl border border-border bg-background p-5">
            <h2 className="text-sm font-semibold text-foreground">
              {isZh ? '排队前提交失败' : 'Pre-Queue Submission Failures'}
              {(data.submissionFailureCount ?? 0) > 0 && (
                <span className="ml-2 text-xs font-normal text-red-600">
                  ({data.submissionFailureCount})
                </span>
              )}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isZh
                ? '来源：generation_attempt_events（stage=image_queue, status=failed）。这些错误在 job 入库前发生。'
                : 'Source: generation_attempt_events (stage=image_queue, status=failed). These fail before job creation.'}
            </p>
            {(data.recentSubmissionFailures?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-emerald-600">{isZh ? '无提交失败' : 'No submission failures'}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{isZh ? '时间' : 'Time'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '工作流' : 'Studio'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '错误码' : 'Error'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '详情' : 'Details'}</th>
                      <th className="px-3 py-2 font-medium">{isZh ? '用户' : 'User'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSubmissionFailures?.map((sf) => (
                      <tr key={sf.id} className="border-t border-border align-top">
                        <td className="whitespace-nowrap px-3 py-2 text-foreground">
                          {fmtTime(sf.created_at)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-foreground">
                          {sf.studio_type}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs text-red-700">
                            {sf.error_code ?? '—'}
                          </span>
                        </td>
                        <td className="max-w-[300px] truncate px-3 py-2 text-xs text-muted-foreground" title={sf.error_message ?? ''}>
                          {sf.error_message ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {sf.user_email ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
