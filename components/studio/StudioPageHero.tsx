import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StudioPageHeroProps {
  icon: LucideIcon
  badge: string
  title: string
  description: ReactNode
  badgeClassName?: string
  className?: string
  /** Optional extra elements rendered below the description (e.g. chip links). */
  extras?: ReactNode
  /** Optional element pinned to the top-right corner of the hero (e.g. promo card). */
  topRight?: ReactNode
}

export function StudioPageHero({
  icon: Icon,
  badge,
  title,
  description,
  badgeClassName,
  className,
  extras,
  topRight,
}: StudioPageHeroProps) {
  return (
    <section
      className={cn(
        'relative px-6 py-8 text-center sm:px-10 sm:py-10',
        className
      )}
    >
      {topRight && (
        <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
          {topRight}
        </div>
      )}
      <div className="relative mx-auto flex max-w-4xl flex-col items-center">
        <div
          className={cn(
            'inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3.5 py-1.5 text-[13px] font-semibold text-muted-foreground',
            badgeClassName
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          <span>{badge}</span>
        </div>

        <h1 className="mt-4 max-w-4xl font-[var(--font-display)] text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold leading-[1.15] tracking-[-0.03em] text-foreground">
          {title}
        </h1>

        <div className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-[15px] sm:leading-8">
          {description}
        </div>

        {extras && <div className="mt-4">{extras}</div>}
      </div>
    </section>
  )
}
