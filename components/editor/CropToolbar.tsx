'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Check, X } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'
import { uploadFile } from '@/lib/api/upload'
import { cn } from '@/lib/utils'

const ASPECT_PRESETS = [
  { label: '1:1', value: '1:1' },
  { label: '2:3', value: '2:3' },
  { label: '3:2', value: '3:2' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '4:5', value: '4:5' },
  { label: '5:4', value: '5:4' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: '21:9', value: '21:9' },
  { label: '4:1', value: '4:1' },
  { label: '1:4', value: '1:4' },
  { label: '8:1', value: '8:1' },
  { label: '1:8', value: '1:8' },
]

export function CropToolbar() {
  const t = useTranslations('studio.editor')
  const crop = useEditorStore((s) => s.crop)
  const updateCropRegion = useEditorStore((s) => s.updateCropRegion)
  const applyCrop = useEditorStore((s) => s.applyCrop)
  const cancelCrop = useEditorStore((s) => s.cancelCrop)
  const objects = useEditorStore((s) => s.objects)

  const obj = objects.find((o) => o.id === crop.objectId)

  const setAspectRatio = useCallback(
    (ratio: string | null) => {
      if (!obj) return
      const natW = obj.naturalWidth || obj.width
      const natH = obj.naturalHeight || obj.height

      if (!ratio) {
        // Free crop → reset to full
        updateCropRegion({
          aspectRatioLock: null,
          x: 0,
          y: 0,
          width: natW,
          height: natH,
        })
        return
      }

      if (ratio === 'original') {
        updateCropRegion({
          aspectRatioLock: null,
          x: 0,
          y: 0,
          width: natW,
          height: natH,
        })
        return
      }

      const [rw, rh] = ratio.split(':').map(Number)
      const targetRatio = rw / rh
      let newW = natW
      let newH = natW / targetRatio
      if (newH > natH) {
        newH = natH
        newW = natH * targetRatio
      }
      const newX = (natW - newW) / 2
      const newY = (natH - newH) / 2
      updateCropRegion({
        aspectRatioLock: ratio,
        x: Math.max(0, newX),
        y: Math.max(0, newY),
        width: Math.min(newW, natW),
        height: Math.min(newH, natH),
      })
    },
    [obj, updateCropRegion]
  )

  const handleApply = useCallback(async () => {
    if (!obj) return
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(crop.width)
    canvas.height = Math.round(crop.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = obj.url

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image for crop'))
    })

    ctx.drawImage(
      img,
      Math.round(crop.x),
      Math.round(crop.y),
      Math.round(crop.width),
      Math.round(crop.height),
      0,
      0,
      Math.round(crop.width),
      Math.round(crop.height)
    )

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    )
    if (!blob) return

    const file = new File([blob], `crop-${Date.now()}.png`, { type: 'image/png' })
    const result = await uploadFile(file)
    applyCrop(result.publicUrl)
  }, [obj, crop, applyCrop])

  if (!crop.active) return null

  return (
    <div className="absolute bottom-16 left-1/2 z-[10000] -translate-x-1/2 rounded-xl border border-[#e5e7eb] bg-white px-4 py-3 shadow-2xl">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAspectRatio(null)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            crop.aspectRatioLock === null
              ? 'bg-[#111827] text-white'
              : 'text-[#6b7280] hover:bg-[#f3f4f6]'
          )}
        >
          {t('cropFree')}
        </button>
        <button
          type="button"
          onClick={() => setAspectRatio('original')}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-[#6b7280] hover:bg-[#f3f4f6] transition-colors"
        >
          {t('cropOriginal')}
        </button>

        <div className="mx-1 h-4 w-px bg-[#e5e7eb]" />

        {ASPECT_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => setAspectRatio(preset.value)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              crop.aspectRatioLock === preset.value
                ? 'bg-[#111827] text-white'
                : 'text-[#6b7280] hover:bg-[#f3f4f6]'
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={cancelCrop}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f4f6] text-[#6b7280] hover:bg-[#e5e7eb] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111827] text-white hover:bg-[#1f2937] transition-colors"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
