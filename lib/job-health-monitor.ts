import type { SupabaseClient } from '@supabase/supabase-js'

export const JOB_HEALTH_MONITOR_CONFIG_KEY = 'job_health_monitor_state'
export const JOB_HEALTH_MONITOR_WINDOW_MINUTES = 15
export const JOB_HEALTH_MONITOR_COOLDOWN_MINUTES = 60
export const JOB_HEALTH_MIN_SAMPLE_SIZE = 20
export const JOB_HEALTH_MIN_SUCCESS_RATE = 75
export const JOB_HEALTH_MIN_IMAGE_GEN_FAILURES = 10
export const JOB_HEALTH_MIN_STUCK_JOBS = 3
export const JOB_HEALTH_STUCK_JOB_AGE_MINUTES = 10
export const JOB_HEALTH_MIN_ERROR_CODE_SPIKE = 8
export const JOB_HEALTH_MIN_SUBMISSION_FAILURES = 3
export const JOB_HEALTH_MIN_GENERATION_DROUGHT_MINUTES = 30

type JsonRecord = Record<string, unknown>

export type DurationStat = {
  count: number
  avg: number
  min: number
  max: number
  p50: number
}

export type FailedJob = {
  id: string
  type: string
  error_code: string | null
  error_message: string | null
  created_at: string
  user_email?: string
  studio_type?: string
  image_count?: number
}

export type ProcessingJob = {
  id: string
  type: string
  created_at: string
  age_min: number
}

export type ErrorCodeCount = {
  code: string
  count: number
}

export type FailedTypeCount = {
  type: string
  count: number
}

export type SubmissionFailure = {
  id: string
  user_id: string
  trace_id: string
  studio_type: string
  error_code: string | null
  error_message: string | null
  created_at: string
  user_email?: string
  metadata?: Record<string, unknown>
}

export type JobHealthMonitorState = {
  lastCheckedAt: string | null
  lastIncidentFingerprint: string | null
  lastIncidentType: string | null
  lastAlertSentAt: string | null
  lastAlertSummary: string | null
  cooldownUntil: string | null
}

export type JobHealthIncidentType =
  | 'success_rate'
  | 'image_gen_failures'
  | 'stuck_jobs'
  | 'error_code_spike'
  | 'submission_failures'
  | 'generation_drought'

export type JobHealthIncident = {
  type: JobHealthIncidentType
  fingerprint: string
  summary: string
  primaryKey: string
}

export type JobHealthSnapshot = {
  hours: number
  since: string
  windowStart: string
  windowEnd: string
  windowBucketStart: string
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
  topErrorCodes: ErrorCodeCount[]
  failedByType: FailedTypeCount[]
  submissionFailureCount: number
  recentSubmissionFailures: SubmissionFailure[]
  lastImageGenOrStyleReplicateAt: string | null
  minutesSinceLastGeneration: number | null
}

type JobRow = {
  id: string
  type: string
  status: string
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  duration_ms: number | null
  user_id: string | null
  payload: JsonRecord | null
}

type ProcessingRow = {
  id: string
  type: string
  created_at: string
}

