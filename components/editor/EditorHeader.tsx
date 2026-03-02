'use client'

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, Minus, Plus } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]

export function EditorHeader() {
  const t = useTranslations('studio.editor')
  const locale = useLocale()
  const router = useRouter()
  const zoom = useEditorStore((s) => s.zoom)
  const setZoom = useEditorStore((s) => s.setZoom)

  const zoomIn = () => {
    const next = ZOOM_STEPS.find((s) => s > zoom + 0.001)
    setZoom(next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
  }

  const zoomOut = () => {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.001)
    setZoom(prev ?? ZOOM_STEPS[0])
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#e5e7eb] bg-white px-4">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-[#6b7280] hover:text-[#111827] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{t('back')}</span>
      </button>

      <h1 className="text-sm font-semibold text-[#111827]">{t('title')}</h1>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={zoomOut}
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#f3f4f6] transition-colors"
          title={t('zoomOut')}
        >
          <Minus className="h-3.5 w-3.5 text-[#6b7280]" />
        </button>
        <span className="min-w-[48px] text-center text-xs tabular-nums text-[#374151]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={zoomIn}
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#f3f4f6] transition-colors"
          title={t('zoomIn')}
        >
          <Plus className="h-3.5 w-3.5 text-[#6b7280]" />
        </button>
      </div>
    </header>
  )
}
