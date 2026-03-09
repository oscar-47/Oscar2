'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { FluidPendingCard } from '@/components/generation/FluidPendingCard'
import { ResultGallery } from '@/components/generation/ResultGallery'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ImageUploader } from '@/components/upload/ImageUploader'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { ModelTextHint } from '@/components/studio/ModelTextHint'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { uploadFile, uploadFiles } from '@/lib/api/upload'
import { analyzeSingle, processGenerationJob } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { GenerationModel, AspectRatio, ImageSize, GenerationJob } from '@/types'
import {
  AVAILABLE_MODELS,
  getAvailableModels,
  DEFAULT_MODEL,
  getGenerationCreditCost,
  getSupportedImageSizes,
  isValidModel,
  normalizeGenerationModel,
  sanitizeImageSizeForModel,
} from '@/types'
import { useUserEmail } from '@/lib/hooks/useUserEmail'
import { createResultAsset, extractResultAssetMetadata } from '@/lib/utils/result-assets'
import { friendlyError } from '@/lib/utils'
import { Download, GalleryVerticalEnd, Image as ImageIcon, LayoutGrid, Loader2, Plus, ShieldCheck, Sparkles } from 'lucide-react'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { ImageThumbnail } from '@/components/shared/ImageThumbnail'

type Mode = 'single' | 'batch'
type Phase = 'idle' | 'running' | 'success' | 'failed'
type CardStatus = 'loading' | 'success' | 'failed'
type Card = { url: string | null; status: CardStatus; error?: string; referenceIndex: number; groupIndex: number }
type UImg = { file: File; previewUrl: string }

const uid = () => crypto.randomUUID()

function toCssAspectRatio(aspectRatio: AspectRatio): string {
  const [w, h] = aspectRatio.split(':').map((v) => Number(v))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '4 / 3'
  return `${w} / ${h}`
}

