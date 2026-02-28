'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CorePageShellProps {
  children: ReactNode
  maxWidthClass?: string
  contentClassName?: string
}

export function CorePageShell({
  children,
  maxWidthClass = 'max-w-6xl',
  contentClassName,
}: CorePageShellProps) {
  return (
    <div className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 bg-[#f1f3f6]">
      <div
        className={cn(
          'mx-auto min-h-[calc(100vh-56px)] px-6 pb-12 pt-10 sm:px-8',
          maxWidthClass,
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}
