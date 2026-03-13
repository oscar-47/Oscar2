'use client'

import { SupportFeedbackLink } from '@/components/support/SupportFeedbackLink'
import { useSupportFeedbackUnreadCount } from '@/lib/hooks/useSupportFeedbackUnreadCount'

interface FloatingSupportFeedbackButtonProps {
  userId: string
}

export function FloatingSupportFeedbackButton({
  userId,
}: FloatingSupportFeedbackButtonProps) {
  const { count } = useSupportFeedbackUnreadCount(userId)

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40">
      <div className="pointer-events-auto relative">
        <SupportFeedbackLink variant="floating" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </div>
    </div>
  )
}