function waitForJob(jobId: string, signal: AbortSignal): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let nudgeCount = 0
    const cleanup = () => { if (pollTimer) clearInterval(pollTimer); supabase.removeChannel(channel) }
    const done = (job: GenerationJob) => { if (settled) return; settled = true; cleanup(); resolve(job) }
    const fail = (e: Error) => { if (settled) return; settled = true; cleanup(); reject(e) }

    const check = async () => {
      const { data } = await supabase.from('generation_jobs').select('*').eq('id', jobId).single()
      if (!data) return
      const job = data as GenerationJob
      if (job.status === 'success') done(job)
      else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      else if (++nudgeCount % 2 === 0) processGenerationJob(jobId).catch(() => {})
    }

    signal.addEventListener('abort', () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true })
    const channel = supabase.channel(`wait:${jobId}`).on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` },
      (payload) => {
        const job = payload.new as GenerationJob
        if (job.status === 'success') done(job)
        else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      }
    ).subscribe()
    void check()
    pollTimer = setInterval(() => void check(), 2000)
  })
}

export function AestheticMirrorForm() {
  const t = useTranslations('studio.aestheticMirror')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const router = useRouter()
  const { total } = useCredits()
  const userEmail = useUserEmail()

  const [mode, setMode] = useState<Mode>('single')
  const [singleRefFile, setSingleRefFile] = useState<File | null>(null)
  const [singleRefPreview, setSingleRefPreview] = useState<string | null>(null)
  const [singleProducts, setSingleProducts] = useState<UImg[]>([])
  const [batchRefs, setBatchRefs] = useState<UImg[]>([])
  const [batchProduct, setBatchProduct] = useState<UImg | null>(null)
  const [userPrompt, setUserPrompt] = useState('')
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const { promptProfile } = usePromptProfile(model)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [imageCount, setImageCount] = useState(1)
  const [groupCount, setGroupCount] = useState(1)
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
  } = useResultAssetSession('aesthetic-mirror')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)

  // Session persistence removed: text persisted but images didn't on refresh.

  const abortRef = useRef<AbortController | null>(null)
  const productInputRef = useRef<HTMLInputElement | null>(null)
  const batchRefInputRef = useRef<HTMLInputElement | null>(null)
  const batchProductInputRef = useRef<HTMLInputElement | null>(null)
  const lastRequestRef = useRef<{
    refs: string[]
    product: string
    prompt: string | undefined
  } | null>(null)

  const expectedCount = mode === 'batch' ? batchRefs.length * groupCount : singleProducts.length * imageCount
  const baseCost = getGenerationCreditCost(model, imageSize)
  const totalCost = baseCost * Math.max(1, expectedCount)
  const insufficientCredits = total !== null && total < totalCost
  const isRunning = phase === 'running'
  const isZh = locale.startsWith('zh')
  const previewAspectRatio = toCssAspectRatio(aspectRatio)
  const resultPanelTitle = phase === 'running'
    ? (isZh ? '分析中...' : 'Analyzing...')
    : mode === 'batch'
      ? t('batchResultTitle')
      : tc('results')
  const resultPanelSubtitle = phase === 'running'
    ? (isZh ? '正在分析参考图并生成设计规范' : 'Analyzing references and generating design specs')
    : (isZh ? '上传产品图并点击分析开始' : "Upload product images and click 'Analyze' to start.")
  const canGenerate = mode === 'single'
    ? !!singleRefFile && singleProducts.length > 0 && !isRunning && !insufficientCredits
    : batchRefs.length > 0 && !!batchProduct && !isRunning && !insufficientCredits

  // FLUX Kontext Pro supports all resolutions

  const parseCards = (job: GenerationJob): Card[] => {
    const data = (job.result_data ?? {}) as Record<string, unknown>
    const rows = Array.isArray(data.outputs) ? data.outputs : []
    if (rows.length > 0) {
      return rows.map((v) => {
        const item = (v ?? {}) as Record<string, unknown>
        return {
          url: typeof item.url === 'string' ? item.url : null,
          status: item.unit_status === 'failed' ? 'failed' : (typeof item.url === 'string' ? 'success' : 'failed'),
          error: typeof item.error_message === 'string' ? item.error_message : undefined,
          referenceIndex: Number(item.reference_index ?? 0),
          groupIndex: Number(item.group_index ?? 0),
        }
      })
    }
    return job.result_url ? [{ url: job.result_url, status: 'success', referenceIndex: 0, groupIndex: 0 }] : []
  }

  const runRequest = useCallback(async (
    request: Record<string, unknown>,
    slots: number,
    mergeIdx?: number[],
    batchMeta?: { batchId: string; batchTimestamp: number },
  ) => {
    const abort = new AbortController()
    abortRef.current = abort
    const resolvedBatchId = batchMeta?.batchId ?? uid()
    const resolvedBatchTimestamp = batchMeta?.batchTimestamp ?? Date.now()
    setPhase('running'); setProgress(10); setStatusLine(t('runningText1')); setErrorMessage(null)
    if (!mergeIdx?.length) {
      const loadingCards: Card[] = Array.from({ length: Math.max(1, slots) }, (_, i) => ({ url: null, status: 'loading' as const, referenceIndex: i, groupIndex: 0 }))
      setCards(loadingCards)
    }
    const progressTimer = setInterval(() => setProgress((p) => Math.min(90, p + 7)), 900)
    const statusTimer = setInterval(() => setStatusLine((s) => s === t('runningText1') ? t('runningText2') : s === t('runningText2') ? t('runningText3') : t('runningText1')), 1800)
    try {
      const { job_id } = await analyzeSingle({
        ...request,
        promptProfile,
        trace_id: uid(),
        client_job_id: uid(),
        fe_attempt: 1,
      } as any)
      const job = await waitForJob(job_id, abort.signal)
      const next = parseCards(job)
      if (!next.length) throw new Error(t('noResultError'))
      const successAssets = next
        .filter((card) => card.status === 'success' && card.url)
        .map((card) => createResultAsset({
          url: card.url!,
          batchId: resolvedBatchId,
          batchTimestamp: resolvedBatchTimestamp,
          ...extractResultAssetMetadata(job.result_data),
          originModule: 'aesthetic-mirror',
        }))
      if (mergeIdx?.length) {
        setCards((prev) => {
          const merged = [...prev]
          mergeIdx.forEach((idx, i) => { if (next[i]) merged[idx] = { ...next[i], referenceIndex: merged[idx]?.referenceIndex ?? next[i].referenceIndex, groupIndex: merged[idx]?.groupIndex ?? next[i].groupIndex } })
          return merged
        })
      } else {
        setCards(next)
      }
      if (successAssets.length > 0) {
        appendResultAssets(successAssets, {
          activeBatchId: resolvedBatchId,
          activeBatchTimestamp: resolvedBatchTimestamp,
        })
      }
      setProgress(100); setPhase('success')
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') { setErrorMessage(friendlyError(e instanceof Error ? e.message : tc('error'), isZh)); setPhase('failed'); setProgress(0) }
    } finally {
      clearInterval(progressTimer); clearInterval(statusTimer); refreshCredits()
    }
  }, [appendResultAssets, isZh, promptProfile, t, tc])

  const handleSubmit = useCallback(async () => {
    // Set running state immediately so the button disables on click
    setPhase('running'); setProgress(5); setStatusLine(t('runningText1')); setErrorMessage(null)
    try {
      const finalPrompt = userPrompt.trim() || undefined
      if (mode === 'single') {
        if (!singleRefFile || !singleProducts.length) { setPhase('idle'); return }
        const [{ publicUrl: referenceImage }, products] = await Promise.all([uploadFile(singleRefFile), uploadFiles(singleProducts.map((x) => x.file))])
        lastRequestRef.current = { refs: [referenceImage], product: products[0].publicUrl, prompt: finalPrompt }
        await runRequest(
          {
            mode: 'single',
            referenceImage,
            productImages: products.map((x) => x.publicUrl),
            model,
            aspectRatio,
            imageSize,
            imageCount,
            userPrompt: finalPrompt,
          },
          products.length * imageCount,
          undefined,
          { batchId: uid(), batchTimestamp: Date.now() },
        )
        return
      }
      if (!batchRefs.length || !batchProduct) { setPhase('idle'); return }
      const [refs, product] = await Promise.all([uploadFiles(batchRefs.map((x) => x.file)), uploadFile(batchProduct.file)])
      const refUrls = refs.map((x) => x.publicUrl)
      lastRequestRef.current = { refs: refUrls, product: product.publicUrl, prompt: finalPrompt }
      await runRequest({
        mode: 'batch',
        referenceImages: refUrls,
        productImage: product.publicUrl,
        groupCount,
        model,
        aspectRatio,
        imageSize,
        userPrompt: finalPrompt,
      }, refUrls.length * groupCount, undefined, { batchId: uid(), batchTimestamp: Date.now() })
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') { setErrorMessage(friendlyError(e instanceof Error ? e.message : 'Upload failed', isZh)); setPhase('failed'); setProgress(0) }
    }
  }, [mode, singleRefFile, singleProducts, batchRefs, batchProduct, model, aspectRatio, imageSize, imageCount, groupCount, isZh, userPrompt, runRequest, t])

  const retryFailed = useCallback(async () => {
    const ctx = lastRequestRef.current
    if (!ctx) return
    const failed = cards.map((c, i) => ({ c, i })).filter((x) => x.c.status === 'failed')
    if (!failed.length) return
    const refs = failed.map(({ c }) => ctx.refs[Math.max(0, c.referenceIndex)] ?? ctx.refs[0])
    await runRequest({
      mode: 'batch',
      referenceImages: refs,
      productImage: ctx.product,
      groupCount: 1,
      model,
      aspectRatio,
      imageSize,
      userPrompt: ctx.prompt,
    }, refs.length, failed.map((x) => x.i), {
      batchId: activeBatchId ?? uid(),
      batchTimestamp: activeBatchTimestamp ?? Date.now(),
    })
  }, [activeBatchId, activeBatchTimestamp, cards, runRequest, model, aspectRatio, imageSize])

  const downloadAll = async () => {
    try {
      setDownloadingAll(true)
      const urls = activeResultAssets.map((asset) => asset.url)
      for (let i = 0; i < urls.length; i++) {
        const res = await fetch(urls[i])
        if (!res.ok) continue
        const blob = await res.blob()
        const o = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = o
        a.download = `style-replicate-${i + 1}-${Date.now()}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(o)
      }
    } catch (e) {
      setErrorMessage(friendlyError(e instanceof Error ? e.message : tc('error'), isZh))
      setPhase('failed')
    } finally {
      setDownloadingAll(false)
    }
  }

  const addBatchRefs = (files: FileList | null) => setBatchRefs((prev) => [...prev, ...Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, 12 - prev.length)).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))])
  const addSingleProducts = (files: FileList | null) => setSingleProducts((prev) => [...prev, ...Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, 6 - prev.length)).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))])

  return (
    <>
    <CorePageShell maxWidthClass="max-w-[1360px]" contentClassName="space-y-8">
        <div className="mb-7 flex items-start gap-3">
          <SectionIcon icon={ImageIcon} className="mt-1" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{t('heroTitle')}</h1>
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                {t('heroBadge')}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('heroDescription')}</p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-full bg-transparent p-0">
                <TabsTrigger
                  value="single"
                  disabled={isRunning}
                  className="h-11 rounded-full border border-transparent bg-transparent text-sm font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <LayoutGrid className="mr-1.5 h-4 w-4" />
                  {t('singleMode')}
                </TabsTrigger>
                <TabsTrigger
                  value="batch"
                  disabled={isRunning}
                  className="h-11 rounded-full border border-transparent bg-transparent text-sm font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <GalleryVerticalEnd className="mr-1.5 h-4 w-4" />
                  {t('batchMode')}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <section className="rounded-[28px] border border-border bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <SectionIcon icon={ImageIcon} className="mt-0.5" />
                  <div>
                    <p className="text-[15px] font-semibold text-foreground">{t('referenceCardTitle')}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{t('referenceCardDesc')}</p>
                  </div>
                </div>
                {mode === 'batch' && <span className="text-[13px] text-muted-foreground">{batchRefs.length}/12</span>}
              </div>
              {mode === 'single' ? (
                <div className="mt-4">
                  <ImageUploader
                    onFileSelected={(f) => {
                      if (singleRefPreview) URL.revokeObjectURL(singleRefPreview)
                      setSingleRefFile(f)
                      setSingleRefPreview(URL.createObjectURL(f))
                      setCards([])
                    }}
                    onClear={() => {
                      if (singleRefPreview) URL.revokeObjectURL(singleRefPreview)
                      setSingleRefFile(null)
                      setSingleRefPreview(null)
                    }}
                    previewUrl={singleRefPreview}
                    disabled={isRunning}
                    label={t('uploadReference')}
                    sublabel={t('referenceUploadHint')}
                  />
                </div>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {batchRefs.map((img, i) => (
                      <ImageThumbnail
                        key={img.previewUrl}
                        src={img.previewUrl}
                        alt={`ref-${i + 1}`}
                        onRemove={() => setBatchRefs((p) => p.filter((_, idx) => idx !== i))}
                      />
                    ))}
                    {batchRefs.length < 12 && (
                      <button className="aspect-square rounded-xl border border-dashed border-border bg-secondary text-muted-foreground" onClick={() => batchRefInputRef.current?.click()}>
                        <Plus className="mx-auto h-5 w-5" />
                      </button>
                    )}
                  </div>
                  <input ref={batchRefInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { addBatchRefs(e.target.files); e.currentTarget.value = '' }} />
                </>
              )}
            </section>

            <section className="rounded-[28px] border border-border bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <SectionIcon icon={ImageIcon} className="mt-0.5" />
                  <div>
                    <p className="text-[15px] font-semibold text-foreground">{t('productCardTitle')}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{t('productCardDesc')}</p>
                  </div>
                </div>
                <span className="text-[13px] text-muted-foreground">{mode === 'batch' ? (batchProduct ? '1/1' : '0/1') : `${singleProducts.length}/6`}</span>
              </div>
              {mode === 'single' ? (
                <>
                  {singleProducts.length === 0 ? (
                    <button
                      type="button"
                      className="mt-4 flex h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary px-4 text-center"
                      onClick={() => productInputRef.current?.click()}
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Plus className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-medium text-foreground">{t('uploadProduct')}</p>
                      <p className="text-xs text-muted-foreground">{t('productDropHint')}</p>
                    </button>
                  ) : (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {singleProducts.map((img, i) => (
                        <ImageThumbnail
                          key={img.previewUrl}
                          src={img.previewUrl}
                          alt={`prod-${i + 1}`}
                          onRemove={() => setSingleProducts((p) => p.filter((_, idx) => idx !== i))}
                        />
                      ))}
                      {singleProducts.length < 6 && (
                        <button
                          type="button"
                          className="aspect-square rounded-xl border border-dashed border-border bg-secondary text-muted-foreground"
                          onClick={() => productInputRef.current?.click()}
                        >
                          <Plus className="mx-auto h-5 w-5" />
                        </button>
                      )}
                    </div>
                  )}
                  <input ref={productInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { addSingleProducts(e.target.files); e.currentTarget.value = '' }} />
                </>
              ) : (
                <>
                  <p className="mt-3 text-xs text-muted-foreground">{t('batchSingleProductHint')}</p>
                  {batchProduct ? (
                    <ImageThumbnail
                      src={batchProduct.previewUrl}
                      alt="batch-product"
                      onRemove={() => setBatchProduct(null)}
                      className="mt-2 h-24 w-24"
                    />
                  ) : (
                    <button className="mt-2 h-24 w-24 rounded-xl border border-dashed border-border bg-secondary text-muted-foreground" onClick={() => batchProductInputRef.current?.click()}>
                      <Plus className="mx-auto h-5 w-5" />
                    </button>
                  )}
                  <input ref={batchProductInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBatchProduct({ file: f, previewUrl: URL.createObjectURL(f) }); e.currentTarget.value = '' }} />
                </>
              )}
            </section>

            <section className="space-y-4 rounded-[28px] border border-border bg-white p-5">
              <Label className="text-[13px] font-medium text-muted-foreground">{t('promptTitle')}</Label>
              <Textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={3}
                className="min-h-[128px] rounded-2xl border-border bg-secondary text-[14px] placeholder:text-muted-foreground"
                placeholder={t('promptPlaceholder')}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">{tc('model')}</Label>
                  <Select
                    value={model}
                    onValueChange={(v) => {
                      const nextModel = normalizeGenerationModel(v) as GenerationModel
                      setModel(nextModel)
                      setImageSize((current) => sanitizeImageSizeForModel(nextModel, current))
                    }}
                  >
                    <SelectTrigger className="h-11 rounded-2xl border-border bg-secondary text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableModels(userEmail).map((m) => (
                        <SelectItem key={m.value} value={m.value}>{isZh ? m.tierLabel.zh : m.tierLabel.en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ModelTextHint />
                </div>
                <div>
                  <Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">{tc('aspectRatio')}</Label>
                  <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                    <SelectTrigger className="h-11 rounded-2xl border-border bg-secondary text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9'] as AspectRatio[]).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">{mode === 'batch' ? t('groupCountLabel') : tc('imageCount')}</Label>
                  <Select value={String(mode === 'batch' ? groupCount : imageCount)} onValueChange={(v) => mode === 'batch' ? setGroupCount(Number(v)) : setImageCount(Number(v))}>
                    <SelectTrigger className="h-11 rounded-2xl border-border bg-secondary text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>{mode === 'batch' ? `${n}${t('groupUnit')}` : `${n}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isRunning ? (
                <Button className="h-12 w-full rounded-2xl bg-primary" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('generating')}
                </Button>
              ) : (
                <Button
                  className="h-12 w-full rounded-2xl bg-primary text-white hover:opacity-90 disabled:bg-muted disabled:text-white"
                  disabled={!canGenerate}
                  onClick={handleSubmit}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {mode === 'batch' ? t('generateBatchCount', { count: Math.max(1, expectedCount) }) : t('generateOne')}
                </Button>
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('eta', { seconds: 5 })}</span>
                <CreditCostBadge cost={totalCost} />
              </div>
              {insufficientCredits && (
                <button className="text-xs text-primary underline" onClick={() => router.push(`/${locale}/pricing`)}>
                  {tc('buyCredits')}
                </button>
              )}
            </section>
          </div>

          <div className="min-h-[840px] rounded-[28px] border border-border bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-start gap-3">
              <SectionIcon icon={Sparkles} className="mt-0.5" />
              <div>
                <h2 className="text-[15px] font-semibold text-foreground">{resultPanelTitle}</h2>
                <p className="text-[13px] text-muted-foreground">{resultPanelSubtitle}</p>
              </div>
            </div>
            {phase === 'running' && (
              <div className="space-y-3">
                <CoreProcessingStatus
                  title="分析中..."
                  subtitle="正在分析参考图并生成设计规范"
                  progress={progress}
                  statusLine={statusLine}
                  showHeader={false}
                  statusPlacement="below"
                />
                <div className="flex flex-wrap content-start items-start gap-3">
                  {cards.map((c, i) => c.status === 'success' && c.url ? (
                    <div
                      key={i}
                      className="relative w-[220px] max-w-full overflow-hidden rounded-2xl border border-border bg-white opacity-60"
                      style={{ aspectRatio: previewAspectRatio }}
                    >
                      <img src={c.url} alt={`prev-${i + 1}`} className="w-full object-cover" />
                    </div>
                  ) : (
                    <FluidPendingCard key={i} aspectRatio={previewAspectRatio} className="w-[220px] max-w-full rounded-2xl" />
                  ))}
                </div>
                {resultAssets.length > 0 && (
                  <ResultGallery
                    images={resultAssets}
                    activeBatchId={activeBatchId}
                    aspectRatio={aspectRatio}
                    editorSessionKey="aesthetic-mirror"
                    originModule="aesthetic-mirror"
                    onClear={clearResultAssets}
                  />
                )}
              </div>
            )}
            {phase === 'success' && (
              <div className="space-y-3">
                <ResultGallery
                  images={resultAssets}
                  activeBatchId={activeBatchId}
                  aspectRatio={aspectRatio}
                  editorSessionKey="aesthetic-mirror"
                  originModule="aesthetic-mirror"
                  onClear={clearResultAssets}
                />
                {cards.some((card) => card.status === 'failed') && (
                  <div className="flex flex-wrap content-start items-start gap-3">
                    {cards.filter((card) => card.status === 'failed').map((card, index) => (
                      <div key={`failed-${index}`} className="w-[220px] max-w-full rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                        {card.error ?? tc('error')}
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <Button variant="outline" onClick={downloadAll} disabled={activeResultAssets.length === 0 || downloadingAll}>{downloadingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t('downloadAllSuccess')}</Button>
                  <Button variant="outline" onClick={retryFailed} disabled={!cards.some((x) => x.status === 'failed') || downloadingAll}>{t('retryFailed')}</Button>
                  <Button variant="outline" onClick={handleSubmit} disabled={!canGenerate || downloadingAll}><Sparkles className="mr-1 h-4 w-4" />{t('regenerateAll')}</Button>
                  <Button variant="outline" onClick={clearResultAssets} disabled={resultAssets.length === 0 || downloadingAll}>{isZh ? '清除历史' : 'Clear History'}</Button>
                </div>
              </div>
            )}
            {phase === 'failed' && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
                  <p className="text-sm text-destructive">{errorMessage ?? tc('error')}</p>
                </div>
                {resultAssets.length > 0 && (
                  <ResultGallery
                    images={resultAssets}
                    activeBatchId={activeBatchId}
                    aspectRatio={aspectRatio}
                    editorSessionKey="aesthetic-mirror"
                    originModule="aesthetic-mirror"
                    onClear={clearResultAssets}
                  />
                )}
              </div>
            )}
            {phase === 'idle' && resultAssets.length === 0 && (
              <div className="flex min-h-[620px] items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Sparkles className="h-9 w-9" />
                  </div>
                  <p className="mt-5 text-base text-muted-foreground">{t('waiting')}</p>
                  <p className="mt-1 text-base text-muted-foreground">{isZh ? '点击左侧“开始复刻风格”按钮' : 'Click "Replicate Style" on the left to start'}</p>
                </div>
              </div>
            )}
            {phase === 'idle' && resultAssets.length > 0 && (
              <ResultGallery
                images={resultAssets}
                activeBatchId={activeBatchId}
                aspectRatio={aspectRatio}
                editorSessionKey="aesthetic-mirror"
                originModule="aesthetic-mirror"
                onClear={clearResultAssets}
              />
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-border bg-white p-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-foreground"><Sparkles className="h-4 w-4 text-muted-foreground" />{t('featureA.title')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('featureA.desc')}</p>
          </div>
          <div className="rounded-3xl border border-border bg-white p-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{t('featureB.title')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('featureB.desc')}</p>
          </div>
          <div className="rounded-3xl border border-border bg-white p-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-foreground"><Download className="h-4 w-4 text-muted-foreground" />{t('featureC.title')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('featureC.desc')}</p>
          </div>
        </div>
    </CorePageShell>
    </>
  )
}
