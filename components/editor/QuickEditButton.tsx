'use client'

import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'
import { getGenerationCreditCost } from '@/types'

interface QuickEditButtonProps {
  objectId: string
  x: number
  y: number
  width: number
  height: number
  zoom: number
}

export function QuickEditButton({ objectId, x, y, width, height, zoom }: QuickEditButtonProps) {
  const t = useTranslations('studio.editor')
  const openQuickEdit = useEditorStore((s) => s.openQuickEdit)
  const crop = useEditorStore((s) => s.crop)
  const quickEdit = useEditorStore((s) => s.quickEdit)

  if (crop.active || quickEdit.open) return null

  const cost = getGenerationCreditCost(quickEdit.model, quickEdit.imageSize)

  const btnY = y + height * zoom + 8
  const btnX = x + (width * zoom) / 2

  return (
    <button
      type="button"
      onClick={() => openQuickEdit(objectId)}
      onMouseDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute z-50 flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-foreground shadow-lg hover:shadow-xl transition-shadow"
      style={{
        left: btnX,
        top: btnY,
        transform: 'translateX(-50%)',
      }}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {t('quickEdit')}
      <span className="ml-1 opacity-80">
        {cost}
      </span>
    </button>
  )
}
