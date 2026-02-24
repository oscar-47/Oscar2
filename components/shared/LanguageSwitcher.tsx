'use client'

import { useLocale } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function switchLocale(newLocale: 'en' | 'zh') {
    if (newLocale === locale) return
    // Replace /en/ or /zh/ prefix with new locale
    const newPath = pathname.replace(/^\/(en|zh)/, `/${newLocale}`)
    startTransition(() => {
      router.push(newPath)
    })
  }

  return (
    <div className="flex items-center gap-1 rounded-md border p-0.5 text-sm">
      <button
        onClick={() => switchLocale('en')}
        disabled={isPending}
        className={`px-2 py-0.5 rounded text-xs transition-colors ${
          locale === 'en' ? 'bg-foreground text-background font-medium' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => switchLocale('zh')}
        disabled={isPending}
        className={`px-2 py-0.5 rounded text-xs transition-colors ${
          locale === 'zh' ? 'bg-foreground text-background font-medium' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        中
      </button>
    </div>
  )
}
