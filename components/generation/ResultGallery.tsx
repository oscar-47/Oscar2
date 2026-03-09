'use client'

import { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createEditorSession } from '@/lib/utils/editor-session'
import { FluidPendingCard } from '@/components/generation/FluidPendingCard'
import { groupResultAssetsByBatch, splitResultAssetsByActiveBatch } from '@/lib/utils/result-assets'
import type { ResultAsset, ResultAssetOrigin } from '@/types'

export type ResultImage = ResultAsset

interface ResultGalleryProps {
  images: ResultImage[]
  isLoading?: boolean
  loadingCount?: number
  className?: string
  aspectRatio?: string
  historyInitiallyExpanded?: boolean
  onImageClick?: (image: ResultImage, index: number) => void
  onClear?: () => void
  editorSessionKey?: string
  originModule?: ResultAssetOrigin
  activeBatchId?: string
}

interface LightboxState {
  images: ResultImage[]
  index: number
}

function sanitizeFilenamePart(value?: string): string {
  return (value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function inferExtension(url: string, contentType?: string | null): string {
  const normalizedType = contentType?.toLowerCase() ?? ''
  if (normalizedType.includes('png')) return '.png'
  if (normalizedType.includes('jpeg') || normalizedType.includes('jpg')) return '.jpg'
  if (normalizedType.includes('webp')) return '.webp'

  try {
    const pathname = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').pathname
    const match = pathname.match(/\.(png|jpe?g|webp)(?:$|\?)/i)
    if (match) return `.${match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()}`
  } catch {}

  return '.png'
}

function buildDownloadFilename(image: ResultImage, contentType?: string | null): string {
  const baseParts = [
    'shopix',
    sanitizeFilenamePart(image.originModule),
    sanitizeFilenamePart(image.label),
  ].filter(Boolean)

  const baseName = baseParts.join('-') || 'shopix-image'
  return `${baseName}${inferExtension(image.url, contentType)}`
}

function toCssAspectRatio(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(':').map((value) => Number(value))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '4 / 3'
  return `${w} / ${h}`
}

function SkeletonCard({ aspectRatio }: { aspectRatio: string }) {
  return <FluidPendingCard aspectRatio={aspectRatio} className="w-[220px] max-w-full" />
}

function formatBatchTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function ResultGallery({
  images,
  isLoading = false,
  loadingCount = 1,
  className,
  aspectRatio = '4:3',
  historyInitiallyExpanded = false,
  onImageClick,
  onClear,
  editorSessionKey,
  originModule = 'unknown',
  activeBatchId,
}: ResultGalleryProps) {
  const t = useTranslations('studio.editor')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const router = useRouter()
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(historyInitiallyExpanded)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const cssAspectRatio = toCssAspectRatio(aspectRatio)

  const {
    activeAssets,
    historicalAssets,
    activeBatchTimestamp,
  } = useMemo(
    () => splitResultAssetsByActiveBatch(images, activeBatchId),
    [activeBatchId, images],
  )

  const currentOriginalImages = useMemo(
    () => activeAssets.filter((image) => image.section !== 'edited'),
    [activeAssets],
  )
  const currentEditedImages = useMemo(
    () => [...activeAssets.filter((image) => image.section === 'edited')]
      .sort((left, right) => right.createdAt - left.createdAt),
    [activeAssets],
  )
  const currentDisplayImages = useMemo(
    () => [...currentOriginalImages, ...currentEditedImages],
    [currentEditedImages, currentOriginalImages],
  )
  const historicalGroups = useMemo(
    () => groupResultAssetsByBatch(historicalAssets),
    [historicalAssets],
  )

  const openLightbox = (batchImages: ResultImage[], index: number) => {
    setLightbox({ images: batchImages, index })
  }

  const closeLightbox = () => setLightbox(null)
  const prev = () => setLightbox((state) => (
    state ? { ...state, index: Math.max(0, state.index - 1) } : null
  ))
  const next = () => setLightbox((state) => (
    state ? { ...state, index: Math.min(state.images.length - 1, state.index + 1) } : null
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

  const downloadImage = useCallback(async (image: ResultImage) => {
    if (!image.url || downloadingId === image.id) return

    try {
      setDownloadingId(image.id)
      const response = await fetch(image.url)
      if (!response.ok) throw new Error(`DOWNLOAD_FAILED_${response.status}`)

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = buildDownloadFilename(image, blob.type)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      console.error('Failed to download image directly, falling back to opening the asset URL.', error)
      window.open(image.url, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloadingId(null)
    }
  }, [downloadingId])

  if (!isLoading && images.length === 0) return null

  const hasHistory = historicalGroups.length > 0

  const renderImageCard = (image: ResultImage, index: number, batchImages: ResultImage[]) => (
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

      {image.label && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 px-3 py-2">
          <p className="text-xs font-medium text-white">{image.label}</p>
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openLightbox(batchImages, index)
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
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void downloadImage(image)
          }}
          disabled={downloadingId === image.id}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/30"
          title={tc('download')}
        >
          <Download className="h-4 w-4 text-white" />
        </button>
      </div>
    </motion.div>
  )

  const renderSection = (
    sectionTitle: string,
    sectionImages: ResultImage[],
    sectionKey: string,
  ) => {
    if (!isLoading && sectionImages.length === 0) return null

    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-muted-foreground">{sectionTitle}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className={cn('flex flex-wrap content-start items-start gap-3', className)}>
          {isLoading && sectionKey === 'current-original' && Array.from({ length: loadingCount }).map((_, index) => (
            <SkeletonCard key={`original-skel-${index}`} aspectRatio={cssAspectRatio} />
          ))}
          {sectionImages.map((image, index) => renderImageCard(image, index, sectionImages))}
        </div>
      </section>
    )
  }

  const renderBatchHeader = (batchIndex: number, batchTimestamp?: number, isLegacy?: boolean) => {
    const baseLabel = isLegacy
      ? t('legacyBatch')
      : t('batchLabel', { index: batchIndex + 1 })

    return (
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
          {baseLabel}
          {batchTimestamp ? ` · ${formatBatchTime(batchTimestamp)}` : ''}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }

  return (
    <>
      {onClear && images.length > 0 && !isLoading && (
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
        {hasHistory && (
          <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{t('currentBatch')}</span>
              {activeBatchTimestamp ? <span>· {formatBatchTime(activeBatchTimestamp)}</span> : null}
            </div>
          </div>
        )}

        {renderSection(t('originalSection'), currentOriginalImages, 'current-original')}
        {renderSection(t('editedSection'), currentEditedImages, 'current-edited')}

        {hasHistory && (
          <section className="rounded-2xl border border-border/70 bg-muted/10">
            <button
              type="button"
              onClick={() => setHistoryExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t('historySection')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locale === 'zh'
                    ? `${historicalGroups.length} 批结果`
                    : `${historicalGroups.length} batch${historicalGroups.length === 1 ? '' : 'es'}`}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{historyExpanded ? t('hideHistory') : t('showHistory')}</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', historyExpanded && 'rotate-180')} />
              </div>
            </button>

            {historyExpanded && (
              <div className="border-t border-border/70 px-4 py-4">
                <div className="space-y-5">
                  {historicalGroups.map((group, batchIndex) => {
                    const historicalOriginalImages = group.images.filter((image) => image.section !== 'edited')
                    const historicalEditedImages = [...group.images.filter((image) => image.section === 'edited')]
                      .sort((left, right) => right.createdAt - left.createdAt)

                    return (
                      <div key={group.key} className="space-y-4">
                        {renderBatchHeader(batchIndex, group.batchTimestamp, group.isLegacy)}
                        {historicalOriginalImages.length > 0 && renderSection(
                          t('originalSection'),
                          historicalOriginalImages,
                          `${group.key}-original`,
                        )}
                        {historicalEditedImages.length > 0 && renderSection(
                          t('editedSection'),
                          historicalEditedImages,
                          `${group.key}-edited`,
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {currentDisplayImages.length > 0 && !isLoading && (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => openAssetsInEditor(currentDisplayImages)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            {t('batchEdit')}
          </Button>
        </div>
      )}

      {lightbox && lightbox.images[lightbox.index] && (
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

          {lightbox.index > 0 && (
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

          {lightbox.index < lightbox.images.length - 1 && (
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
              src={lightbox.images[lightbox.index].url}
              alt={lightbox.images[lightbox.index].label ?? `Result ${lightbox.index + 1}`}
              className="max-h-[80vh] max-w-full rounded-xl object-contain"
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void downloadImage(lightbox.images[lightbox.index])}
                disabled={downloadingId === lightbox.images[lightbox.index].id}
              >
                  <Download className="mr-1.5 h-4 w-4" />
                  {tc('download')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openSingleInEditor(lightbox.images[lightbox.index])}
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
