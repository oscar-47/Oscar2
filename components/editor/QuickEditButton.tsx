'use client'

import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'
import { DEFAULT_CREDIT_COSTS } from '@/types'

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

  const cost = DEFAULT_CREDIT_COSTS['flux-kontext-pro'] ?? 5

  const btnY = y + height * zoom + 8
  const btnX = x + (width * zoom) / 2

  return (
    <button
      type="button"
      onClick={() => openQuickEdit(objectId)}
      className="pointer-events-auto absolute z-50 flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] px-4 py-2 text-xs font-medium text-white shadow-lg hover:shadow-xl transition-shadow"
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
