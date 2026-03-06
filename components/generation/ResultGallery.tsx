'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Download, Pencil, Trash2, X, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createEditorSession } from '@/lib/utils/editor-session'
import type { ResultAsset, ResultAssetOrigin } from '@/types'

export type ResultImage = ResultAsset

interface ResultGalleryProps {
  images: ResultImage[]
  isLoading?: boolean
  loadingCount?: number
  className?: string
  aspectRatio?: string
  onImageClick?: (image: ResultImage, index: number) => void
  onClear?: () => void
  editorSessionKey?: string
  originModule?: ResultAssetOrigin
}

function toCssAspectRatio(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(':').map((value) => Number(value))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '4 / 3'
  return `${w} / ${h}`
}

function SkeletonCard({ aspectRatio }: { aspectRatio: string }) {
  return (
    <div className="w-[220px] max-w-full animate-pulse rounded-xl bg-muted" style={{ aspectRatio }} />
  )
}

function groupByBatch(images: ResultImage[]) {
  const groups: Array<{ batchId?: string; batchTimestamp?: number; images: ResultImage[] }> = []
  let current: (typeof groups)[number] | null = null

  for (const image of images) {
    if (!current || image.batchId !== current.batchId) {
      current = {
        batchId: image.batchId,
        batchTimestamp: image.batchTimestamp,
        images: [image],
      }
      groups.push(current)
      continue
    }
    current.images.push(image)
  }

  return groups
}

function formatBatchTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatResolutionMeta(image: ResultImage, isZh: boolean): string | null {
  const parts: string[] = []
  if (image.requestedSize) parts.push(`${isZh ? '请求' : 'Requested'} ${image.requestedSize}`)
  if (image.deliveredSize) parts.push(`${isZh ? '交付' : 'Delivered'} ${image.deliveredSize}`)
  if (!image.deliveredSize && image.actualSize) parts.push(`${isZh ? '实际' : 'Actual'} ${image.actualSize}`)
  if (image.normalizedByServer) parts.push(isZh ? '已归一化' : 'Normalized')
  return parts.length > 0 ? parts.join(' · ') : null
}

