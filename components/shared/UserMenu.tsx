'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCredits } from '@/lib/hooks/useCredits'
import { User, Coins, Clock, LogOut } from 'lucide-react'
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
  const { total, isLoading } = useCredits(userId)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}`)
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d8dbe1] bg-[#f2f3f5] text-[#6e7380] hover:bg-[#eceef2] hover:text-[#252b34] transition-colors outline-none">
          <User className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-2xl border-[#d6d9e0] bg-[#f7f7f8]">
        {/* Email header */}
        <div className="px-3 py-3">
          <p className="text-sm font-medium truncate">{email}</p>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
        <DropdownMenuSeparator />

        {/* Profile / Member Center */}
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/profile`} className="cursor-pointer">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>{t('profile' as Parameters<typeof t>[0])}</span>
          </Link>
        </DropdownMenuItem>

        {/* Credits */}
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/pricing`} className="cursor-pointer">
            <Coins className="h-4 w-4 text-amber-500" />
            <span>{isLoading ? '—' : `${total}`} {locale === 'zh' ? '积分' : 'Credits'}</span>
          </Link>
        </DropdownMenuItem>

        {/* History */}
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/history`} className="cursor-pointer">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{t('history' as Parameters<typeof t>[0])}</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Sign Out */}
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
