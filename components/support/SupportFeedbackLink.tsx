'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { MessageSquareMore } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SupportFeedbackLinkProps {
  className?: string
  variant?: 'inline' | 'floating'
}

export function SupportFeedbackLink({
  className,
  variant = 'inline',
}: SupportFeedbackLinkProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('profile.supportFeedback')
  const profilePath = `/${locale}/profile`
  const href = pathname === profilePath ? '#support-feedback' : `${profilePath}#support-feedback`
  const isSamePage = pathname === profilePath

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isSamePage) {
      e.preventDefault()
      document.getElementById('support-feedback')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (variant === 'floating') {
    return (
      <Link
        href={href}
        onClick={handleClick}
        aria-label={t('floatingAriaLabel')}
        title={t('floatingAriaLabel')}
        className={cn(
          'group inline-flex h-14 w-14 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-[0_12px_28px_rgba(15,23,42,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_16px_34px_rgba(15,23,42,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className
        )}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:scale-[1.03]">
          <MessageSquareMore className="h-5 w-5" />
        </span>
      </Link>
    )
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-red-700 underline decoration-red-300 underline-offset-4 transition-colors hover:text-red-800',
        className
      )}
    >
      <MessageSquareMore className="h-3.5 w-3.5" />
      <span>{t('errorLink')}</span>
    </Link>
  )
}
