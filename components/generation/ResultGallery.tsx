'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Download, ZoomIn, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ResultImage {
  url: string
  label?: string
}

interface ResultGalleryProps {
  images: ResultImage[]
  isLoading?: boolean
  loadingCount?: number
  className?: string
  aspectRatio?: string
}

function toCssAspectRatio(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(':').map((v) => Number(v))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '4 / 3'
  return `${w} / ${h}`
}

function SkeletonCard({ aspectRatio }: { aspectRatio: string }) {
  return (
    <div className="w-[220px] max-w-full rounded-xl bg-muted animate-pulse" style={{ aspectRatio }} />
  )
}

export function ResultGallery({
  images,
  isLoading = false,
  loadingCount = 1,
  className,
  aspectRatio = '4:3',
}: ResultGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const cssAspectRatio = toCssAspectRatio(aspectRatio)

  const openLightbox = (i: number) => setLightboxIndex(i)
  const closeLightbox = () => setLightboxIndex(null)
  const prev = () =>
    setLightboxIndex((i) => (i !== null ? Math.max(0, i - 1) : null))
  const next = () =>
    setLightboxIndex((i) =>
      i !== null ? Math.min(images.length - 1, i + 1) : null
    )

  if (!isLoading && images.length === 0) return null

  return (
    <>
      <div className={cn('flex flex-wrap content-start items-start gap-3', className)}>
        {isLoading &&
          Array.from({ length: loadingCount }).map((_, i) => (
            <SkeletonCard key={`skel-${i}`} aspectRatio={cssAspectRatio} />
          ))}

        {images.map((img, i) => (
          <motion.div
            key={img.url}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08 }}
            className="group relative w-[220px] max-w-full overflow-hidden rounded-xl border border-border bg-muted"
            style={{ aspectRatio: cssAspectRatio }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.label ?? `Result ${i + 1}`}
              className="w-full h-full object-cover"
            />
            {img.label && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 px-3 py-2">
                <p className="text-xs text-white font-medium">{img.label}</p>
              </div>
            )}

            {/* Hover actions */}
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => openLightbox(i)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
              >
                <ZoomIn className="h-4 w-4 text-white" />
              </button>
              <a
                href={img.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
              >
                <Download className="h-4 w-4 text-white" />
              </a>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>

          {lightboxIndex > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); prev() }}
              className="absolute left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <ChevronLeft className="h-6 w-6 text-white" />
            </button>
          )}

          {lightboxIndex < images.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); next() }}
              className="absolute right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <ChevronRight className="h-6 w-6 text-white" />
            </button>
          )}

          <div
            className="max-w-3xl max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[lightboxIndex].url}
              alt={images[lightboxIndex].label ?? `Result ${lightboxIndex + 1}`}
              className="max-w-full max-h-[80vh] object-contain rounded-xl"
            />
            <div className="flex gap-2">
              <a
                href={images[lightboxIndex].url}
                download
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="secondary" size="sm">
                  <Download className="h-4 w-4 mr-1.5" />
                  Download
                </Button>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
