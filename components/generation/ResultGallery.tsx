'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Download, ZoomIn, X, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createEditorSession } from '@/lib/utils/editor-session'

export interface ResultImage {
  url: string
  label?: string
  batchId?: string
  batchTimestamp?: number
}

interface ResultGalleryProps {
  images: ResultImage[]
  isLoading?: boolean
  loadingCount?: number
  className?: string
  aspectRatio?: string
  onImageClick?: (image: ResultImage, index: number) => void
  onClear?: () => void
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

/** Group images by batchId, preserving insertion order. */
function groupByBatch(images: ResultImage[]): { batchId: string | undefined; batchTimestamp: number | undefined; images: ResultImage[] }[] {
  const groups: { batchId: string | undefined; batchTimestamp: number | undefined; images: ResultImage[] }[] = []
  let current: (typeof groups)[number] | null = null
  for (const img of images) {
    if (!current || img.batchId !== current.batchId) {
      current = { batchId: img.batchId, batchTimestamp: img.batchTimestamp, images: [img] }
      groups.push(current)
    } else {
      current.images.push(img)
    }
  }
  return groups
}

function formatBatchTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ResultGallery({
  images,
  isLoading = false,
  loadingCount = 1,
  className,
  aspectRatio = '4:3',
  onImageClick,
  onClear,
}: ResultGalleryProps) {
  const t = useTranslations('studio.editor')
  const locale = useLocale()
  const router = useRouter()
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

  const openSingleInEditor = (url: string) => {
    const sid = createEditorSession([url])
    router.push(`/${locale}/image-editor?sid=${sid}`)
  }

  const openAllInEditor = () => {
    const urls = images.map((img) => img.url)
    const sid = createEditorSession(urls)
    router.push(`/${locale}/image-editor?sid=${sid}`)
  }

  if (!isLoading && images.length === 0) return null

  const hasBatches = images.some((img) => img.batchId)
  const batches = hasBatches ? groupByBatch(images) : null

  const renderImageCard = (img: ResultImage, i: number) => (
          <motion.div
            key={img.url}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08 }}
            className={cn(
              "group relative w-[220px] max-w-full overflow-hidden rounded-xl border border-border bg-muted",
              onImageClick && "cursor-pointer"
            )}
            style={{ aspectRatio: cssAspectRatio }}
            onClick={onImageClick ? () => onImageClick(img, i) : undefined}
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
                onClick={(e) => { e.stopPropagation(); openLightbox(i) }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
              >
                <ZoomIn className="h-4 w-4 text-white" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openSingleInEditor(img.url) }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
                title={t('editInEditor')}
              >
                <Pencil className="h-4 w-4 text-white" />
              </button>
              <a
                href={img.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
              >
                <Download className="h-4 w-4 text-white" />
              </a>
            </div>
          </motion.div>
  )

  return (
    <>
      {/* Clear history button */}
      {onClear && images.length > 0 && !isLoading && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            {locale === 'zh' ? '清除历史' : 'Clear History'}
          </button>
        </div>
      )}

      {batches ? (
        /* Batch-grouped rendering */
        batches.map((batch, bIdx) => (
          <div key={batch.batchId ?? `batch-${bIdx}`}>
            {batches.length > 1 && (
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {locale === 'zh' ? `第${bIdx + 1}批` : `Batch ${bIdx + 1}`}
                  {batch.batchTimestamp ? ` · ${formatBatchTime(batch.batchTimestamp)}` : ''}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            <div className={cn('flex flex-wrap content-start items-start gap-3', className)}>
              {batch.images.map((img, i) => {
                const globalIndex = images.indexOf(img)
                return renderImageCard(img, globalIndex)
              })}
            </div>
          </div>
        ))
      ) : (
        /* Flat rendering (no batches) */
        <div className={cn('flex flex-wrap content-start items-start gap-3', className)}>
          {isLoading &&
            Array.from({ length: loadingCount }).map((_, i) => (
              <SkeletonCard key={`skel-${i}`} aspectRatio={cssAspectRatio} />
            ))}
          {images.map((img, i) => renderImageCard(img, i))}
        </div>
      )}

      {/* Batch Edit button */}
      {images.length > 0 && !isLoading && (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={openAllInEditor} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            {t('batchEdit')}
          </Button>
        </div>
      )}

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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openSingleInEditor(images[lightboxIndex!].url)}
              >
                <Pencil className="h-4 w-4 mr-1.5" />
                {t('editInEditor')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
