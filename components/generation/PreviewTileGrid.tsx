'use client'

import { ImageIcon } from 'lucide-react'

interface PreviewTileGridProps {
  count: number
  aspectRatio?: string
  labels?: string[]
  className?: string
}

function toCssAspectRatio(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(':').map((v) => Number(v))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '4 / 3'
  return `${w} / ${h}`
}

export function PreviewTileGrid({
  count,
  aspectRatio = '4:3',
  labels,
  className,
}: PreviewTileGridProps) {
  const cssAspectRatio = toCssAspectRatio(aspectRatio)
  const items = Array.from({ length: Math.max(0, count) })

  if (items.length === 0) return null

  return (
    <div className={className}>
      <div className="flex flex-wrap content-start items-start gap-3">
        {items.map((_, index) => (
          <div
            key={`preview-tile-${index}`}
            className="relative w-[220px] max-w-full overflow-hidden rounded-2xl border border-[#d0d4dc] bg-[#f5f6f8]"
            style={{ aspectRatio: cssAspectRatio }}
          >
            <div className="absolute inset-0 m-3 rounded-xl border border-dashed border-[#d8dde5]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#8a909c]">
              <ImageIcon className="h-6 w-6" />
              <span className="text-xs font-medium">
                {labels?.[index] || `预览 ${index + 1}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
