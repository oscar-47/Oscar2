'use client'

import { useTranslations } from 'next-intl'
import { Type, Crop, Download } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'

interface FloatingToolbarProps {
  objectId: string
  x: number
  y: number
  width: number
  zoom: number
}

export function FloatingToolbar({ objectId, x, y, width, zoom }: FloatingToolbarProps) {
  const t = useTranslations('studio.editor')
  const startCrop = useEditorStore((s) => s.startCrop)
  const openTextEdit = useEditorStore((s) => s.openTextEdit)
  const objects = useEditorStore((s) => s.objects)
  const crop = useEditorStore((s) => s.crop)

  if (crop.active) return null

  const obj = objects.find((o) => o.id === objectId)
  if (!obj) return null

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = obj.url
    a.download = `shopix-editor-${Date.now()}.png`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const toolbarY = y - 44
  const toolbarX = x + (width * zoom) / 2

  return (
    <div
      className="pointer-events-auto absolute z-50 flex items-center gap-1 rounded-lg border border-[#e5e7eb] bg-white px-1.5 py-1 shadow-lg"
      style={{
        left: toolbarX,
        top: toolbarY,
        transform: 'translateX(-50%)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => openTextEdit(objectId)}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#374151] hover:bg-[#f3f4f6] transition-colors"
      >
        <Type className="h-3.5 w-3.5" />
        {t('editText')}
      </button>

      <div className="h-4 w-px bg-[#e5e7eb]" />

      <button
        type="button"
        onClick={() => startCrop(objectId)}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#374151] hover:bg-[#f3f4f6] transition-colors"
      >
        <Crop className="h-3.5 w-3.5" />
        {t('crop')}
      </button>

      <div className="h-4 w-px bg-[#e5e7eb]" />

      <button
        type="button"
        onClick={handleDownload}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#374151] hover:bg-[#f3f4f6] transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        {t('download')}
      </button>
    </div>
  )
}
