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
          aspectRatioLock: 'original',
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
    if (!obj || !crop.sessionId) return
    // Snapshot crop state BEFORE async work
    const snapshot = {
      objectId: obj.id,
      cropW: Math.round(crop.width),
      cropH: Math.round(crop.height),
      sessionId: crop.sessionId,
    }
    const canvas = document.createElement('canvas')
    canvas.width = snapshot.cropW
    canvas.height = snapshot.cropH
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
      snapshot.cropW,
      snapshot.cropH,
      0,
      0,
      snapshot.cropW,
      snapshot.cropH
    )

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    )
    if (!blob) return

    const file = new File([blob], `crop-${Date.now()}.png`, { type: 'image/png' })
    const result = await uploadFile(file)
    applyCrop(result.publicUrl, snapshot)
  }, [obj, crop, applyCrop])

  if (!crop.active) return null

  return (
    <div className="absolute bottom-16 left-1/2 z-[10000] -translate-x-1/2 rounded-xl border border-border bg-background px-4 py-3 shadow-2xl">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAspectRatio(null)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            crop.aspectRatioLock === null
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {t('cropFree')}
        </button>
        <button
          type="button"
          onClick={() => setAspectRatio('original')}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            crop.aspectRatioLock === 'original'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {t('cropOriginal')}
        </button>

        <div className="mx-1 h-4 w-px bg-muted" />

        {ASPECT_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => setAspectRatio(preset.value)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              crop.aspectRatioLock === preset.value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted'
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
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground transition-colors"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
