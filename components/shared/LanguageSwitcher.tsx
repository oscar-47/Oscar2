'use client'

import { useLocale } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { Globe } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function switchLocale(newLocale: 'en' | 'zh') {
    if (newLocale === locale) return
    const newPath = pathname.replace(/^\/(en|zh)/, `/${newLocale}`)
    startTransition(() => {
      router.push(newPath)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={isPending}
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-[#666b78] hover:bg-[#eceef2] hover:text-[#222731] transition-colors outline-none"
        >
          <Globe className="h-4 w-4" />
          <span className="text-xs font-medium uppercase">{locale === 'zh' ? 'ZH' : 'EN'}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 rounded-2xl border-[#d6d9e0] bg-[#f7f7f8]">
        <DropdownMenuItem
          onClick={() => switchLocale('en')}
          className={locale === 'en' ? 'font-medium bg-[#eceef2]' : ''}
        >
          English
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => switchLocale('zh')}
          className={locale === 'zh' ? 'font-medium bg-[#eceef2]' : ''}
        >
          中文
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
