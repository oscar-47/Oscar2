'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ImageUploader } from '@/components/upload/ImageUploader'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { uploadFile, uploadFiles } from '@/lib/api/upload'
import { analyzeSingle, processGenerationJob } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { GenerationModel, AspectRatio, ImageSize, GenerationJob } from '@/types'
import { DEFAULT_CREDIT_COSTS } from '@/types'
import { Loader2, Sparkles, Wand2, X, Plus, Download, Image as ImageIcon, ShieldCheck, Zap } from 'lucide-react'
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

  const [mode, setMode] = useState<Mode>('single')
  const [singleRefFile, setSingleRefFile] = useState<File | null>(null)
  const [singleRefPreview, setSingleRefPreview] = useState<string | null>(null)
  const [singleProducts, setSingleProducts] = useState<UImg[]>([])
  const [batchRefs, setBatchRefs] = useState<UImg[]>([])
  const [batchProduct, setBatchProduct] = useState<UImg | null>(null)
  const [userPrompt, setUserPrompt] = useState('')
  const [model, setModel] = useState<GenerationModel>('flux-kontext-pro')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [imageCount, setImageCount] = useState(1)
  const [groupCount, setGroupCount] = useState(1)
  const [turboEnabled, setTurboEnabled] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusLine, setStatusLine] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const productInputRef = useRef<HTMLInputElement | null>(null)
  const batchRefInputRef = useRef<HTMLInputElement | null>(null)
  const batchProductInputRef = useRef<HTMLInputElement | null>(null)
  const lastRequestRef = useRef<{ refs: string[]; product: string } | null>(null)

  const expectedCount = mode === 'batch' ? batchRefs.length * groupCount : singleProducts.length * imageCount
  const baseCost = Math.max(DEFAULT_CREDIT_COSTS[model] ?? 5, 5)
  const turboExtra = imageSize === '1K' ? 8 : imageSize === '2K' ? 12 : 16
  const unitCost = turboEnabled ? baseCost + turboExtra : baseCost
  const totalCost = unitCost * Math.max(1, expectedCount)
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

  const runRequest = useCallback(async (request: Record<string, unknown>, slots: number, mergeIdx?: number[]) => {
    const abort = new AbortController()
    abortRef.current = abort
    setPhase('running'); setProgress(10); setStatusLine(t('runningText1')); setErrorMessage(null)
    if (!mergeIdx?.length) setCards(Array.from({ length: Math.max(1, slots) }, (_, i) => ({ url: null, status: 'loading', referenceIndex: i, groupIndex: 0 })))
    const progressTimer = setInterval(() => setProgress((p) => Math.min(90, p + 7)), 900)
    const statusTimer = setInterval(() => setStatusLine((s) => s === t('runningText1') ? t('runningText2') : s === t('runningText2') ? t('runningText3') : t('runningText1')), 1800)
    try {
      const { job_id } = await analyzeSingle({ ...request, trace_id: uid(), client_job_id: uid(), fe_attempt: 1, turboEnabled } as any)
      const job = await waitForJob(job_id, abort.signal)
      const next = parseCards(job)
      if (!next.length) throw new Error(t('noResultError'))
      if (mergeIdx?.length) {
        setCards((prev) => {
          const merged = [...prev]
          mergeIdx.forEach((idx, i) => { if (next[i]) merged[idx] = { ...next[i], referenceIndex: merged[idx]?.referenceIndex ?? next[i].referenceIndex, groupIndex: merged[idx]?.groupIndex ?? next[i].groupIndex } })
          return merged
        })
      } else setCards(next)
      setProgress(100); setPhase('success')
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') { setErrorMessage(e instanceof Error ? e.message : tc('error')); setPhase('failed'); setProgress(0) }
    } finally {
      clearInterval(progressTimer); clearInterval(statusTimer); refreshCredits()
    }
  }, [t, tc])

  const handleSubmit = useCallback(async () => {
    // Set running state immediately so the button disables on click
    setPhase('running'); setProgress(5); setStatusLine(t('runningText1')); setErrorMessage(null)
    try {
      if (mode === 'single') {
        if (!singleRefFile || !singleProducts.length) { setPhase('idle'); return }
        const [{ publicUrl: referenceImage }, products] = await Promise.all([uploadFile(singleRefFile), uploadFiles(singleProducts.map((x) => x.file))])
        lastRequestRef.current = { refs: [referenceImage], product: products[0].publicUrl }
        await runRequest(
          {
            mode: 'single',
            referenceImage,
            productImages: products.map((x) => x.publicUrl),
            model,
            aspectRatio,
            imageSize,
            imageCount,
            userPrompt: userPrompt.trim() || undefined,
          },
          products.length * imageCount,
        )
        return
      }
      if (!batchRefs.length || !batchProduct) { setPhase('idle'); return }
      const [refs, product] = await Promise.all([uploadFiles(batchRefs.map((x) => x.file)), uploadFile(batchProduct.file)])
      const refUrls = refs.map((x) => x.publicUrl)
      lastRequestRef.current = { refs: refUrls, product: product.publicUrl }
      await runRequest({ mode: 'batch', referenceImages: refUrls, productImage: product.publicUrl, groupCount, model, aspectRatio, imageSize, userPrompt: userPrompt.trim() || undefined }, refUrls.length * groupCount)
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') { setErrorMessage(e instanceof Error ? e.message : 'Upload failed'); setPhase('failed'); setProgress(0) }
    }
  }, [mode, singleRefFile, singleProducts, batchRefs, batchProduct, model, aspectRatio, imageSize, imageCount, groupCount, userPrompt, runRequest, t])

  const retryFailed = useCallback(async () => {
    const ctx = lastRequestRef.current
    if (!ctx) return
    const failed = cards.map((c, i) => ({ c, i })).filter((x) => x.c.status === 'failed')
    if (!failed.length) return
    const refs = failed.map(({ c }) => ctx.refs[Math.max(0, c.referenceIndex)] ?? ctx.refs[0])
    await runRequest({ mode: 'batch', referenceImages: refs, productImage: ctx.product, groupCount: 1, model, aspectRatio, imageSize, userPrompt: userPrompt.trim() || undefined }, refs.length, failed.map((x) => x.i))
  }, [cards, runRequest, model, aspectRatio, imageSize, userPrompt])

  const downloadOne = async (url: string, index: number) => {
    try {
      setDownloadingIndex(index)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`DOWNLOAD_FAILED_${res.status}`)
      const blob = await res.blob()
      const o = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = o
      a.download = `style-replicate-${index + 1}-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(o)
    } catch (e) {
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
      setErrorMessage(e instanceof Error ? e.message : tc('error'))
      setPhase('failed')
    } finally {
      setDownloadingAll(false)
    }
  }

  const addBatchRefs = (files: FileList | null) => setBatchRefs((prev) => [...prev, ...Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, 12 - prev.length)).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))])
  const addSingleProducts = (files: FileList | null) => setSingleProducts((prev) => [...prev, ...Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, 6 - prev.length)).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))])

  return (
    <CorePageShell maxWidthClass="max-w-[1360px]" contentClassName="space-y-8">
        <section className="pt-6 text-center sm:pt-8">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#d0d4dc] bg-[#f1f3f6] px-4 py-1.5 text-xs font-medium text-[#3f4047]">
            <Sparkles className="h-4 w-4" />
            {t('heroBadge')}
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#17181d] sm:text-4xl">{t('heroTitle')}</h1>
          <p className="mx-auto mt-3 max-w-3xl text-sm leading-relaxed text-[#70727a] sm:text-base">{t('heroDescription')}</p>
        </section>

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="inline-flex rounded-2xl bg-transparent p-0.5">
              <button
                type="button"
                className={`h-11 rounded-xl px-7 text-base font-medium ${mode === 'single' ? 'bg-[#111318] text-white shadow-sm' : 'text-[#6f727b]'}`}
                onClick={() => setMode('single')}
              >
                {t('singleMode')}
              </button>
              <button
                type="button"
                className={`h-11 rounded-xl px-7 text-base font-medium ${mode === 'batch' ? 'bg-[#111318] text-white shadow-sm' : 'text-[#6f727b]'}`}
                onClick={() => setMode('batch')}
              >
                {t('batchMode')}
              </button>
            </div>

            <section className="rounded-[28px] border border-[#d0d4dc] bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <SectionIcon icon={ImageIcon} className="mt-0.5" />
                  <div>
                    <p className="text-[15px] font-semibold text-[#1a1d24]">{t('referenceCardTitle')}</p>
                    <p className="mt-0.5 text-[13px] text-[#7d818d]">{t('referenceCardDesc')}</p>
                  </div>
                </div>
                {mode === 'batch' && <span className="text-[13px] text-[#6f7380]">{batchRefs.length}/12</span>}
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
                      <button className="aspect-square rounded-xl border border-dashed border-[#d0d4dc] bg-[#f1f3f6] text-[#848791]" onClick={() => batchRefInputRef.current?.click()}>
                        <Plus className="mx-auto h-5 w-5" />
                      </button>
                    )}
                  </div>
                  <input ref={batchRefInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { addBatchRefs(e.target.files); e.currentTarget.value = '' }} />
                </>
              )}
            </section>

            <section className="rounded-[28px] border border-[#d0d4dc] bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <SectionIcon icon={ImageIcon} className="mt-0.5" />
                  <div>
                    <p className="text-[15px] font-semibold text-[#1a1d24]">{t('productCardTitle')}</p>
                    <p className="mt-0.5 text-[13px] text-[#7d818d]">{t('productCardDesc')}</p>
                  </div>
                </div>
                <span className="text-[13px] text-[#6f7380]">{mode === 'batch' ? (batchProduct ? '1/1' : '0/1') : `${singleProducts.length}/6`}</span>
              </div>
              {mode === 'single' ? (
                <>
                  {singleProducts.length === 0 ? (
                    <button
                      type="button"
                      className="mt-4 flex h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#d0d4dc] bg-[#f1f3f6] px-4 text-center"
                      onClick={() => productInputRef.current?.click()}
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f0f0f2] text-[#73757e]">
                        <Plus className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-medium text-[#35373e]">{t('uploadProduct')}</p>
                      <p className="text-xs text-[#8d9098]">{t('productDropHint')}</p>
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
                          className="aspect-square rounded-xl border border-dashed border-[#d0d4dc] bg-[#f1f3f6] text-[#848791]"
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
                  <p className="mt-3 text-xs text-[#8d9098]">{t('batchSingleProductHint')}</p>
                  {batchProduct ? (
                    <ImageThumbnail
                      src={batchProduct.previewUrl}
                      alt="batch-product"
                      onRemove={() => setBatchProduct(null)}
                      className="mt-2 h-24 w-24"
                    />
                  ) : (
                    <button className="mt-2 h-24 w-24 rounded-xl border border-dashed border-[#d0d4dc] bg-[#f1f3f6] text-[#848791]" onClick={() => batchProductInputRef.current?.click()}>
                      <Plus className="mx-auto h-5 w-5" />
                    </button>
                  )}
                  <input ref={batchProductInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBatchProduct({ file: f, previewUrl: URL.createObjectURL(f) }); e.currentTarget.value = '' }} />
                </>
              )}
            </section>

            <section className="space-y-4 rounded-[28px] border border-[#d0d4dc] bg-white p-5">
              <Label className="text-[13px] font-medium text-[#5a5e6b]">{t('promptTitle')}</Label>
              <Textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={3}
                className="min-h-[128px] rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] placeholder:text-[#9599a3]"
                placeholder={t('promptPlaceholder')}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{tc('model')}</Label>
                  <Select value={model} onValueChange={(v) => setModel(v as GenerationModel)}>
                    <SelectTrigger className="h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flux-kontext-pro">FLUX.1 Kontext Pro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{tc('aspectRatio')}</Label>
                  <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                    <SelectTrigger className="h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9'] as AspectRatio[]).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{tc('imageSize')}</Label>
                  <Select value={imageSize} onValueChange={(v) => setImageSize(v as ImageSize)}>
                    <SelectTrigger className="h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1K">1K</SelectItem>
                      <SelectItem value="2K">2K</SelectItem>
                      <SelectItem value="4K">4K</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-[13px] font-medium text-[#5a5e6b]">{mode === 'batch' ? t('groupCountLabel') : tc('imageCount')}</Label>
                  <Select value={String(mode === 'batch' ? groupCount : imageCount)} onValueChange={(v) => mode === 'batch' ? setGroupCount(Number(v)) : setImageCount(Number(v))}>
                    <SelectTrigger className="h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>{mode === 'batch' ? `${n}${t('groupUnit')}` : `${n}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-[#d0d4dc] bg-[#f1f3f6] px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${turboEnabled ? 'bg-[#e7f8ee] text-[#22b968]' : 'bg-[#eceef2] text-[#6f737c]'}`}>
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-[#1a1d24]">Turbo {isZh ? '加速模式' : 'Boost'}</p>
                    <p className="text-[12px] text-[#7d818d]">{isZh ? '更快、更稳定' : 'Faster & more stable'}</p>
                  </div>
                </div>
                <Switch
                  checked={turboEnabled}
                  onCheckedChange={setTurboEnabled}
                  disabled={isRunning}
                  className="h-8 w-14 border-0 data-[state=checked]:bg-[#1a1d24] data-[state=unchecked]:bg-[#d8d9dd]"
                />
              </div>

              {isRunning ? (
                <Button className="h-12 w-full rounded-2xl bg-[#111318]" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('generating')}
                </Button>
              ) : (
                <Button
                  className="h-12 w-full rounded-2xl bg-[#191b22] text-white hover:bg-[#13151a] disabled:bg-[#9a9ca3] disabled:text-white"
                  disabled={!canGenerate}
                  onClick={handleSubmit}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {mode === 'batch' ? t('generateBatchCount', { count: Math.max(1, expectedCount) }) : t('generateOne')}
                </Button>
              )}
              <div className="flex items-center justify-between text-xs text-[#7f828c]">
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

          <div className="min-h-[840px] rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-start gap-3">
              <SectionIcon icon={Sparkles} className="mt-0.5" />
              <div>
                <h2 className="text-[15px] font-semibold text-[#1a1d24]">{resultPanelTitle}</h2>
                <p className="text-[13px] text-[#7d818d]">{resultPanelSubtitle}</p>
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
                  {cards.map((_, i) => (
                    <div
                      key={i}
                      className="flex w-[220px] max-w-full items-center justify-center rounded-2xl border border-[#e1e1e5] bg-white/70"
                      style={{ aspectRatio: previewAspectRatio }}
                    >
                      <Loader2 className="h-5 w-5 animate-spin text-[#666973]" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {phase === 'success' && (
              <div className="space-y-3">
                <div className="flex flex-wrap content-start items-start gap-3">
                  {cards.map((c, i) => c.status === 'success' && c.url ? (
                    <div
                      key={i}
                      className="group relative w-[220px] max-w-full overflow-hidden rounded-2xl border border-[#dcdce1] bg-white"
                      style={{ aspectRatio: previewAspectRatio }}
                    >
                      <img src={c.url} alt={`result-${i + 1}`} className="w-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                        <button type="button" onClick={() => void downloadOne(c.url as string, i)} disabled={downloadingIndex === i || downloadingAll} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/30 disabled:opacity-60">{downloadingIndex === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="w-[220px] max-w-full rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">{c.error ?? tc('error')}</div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button variant="outline" onClick={downloadAll} disabled={!cards.some((x) => x.status === 'success') || downloadingAll || downloadingIndex !== null}>{downloadingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t('downloadAllSuccess')}</Button>
                  <Button variant="outline" onClick={retryFailed} disabled={!cards.some((x) => x.status === 'failed') || downloadingAll || downloadingIndex !== null}>{t('retryFailed')}</Button>
                  <Button variant="outline" onClick={handleSubmit} disabled={!canGenerate || downloadingAll || downloadingIndex !== null}><Sparkles className="mr-1 h-4 w-4" />{t('regenerateAll')}</Button>
                </div>
              </div>
            )}
            {phase === 'failed' && <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5"><p className="text-sm text-destructive">{errorMessage ?? tc('error')}</p></div>}
            {phase === 'idle' && (
              <div className="flex min-h-[620px] items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#ececef] text-[#7f828c]">
                    <Sparkles className="h-9 w-9" />
                  </div>
                  <p className="mt-5 text-base text-[#7f828c]">{t('waiting')}</p>
                  <p className="mt-1 text-base text-[#7f828c]">{isZh ? '点击左侧“开始复刻风格”按钮' : 'Click "Replicate Style" on the left to start'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-[#d0d4dc] bg-white p-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-[#17181d]"><Sparkles className="h-4 w-4 text-[#686b74]" />{t('featureA.title')}</p>
            <p className="mt-2 text-sm text-[#777a83]">{t('featureA.desc')}</p>
          </div>
          <div className="rounded-3xl border border-[#d0d4dc] bg-white p-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-[#17181d]"><ShieldCheck className="h-4 w-4 text-[#686b74]" />{t('featureB.title')}</p>
            <p className="mt-2 text-sm text-[#777a83]">{t('featureB.desc')}</p>
          </div>
          <div className="rounded-3xl border border-[#d0d4dc] bg-white p-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-[#17181d]"><Download className="h-4 w-4 text-[#686b74]" />{t('featureC.title')}</p>
            <p className="mt-2 text-sm text-[#777a83]">{t('featureC.desc')}</p>
          </div>
        </div>
    </CorePageShell>
  )
}
