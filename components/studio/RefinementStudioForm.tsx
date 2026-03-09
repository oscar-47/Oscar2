'use client'

import { useCallback, useRef, useState } from 'react'
import { FluidPendingCard } from '@/components/generation/FluidPendingCard'
import { ResultGallery } from '@/components/generation/ResultGallery'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { useTranslations, useLocale } from 'next-intl'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { Loader2, Plus, Download, Sparkles, FileText, Upload, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { GenerationParametersCard } from '@/components/studio/GenerationParametersCard'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { uploadFiles } from '@/lib/api/upload'
import { analyzeSingle, processGenerationJob } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import { createResultAsset, extractResultAssetMetadata } from '@/lib/utils/result-assets'
import { clampText, formatTextCounter, TEXT_LIMITS } from '@/lib/input-guard'
import type { AspectRatio, BackgroundMode, GenerationJob, GenerationModel, ImageSize } from '@/types'
import {
  DEFAULT_MODEL,
  getGenerationCreditCost,
  isValidModel,
  normalizeGenerationModel,
  sanitizeImageSizeForModel,
} from '@/types'
import { friendlyError } from '@/lib/utils'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { ImageThumbnail } from '@/components/shared/ImageThumbnail'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'

type Phase = 'idle' | 'running' | 'success' | 'failed'
type CardStatus = 'loading' | 'success' | 'failed'
type Card = { url: string | null; status: CardStatus; error?: string; productIndex: number }
type UploadedImage = { file: File; previewUrl: string }

const uid = () => crypto.randomUUID()
const MAX_IMAGES = 50
const MAX_SIZE_MB = 10
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

function fileExt(name: string): string {
  const lower = name.toLowerCase()
  const idx = lower.lastIndexOf('.')
  return idx >= 0 ? lower.slice(idx) : ''
}

function isAllowedProductFile(file: File): boolean {
  const ext = fileExt(file.name)
  const extAllowed = ext === '.jpg' || ext === '.jpeg' || ext === '.png'
  const normalizedMime = file.type.toLowerCase()
  // Some files may have an empty MIME type in certain browser/system combinations.
  const mimeAllowed =
    normalizedMime === '' ||
    normalizedMime === 'image/jpeg' ||
    normalizedMime === 'image/jpg' ||
    normalizedMime === 'image/pjpeg' ||
    normalizedMime === 'image/png'
  return extAllowed && mimeAllowed && file.size <= MAX_SIZE_BYTES
}

function triggerDirectDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function toCssAspectRatio(aspectRatio: AspectRatio): string {
  const [w, h] = aspectRatio.split(':').map((v) => Number(v))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '4 / 3'
  return `${w} / ${h}`
}

function waitForJob(
  jobId: string,
  signal: AbortSignal,
  onUpdate?: (job: GenerationJob) => void
): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let nudgeCount = 0

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer)
      supabase.removeChannel(channel)
    }
    const done = (job: GenerationJob) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(job)
    }
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const check = async () => {
      const { data } = await supabase.from('generation_jobs').select('*').eq('id', jobId).single()
      if (!data) return
      const job = data as GenerationJob
      onUpdate?.(job)
      if (job.status === 'success') done(job)
      else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      else if (++nudgeCount % 2 === 0) processGenerationJob(jobId).catch(() => {})
    }

    signal.addEventListener('abort', () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true })

    const channel = supabase
      .channel(`wait:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` },
        () => void check()
      )
      .subscribe()

    void check()
    pollTimer = setInterval(() => void check(), 2000)
  })
}

function normalizeCardsFromJob(job: GenerationJob, fallbackCount: number): {
  cards: Card[]
  requestedCount: number
  completedCount: number
} {
  const data = (job.result_data ?? {}) as Record<string, unknown>
  const summary = (data.summary ?? {}) as Record<string, unknown>
  const outputs = Array.isArray(data.outputs) ? data.outputs : []
  const requestedRaw = Number(summary.requested_count ?? fallbackCount)
  const completedRaw = Number(summary.completed_count ?? outputs.length)
  const requestedCount = Number.isFinite(requestedRaw) ? Math.max(1, requestedRaw) : Math.max(1, fallbackCount)
  const completedCount = Number.isFinite(completedRaw) ? Math.max(0, Math.min(requestedCount, completedRaw)) : 0

  const cards: Card[] = Array.from({ length: requestedCount }, (_, i) => ({
    url: null,
    status: 'loading',
    productIndex: i,
  }))

  outputs.forEach((entry, idx) => {
    const item = (entry ?? {}) as Record<string, unknown>
    const productIndexRaw = Number(item.product_index ?? idx)
    const productIndex = Number.isFinite(productIndexRaw) ? Math.max(0, Math.min(requestedCount - 1, productIndexRaw)) : idx
    const unitStatus = String(item.unit_status ?? 'pending')
    if (unitStatus === 'success' && typeof item.url === 'string' && item.url.length > 0) {
      cards[productIndex] = {
        url: item.url,
        status: 'success',
        productIndex,
      }
      return
    }
    if (unitStatus === 'failed') {
      cards[productIndex] = {
        url: null,
        status: 'failed',
        error: typeof item.error_message === 'string' ? item.error_message : undefined,
        productIndex,
      }
    }
  })

  return { cards, requestedCount, completedCount }
}

