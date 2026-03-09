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
      className="absolute inset-0 flex flex-col items-center justify-center rounded-md overflow-hidden bg-white/85 dark:bg-zinc-950/85 backdrop-blur-sm"
      style={{ width, height }}
    >
      <div
        className="absolute left-[-20%] top-[-20%] h-[100%] w-[100%] rounded-full bg-violet-400/30"
        style={{ filter: 'blur(48px)', animation: 'fluid-drift-1 10s ease-in-out infinite' }}
      />
      <div
        className="absolute bottom-[-20%] right-[-20%] h-[100%] w-[100%] rounded-full bg-pink-300/25"
        style={{ filter: 'blur(48px)', animation: 'fluid-drift-2 12s ease-in-out infinite 1s' }}
      />
      <div
        className="absolute bottom-[-10%] left-[-10%] h-[80%] w-[80%] rounded-full bg-amber-300/20"
        style={{ filter: 'blur(44px)', animation: 'fluid-drift-3 9s ease-in-out infinite 2s' }}
      />
      <Loader2 className="relative z-10 h-8 w-8 animate-spin text-foreground/70" />
      <p className="relative z-10 mt-2 text-sm font-medium text-foreground/70">{t('processing')}</p>
    </div>
  )
}