export function ResultGallery({
  images,
  isLoading = false,
  loadingCount = 1,
  className,
  aspectRatio = '4:3',
  onImageClick,
  onClear,
  editorSessionKey,
  originModule = 'unknown',
}: ResultGalleryProps) {
  const t = useTranslations('studio.editor')
  const locale = useLocale()
  const router = useRouter()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const cssAspectRatio = toCssAspectRatio(aspectRatio)
  const isZh = locale.startsWith('zh')

  const originalImages = useMemo(
    () => images.filter((image) => image.section !== 'edited'),
    [images],
  )
  const editedImages = useMemo(
    () => [...images.filter((image) => image.section === 'edited')]
      .sort((left, right) => right.createdAt - left.createdAt),
    [images],
  )
  const displayImages = useMemo(
    () => [...originalImages, ...editedImages],
    [editedImages, originalImages],
  )
  const displayIndexById = useMemo(
    () => new Map(displayImages.map((image, index) => [image.id, index])),
    [displayImages],
  )

  const openLightbox = (index: number) => setLightboxIndex(index)
  const closeLightbox = () => setLightboxIndex(null)
  const prev = () => setLightboxIndex((index) => (index !== null ? Math.max(0, index - 1) : null))
  const next = () => setLightboxIndex((index) => (
    index !== null ? Math.min(displayImages.length - 1, index + 1) : null
  ))

  const openAssetsInEditor = (assets: ResultImage[]) => {
    if (assets.length === 0) return
    const sid = createEditorSession({
      assets,
      returnSessionKey: editorSessionKey,
      originModule,
    })
    router.push(`/${locale}/image-editor?sid=${sid}`)
  }

  const openSingleInEditor = (image: ResultImage) => {
    openAssetsInEditor([image])
  }

  const openAllInEditor = () => {
    openAssetsInEditor(displayImages)
  }

  if (!isLoading && displayImages.length === 0) return null

  const originalBatches = originalImages.some((image) => image.batchId)
    ? groupByBatch(originalImages)
    : null

  const renderImageCard = (image: ResultImage, index: number) => (
    <motion.div
      key={image.id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.08 }}
      className={cn(
        'group relative w-[220px] max-w-full overflow-hidden rounded-xl border border-border bg-muted',
        onImageClick && 'cursor-pointer',
      )}
      style={{ aspectRatio: cssAspectRatio }}
      onClick={onImageClick ? () => onImageClick(image, index) : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.label ?? `Result ${index + 1}`}
        className="h-full w-full object-cover"
      />

      {(image.label || formatResolutionMeta(image, isZh)) && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 px-3 py-2">
          {image.label && (
            <p className="text-xs font-medium text-white">{image.label}</p>
          )}
          {formatResolutionMeta(image, isZh) && (
            <p className="mt-1 text-[10px] text-white/80">{formatResolutionMeta(image, isZh)}</p>
          )}
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openLightbox(index)
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/30"
        >
          <ZoomIn className="h-4 w-4 text-white" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openSingleInEditor(image)
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/30"
          title={t('editInEditor')}
        >
          <Pencil className="h-4 w-4 text-white" />
        </button>
        <a
          href={image.url}
          download
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/30"
        >
          <Download className="h-4 w-4 text-white" />
        </a>
      </div>
    </motion.div>
  )

  return (
    <>
      {onClear && displayImages.length > 0 && !isLoading && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            {locale === 'zh' ? '清除历史' : 'Clear History'}
          </button>
        </div>
      )}

      <div className="space-y-5">
        {(isLoading || originalImages.length > 0) && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground">{t('originalSection')}</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {originalBatches ? (
              originalBatches.map((batch, batchIndex) => (
                <div key={batch.batchId ?? `original-batch-${batchIndex}`} className="space-y-3">
                  {originalBatches.length > 1 && (
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-border" />
                      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {locale === 'zh' ? `第${batchIndex + 1}批` : `Batch ${batchIndex + 1}`}
                        {batch.batchTimestamp ? ` · ${formatBatchTime(batch.batchTimestamp)}` : ''}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <div className={cn('flex flex-wrap content-start items-start gap-3', className)}>
                    {batch.images.map((image) => renderImageCard(image, displayIndexById.get(image.id) ?? 0))}
                  </div>
                </div>
              ))
            ) : (
              <div className={cn('flex flex-wrap content-start items-start gap-3', className)}>
                {isLoading && Array.from({ length: loadingCount }).map((_, index) => (
                  <SkeletonCard key={`original-skel-${index}`} aspectRatio={cssAspectRatio} />
                ))}
                {originalImages.map((image) => renderImageCard(image, displayIndexById.get(image.id) ?? 0))}
              </div>
            )}
          </section>
        )}

        {editedImages.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground">{t('editedSection')}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className={cn('flex flex-wrap content-start items-start gap-3', className)}>
              {editedImages.map((image) => renderImageCard(image, displayIndexById.get(image.id) ?? 0))}
            </div>
          </section>
        )}
      </div>

      {displayImages.length > 0 && !isLoading && (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={openAllInEditor} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            {t('batchEdit')}
          </Button>
        </div>
      )}

      {lightboxIndex !== null && displayImages[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5 text-white" />
          </button>

          {lightboxIndex > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                prev()
              }}
              className="absolute left-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
            >
              <ChevronLeft className="h-6 w-6 text-white" />
            </button>
          )}

          {lightboxIndex < displayImages.length - 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                next()
              }}
              className="absolute right-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
            >
              <ChevronRight className="h-6 w-6 text-white" />
            </button>
          )}

          <div
            className="flex max-h-[90vh] max-w-3xl flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayImages[lightboxIndex].url}
              alt={displayImages[lightboxIndex].label ?? `Result ${lightboxIndex + 1}`}
              className="max-h-[80vh] max-w-full rounded-xl object-contain"
            />
            <div className="flex gap-2">
              <a
                href={displayImages[lightboxIndex].url}
                download
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="secondary" size="sm">
                  <Download className="mr-1.5 h-4 w-4" />
                  Download
                </Button>
              </a>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openSingleInEditor(displayImages[lightboxIndex])}
              >
                <Pencil className="mr-1.5 h-4 w-4" />
                {t('editInEditor')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
