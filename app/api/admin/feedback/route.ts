import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/types'
import { SUPPORT_FEEDBACK_EXTENDED_SELECT, normalizeSupportFeedbackReply } from '@/lib/support-feedback'
import { isCreatorProgramStage, isCreatorProgramMetricType } from '@/lib/creator-program'

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user || !isAdminUser(user.email)) return null
  return user
}

// ---------------------------------------------------------------------------
// GET  /api/admin/feedback?category=general|creator_program
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const admin = createAdminClient()
  const url = new URL(request.url)
  const category = url.searchParams.get('category') // optional

  try {
    let query = admin
      .from('support_feedback')
      .select(`${SUPPORT_FEEDBACK_EXTENDED_SELECT}, profiles!inner(email)`)
      .order('created_at', { ascending: false })

    if (category === 'general' || category === 'creator_program') {
      query = query.eq('category', category)
    }

    const { data: rows, error: queryError } = await query

    if (queryError) {
      return NextResponse.json({ error: queryError.message }, { status: 500 })
    }

    // For creator_program rows, also fetch rewards
    let rewardsByFeedbackId: Record<string, unknown[]> = {}
    if (!category || category === 'creator_program') {
      const creatorFeedbackIds = (rows ?? [])
        .filter((r: Record<string, unknown>) => r.category === 'creator_program')
        .map((r: Record<string, unknown>) => r.id as string)

      if (creatorFeedbackIds.length > 0) {
        const { data: rewards } = await admin
          .from('creator_program_rewards')
          .select('*')
          .in('feedback_id', creatorFeedbackIds)
          .order('created_at', { ascending: false })

        if (rewards) {
          for (const reward of rewards) {
            const fid = (reward as Record<string, unknown>).feedback_id as string
            if (!rewardsByFeedbackId[fid]) rewardsByFeedbackId[fid] = []
            rewardsByFeedbackId[fid].push(reward)
          }
        }
      }
    }

    // Flatten the joined profile email into each row
    const enriched = (rows ?? []).map((row: Record<string, unknown>) => {
      const profiles = row.profiles as { email?: string } | null
      const email = profiles?.email ?? null
      const { profiles: _unused, ...rest } = row
      void _unused
      return {
        ...rest,
        user_email: email,
        rewards: rewardsByFeedbackId[row.id as string] ?? [],
      }
    })

    return NextResponse.json({ rows: enriched })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// PATCH  /api/admin/feedback   — reply to a feedback
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const admin = createAdminClient()

  try {
    const body = (await request.json()) as { id?: string; adminReply?: string }
    const { id, adminReply } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 })
    }

    const normalized = normalizeSupportFeedbackReply(adminReply)
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 })
    }

    const { data: updated, error: updateError } = await admin
      .from('support_feedback')
      .update({
        admin_reply: normalized.value,
        admin_replied_at: new Date().toISOString(),
        admin_replied_by: user.email,
        status: 'replied',
      })
      .eq('id', id)
      .select(SUPPORT_FEEDBACK_EXTENDED_SELECT)
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ row: updated })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST  /api/admin/feedback   — issue creator program reward
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const admin = createAdminClient()

  try {
    const body = (await request.json()) as {
      feedbackId?: string
      userId?: string
      stage?: string
      metricType?: string
      metricValue?: number
      rewardCredits?: number
      adminNote?: string
    }

    const { feedbackId, userId, stage, metricType, metricValue, rewardCredits, adminNote } = body

    if (!feedbackId || typeof feedbackId !== 'string') {
      return NextResponse.json({ error: 'MISSING_FEEDBACK_ID' }, { status: 400 })
    }
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'MISSING_USER_ID' }, { status: 400 })
    }
    if (!stage || !isCreatorProgramStage(stage)) {
      return NextResponse.json({ error: 'INVALID_STAGE' }, { status: 400 })
    }
    if (!metricType || !isCreatorProgramMetricType(metricType)) {
      return NextResponse.json({ error: 'INVALID_METRIC_TYPE' }, { status: 400 })
    }
    if (typeof metricValue !== 'number' || !Number.isFinite(metricValue) || metricValue < 0) {
      return NextResponse.json({ error: 'INVALID_METRIC_VALUE' }, { status: 400 })
    }
    if (typeof rewardCredits !== 'number' || !Number.isFinite(rewardCredits) || rewardCredits <= 0) {
      return NextResponse.json({ error: 'INVALID_REWARD_CREDITS' }, { status: 400 })
    }

    // Insert reward row
    const { data: reward, error: insertError } = await admin
      .from('creator_program_rewards')
      .insert({
        feedback_id: feedbackId,
        user_id: userId,
        stage,
        metric_type: metricType,
        metric_value: metricValue,
        reward_credits: rewardCredits,
        admin_note: adminNote?.trim() || null,
      })
      .select('*')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Add credits to user's purchased_credits
    const { error: creditError } = await admin.rpc('increment_purchased_credits', {
      p_user_id: userId,
      p_amount: rewardCredits,
    }).single()

    // Fallback: if the RPC doesn't exist, do a raw update
    if (creditError) {
      const { data: profile } = await admin
        .from('profiles')
        .select('purchased_credits')
        .eq('id', userId)
        .single()

      if (profile) {
        await admin
          .from('profiles')
          .update({
            purchased_credits: (profile.purchased_credits ?? 0) + rewardCredits,
          })
          .eq('id', userId)
      }
    }

    // Update the feedback status to 'replied' if not already
    await admin
      .from('support_feedback')
      .update({ status: 'replied' })
      .eq('id', feedbackId)
      .eq('status', 'open')

    return NextResponse.json({ reward })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
