import { NextRequest, NextResponse } from 'next/server'
import { sendResendEmail, getDefaultSupportReplyTo, getHealthAlertFromAddress } from '@/lib/email/resend'
import {
  buildMonitorStateUpdate,
  detectJobHealthIncident,
  getJobHealthMonitorState,
  getJobHealthSnapshot,
  shouldSendMonitorAlert,
  saveJobHealthMonitorState,
  type JobHealthIncident,
  type JobHealthSnapshot,
} from '@/lib/job-health-monitor'
import { getLocalizedUrl } from '@/lib/site'
import { createAdminClient } from '@/lib/supabase/admin'
import { ADMIN_EMAIL_LIST } from '@/types'

function getAuthorizedSecrets() {
  return [process.env.HEALTH_MONITOR_SECRET?.trim(), process.env.CRON_SECRET?.trim()].filter(
    (value): value is string => Boolean(value)
  )
}

function isAuthorized(request: NextRequest) {
  const secrets = getAuthorizedSecrets()
  if (!secrets.length) return false

  const authorization = request.headers.get('authorization')?.trim()
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const headerToken = request.headers.get('x-health-monitor-secret')?.trim() || ''

  return secrets.includes(bearerToken) || secrets.includes(headerToken)
}

function formatTimeRange(snapshot: JobHealthSnapshot) {
  return `${snapshot.windowStart} -> ${snapshot.windowEnd}`
}

function formatIncidentLabel(incident: JobHealthIncident) {
  switch (incident.type) {
    case 'success_rate':
      return '成功率异常'
    case 'image_gen_failures':
      return 'IMAGE_GEN 失败激增'
    case 'stuck_jobs':
      return 'processing 任务卡住'
    case 'error_code_spike':
      return '错误码集中爆发'
    case 'submission_failures':
      return '排队前提交失败'
    case 'generation_drought':
      return '出图中断'
    default:
      return incident.type
  }
}

function buildAlertSubject(snapshot: JobHealthSnapshot, incident: JobHealthIncident) {
  if (incident.type === 'success_rate') {
    return `[Shopix Alert] 生成成功率异常 / 15m success ${snapshot.successRate.toFixed(1)}%`
  }

  return `[Shopix Alert] ${formatIncidentLabel(incident)} / 15m failed ${snapshot.failedCount}`
}

function buildAlertText(snapshot: JobHealthSnapshot, incident: JobHealthIncident) {
  const topErrors = snapshot.topErrorCodes.length
    ? snapshot.topErrorCodes.map((item) => `${item.code}=${item.count}`).join(', ')
    : '无'
  const failedByType = snapshot.failedByType.length
    ? snapshot.failedByType.map((item) => `${item.type}=${item.count}`).join(', ')
    : '无'
  const stuckPreview = snapshot.stuckJobs.length
    ? snapshot.stuckJobs.slice(0, 5).map((item) => `${item.id.slice(0, 8)} ${item.type} ${item.age_min}min`).join('\n')
    : '无'
  const submissionPreview = snapshot.recentSubmissionFailures.length
    ? snapshot.recentSubmissionFailures.slice(0, 5).map((item) => `${item.studio_type} ${item.error_code ?? '?'} ${item.user_email ?? item.user_id.slice(0, 8)}`).join('\n')
    : '无'

  return [
    'Shopix 生成健康监控发现异常。',
    '',
    `命中规则: ${formatIncidentLabel(incident)}`,
    `摘要: ${incident.summary}`,
    `时间窗口: ${formatTimeRange(snapshot)}`,
    `成功率: ${snapshot.successRate.toFixed(1)}%`,
    `总任务数: ${snapshot.total}`,
    `成功数: ${snapshot.successCount}`,
    `失败数: ${snapshot.failedCount}`,
    `处理中: ${snapshot.processingCount}`,
    `卡住任务数: ${snapshot.stuckJobs.length}`,
    `排队前提交失败: ${snapshot.submissionFailureCount}`,
    `距上次出图: ${snapshot.minutesSinceLastGeneration != null ? `${snapshot.minutesSinceLastGeneration} 分钟` : '—'}`,
    `Top error codes: ${topErrors}`,
    `Failed by type: ${failedByType}`,
    '',
    'Stuck jobs:',
    stuckPreview,
    '',
    '排队前提交失败:',
    submissionPreview,
    '',
    `后台健康页: ${getLocalizedUrl('zh', '/job-health')}`,
  ].join('\n')
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const admin = createAdminClient()
  const snapshot = await getJobHealthSnapshot(admin, 0.25)
  const currentState = await getJobHealthMonitorState(admin)
  const incident = detectJobHealthIncident(snapshot)
  const nowIso = new Date().toISOString()
  const shouldSend = incident ? shouldSendMonitorAlert(currentState, incident, Date.now()) : false
  let alertSent = false
  let alertError: string | null = null

  if (incident && shouldSend) {
    try {
      await sendResendEmail({
        from: getHealthAlertFromAddress(),
        to: [...ADMIN_EMAIL_LIST],
        subject: buildAlertSubject(snapshot, incident),
        text: buildAlertText(snapshot, incident),
        replyTo: getDefaultSupportReplyTo(),
      })
      alertSent = true
    } catch (error) {
      alertError = error instanceof Error ? error.message : 'Unknown error'
    }
  }

  const nextState = buildMonitorStateUpdate(currentState, nowIso, incident, { alertSent })
  const monitor = await saveJobHealthMonitorState(admin, nextState)

  return NextResponse.json({
    ok: true,
    status: !incident
      ? 'healthy'
      : alertSent
      ? 'alert_sent'
      : shouldSend
      ? 'alert_failed'
      : 'cooldown',
    incident,
    alertSent,
    alertError,
    snapshot,
    monitor,
  })
}
