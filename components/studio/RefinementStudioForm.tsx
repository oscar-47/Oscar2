'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { Loader2, Plus, Download, Sparkles, FileText, Upload, X, ImageIcon, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { uploadFiles } from '@/lib/api/upload'
import { analyzeSingle, processGenerationJob } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { AspectRatio, BackgroundMode, GenerationJob, GenerationModel, ImageSize } from '@/types'
import { DEFAULT_CREDIT_COSTS } from '@/types'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { ImageThumbnail } from '@/components/shared/ImageThumbnail'

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
  const { total } = useCredits()

  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [userPrompt, setUserPrompt] = useState('')
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('white')
  const [model, setModel] = useState<GenerationModel>('flux-kontext-pro')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('2K')
  const [turboEnabled, setTurboEnabled] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusLine, setStatusLine] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const uploadedUrlsRef = useRef<string[]>([])

  const expectedCount = productImages.length
  const baseCost = Math.max(DEFAULT_CREDIT_COSTS[model] ?? 5, 5)
  const turboExtra = imageSize === '1K' ? 8 : imageSize === '2K' ? 12 : 16
  const unitCost = turboEnabled ? baseCost + turboExtra : baseCost
  const totalCost = unitCost * Math.max(1, expectedCount)
  const insufficientCredits = total !== null && total < totalCost
  const isRunning = phase === 'running'
  const canGenerate = expectedCount > 0 && !isRunning && !insufficientCredits
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
    async (productUrls: string[], mergeIndices?: number[]) => {
      const abort = new AbortController()
      abortRef.current = abort
      const requestCount = productUrls.length

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
          backgroundMode,
          userPrompt: userPrompt.trim() || undefined,
          model,
          aspectRatio,
          imageSize,
          turboEnabled,
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

        setProgress(100)
        const successCount = finalSnapshot.cards.filter((c) => c.status === 'success').length
        setPhase(successCount > 0 ? 'success' : 'failed')
        if (successCount === 0) {
          setErrorMessage(job.error_message ?? t('allFailed'))
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') {
          setErrorMessage(e instanceof Error ? e.message : tc('error'))
          setPhase('failed')
          setProgress(0)
        }
      } finally {
        clearInterval(statusTimer)
        refreshCredits()
      }
    },
    [aspectRatio, backgroundMode, imageSize, model, t, tc, turboEnabled, userPrompt]
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
      await runRefinement(urls)
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : tc('error'))
      setPhase('failed')
      setProgress(0)
    }
  }, [canGenerate, expectedCount, productImages, runRefinement, t, tc])

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
    await runRefinement(retryUrls, mergeIndices)
  }, [cards, runRefinement])

  const downloadOne = (url: string, index: number) => {
    try {
      setDownloadingIndex(index)
      triggerDirectDownload(url, `refinement-${index + 1}-${Date.now()}.png`)
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : tc('error'))
      setPhase('failed')
    } finally {
      setDownloadingIndex(null)
    }
  }

  const downloadAll = async () => {
    try {
      setDownloadingAll(true)
      const urls = cards.filter((x) => x.status === 'success' && x.url).map((x) => x.url as string)
      for (let i = 0; i < urls.length; i++) {
        triggerDirectDownload(urls[i], `refinement-${i + 1}-${Date.now()}.png`)
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : tc('error'))
      setPhase('failed')
    } finally {
      setDownloadingAll(false)
    }
  }

  const panelClass = 'rounded-[28px] border border-[#d0d4dc] bg-white'
  const selectTriggerClass = 'h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] text-[#1b1f26] shadow-none'
  const resultPanelTitle = phase === 'running' ? '分析中...' : t('resultTitle')
  const resultPanelSubtitle = phase === 'running' ? '正在分析产品并生成设计规范' : t('resultSubtitle')

  return (
    <CorePageShell maxWidthClass="max-w-[1360px]" contentClassName="space-y-8">
      <div className="pt-4 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#d0d4dc] bg-[#f1f3f6] px-4 py-1.5 text-xs font-medium text-[#1e2127]">
          <Sparkles className="h-4 w-4" />
          <span>{t('heroBadge')}</span>
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#17181d] sm:text-4xl">{t('title')}</h1>
        <p className="mx-auto mt-3 max-w-[900px] text-sm leading-relaxed text-[#5f6672] sm:text-base">{t('description')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className={`${panelClass} p-5`}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <SectionIcon icon={ImageIcon} className="mt-0.5" />
                <div>
                  <p className="text-[15px] font-semibold text-[#1a1d24]">{tc('productImage')}</p>
                  <p className="text-[13px] text-[#666d79]">{t('productUploadSubtitle')}</p>
                </div>
              </div>
              <span className="text-[13px] text-[#616875]">{productImages.length}/{MAX_IMAGES}</span>
            </div>

            <div className="mt-4">
              {productImages.length === 0 ? (
                <div
                  {...getRootProps()}
                  className={`cursor-pointer rounded-[24px] border-2 border-dashed p-8 text-center transition-colors ${
                    isDragActive ? 'border-[#8d94a2] bg-[#e9edf2]' : 'border-[#d0d4dc] bg-[#f1f3f6] hover:border-[#8e96a4]'
                  }`}
                  onClick={open}
                >
                  <input {...getInputProps()} />
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#ebedf0]">
                    <Upload className="h-6 w-6 text-[#70747d]" />
                  </div>
                  <p className="text-[15px] font-medium text-[#2f333b]">{t('uploadDropLabel')}</p>
                  <p className="mt-1 text-[13px] text-[#686f7c]">{t('uploadDropMeta')}</p>
                </div>
              ) : (
                <div
                  {...getRootProps()}
                  className={`rounded-[24px] border p-3 ${
                    isDragActive ? 'border-[#8d94a2] bg-[#e9edf2]' : 'border-[#d0d4dc] bg-[#f1f3f6]'
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
                        className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-[#c8ccd4] text-[#6f737c] transition-colors hover:bg-[#eceef2] disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
              <p className="mt-3 text-[13px] text-[#5f6672]">{t('uploadSupportHint')}</p>
              {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
            </div>
          </section>

          <section className={`${panelClass} p-5`}>
            <div className="flex items-start gap-3">
              <SectionIcon icon={FileText} className="mt-0.5" />
              <div>
                <p className="text-[15px] font-semibold text-[#1a1d24]">{t('requirementsTitle')}</p>
                <p className="text-[13px] text-[#666d79]">{t('requirementsSubtitle')}</p>
              </div>
            </div>

            <Textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={4}
              placeholder={t('requirementsExample')}
              disabled={isRunning}
              className="mt-4 resize-none rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] px-4 py-3 text-[14px] text-[#20242c] placeholder:text-[#7c8390] focus-visible:ring-0 focus-visible:ring-offset-0"
            />

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{tc('model')}</Label>
                <Select value={model} onValueChange={(v) => setModel(v as GenerationModel)} disabled={isRunning}>
                  <SelectTrigger className={selectTriggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flux-kontext-pro">FLUX.1 Kontext Pro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{t('backgroundMode')}</Label>
                <Select value={backgroundMode} onValueChange={(v) => setBackgroundMode(v as BackgroundMode)} disabled={isRunning}>
                  <SelectTrigger className={selectTriggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="white">{t('backgroundWhite')}</SelectItem>
                    <SelectItem value="original">{t('backgroundOriginal')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{tc('aspectRatio')}</Label>
                <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)} disabled={isRunning}>
                  <SelectTrigger className={selectTriggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9'] as AspectRatio[]).map((ratio) => (
                      <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{tc('imageSize')}</Label>
                <Select value={imageSize} onValueChange={(v) => setImageSize(v as ImageSize)} disabled={isRunning}>
                  <SelectTrigger className={selectTriggerClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1K">1K</SelectItem>
                    <SelectItem value="2K">2K</SelectItem>
                    <SelectItem value="4K">4K</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className={`${panelClass} p-4`}>
            <div className="flex items-center justify-between rounded-[16px] border border-[#d0d4dc] bg-[#f1f3f6] px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${turboEnabled ? 'bg-[#e7f8ee] text-[#22b968]' : 'bg-[#eceef2] text-[#6f737c]'}`}>
                  <Zap className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-[#1a1d24]">{t('turboTitle')}</p>
                  <p className="text-[12px] text-[#636b78]">{t('turboDesc')}</p>
                </div>
              </div>
              <Switch
                checked={turboEnabled}
                onCheckedChange={setTurboEnabled}
                className="h-8 w-14 border-0 data-[state=checked]:bg-[#1a1d24] data-[state=unchecked]:bg-[#d8d9dd]"
              />
            </div>

            <div className="mt-4">
              {isRunning ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-12 w-full rounded-2xl bg-[#8e9096] text-white hover:bg-[#84868d]" disabled>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('generating')}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl border-[#d0d3da] bg-[#f4f5f6] text-[#242830]"
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
                  className="h-12 w-full rounded-2xl bg-[#191b22] text-white hover:bg-[#13151a] disabled:bg-[#9a9ca3] disabled:text-white"
                  disabled={!canGenerate}
                  onClick={handleSubmit}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('generate')}
                </Button>
              )}
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
              <h2 className="text-[15px] font-semibold text-[#1a1d24]">{resultPanelTitle}</h2>
              <p className="text-[13px] text-[#666d79]">{resultPanelSubtitle}</p>
            </div>
          </div>

          {phase === 'running' && (
            <CoreProcessingStatus
              title="分析中..."
              subtitle="正在分析产品并生成设计规范"
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

          {phase === 'idle' && cards.length === 0 ? (
            <div className="flex min-h-[620px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#e8eaef] text-[#767b86]">
                  <Sparkles className="h-8 w-8" />
                </div>
                <p className="text-[15px] text-[#5f6672]">{t('waiting')}</p>
                <p className="mt-1 text-[15px] text-[#5f6672]">{t('waitingActionHint')}</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
              {cards.map((card, i) =>
                card.status === 'success' && card.url ? (
                  <div
                    key={i}
                    className="group relative overflow-hidden rounded-2xl border border-[#d2d6de] bg-[#eef0f4]"
                    style={{ aspectRatio: previewAspectRatio }}
                  >
                    <img src={card.url} alt={`result-${i + 1}`} className="w-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => downloadOne(card.url as string, i)}
                        disabled={downloadingIndex === i || downloadingAll}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/30 disabled:opacity-60"
                      >
                        {downloadingIndex === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                ) : card.status === 'failed' ? (
                  <div key={i} className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                    {card.error ?? tc('error')}
                  </div>
                ) : (
                  <div
                    key={i}
                    className="flex items-center justify-center rounded-2xl border border-[#d0d4db] bg-[#eff1f4]"
                    style={{ aspectRatio: previewAspectRatio }}
                  >
                    <Loader2 className="h-5 w-5 animate-spin text-[#6f737c]" />
                  </div>
                )
              )}
            </div>
          )}

          {cards.length > 0 && phase !== 'running' && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button
                variant="outline"
                className="rounded-2xl border-[#cfd3db] bg-[#f4f5f7] text-[#2b2f38]"
                onClick={downloadAll}
                disabled={!cards.some((x) => x.status === 'success') || downloadingAll || downloadingIndex !== null}
              >
                {downloadingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {t('downloadAllSuccess')}
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl border-[#cfd3db] bg-[#f4f5f7] text-[#2b2f38]"
                onClick={retryFailed}
                disabled={!cards.some((x) => x.status === 'failed') || downloadingAll || downloadingIndex !== null}
              >
                {t('retryFailed')}
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl border-[#cfd3db] bg-[#f4f5f7] text-[#2b2f38]"
                onClick={handleSubmit}
                disabled={!canGenerate || downloadingAll || downloadingIndex !== null}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('regenerateAll')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </CorePageShell>
  )
}
