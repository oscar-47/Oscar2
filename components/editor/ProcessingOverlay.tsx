'use client'

import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'

interface ProcessingOverlayProps {
  width: number
  height: number
}

export function ProcessingOverlay({ width, height }: ProcessingOverlayProps) {
  const t = useTranslations('studio.editor')

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-black/50 backdrop-blur-[2px]"
      style={{ width, height }}
    >
      <Loader2 className="h-8 w-8 animate-spin text-white" />
      <p className="mt-2 text-sm font-medium text-white">{t('processing')}</p>
    </div>
  )
}
