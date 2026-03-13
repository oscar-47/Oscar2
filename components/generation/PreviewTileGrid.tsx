'use client'

import { ImageIcon } from 'lucide-react'
import { getAspectRatioCardStyle, toCssAspectRatio } from '@/components/generation/aspect-ratio-layout'

interface PreviewTileGridProps {
  count: number
  aspectRatio?: string
  labels?: string[]
  className?: string
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
            className="relative max-w-full shrink-0 overflow-hidden rounded-2xl border border-border bg-secondary"
            style={getAspectRatioCardStyle(cssAspectRatio)}
          >
            <div className="absolute inset-0 m-3 rounded-xl border border-dashed border-border" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
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
