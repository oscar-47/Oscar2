'use client'

import { type PointerEvent, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { Crown, Sparkles } from 'lucide-react'

type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'trialing'
  | 'incomplete'
  | 'unpaid'
  | null

interface MembershipCardProps {
  profile: {
    email: string | null
    phone: string | null
    full_name: string | null
    subscription_plan: string | null
    subscription_status: SubscriptionStatus
    current_period_end: string | null
    subscription_credits: number
    purchased_credits: number
  } | null
  hasPaidHistory: boolean
  latestPaidAt: string | null
  latestTopupPlan: string | null
  topupPurchaseCount: number
}

type MembershipThemeKey =
  | 'free'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'topup_5'
  | 'topup_15'
  | 'topup_30'
  | 'topup'

type MembershipTheme = {
  shell: string
  border: string
  text: string
  muted: string
  accent: string
  accentSoft: string
  chip: string
  chipBorder: string
  chipText: string
  foil: string
  glow: string
  edgeGlow: string
  mark: string
  markBorder: string
  markText: string
  shadow: string
}

const SPRING = { stiffness: 260, damping: 28, mass: 0.7 }

const MEMBERSHIP_THEMES: Record<MembershipThemeKey, MembershipTheme> = {
  yearly: {
    shell: 'linear-gradient(145deg, rgba(18,17,16,0.99), rgba(33,29,25,0.99) 52%, rgba(57,48,35,0.98) 100%)',
    border: 'rgba(214, 181, 117, 0.42)',
    text: 'rgba(247, 238, 217, 0.98)',
    muted: 'rgba(222, 205, 171, 0.68)',
    accent: 'rgba(233, 197, 122, 0.98)',
    accentSoft: 'rgba(244, 221, 173, 0.15)',
    chip: 'rgba(255,255,255,0.055)',
    chipBorder: 'rgba(255,255,255,0.11)',
    chipText: 'rgba(245, 235, 214, 0.9)',
    foil: 'linear-gradient(90deg, rgba(254,232,188,0.95), rgba(208,156,54,0.95) 42%, rgba(255,244,214,0.55) 100%)',
    glow: 'rgba(227, 185, 101, 0.22)',
    edgeGlow: '0 0 28px rgba(227,185,101,0.25), inset 0 0 28px rgba(227,185,101,0.06)',
    mark: 'linear-gradient(145deg, rgba(255,244,214,0.95), rgba(228,187,105,0.92))',
    markBorder: 'rgba(255,255,255,0.2)',
    markText: 'rgba(71, 50, 16, 0.96)',
    shadow: '0 8px 40px rgba(24, 18, 10, 0.22)',
  },
  quarterly: {
    shell: 'linear-gradient(145deg, rgba(18,19,22,0.99), rgba(30,33,40,0.99) 50%, rgba(58,63,75,0.97) 100%)',
    border: 'rgba(180, 185, 198, 0.38)',
    text: 'rgba(240, 241, 244, 0.98)',
    muted: 'rgba(190, 194, 206, 0.68)',
    accent: 'rgba(200, 205, 220, 0.98)',
    accentSoft: 'rgba(200, 205, 220, 0.14)',
    chip: 'rgba(255,255,255,0.055)',
    chipBorder: 'rgba(255,255,255,0.11)',
    chipText: 'rgba(238, 240, 245, 0.9)',
    foil: 'linear-gradient(90deg, rgba(232,235,242,0.95), rgba(165,172,190,0.92) 40%, rgba(255,255,255,0.45) 100%)',
    glow: 'rgba(160, 168, 190, 0.22)',
    edgeGlow: '0 0 28px rgba(160,168,190,0.25), inset 0 0 28px rgba(160,168,190,0.06)',
    mark: 'linear-gradient(145deg, rgba(245,246,250,0.95), rgba(195,200,215,0.92))',
    markBorder: 'rgba(255,255,255,0.2)',
    markText: 'rgba(55, 60, 75, 0.98)',
    shadow: '0 8px 40px rgba(12, 14, 20, 0.22)',
  },
  monthly: {
    shell: 'linear-gradient(145deg, rgba(23,18,16,0.99), rgba(44,30,26,0.99) 52%, rgba(82,58,46,0.97) 100%)',
    border: 'rgba(209, 155, 120, 0.34)',
    text: 'rgba(248, 237, 229, 0.98)',
    muted: 'rgba(218, 194, 182, 0.68)',
    accent: 'rgba(228, 172, 136, 0.98)',
    accentSoft: 'rgba(228, 172, 136, 0.15)',
    chip: 'rgba(255,255,255,0.055)',
    chipBorder: 'rgba(255,255,255,0.1)',
    chipText: 'rgba(247, 237, 231, 0.9)',
    foil: 'linear-gradient(90deg, rgba(252,224,206,0.95), rgba(212,147,110,0.92) 44%, rgba(255,236,214,0.45) 100%)',
    glow: 'rgba(212, 141, 101, 0.22)',
    edgeGlow: '0 0 28px rgba(212,141,101,0.25), inset 0 0 28px rgba(212,141,101,0.06)',
    mark: 'linear-gradient(145deg, rgba(255,245,240,0.95), rgba(233,191,163,0.92))',
    markBorder: 'rgba(255,255,255,0.18)',
    markText: 'rgba(95, 57, 34, 0.98)',
    shadow: '0 8px 40px rgba(26, 14, 10, 0.22)',
  },
  topup_30: {
    shell: 'linear-gradient(145deg, rgba(22,17,14,0.99), rgba(36,28,23,0.99) 52%, rgba(71,57,44,0.97) 100%)',
    border: 'rgba(203, 171, 130, 0.34)',
    text: 'rgba(248, 239, 227, 0.98)',
    muted: 'rgba(214, 198, 176, 0.68)',
    accent: 'rgba(224, 188, 140, 0.98)',
    accentSoft: 'rgba(224, 188, 140, 0.14)',
    chip: 'rgba(255,255,255,0.052)',
    chipBorder: 'rgba(255,255,255,0.1)',
    chipText: 'rgba(245, 236, 224, 0.9)',
    foil: 'linear-gradient(90deg, rgba(248,225,194,0.95), rgba(199,154,98,0.92) 40%, rgba(255,239,213,0.42) 100%)',
    glow: 'rgba(202, 157, 104, 0.2)',
    edgeGlow: '0 0 28px rgba(202,157,104,0.22), inset 0 0 28px rgba(202,157,104,0.06)',
    mark: 'linear-gradient(145deg, rgba(255,246,236,0.95), rgba(229,205,178,0.92))',
    markBorder: 'rgba(255,255,255,0.18)',
    markText: 'rgba(88, 64, 42, 0.98)',
    shadow: '0 8px 40px rgba(24, 17, 12, 0.2)',
  },
  topup_15: {
    shell: 'linear-gradient(145deg, rgba(18,19,22,0.99), rgba(30,33,40,0.99) 52%, rgba(58,63,75,0.97) 100%)',
    border: 'rgba(180, 185, 198, 0.38)',
    text: 'rgba(240, 241, 244, 0.98)',
    muted: 'rgba(190, 194, 206, 0.68)',
    accent: 'rgba(200, 205, 220, 0.98)',
    accentSoft: 'rgba(200, 205, 220, 0.14)',
    chip: 'rgba(255,255,255,0.055)',
    chipBorder: 'rgba(255,255,255,0.11)',
    chipText: 'rgba(238, 240, 245, 0.9)',
    foil: 'linear-gradient(90deg, rgba(232,235,242,0.95), rgba(165,172,190,0.92) 40%, rgba(255,255,255,0.45) 100%)',
    glow: 'rgba(160, 168, 190, 0.22)',
    edgeGlow: '0 0 28px rgba(160,168,190,0.25), inset 0 0 28px rgba(160,168,190,0.06)',
    mark: 'linear-gradient(145deg, rgba(245,246,250,0.95), rgba(195,200,215,0.92))',
    markBorder: 'rgba(255,255,255,0.2)',
    markText: 'rgba(55, 60, 75, 0.98)',
    shadow: '0 8px 40px rgba(12, 14, 20, 0.2)',
  },
  topup_5: {
    shell: 'linear-gradient(145deg, rgba(14,17,23,0.99), rgba(22,28,40,0.99) 52%, rgba(41,52,76,0.97) 100%)',
    border: 'rgba(151, 175, 224, 0.34)',
    text: 'rgba(237, 243, 252, 0.98)',
    muted: 'rgba(184, 197, 219, 0.68)',
    accent: 'rgba(178, 198, 244, 0.98)',
    accentSoft: 'rgba(178, 198, 244, 0.14)',
    chip: 'rgba(255,255,255,0.05)',
    chipBorder: 'rgba(255,255,255,0.098)',
    chipText: 'rgba(236, 242, 250, 0.88)',
    foil: 'linear-gradient(90deg, rgba(221,232,252,0.95), rgba(145,173,231,0.92) 42%, rgba(254,230,191,0.35) 100%)',
    glow: 'rgba(113, 145, 216, 0.2)',
    edgeGlow: '0 0 28px rgba(113,145,216,0.22), inset 0 0 28px rgba(113,145,216,0.06)',
    mark: 'linear-gradient(145deg, rgba(239,244,255,0.95), rgba(188,206,243,0.92))',
    markBorder: 'rgba(255,255,255,0.18)',
    markText: 'rgba(53, 73, 116, 0.98)',
    shadow: '0 8px 40px rgba(9, 13, 22, 0.22)',
  },
  topup: {
    shell: 'linear-gradient(145deg, rgba(19,19,18,0.99), rgba(34,32,29,0.99) 52%, rgba(62,57,49,0.97) 100%)',
    border: 'rgba(184, 172, 152, 0.34)',
    text: 'rgba(244, 239, 233, 0.98)',
    muted: 'rgba(209, 200, 187, 0.68)',
    accent: 'rgba(219, 194, 154, 0.98)',
    accentSoft: 'rgba(219, 194, 154, 0.14)',
    chip: 'rgba(255,255,255,0.05)',
    chipBorder: 'rgba(255,255,255,0.098)',
    chipText: 'rgba(242, 238, 232, 0.88)',
    foil: 'linear-gradient(90deg, rgba(244,232,212,0.93), rgba(180,164,132,0.92) 44%, rgba(255,240,219,0.35) 100%)',
    glow: 'rgba(181, 160, 124, 0.2)',
    edgeGlow: '0 0 28px rgba(181,160,124,0.22), inset 0 0 28px rgba(181,160,124,0.06)',
    mark: 'linear-gradient(145deg, rgba(249,245,239,0.95), rgba(216,206,189,0.92))',
    markBorder: 'rgba(255,255,255,0.18)',
    markText: 'rgba(82, 71, 55, 0.98)',
    shadow: '0 8px 40px rgba(16, 15, 11, 0.2)',
  },
  free: {
    shell: 'linear-gradient(145deg, rgba(250,248,245,0.99), rgba(242,238,232,0.99) 52%, rgba(235,232,226,0.97) 100%)',
    border: 'rgba(199, 188, 173, 0.52)',
    text: 'rgba(49, 42, 35, 0.96)',
    muted: 'rgba(108, 98, 88, 0.72)',
    accent: 'rgba(123, 108, 89, 0.98)',
    accentSoft: 'rgba(123, 108, 89, 0.08)',
    chip: 'rgba(255,255,255,0.58)',
    chipBorder: 'rgba(187,178,165,0.52)',
    chipText: 'rgba(69, 59, 47, 0.9)',
    foil: 'linear-gradient(90deg, rgba(126,110,91,0.9), rgba(198,172,124,0.72) 50%, rgba(255,255,255,0.45) 100%)',
    glow: 'rgba(202, 178, 136, 0.18)',
    edgeGlow: '0 0 22px rgba(202,178,136,0.14), inset 0 0 22px rgba(202,178,136,0.04)',
    mark: 'linear-gradient(145deg, rgba(255,253,250,0.96), rgba(230,222,211,0.96))',
    markBorder: 'rgba(196,188,176,0.62)',
    markText: 'rgba(86, 74, 60, 0.96)',
    shadow: '0 6px 32px rgba(44, 35, 24, 0.08)',
  },
}

function resolveThemeKey(
  subscriptionPlan: string | null | undefined,
  latestTopupPlan: string | null | undefined,
  hasPaidHistory: boolean,
): MembershipThemeKey {
  if (subscriptionPlan === 'yearly' || subscriptionPlan === 'quarterly' || subscriptionPlan === 'monthly') {
    return subscriptionPlan
  }
  if (latestTopupPlan === 'topup_30' || latestTopupPlan === 'topup_15' || latestTopupPlan === 'topup_5') {
    return latestTopupPlan
  }
  if (hasPaidHistory) return 'topup'
  return 'free'
}

function subscriptionPlanLabel(
  plan: string | null | undefined,
  t: ReturnType<typeof useTranslations<'profile'>>,
) {
  switch (plan) {
    case 'monthly':
      return t('planNames.monthly')
    case 'quarterly':
      return t('planNames.quarterly')
    case 'yearly':
      return t('planNames.yearly')
    default:
      return t('noPlan')
  }
}

function topupPlanLabel(plan: string | null | undefined, isZh: boolean) {
  if (!plan) return isZh ? '积分卡' : 'Credit Pass'
  if (plan.startsWith('topup_')) {
    const amount = plan.slice('topup_'.length)
    return isZh ? `充值 $${amount}` : `Top-up $${amount}`
  }
  return plan
}

function formatNumber(locale: string, value: number) {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(value)
}

export function MembershipCard({
  profile,
  hasPaidHistory,
  latestTopupPlan,
}: MembershipCardProps) {
  const t = useTranslations('profile')
  const locale = useLocale()
  const isZh = locale === 'zh'
  const reduceMotion = useReducedMotion()
  const cardRef = useRef<HTMLDivElement | null>(null)

  const rotateX = useSpring(0, SPRING)
  const rotateY = useSpring(0, SPRING)
  const glowX = useMotionValue(50)
  const glowY = useMotionValue(50)

  const themeKey = resolveThemeKey(profile?.subscription_plan, latestTopupPlan, hasPaidHistory)
  const theme = MEMBERSHIP_THEMES[themeKey]
  const displayName = profile?.full_name?.trim() || profile?.email?.split('@')[0] || profile?.phone || 'Shopix'
  const subscriptionCredits = profile?.subscription_credits ?? 0
  const purchasedCredits = profile?.purchased_credits ?? 0
  const totalCredits = subscriptionCredits + purchasedCredits
  const hasSubscription = Boolean(profile?.subscription_plan)
  const isPaidMember = hasPaidHistory || hasSubscription
  const title = hasSubscription
    ? subscriptionPlanLabel(profile?.subscription_plan, t)
    : isPaidMember
      ? topupPlanLabel(latestTopupPlan, isZh)
      : t('membershipCard.freeTitle')
  const tierLabel = hasSubscription
    ? t('membershipCard.subscriptionTier')
    : isPaidMember
      ? t('membershipCard.tokenTier')
      : t('membershipCard.freeTier')

  const cardGlow = useMotionTemplate`radial-gradient(ellipse at ${glowX}% ${glowY}%, ${theme.glow}, transparent 50%)`

  function resetMotion() {
    rotateX.set(0)
    rotateY.set(0)
    glowX.set(50)
    glowY.set(50)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (reduceMotion || !cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    rotateX.set((py - 0.5) * -5)
    rotateY.set((px - 0.5) * 6)
    glowX.set(px * 100)
    glowY.set(py * 100)
  }

  const nanoBananaCount = Math.floor(totalCredits / 15)

  return (
    <motion.div
      ref={cardRef}
      data-membership-card
      className="relative aspect-[1.586/1] overflow-hidden rounded-[20px] border"
      style={{
        background: theme.shell,
        borderColor: theme.border,
        boxShadow: `${theme.shadow}, ${theme.edgeGlow}`,
        color: theme.text,
        rotateX,
        rotateY,
        transformStyle: 'preserve-3d',
        transformPerspective: 1200,
      }}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetMotion}
    >
      {/* Animated glow follow */}
      <motion.div className="pointer-events-none absolute inset-0" style={{ backgroundImage: cardGlow }} />
      {/* Top foil line */}
      <div className="absolute inset-x-5 top-3.5 h-px opacity-70" style={{ background: theme.foil }} />
      {/* Soft ambient blob */}
      <div className="absolute -left-8 -top-8 h-28 w-28 rounded-full blur-3xl" style={{ background: theme.accentSoft }} />
      <div className="absolute -bottom-6 -right-6 h-20 w-20 rounded-full blur-3xl opacity-60" style={{ background: theme.accentSoft }} />
      {/* Specular edge highlight — diagonal sweep */}
      <div className="pointer-events-none absolute inset-0 rounded-[20px] opacity-40 bg-[linear-gradient(125deg,rgba(255,255,255,0.18),transparent_28%,transparent_72%,rgba(255,255,255,0.05)_100%)]" />

      <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
        {/* ── Top row: EMV chip + network mark ── */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* EMV chip — simplified rectangles */}
            <div
              className="flex h-[26px] w-[34px] items-center justify-center rounded-[5px] border"
              style={{ background: theme.chip, borderColor: theme.chipBorder }}
            >
              <div className="grid grid-cols-3 gap-px">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-[3px] w-[5px] rounded-[0.5px]" style={{ background: theme.muted }} />
                ))}
              </div>
            </div>
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: theme.muted }}>
              {tierLabel}
            </span>
          </div>

          {/* Network mark — Shopix branding */}
          <div className="flex items-center gap-2">
            <span
              className="rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.22em]"
              style={{ borderColor: theme.chipBorder, background: theme.chip, color: theme.chipText }}
            >
              {isPaidMember ? 'PRO' : 'FREE'}
            </span>
            <span className="font-[var(--font-display)] text-[11px] font-extrabold tracking-[-0.02em]" style={{ color: theme.muted }}>
              Shopix
            </span>
          </div>
        </div>

        {/* ── Center: card number dots ── */}
        <div className="flex items-center gap-4 py-1" style={{ color: theme.muted }}>
          {[0, 1, 2].map((group) => (
            <span key={group} className="flex gap-[3px]">
              {[0, 1, 2, 3].map((dot) => (
                <span key={dot} className="inline-block h-[3px] w-[3px] rounded-full opacity-30" style={{ background: 'currentColor' }} />
              ))}
            </span>
          ))}
          <span className="text-[11px] font-medium tabular-nums tracking-[0.12em] opacity-40">
            {(totalCredits % 10000).toString().padStart(4, '0')}
          </span>
        </div>

        {/* ── Bottom: cardholder + balance ── */}
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-[var(--font-display)] text-[1.15rem] font-extrabold leading-none tracking-[-0.03em] sm:text-[1.3rem]">
              {title}
            </h2>
            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.08em]" style={{ color: theme.muted }}>
              {displayName}
            </p>
            {/* Nano Banana estimate */}
            {totalCredits > 0 && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] tabular-nums" style={{ color: theme.muted }}>
                <span>🍌</span>
                <span>
                  {isZh
                    ? `约 ${formatNumber(locale, nanoBananaCount)} 张 Nano Banana`
                    : `~${formatNumber(locale, nanoBananaCount)} Nano Banana images`}
                </span>
              </p>
            )}
          </div>

          {/* Credit balance */}
          <div className="shrink-0 text-right">
            <p className="font-[var(--font-display)] text-[1.4rem] font-extrabold leading-none tracking-[-0.04em] sm:text-[1.6rem]" style={{ color: theme.accent }}>
              {formatNumber(locale, totalCredits)}
            </p>
            <p className="mt-0.5 text-[9px] tracking-[0.06em]" style={{ color: theme.muted }}>
              {t('membershipCard.creditBalance')}
            </p>
            {/* Mini breakdown */}
            <div className="mt-1.5 flex gap-2">
              <span className="text-[8px] tabular-nums opacity-60" style={{ color: theme.chipText }}>
                {t('subscriptionCredits')} {formatNumber(locale, subscriptionCredits)}
              </span>
              <span className="text-[8px] tabular-nums opacity-60" style={{ color: theme.chipText }}>
                {t('purchasedCredits')} {formatNumber(locale, purchasedCredits)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

