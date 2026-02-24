'use client'

import { Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCredits } from '@/lib/hooks/useCredits'

interface CreditCostBadgeProps {
  cost: number
  className?: string
}

export function CreditCostBadge({ cost, className }: CreditCostBadgeProps) {
  const { total } = useCredits()
  const insufficient = total !== null && total < cost

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        insufficient
          ? 'bg-destructive/10 text-destructive'
          : 'bg-primary/10 text-primary',
        className
      )}
    >
      <Zap className="h-3 w-3" />
      {cost} credits
      {insufficient && ' (insufficient)'}
    </span>
  )
}
