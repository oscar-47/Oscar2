'use client'

import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionIcon } from '@/components/shared/SectionIcon'

interface CoreProcessingStatusProps {
  title: string
  subtitle: string
  progress: number
  statusLine: string
  showHeader?: boolean
  className?: string
  centerMinHeightClass?: string
  statusPlacement?: 'center' | 'below'
}

export function CoreProcessingStatus({
  title,
  subtitle,
  progress,
  statusLine,
  showHeader = true,
  className,
  centerMinHeightClass = 'min-h-[220px]',
  statusPlacement = 'center',
}: CoreProcessingStatusProps) {
  return (
    <div className={cn('space-y-5', className)}>
      {showHeader && (
        <div className="flex items-start gap-3">
          <SectionIcon icon={Sparkles} className="mt-0.5" />
          <div>
            <h3 className="text-[15px] font-semibold text-[#1a1d24]">{title}</h3>
            <p className="mt-0.5 text-[13px] text-[#7d818d]">{subtitle}</p>
          </div>
        </div>
      )}

      <div className="h-3 overflow-hidden rounded-full bg-[#dcdee4]">
        <div
          className="h-full rounded-full bg-[#17191f] transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>

      {statusPlacement === 'below' ? (
        <p className="text-center text-[13px] text-[#7d818d]">{statusLine}</p>
      ) : (
        <div className={cn('flex items-center justify-center text-center', centerMinHeightClass)}>
          <p className="text-[16px] font-semibold text-[#7b7f89]">{statusLine}</p>
        </div>
      )}
    </div>
  )
}
