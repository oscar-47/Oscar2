import type {
  CreatorProgramMetricType,
  CreatorProgramRewardRow,
  CreatorProgramStage,
} from '@/types'

export const CREATOR_PROGRAM_NAME = '小皮皮推荐官'

export const CREATOR_PROGRAM_3D_THRESHOLD = 20
export const CREATOR_PROGRAM_3D_REWARD = 30

export const CREATOR_PROGRAM_7D_TIERS = [
  { threshold: 5000, reward: 1600 },
  { threshold: 2000, reward: 1000 },
  { threshold: 200, reward: 150 },
] as const

export const CREATOR_PROGRAM_ALLOWED_PLATFORMS = [
  'douyin',
  'xiaohongshu',
  'kuaishou',
  'bilibili',
  'weibo',
  'wechat_video',
  'tiktok',
  'instagram',
  'youtube',
  'other',
] as const

export function isCreatorProgramMetricType(value: string): value is CreatorProgramMetricType {
  return value === 'like' || value === 'favorite'
}

export function isCreatorProgramStage(value: string): value is CreatorProgramStage {
  return value === '3d' || value === '7d'
}

export function isCreatorProgramPlatform(value: string) {
  return CREATOR_PROGRAM_ALLOWED_PLATFORMS.includes(
    value as (typeof CREATOR_PROGRAM_ALLOWED_PLATFORMS)[number],
  )
}

export function computeCreatorProgramReward(stage: CreatorProgramStage, metricValue: number) {
  if (!Number.isFinite(metricValue) || metricValue < 0) {
    return 0
  }

  if (stage === '3d') {
    return metricValue >= CREATOR_PROGRAM_3D_THRESHOLD ? CREATOR_PROGRAM_3D_REWARD : 0
  }

  for (const tier of CREATOR_PROGRAM_7D_TIERS) {
    if (metricValue >= tier.threshold) {
      return tier.reward
    }
  }

  return 0
}

export function buildCreatorProgramAutoReply(input: {
  isZh: boolean
  stage: CreatorProgramStage
  metricType: CreatorProgramMetricType
  metricValue: number
  rewardCredits: number
  adminNote?: string | null
}) {
  const metricLabel = input.isZh
    ? input.metricType === 'like' ? '点赞' : '收藏'
    : input.metricType === 'like' ? 'likes' : 'favorites'
  const stageLabel = input.isZh
    ? input.stage === '3d' ? '3天档' : '7天档'
    : input.stage === '3d' ? '3-day tier' : '7-day tier'
  const base = input.isZh
    ? `已审核通过，${stageLabel}按 ${input.metricValue} ${metricLabel} 发放 ${input.rewardCredits} 积分。`
    : `Approved. ${stageLabel} settled at ${input.metricValue} ${metricLabel} for ${input.rewardCredits} credits.`

  const note = input.adminNote?.trim()
  if (!note) return base
  return input.isZh ? `${base}\n\n补充说明：${note}` : `${base}\n\nNote: ${note}`
}

export function sumCreatorProgramRewards(rows: CreatorProgramRewardRow[]) {
  return rows.reduce((sum, row) => sum + row.reward_credits, 0)
}
