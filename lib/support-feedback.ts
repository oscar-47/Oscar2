import type {
  SupportFeedback,
  SupportFeedbackAttachment,
  SupportFeedbackCategory,
  SupportFeedbackStatus,
} from '@/types'

export const SUPPORT_FEEDBACK_MAX_ATTACHMENTS = 3
export const SUPPORT_FEEDBACK_MAX_MESSAGE_LENGTH = 2000
export const SUPPORT_FEEDBACK_MAX_REPLY_LENGTH = 2000
export const SUPPORT_FEEDBACK_LEGACY_SELECT =
  'id,user_id,message,attachments,status,admin_reply,admin_replied_at,admin_replied_by,user_seen_reply_at,created_at,updated_at'
export const SUPPORT_FEEDBACK_EXTENDED_SELECT =
  `${SUPPORT_FEEDBACK_LEGACY_SELECT},category,creator_content_url,creator_platform,creator_published_at`

export function isSupportFeedbackStatus(value: string): value is SupportFeedbackStatus {
  return value === 'open' || value === 'replied'
}

export function isSupportFeedbackCategory(value: string): value is SupportFeedbackCategory {
  return value === 'general' || value === 'creator_program'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTrimmedText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeSupportFeedbackMessage(value: unknown) {
  const message = readTrimmedText(value)
  if (!message) return { ok: false as const, error: 'MESSAGE_REQUIRED' as const }
  if (message.length > SUPPORT_FEEDBACK_MAX_MESSAGE_LENGTH) {
    return { ok: false as const, error: 'MESSAGE_TOO_LONG' as const }
  }
  return { ok: true as const, value: message }
}

export function normalizeSupportFeedbackReply(value: unknown) {
  const reply = readTrimmedText(value)
  if (!reply) return { ok: false as const, error: 'REPLY_REQUIRED' as const }
  if (reply.length > SUPPORT_FEEDBACK_MAX_REPLY_LENGTH) {
    return { ok: false as const, error: 'REPLY_TOO_LONG' as const }
  }
  return { ok: true as const, value: reply }
}

export function normalizeSupportFeedbackAttachments(value: unknown) {
  if (value == null) {
    return { ok: true as const, value: [] as SupportFeedbackAttachment[] }
  }

  if (!Array.isArray(value)) {
    return { ok: false as const, error: 'ATTACHMENTS_INVALID' as const }
  }

  if (value.length > SUPPORT_FEEDBACK_MAX_ATTACHMENTS) {
    return { ok: false as const, error: 'ATTACHMENTS_TOO_MANY' as const }
  }

  const attachments: SupportFeedbackAttachment[] = []
  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false as const, error: 'ATTACHMENTS_INVALID' as const }
    }

    const publicUrl = readTrimmedText(item.publicUrl)
    const path = readTrimmedText(item.path)
    const fileName = readTrimmedText(item.fileName) || null
    const mimeType = readTrimmedText(item.mimeType) || null
    const size = typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : null

    if (!publicUrl || !path) {
      return { ok: false as const, error: 'ATTACHMENTS_INVALID' as const }
    }

    attachments.push({
      publicUrl,
      path,
      fileName,
      mimeType,
      size,
    })
  }

  return { ok: true as const, value: attachments }
}

export function isUnreadSupportFeedbackReply(item: {
  admin_replied_at: string | null
  user_seen_reply_at: string | null
}) {
  if (!item.admin_replied_at) return false
  if (!item.user_seen_reply_at) return true
  return new Date(item.user_seen_reply_at).getTime() < new Date(item.admin_replied_at).getTime()
}

export function isSupportFeedbackExtendedSchemaError(message: string | null | undefined) {
  const normalized = message ?? ''
  return [
    'category',
    'creator_content_url',
    'creator_platform',
    'creator_published_at',
  ].some((field) => normalized.includes(field))
}

export function isCreatorProgramRewardsSchemaError(message: string | null | undefined) {
  return (message ?? '').includes('creator_program_rewards')
}

export function normalizeSupportFeedbackRow(
  row: Partial<SupportFeedback> & { attachments?: unknown },
): SupportFeedback {
  const attachments = normalizeSupportFeedbackAttachments(row.attachments)
  const hasCreatorFields =
    typeof row.creator_content_url === 'string' && row.creator_content_url.length > 0
  const category =
    typeof row.category === 'string' && isSupportFeedbackCategory(row.category)
      ? row.category
      : hasCreatorFields
        ? 'creator_program'
        : 'general'
  const status =
    typeof row.status === 'string' && isSupportFeedbackStatus(row.status) ? row.status : 'open'

  return {
    id: typeof row.id === 'string' ? row.id : '',
    user_id: typeof row.user_id === 'string' ? row.user_id : '',
    message: typeof row.message === 'string' ? row.message : '',
    attachments: attachments.ok ? attachments.value : [],
    category,
    creator_content_url:
      typeof row.creator_content_url === 'string' ? row.creator_content_url : null,
    creator_platform: typeof row.creator_platform === 'string' ? row.creator_platform : null,
    creator_published_at:
      typeof row.creator_published_at === 'string' ? row.creator_published_at : null,
    status,
    admin_reply: typeof row.admin_reply === 'string' ? row.admin_reply : null,
    admin_replied_at:
      typeof row.admin_replied_at === 'string' ? row.admin_replied_at : null,
    admin_replied_by:
      typeof row.admin_replied_by === 'string' ? row.admin_replied_by : null,
    user_seen_reply_at:
      typeof row.user_seen_reply_at === 'string' ? row.user_seen_reply_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  }
}