function defaultMonitorState(): JobHealthMonitorState {
  return {
    lastCheckedAt: null,
    lastIncidentFingerprint: null,
    lastIncidentType: null,
    lastAlertSentAt: null,
    lastAlertSummary: null,
    cooldownUntil: null,
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeMonitorState(value: unknown): JobHealthMonitorState {
  const record = asRecord(value)
  if (!record) return defaultMonitorState()

  return {
    lastCheckedAt: readString(record.lastCheckedAt),
    lastIncidentFingerprint: readString(record.lastIncidentFingerprint),
    lastIncidentType: readString(record.lastIncidentType),
    lastAlertSentAt: readString(record.lastAlertSentAt),
    lastAlertSummary: readString(record.lastAlertSummary),
    cooldownUntil: readString(record.cooldownUntil),
  }
}

function buildDurationStats(durations: Array<{ type: string; seconds: number }>): Record<string, DurationStat> {
  const grouped: Record<string, number[]> = {}
  for (const item of durations) {
    if (!grouped[item.type]) grouped[item.type] = []
    grouped[item.type].push(item.seconds)
  }

  const stats: Record<string, DurationStat> = {}
  for (const [type, values] of Object.entries(grouped)) {
    values.sort((a, b) => a - b)
    stats[type] = {
      count: values.length,
      avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      min: Math.round(values[0]),
      max: Math.round(values[values.length - 1]),
      p50: Math.round(values[Math.floor(values.length / 2)]),
    }
  }

  return stats
}

function getBucketStart(nowMs: number, windowMinutes: number) {
  const intervalMs = windowMinutes * 60 * 1000
  return new Date(Math.floor(nowMs / intervalMs) * intervalMs).toISOString()
}

export async function getJobHealthMonitorState(admin: SupabaseClient): Promise<JobHealthMonitorState> {
  const { data, error } = await admin
    .from('system_config')
    .select('config_value')
    .eq('config_key', JOB_HEALTH_MONITOR_CONFIG_KEY)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return normalizeMonitorState(data?.config_value ?? null)
}

export async function saveJobHealthMonitorState(
  admin: SupabaseClient,
  state: JobHealthMonitorState
): Promise<JobHealthMonitorState> {
  const nextState = normalizeMonitorState(state)

  const { error } = await admin
    .from('system_config')
    .upsert(
      {
        config_key: JOB_HEALTH_MONITOR_CONFIG_KEY,
        config_value: nextState,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'config_key',
      }
    )

  if (error) {
    throw new Error(error.message)
  }

  return nextState
}

export async function getJobHealthSnapshot(
  admin: SupabaseClient,
  hours: number
): Promise<JobHealthSnapshot> {
  const nowMs = Date.now()
  const windowEnd = new Date(nowMs).toISOString()
  const windowStart = new Date(nowMs - hours * 60 * 60 * 1000).toISOString()

  const [
    { data: jobs, error: jobsError },
    { data: processingJobs, error: processingError },
    { data: submissionEvents, error: submissionError },
    { data: latestGenJobs, error: latestGenError },
  ] = await Promise.all([
    admin
      .from('generation_jobs')
      .select('id, type, status, error_code, error_message, created_at, updated_at, duration_ms, user_id, payload')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1000),
    admin
      .from('generation_jobs')
      .select('id, type, created_at')
      .eq('status', 'processing')
      .order('created_at', { ascending: false })
      .limit(200),
    // Pre-queue submission failures from generation_attempt_events
    admin
      .from('generation_attempt_events')
      .select('id, user_id, trace_id, studio_type, error_code, error_message, metadata, created_at')
      .eq('stage', 'image_queue')
      .eq('status', 'failed')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(100),
    // Last IMAGE_GEN or STYLE_REPLICATE job (any time range) to detect generation drought
    admin
      .from('generation_jobs')
      .select('created_at')
      .in('type', ['IMAGE_GEN', 'STYLE_REPLICATE'])
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  if (jobsError) throw new Error(jobsError.message)
  if (processingError) throw new Error(processingError.message)
  if (submissionError) throw new Error(submissionError.message)
  if (latestGenError) throw new Error(latestGenError.message)

  const byStatus: Record<string, number> = {}
  const byTypeStatus: Record<string, number> = {}
  const byErrorCode: Record<string, number> = {}
  const recentFailed: FailedJob[] = []
  const executionDurations: Array<{ type: string; seconds: number }> = []
  const wallClockDurations: Array<{ type: string; seconds: number }> = []
  const queueOverheadDurations: Array<{ type: string; seconds: number }> = []
  const failedUserIds = new Set<string>()
  const failedByTypeMap: Record<string, number> = {}

  for (const row of (jobs ?? []) as JobRow[]) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    byTypeStatus[`${row.type}/${row.status}`] = (byTypeStatus[`${row.type}/${row.status}`] ?? 0) + 1

    if (row.status === 'failed') {
      const errorCode = row.error_code || 'UNKNOWN'
      byErrorCode[errorCode] = (byErrorCode[errorCode] ?? 0) + 1
      failedByTypeMap[row.type] = (failedByTypeMap[row.type] ?? 0) + 1
      if (row.user_id) failedUserIds.add(row.user_id)

      const payload = asRecord(row.payload)
      recentFailed.push({
        id: row.id,
        type: row.type,
        error_code: row.error_code,
        error_message: row.error_message,
        created_at: row.created_at,
        studio_type: readString(payload?.studioType) ?? undefined,
        image_count: Array.isArray(payload?.productImages) ? payload?.productImages.length : undefined,
      })
    }

    if (row.status === 'success' && typeof row.duration_ms === 'number') {
      const executionSeconds = row.duration_ms / 1000
      if (executionSeconds > 0 && executionSeconds < 3600) {
        executionDurations.push({ type: row.type, seconds: executionSeconds })
      }
    }

    if (row.status === 'success' && row.updated_at && row.created_at) {
      const createdMs = new Date(row.created_at).getTime()
      const updatedMs = new Date(row.updated_at).getTime()
      const wallClockSeconds = (updatedMs - createdMs) / 1000
      if (wallClockSeconds > 0 && wallClockSeconds < 3600) {
        wallClockDurations.push({ type: row.type, seconds: wallClockSeconds })
      }
      if (typeof row.duration_ms === 'number') {
        const overheadSeconds = wallClockSeconds - row.duration_ms / 1000
        if (overheadSeconds >= 0 && overheadSeconds < 3600) {
          queueOverheadDurations.push({ type: row.type, seconds: overheadSeconds })
        }
      }
    }
  }

  const emailMap: Record<string, string> = {}
  if (failedUserIds.size > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', Array.from(failedUserIds))

    if (profilesError) {
      throw new Error(profilesError.message)
    }

    for (const row of profiles ?? []) {
      if (row.id) {
        emailMap[row.id] = row.email ?? '—'
      }
    }
  }

  const jobById = new Map(((jobs ?? []) as JobRow[]).map((row) => [row.id, row]))
  for (const failed of recentFailed) {
    const row = jobById.get(failed.id)
    if (row?.user_id) {
      failed.user_email = emailMap[row.user_id] ?? undefined
    }
  }

  const processing = ((processingJobs ?? []) as ProcessingRow[]).map((row) => ({
    id: row.id,
    type: row.type,
    created_at: row.created_at,
    age_min: Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000),
  }))

  const topErrorCodes = Object.entries(byErrorCode)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 5)
    .map(([code, count]) => ({ code, count }))

  const failedByType = Object.entries(failedByTypeMap)
    .sort(([, left], [, right]) => right - left)
    .map(([type, count]) => ({ type, count }))

  // Submission failures (pre-queue)
  const submissionFailureUserIds = new Set<string>()
  const recentSubmissionFailures: SubmissionFailure[] = ((submissionEvents ?? []) as Array<{
    id: string; user_id: string; trace_id: string; studio_type: string
    error_code: string | null; error_message: string | null; created_at: string
    metadata: Record<string, unknown> | null
  }>).map((e) => {
    if (e.user_id) submissionFailureUserIds.add(e.user_id)
    return {
      id: e.id,
      user_id: e.user_id,
      trace_id: e.trace_id,
      studio_type: e.studio_type,
      error_code: e.error_code,
      error_message: e.error_message,
      created_at: e.created_at,
      metadata: e.metadata ?? undefined,
    }
  })

  // Resolve emails for submission failure users
  const allUnresolvedUserIds = Array.from(submissionFailureUserIds).filter((uid) => !emailMap[uid])
  if (allUnresolvedUserIds.length > 0) {
    const { data: extraProfiles } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', allUnresolvedUserIds)
    for (const row of extraProfiles ?? []) {
      if (row.id) emailMap[row.id] = row.email ?? '—'
    }
  }
  for (const sf of recentSubmissionFailures) {
    sf.user_email = emailMap[sf.user_id] ?? undefined
  }

  // Generation drought: how long since last IMAGE_GEN / STYLE_REPLICATE
  const lastGenRow = (latestGenJobs ?? [])[0] as { created_at: string } | undefined
  const lastImageGenOrStyleReplicateAt = lastGenRow?.created_at ?? null
  const minutesSinceLastGeneration = lastImageGenOrStyleReplicateAt
    ? Math.round((nowMs - new Date(lastImageGenOrStyleReplicateAt).getTime()) / 60000)
    : null

  const total = (jobs ?? []).length
  const successCount = byStatus.success ?? 0
  const failedCount = byStatus.failed ?? 0
  const processingCount = byStatus.processing ?? 0
  const stuckJobs = processing.filter((row) => row.age_min >= JOB_HEALTH_STUCK_JOB_AGE_MINUTES)

  return {
    hours,
    since: windowStart,
    windowStart,
    windowEnd,
    windowBucketStart: getBucketStart(nowMs, JOB_HEALTH_MONITOR_WINDOW_MINUTES),
    total,
    successCount,
    failedCount,
    processingCount,
    successRate: total > 0 ? Math.round((successCount / total) * 1000) / 10 : 0,
    byStatus,
    byTypeStatus,
    byErrorCode,
    durationStats: buildDurationStats(executionDurations),
    wallClockStats: buildDurationStats(wallClockDurations),
    queueOverheadStats: buildDurationStats(queueOverheadDurations),
    recentFailed: recentFailed.slice(0, 50),
    processing,
    stuckJobs,
    topErrorCodes,
    failedByType,
    submissionFailureCount: recentSubmissionFailures.length,
    recentSubmissionFailures: recentSubmissionFailures.slice(0, 30),
    lastImageGenOrStyleReplicateAt,
    minutesSinceLastGeneration,
  }
}

