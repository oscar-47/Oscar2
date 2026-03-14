'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCredits } from '@/lib/hooks/useCredits'
import { useSupportFeedbackUnreadCount } from '@/lib/hooks/useSupportFeedbackUnreadCount'
import { isAdminUser } from '@/types'
import { Activity, Clock, Coins, Crown, LogOut, User, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface UserMenuProps {
  userId: string
  email: string
}

export function UserMenu({ userId, email }: UserMenuProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const router = useRouter()
  const { total, isLoading, isPaidMember, subscriptionPlan } = useCredits(userId)
  const { count: unreadSupportReplies } = useSupportFeedbackUnreadCount(userId)
  const isAdmin = isAdminUser(email)
  const accountInitial = email.trim().charAt(0).toUpperCase() || 'S'
  const paidLabel = locale === 'zh' ? '付费用户' : 'Paid Member'
  const standardLabel = locale === 'zh' ? '创作账号' : 'Creator Account'

  // Plan-based avatar color tier: blue (monthly), silver (quarterly), gold (yearly/default paid)
  const avatarTier = subscriptionPlan === 'monthly' ? 'blue'
    : subscriptionPlan === 'quarterly' ? 'silver'
    : 'gold'
  const AVATAR_TIERS = {
    blue: {
      trigger: 'border-blue-300/70 bg-[linear-gradient(160deg,rgba(224,242,254,0.98),rgba(96,165,250,0.96)_52%,rgba(37,99,235,0.98))] text-blue-950 shadow-[0_12px_28px_rgba(37,99,235,0.34)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(37,99,235,0.38)]',
      specular: 'absolute inset-[2px] rounded-full bg-[radial-gradient(circle_at_28%_22%,rgba(255,255,255,0.8),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.18),transparent)]',
      ring: 'absolute inset-0 rounded-full ring-1 ring-white/35',
      badge: 'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-blue-100/70 bg-[linear-gradient(160deg,#bfdbfe,#3b82f6)] text-blue-950 shadow-[0_6px_14px_rgba(37,99,235,0.3)]',
      innerAvatar: 'border-blue-200/60 bg-[linear-gradient(160deg,rgba(224,242,254,0.98),rgba(96,165,250,0.96)_52%,rgba(37,99,235,0.98))] text-blue-950',
      innerBadge: 'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[linear-gradient(160deg,#bfdbfe,#3b82f6)] text-blue-950',
      dropdownBg: 'bg-[linear-gradient(145deg,rgba(14,17,23,0.99),rgba(22,38,65,0.98)_55%,rgba(37,68,126,0.92))] text-blue-50',
      chipClass: 'bg-white/14 text-blue-50 ring-1 ring-white/14',
      creditClass: 'text-blue-100/80',
    },
    silver: {
      trigger: 'border-slate-300/70 bg-[linear-gradient(160deg,rgba(241,245,249,0.98),rgba(148,163,184,0.96)_52%,rgba(71,85,105,0.98))] text-slate-950 shadow-[0_12px_28px_rgba(71,85,105,0.34)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(71,85,105,0.38)]',
      specular: 'absolute inset-[2px] rounded-full bg-[radial-gradient(circle_at_28%_22%,rgba(255,255,255,0.85),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.22),transparent)]',
      ring: 'absolute inset-0 rounded-full ring-1 ring-white/40',
      badge: 'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200/70 bg-[linear-gradient(160deg,#e2e8f0,#64748b)] text-slate-950 shadow-[0_6px_14px_rgba(71,85,105,0.3)]',
      innerAvatar: 'border-slate-300/60 bg-[linear-gradient(160deg,rgba(241,245,249,0.98),rgba(148,163,184,0.96)_52%,rgba(71,85,105,0.98))] text-slate-950',
      innerBadge: 'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[linear-gradient(160deg,#e2e8f0,#64748b)] text-slate-950',
      dropdownBg: 'bg-[linear-gradient(145deg,rgba(15,17,20,0.99),rgba(30,37,48,0.98)_55%,rgba(59,72,92,0.92))] text-slate-50',
      chipClass: 'bg-white/14 text-slate-50 ring-1 ring-white/14',
      creditClass: 'text-slate-100/80',
    },
    gold: {
      trigger: 'border-amber-300/70 bg-[linear-gradient(160deg,rgba(255,246,222,0.98),rgba(242,201,102,0.96)_52%,rgba(177,120,22,0.98))] text-amber-950 shadow-[0_12px_28px_rgba(167,111,20,0.34)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(167,111,20,0.38)]',
      specular: 'absolute inset-[2px] rounded-full bg-[radial-gradient(circle_at_28%_22%,rgba(255,255,255,0.8),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.18),transparent)]',
      ring: 'absolute inset-0 rounded-full ring-1 ring-white/35',
      badge: 'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-amber-100/70 bg-[linear-gradient(160deg,#ffe9a8,#e0a115)] text-amber-950 shadow-[0_6px_14px_rgba(173,113,14,0.3)]',
      innerAvatar: 'border-amber-200/60 bg-[linear-gradient(160deg,rgba(255,246,222,0.98),rgba(242,201,102,0.96)_52%,rgba(177,120,22,0.98))] text-amber-950',
      innerBadge: 'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[linear-gradient(160deg,#ffe9a8,#e0a115)] text-amber-950',
      dropdownBg: 'bg-[linear-gradient(145deg,rgba(19,18,17,0.99),rgba(41,34,24,0.98)_55%,rgba(107,78,24,0.92))] text-amber-50',
      chipClass: 'bg-white/14 text-amber-50 ring-1 ring-white/14',
      creditClass: 'text-amber-100/80',
    },
  } as const
  const av = isPaidMember ? AVATAR_TIERS[avatarTier] : null

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}`)
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="User menu"
          className={cn(
            'group relative flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold uppercase tracking-[0.22em] outline-none transition-all duration-300',
            av
              ? av.trigger
              : 'border-border bg-secondary text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {av && (
            <>
              <span className={av.specular} />
              <span className={av.ring} />
              <span className={av.badge}>
                <Crown className="h-2.5 w-2.5 fill-current" />
              </span>
            </>
          )}
          {unreadSupportReplies > 0 && (
            <span className="absolute -left-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold tracking-normal text-white shadow-sm">
              {unreadSupportReplies > 99 ? '99+' : unreadSupportReplies}
            </span>
          )}
          <span className="relative z-10 leading-none">{accountInitial}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-[1.75rem] border-border/70 bg-popover/95 p-1.5 shadow-[0_20px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div
          className={cn(
            'rounded-[1.25rem] px-3.5 py-3.5',
            av ? av.dropdownBg : 'bg-secondary/80 text-foreground'
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold uppercase tracking-[0.22em]',
                av ? av.innerAvatar : 'border-border bg-background text-foreground'
              )}
            >
              {av && (
                <span className={av.innerBadge}>
                  <Crown className="h-2.5 w-2.5 fill-current" />
                </span>
              )}
              <span>{accountInitial}</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{email}</p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]',
                    av ? av.chipClass : 'bg-background/70 text-muted-foreground ring-1 ring-border/60'
                  )}
                >
                  {isPaidMember ? paidLabel : standardLabel}
                </span>
                <span className={cn('text-xs', av ? av.creditClass : 'text-muted-foreground')}>
                  {isLoading ? '—' : `${total}`} {t('credits' as Parameters<typeof t>[0])}
                </span>
              </div>
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href={`/${locale}/profile`} className="cursor-pointer">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>{t('profile' as Parameters<typeof t>[0])}</span>
            {unreadSupportReplies > 0 && (
              <span className="ml-auto inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                {unreadSupportReplies > 99 ? '99+' : unreadSupportReplies}
              </span>
            )}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href={`/${locale}/pricing`} className="cursor-pointer">
            <Coins className="h-4 w-4 text-amber-500" />
            <span>{isLoading ? '—' : `${total}`} {t('credits' as Parameters<typeof t>[0])}</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href={`/${locale}/history`} className="cursor-pointer">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{t('history' as Parameters<typeof t>[0])}</span>
          </Link>
        </DropdownMenuItem>

        {isAdmin && (
          <>
            <DropdownMenuItem asChild>
              <Link href={`/${locale}/users`} className="cursor-pointer">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{t('users' as Parameters<typeof t>[0])}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/${locale}/job-health`} className="cursor-pointer">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span>{locale === 'zh' ? '任务监控' : 'Job Health'}</span>
              </Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleSignOut}
          className="text-red-500 focus:text-red-500 focus:bg-red-50 dark:focus:bg-red-950"
        >
          <LogOut className="h-4 w-4" />
          <span>{t('signOut' as Parameters<typeof t>[0])}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
