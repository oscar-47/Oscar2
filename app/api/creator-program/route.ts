import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isCreatorProgramPlatform } from '@/lib/creator-program'
import {
  SUPPORT_FEEDBACK_EXTENDED_SELECT,
  isCreatorProgramRewardsSchemaError,
  isSupportFeedbackExtendedSchemaError,
  normalizeSupportFeedbackRow,
} from '@/lib/support-feedback'
import type { CreatorProgramRewardRow, SupportFeedback } from '@/types'

type CreatorProgramRow = SupportFeedback & {
  rewards: CreatorProgramRewardRow[]
}

function normalizeLine(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizePublishedAt(value: unknown) {
  const raw = normalizeLine(value)
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function buildDefaultMessage(input: {
  contentUrl: string
  platform: string
  publishedAt: string
  note: string
}) {
  const lines = [
    'Creator program submission',
    `Link: ${input.contentUrl}`,
    `Platform: ${input.platform}`,
    `Published at: ${input.publishedAt}`,
  ]

  if (input.note) {
    lines.push(`Note: ${input.note}`)
  }

  return lines.join('\n')
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return user
}

export async function GET() {
  const user = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: feedbackRows, error: feedbackError } = await admin
    .from('support_feedback')
    .select(SUPPORT_FEEDBACK_EXTENDED_SELECT)
    .eq('user_id', user.id)
    .eq('category', 'creator_program')
    .order('created_at', { ascending: false })

  if (feedbackError) {
    if (isSupportFeedbackExtendedSchemaError(feedbackError.message)) {
      return NextResponse.json({ rows: [], schemaReady: false })
    }
    return NextResponse.json({ error: feedbackError.message }, { status: 500 })
  }

  const feedbacks = (feedbackRows ?? []).map((row) =>
    normalizeSupportFeedbackRow(row),
  ) as SupportFeedback[]
  const feedbackIds = feedbacks.map((item) => item.id)

  let rewards: CreatorProgramRewardRow[] = []
  if (feedbackIds.length > 0) {
    const { data: rewardRows, error: rewardError } = await admin
      .from('creator_program_rewards')
      .select(
        'id,feedback_id,user_id,stage,metric_type,metric_value,reward_credits,transaction_id,admin_note,email_sent_at,email_error,created_at',
      )
      .in('feedback_id', feedbackIds)
      .order('created_at', { ascending: false })

    if (rewardError) {
      if (isCreatorProgramRewardsSchemaError(rewardError.message)) {
        return NextResponse.json({ rows: [], schemaReady: false })
      }
      return NextResponse.json({ error: rewardError.message }, { status: 500 })
    }

    rewards = (rewardRows ?? []) as CreatorProgramRewardRow[]
  }

  const rewardsByFeedbackId = rewards.reduce<Record<string, CreatorProgramRewardRow[]>>(
    (acc, item) => {
      acc[item.feedback_id] ??= []
      acc[item.feedback_id].push(item)
      return acc
    },
    {},
  )

  const rows: CreatorProgramRow[] = feedbacks.map((item) => ({
    ...item,
    rewards: rewardsByFeedbackId[item.id] ?? [],
  }))

  return NextResponse.json({ rows, schemaReady: true })
}

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    contentUrl?: unknown
    platform?: unknown
    publishedAt?: unknown
    message?: unknown
  } | null

  const contentUrl = normalizeLine(body?.contentUrl)
  const platform = normalizeLine(body?.platform) || 'other'
  const publishedAt = normalizePublishedAt(body?.publishedAt)
  const note = normalizeLine(body?.message)

  if (!contentUrl || !isValidHttpUrl(contentUrl)) {
    return NextResponse.json({ error: 'CONTENT_URL_INVALID' }, { status: 400 })
  }

  if (!publishedAt) {
    return NextResponse.json({ error: 'PUBLISHED_AT_REQUIRED' }, { status: 400 })
  }

  if (!isCreatorProgramPlatform(platform)) {
    return NextResponse.json({ error: 'PLATFORM_INVALID' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('support_feedback')
    .insert({
      user_id: user.id,
      message: buildDefaultMessage({
        contentUrl,
        platform,
        publishedAt,
        note,
      }),
      attachments: [],
      category: 'creator_program',
      creator_content_url: contentUrl,
      creator_platform: platform,
      creator_published_at: publishedAt,
      status: 'open',
    })
    .select(SUPPORT_FEEDBACK_EXTENDED_SELECT)
    .single()

  if (error) {
    if (isSupportFeedbackExtendedSchemaError(error.message)) {
      return NextResponse.json({ error: 'FEATURE_UNAVAILABLE' }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      row: {
        ...normalizeSupportFeedbackRow(data ?? {}),
        rewards: [],
      },
    },
    { status: 201 },
  )
}