export function RefinementStudioForm() {
  const t = useTranslations('studio.refinementStudio')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const isZh = locale.startsWith('zh')
  const { total } = useCredits()

  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [userPrompt, setUserPrompt] = useState('')
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('white')
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const { promptProfile } = usePromptProfile(model)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusLine, setStatusLine] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const {
    assets: resultAssets,
    activeAssets: activeResultAssets,
    activeBatchId,
    activeBatchTimestamp,
    appendAssets: appendResultAssets,
    clearAssets: clearResultAssets,
  } = useResultAssetSession('refinement-studio')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)

  // Session persistence removed: text persisted but images didn't on refresh.

  const abortRef = useRef<AbortController | null>(null)
  const uploadedUrlsRef = useRef<string[]>([])

  const expectedCount = productImages.length
  const baseCost = getGenerationCreditCost(model, imageSize)
  const totalCost = baseCost * Math.max(1, expectedCount)
  const insufficientCredits = total !== null && total < totalCost
  const isRunning = phase === 'running'
  const canGenerate = expectedCount > 0 && !isRunning && !insufficientCredits
  const primaryActionClass = 'h-12 w-full rounded-2xl border border-primary/20 bg-primary text-primary-foreground shadow-sm hover:opacity-95 disabled:border-border disabled:bg-muted disabled:text-foreground/75 disabled:shadow-none disabled:opacity-100'
  const previewAspectRatio = toCssAspectRatio(aspectRatio)

  const addProductImages = useCallback((files: File[]) => {
    const remaining = Math.max(0, MAX_IMAGES - productImages.length)
    if (remaining <= 0) {
      setUploadError(t('uploadLimitReached'))
      return
    }

    const valid = files.filter(isAllowedProductFile)
    if (valid.length < files.length) {
      setUploadError(t('uploadInvalidFormat'))
    } else {
      setUploadError(null)
    }

    if (valid.length === 0) return
    const toAdd = valid.slice(0, remaining)
    if (valid.length > remaining) {
      setUploadError(t('uploadLimitReached'))
    }
    setProductImages((prev) => [...prev, ...toAdd.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))])
  }, [productImages.length, t])

  const removeProductImage = useCallback((index: number) => {
    setProductImages((prev) => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const onDrop = useCallback((accepted: File[], rejected: readonly FileRejection[]) => {
    if (rejected.length > 0) setUploadError(t('uploadInvalidFormat'))
    if (accepted.length > 0) addProductImages(accepted)
  }, [addProductImages, t])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/jpg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxSize: MAX_SIZE_BYTES,
    multiple: true,
    noClick: true,
    disabled: isRunning || productImages.length >= MAX_IMAGES,
  })

  const runRefinement = useCallback(
    async (
      productUrls: string[],
      mergeIndices?: number[],
      batchMeta?: { batchId: string; batchTimestamp: number },
    ) => {
      const abort = new AbortController()
      abortRef.current = abort
      const requestCount = productUrls.length
      const resolvedBatchId = batchMeta?.batchId ?? uid()
      const resolvedBatchTimestamp = batchMeta?.batchTimestamp ?? Date.now()

      setPhase('running')
      setProgress(5)
      setStatusLine(t('runningText1'))
      setErrorMessage(null)

      if (mergeIndices?.length) {
        setCards((prev) => {
          const next = [...prev]
          mergeIndices.forEach((globalIdx) => {
            next[globalIdx] = { url: null, status: 'loading', productIndex: globalIdx }
          })
          return next
        })
      } else {
        setCards(Array.from({ length: requestCount }, (_, i) => ({ url: null, status: 'loading', productIndex: i })))
      }

      const statusTimer = setInterval(() => {
        setStatusLine((prev) => (prev === t('runningText1') ? t('runningText2') : prev === t('runningText2') ? t('runningText3') : t('runningText1')))
      }, 2000)

      try {
        const { job_id } = await analyzeSingle({
          mode: 'refinement',
          referenceImage: productUrls[0],
          productImages: productUrls,
          promptProfile,
          backgroundMode,
          userPrompt: userPrompt.trim() || undefined,
          model,
          aspectRatio,
          imageSize,
          trace_id: uid(),
          client_job_id: uid(),
          fe_attempt: 1,
        })

        const applySnapshot = (job: GenerationJob) => {
          const snapshot = normalizeCardsFromJob(job, requestCount)
          const percent = Math.max(8, Math.min(98, Math.round((snapshot.completedCount / snapshot.requestedCount) * 100)))
          setProgress(percent)

          if (mergeIndices?.length) {
            setCards((prev) => {
              const merged = [...prev]
              mergeIndices.forEach((globalIdx, localIdx) => {
                const localCard = snapshot.cards[localIdx]
                if (!localCard) return
                merged[globalIdx] = {
                  ...localCard,
                  productIndex: globalIdx,
                }
              })
              return merged
            })
          } else {
            setCards(snapshot.cards)
          }
        }

        const job = await waitForJob(job_id, abort.signal, applySnapshot)
        const finalSnapshot = normalizeCardsFromJob(job, requestCount)

        if (mergeIndices?.length) {
          setCards((prev) => {
            const merged = [...prev]
            mergeIndices.forEach((globalIdx, localIdx) => {
              const localCard = finalSnapshot.cards[localIdx]
              if (!localCard) return
              merged[globalIdx] = {
                ...localCard,
                productIndex: globalIdx,
              }
            })
            return merged
          })
        } else {
          setCards(finalSnapshot.cards)
        }

        const successAssets = finalSnapshot.cards
          .filter((card) => card.status === 'success' && card.url)
          .map((card) => createResultAsset({
            url: card.url!,
            batchId: resolvedBatchId,
            batchTimestamp: resolvedBatchTimestamp,
            ...extractResultAssetMetadata(job.result_data),
            originModule: 'refinement-studio',
          }))
        if (successAssets.length > 0) {
          appendResultAssets(successAssets, {
            activeBatchId: resolvedBatchId,
            activeBatchTimestamp: resolvedBatchTimestamp,
          })
        }

        setProgress(100)
        const successCount = finalSnapshot.cards.filter((c) => c.status === 'success').length
        setPhase(successCount > 0 ? 'success' : 'failed')
        if (successCount === 0) {
          setErrorMessage(job.error_message ?? t('allFailed'))
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') {
          setErrorMessage(friendlyError(e instanceof Error ? e.message : tc('error'), isZh))
          setPhase('failed')
          setProgress(0)
        }
      } finally {
        clearInterval(statusTimer)
        refreshCredits()
      }
    },
    [appendResultAssets, aspectRatio, backgroundMode, imageSize, isZh, model, promptProfile, t, tc, userPrompt]
  )

  const handleSubmit = useCallback(async () => {
    if (!canGenerate) return

    setPhase('running')
    setProgress(3)
    setStatusLine(t('uploadingText'))
    setErrorMessage(null)
    setCards(Array.from({ length: Math.max(1, expectedCount) }, (_, i) => ({ url: null, status: 'loading', productIndex: i })))

    try {
      const uploads = await uploadFiles(productImages.map((x) => x.file))
      const urls = uploads.map((x) => x.publicUrl)
      uploadedUrlsRef.current = urls
      await runRefinement(urls, undefined, {
        batchId: uid(),
        batchTimestamp: Date.now(),
      })
    } catch (e: unknown) {
      setErrorMessage(friendlyError(e instanceof Error ? e.message : tc('error'), isZh))
      setPhase('failed')
      setProgress(0)
    }
  }, [canGenerate, expectedCount, isZh, productImages, runRefinement, t, tc])

  const retryFailed = useCallback(async () => {
    const sourceUrls = uploadedUrlsRef.current
    if (sourceUrls.length === 0) return
    const failed = cards.map((card, idx) => ({ card, idx })).filter((x) => x.card.status === 'failed')
    if (failed.length === 0) return

    const retryUrls = failed
      .map(({ idx }) => sourceUrls[idx])
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
    const mergeIndices = failed.map((x) => x.idx)
    if (retryUrls.length === 0) return
    await runRefinement(retryUrls, mergeIndices, {
      batchId: activeBatchId ?? uid(),
      batchTimestamp: activeBatchTimestamp ?? Date.now(),
    })
  }, [activeBatchId, activeBatchTimestamp, cards, runRefinement])

  const downloadAll = async () => {
    try {
      setDownloadingAll(true)
      const urls = activeResultAssets.map((asset) => asset.url)
      for (let i = 0; i < urls.length; i++) {
        triggerDirectDownload(urls[i], `refinement-${i + 1}-${Date.now()}.png`)
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    } catch (e: unknown) {
      setErrorMessage(friendlyError(e instanceof Error ? e.message : tc('error'), isZh))
      setPhase('failed')
    } finally {
      setDownloadingAll(false)
    }
  }

  const panelClass = 'rounded-[28px] border border-border bg-white'
  const selectTriggerClass = 'h-11 rounded-2xl border-border bg-secondary text-[14px] text-foreground shadow-none'
  const resultPanelTitle = phase === 'running' ? t('runningTitle') : t('resultTitle')
  const resultPanelSubtitle = phase === 'running' ? t('runningSubtitle') : t('resultSubtitle')
  const persistedHistoryGallery = resultAssets.length > 0 ? (
    <ResultGallery
      images={resultAssets}
      activeBatchId={activeBatchId}
      aspectRatio={aspectRatio}
      editorSessionKey="refinement-studio"
      originModule="refinement-studio"
      onClear={clearResultAssets}
    />
  ) : null

  return (
    <>
    <CorePageShell maxWidthClass="max-w-[1360px]" contentClassName="space-y-8">
      <div className="mb-7 flex items-start gap-3">
        <SectionIcon icon={ImageIcon} className="mt-1" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              {t('heroBadge')}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className={`${panelClass} p-5`}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <SectionIcon icon={ImageIcon} className="mt-0.5" />
                <div>
                  <p className="text-[15px] font-semibold text-foreground">{tc('productImage')}</p>
                  <p className="text-[13px] text-muted-foreground">{t('productUploadSubtitle')}</p>
                </div>
              </div>
              <span className="text-[13px] text-muted-foreground">{productImages.length}/{MAX_IMAGES}</span>
            </div>

            <div className="mt-4">
              {productImages.length === 0 ? (
                <div
                  {...getRootProps()}
                  className={`cursor-pointer rounded-[24px] border-2 border-dashed p-8 text-center transition-colors ${
                    isDragActive ? 'border-muted-foreground bg-muted' : 'border-border bg-secondary hover:border-muted-foreground'
                  }`}
                  onClick={open}
                >
                  <input {...getInputProps()} />
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-[15px] font-medium text-foreground">{t('uploadDropLabel')}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">{t('uploadDropMeta')}</p>
                </div>
              ) : (
                <div
                  {...getRootProps()}
                  className={`rounded-[24px] border p-3 ${
                    isDragActive ? 'border-muted-foreground bg-muted' : 'border-border bg-secondary'
                  }`}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-wrap gap-2.5">
                    {productImages.map((img, i) => (
                      <ImageThumbnail
                        key={img.previewUrl}
                        src={img.previewUrl}
                        alt={`product-${i + 1}`}
                        size="sm"
                        onRemove={() => removeProductImage(i)}
                        disabled={isRunning}
                      />
                    ))}
                    {productImages.length < MAX_IMAGES && (
                      <button
                        type="button"
                        onClick={open}
                        disabled={isRunning}
                        className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
              <p className="mt-3 text-[13px] text-muted-foreground">{t('uploadSupportHint')}</p>
              {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
            </div>
          </section>

          <section className={`${panelClass} p-5`}>
            <div className="flex items-start gap-3">
              <SectionIcon icon={FileText} className="mt-0.5" />
              <div>
                <p className="text-[15px] font-semibold text-foreground">{t('requirementsTitle')}</p>
                <p className="text-[13px] text-muted-foreground">{t('requirementsSubtitle')}</p>
              </div>
            </div>

            <Textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(clampText(e.target.value, TEXT_LIMITS.brief))}
              rows={4}
              maxLength={TEXT_LIMITS.brief}
              placeholder={t('requirementsExample')}
              disabled={isRunning}
              className="mt-4 resize-none rounded-2xl border-border bg-secondary px-4 py-3 text-[14px] text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {formatTextCounter(userPrompt, TEXT_LIMITS.brief, isZh)}
            </p>

          </section>

          <GenerationParametersCard
            model={model}
            onModelChange={setModel}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
          imageSize={imageSize}
          onImageSizeChange={setImageSize}
          disabled={isRunning}
          aspectRatioOptions={['1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9']}
          extraFields={
              <div className="mt-4 space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">{t('backgroundMode')}</Label>
                <Select value={backgroundMode} onValueChange={(v) => setBackgroundMode(v as BackgroundMode)} disabled={isRunning}>
                  <SelectTrigger className={selectTriggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="white">{t('backgroundWhite')}</SelectItem>
                    <SelectItem value="original">{t('backgroundOriginal')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          />

          <section className={`${panelClass} p-4`}>
            <div className="mt-0">
              {isRunning ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button className={primaryActionClass} disabled>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('generating')}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl border-border bg-secondary text-foreground"
                    onClick={() => {
                      abortRef.current?.abort()
                      setPhase('idle')
                      setProgress(0)
                    }}
                  >
                    {tc('stop')}
                  </Button>
                </div>
              ) : (
                <Button
                  className={primaryActionClass}
                  disabled={!canGenerate}
                  onClick={handleSubmit}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {expectedCount > 0 ? t('generateBatchCount', { count: expectedCount }) : t('generate')}
                </Button>
              )}
            </div>

            <div className="mt-2 flex justify-end">
              <CreditCostBadge cost={totalCost} className="px-3 py-1 text-[13px]" />
            </div>

            {insufficientCredits && (
              <p className="mt-2 text-xs text-destructive">{tc('insufficientCredits')}</p>
            )}
          </section>
        </div>

        <div className={`${panelClass} min-h-[840px] p-5 sm:p-6`}>
          <div className="mb-4 flex items-start gap-3">
            <SectionIcon icon={Sparkles} className="mt-0.5" />
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">{resultPanelTitle}</h2>
              <p className="text-[13px] text-muted-foreground">{resultPanelSubtitle}</p>
            </div>
          </div>

          {phase === 'running' && (
            <CoreProcessingStatus
              title={t('runningTitle')}
              subtitle={t('runningSubtitle')}
              progress={progress}
              statusLine={statusLine}
              showHeader={false}
              statusPlacement="below"
            />
          )}

          {phase === 'failed' && errorMessage && (
            <div className="mb-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          {phase === 'idle' && resultAssets.length === 0 && cards.length === 0 ? (
            <div className="flex min-h-[620px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Sparkles className="h-8 w-8" />
                </div>
                <p className="text-[15px] text-muted-foreground">{t('waiting')}</p>
                <p className="mt-1 text-[15px] text-muted-foreground">{t('waitingActionHint')}</p>
              </div>
            </div>
          ) : phase === 'running' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap content-start items-start gap-3">
                {cards.map((card, i) =>
                  card.status === 'loading' ? (
                    <FluidPendingCard key={i} aspectRatio={previewAspectRatio} className="w-[220px] max-w-full rounded-2xl" />
                  ) : card.status === 'failed' ? (
                    <div key={i} className="w-[220px] max-w-full rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                      {card.error ?? tc('error')}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="w-[220px] max-w-full overflow-hidden rounded-2xl border border-border bg-secondary opacity-60"
                      style={{ aspectRatio: previewAspectRatio }}
                    >
                      <img src={card.url!} alt={`result-${i + 1}`} className="w-full object-cover" />
                    </div>
                  )
                )}
              </div>
              {persistedHistoryGallery}
            </div>
          ) : (
            <div className="space-y-3">
              {persistedHistoryGallery}
              {cards.some((card) => card.status === 'failed') && (
                <div className="flex flex-wrap content-start items-start gap-3">
                  {cards.filter((card) => card.status === 'failed').map((card, index) => (
                    <div key={`failed-${index}`} className="w-[220px] max-w-full rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                      {card.error ?? tc('error')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(cards.length > 0 || resultAssets.length > 0) && phase !== 'running' && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <Button
                variant="outline"
                className="rounded-2xl border-border bg-surface text-foreground"
                onClick={downloadAll}
                disabled={activeResultAssets.length === 0 || downloadingAll}
              >
                {downloadingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {t('downloadAllSuccess')}
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl border-border bg-surface text-foreground"
                onClick={retryFailed}
                disabled={!cards.some((x) => x.status === 'failed') || downloadingAll}
              >
                {t('retryFailed')}
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl border-border bg-surface text-foreground"
                onClick={handleSubmit}
                disabled={!canGenerate || downloadingAll}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('regenerateAll')}
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl border-border bg-surface text-foreground"
                onClick={clearResultAssets}
                disabled={resultAssets.length === 0 || downloadingAll}
              >
                {isZh ? '清除历史' : 'Clear History'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </CorePageShell>
    </>
  )
}
