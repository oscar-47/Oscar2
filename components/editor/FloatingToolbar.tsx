'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Type, Crop, Download, Loader2 } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'
import { detectImageText } from '@/lib/api/edge-functions'

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
  const textDetection = useEditorStore((s) => s.textDetection)
  const setTextDetection = useEditorStore((s) => s.setTextDetection)
  const openQuickEdit = useEditorStore((s) => s.openQuickEdit)
  const objects = useEditorStore((s) => s.objects)
  const crop = useEditorStore((s) => s.crop)
  const [message, setMessage] = useState<string | null>(null)

  if (crop.active) return null

  const obj = objects.find((o) => o.id === objectId)
  if (!obj) return null

  const handleDetectText = async () => {
    setTextDetection({ objectId, loading: true, detected: false, texts: [] })
    setMessage(null)
    try {
      const result = await detectImageText(obj.url)
      setTextDetection({
        objectId,
        loading: false,
        detected: result.hasText,
        texts: result.texts,
      })
      if (!result.hasText) {
        setMessage(t('noTextDetected'))
        setTimeout(() => setMessage(null), 3000)
      } else {
        // Pre-fill quick edit with detected text info
        const textInfo = result.texts.map((tx) => tx.content).join(', ')
        openQuickEdit(objectId)
        useEditorStore.getState().setQuickEditField(
          'prompt',
          `Detected text: ${textInfo}\n\n`
        )
      }
    } catch {
      setTextDetection({ objectId, loading: false })
      setMessage('Text detection failed')
      setTimeout(() => setMessage(null), 3000)
    }
  }

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
    <>
      <div
        className="pointer-events-auto absolute z-50 flex items-center gap-1 rounded-lg border border-[#e5e7eb] bg-white px-1.5 py-1 shadow-lg"
        style={{
          left: toolbarX,
          top: toolbarY,
          transform: 'translateX(-50%)',
        }}
      >
        <button
          type="button"
          onClick={() => void handleDetectText()}
          disabled={textDetection.loading && textDetection.objectId === objectId}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#374151] hover:bg-[#f3f4f6] transition-colors disabled:opacity-50"
        >
          {textDetection.loading && textDetection.objectId === objectId ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Type className="h-3.5 w-3.5" />
          )}
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

      {/* Inline message */}
      {message && (
        <div
          className="pointer-events-none absolute z-50 rounded-lg bg-[#111827] px-3 py-1.5 text-xs text-white shadow-lg"
          style={{
            left: toolbarX,
            top: toolbarY - 36,
            transform: 'translateX(-50%)',
          }}
        >
          {message}
        </div>
      )}
    </>
  )
}