function buildIncidentFingerprint(
  type: JobHealthIncidentType,
  windowBucketStart: string,
  primaryKey: string
) {
  return [type, windowBucketStart, primaryKey].join(':')
}

export function detectJobHealthIncident(snapshot: JobHealthSnapshot): JobHealthIncident | null {
  // HIGHEST PRIORITY: pre-queue submission failures (invisible to job-level monitoring)
  if (snapshot.submissionFailureCount >= JOB_HEALTH_MIN_SUBMISSION_FAILURES) {
    const topError = snapshot.recentSubmissionFailures[0]?.error_code ?? 'UNKNOWN'
    const primaryKey = `${topError}:${snapshot.submissionFailureCount}`
    return {
      type: 'submission_failures',
      primaryKey,
      fingerprint: buildIncidentFingerprint('submission_failures', snapshot.windowBucketStart, primaryKey),
      summary: `排队前提交失败 ${snapshot.submissionFailureCount} 次（${topError}）— 这些错误不会出现在 generation_jobs 中`,
    }
  }

  // Generation drought: ANALYSIS jobs exist but no IMAGE_GEN/STYLE_REPLICATE for too long
  if (
    snapshot.minutesSinceLastGeneration !== null &&
    snapshot.minutesSinceLastGeneration >= JOB_HEALTH_MIN_GENERATION_DROUGHT_MINUTES &&
    (snapshot.byTypeStatus['ANALYSIS/success'] ?? 0) > 0
  ) {
    const primaryKey = String(snapshot.minutesSinceLastGeneration)
    return {
      type: 'generation_drought',
      primaryKey,
      fingerprint: buildIncidentFingerprint('generation_drought', snapshot.windowBucketStart, primaryKey),
      summary: `已 ${snapshot.minutesSinceLastGeneration} 分钟没有 IMAGE_GEN/STYLE_REPLICATE 任务，但有 ANALYSIS 成功 — 可能出图入队全部失败`,
    }
  }

  if (snapshot.total >= JOB_HEALTH_MIN_SAMPLE_SIZE && snapshot.successRate < JOB_HEALTH_MIN_SUCCESS_RATE) {
    const primaryKey = `${snapshot.successRate.toFixed(1)}`
    return {
      type: 'success_rate',
      primaryKey,
      fingerprint: buildIncidentFingerprint('success_rate', snapshot.windowBucketStart, primaryKey),
      summary: `最近 15 分钟成功率降到 ${snapshot.successRate.toFixed(1)}%（${snapshot.successCount}/${snapshot.total}）`,
    }
  }

  const imageGenFailed = snapshot.failedByType.find((item) => item.type === 'IMAGE_GEN')?.count ?? 0
  if (imageGenFailed >= JOB_HEALTH_MIN_IMAGE_GEN_FAILURES) {
    const primaryKey = snapshot.topErrorCodes[0]?.code ?? 'IMAGE_GEN'
    return {
      type: 'image_gen_failures',
      primaryKey,
      fingerprint: buildIncidentFingerprint('image_gen_failures', snapshot.windowBucketStart, primaryKey),
      summary: `最近 15 分钟 IMAGE_GEN 失败 ${imageGenFailed} 次`,
    }
  }

  if (snapshot.stuckJobs.length >= JOB_HEALTH_MIN_STUCK_JOBS) {
    const primaryKey = String(snapshot.stuckJobs.length)
    return {
      type: 'stuck_jobs',
      primaryKey,
      fingerprint: buildIncidentFingerprint('stuck_jobs', snapshot.windowBucketStart, primaryKey),
      summary: `${snapshot.stuckJobs.length} 个 processing 任务超过 ${JOB_HEALTH_STUCK_JOB_AGE_MINUTES} 分钟`,
    }
  }

  const topError = snapshot.topErrorCodes[0]
  if (topError && topError.count >= JOB_HEALTH_MIN_ERROR_CODE_SPIKE) {
    return {
      type: 'error_code_spike',
      primaryKey: topError.code,
      fingerprint: buildIncidentFingerprint('error_code_spike', snapshot.windowBucketStart, topError.code),
      summary: `错误码 ${topError.code} 在最近 15 分钟出现 ${topError.count} 次`,
    }
  }

  return null
}

export function shouldSendMonitorAlert(
  currentState: JobHealthMonitorState,
  incident: JobHealthIncident,
  nowMs: number
) {
  if (currentState.lastIncidentFingerprint !== incident.fingerprint) {
    return true
  }

  const cooldownUntilMs = currentState.cooldownUntil ? new Date(currentState.cooldownUntil).getTime() : 0
  return !cooldownUntilMs || cooldownUntilMs <= nowMs
}

export function buildMonitorStateUpdate(
  currentState: JobHealthMonitorState,
  nowIso: string,
  incident: JobHealthIncident | null,
  options?: { alertSent?: boolean }
): JobHealthMonitorState {
  const nextState: JobHealthMonitorState = {
    ...currentState,
    lastCheckedAt: nowIso,
  }

  if (!incident) {
    return nextState
  }

  nextState.lastIncidentFingerprint = incident.fingerprint
  nextState.lastIncidentType = incident.type
  nextState.lastAlertSummary = incident.summary

  if (options?.alertSent) {
    nextState.lastAlertSentAt = nowIso
    nextState.cooldownUntil = new Date(
      new Date(nowIso).getTime() + JOB_HEALTH_MONITOR_COOLDOWN_MINUTES * 60 * 1000
    ).toISOString()
  }

  return nextState
}
