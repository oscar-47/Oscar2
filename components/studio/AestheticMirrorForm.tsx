'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ImageUploader } from '@/components/upload/ImageUploader'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { uploadFile, uploadFiles } from '@/lib/api/upload'
import { analyzeSingle, processGenerationJob } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { GenerationModel, AspectRatio, ImageSize, GenerationJob } from '@/types'
import { DEFAULT_CREDIT_COSTS } from '@/types'
import { Loader2, Sparkles, Wand2, X, Plus, Download } from 'lucide-react'

type Mode = 'single' | 'batch'
type Phase = 'idle' | 'running' | 'success' | 'failed'
type CardStatus = 'loading' | 'success' | 'failed'
type Card = { url: string | null; status: CardStatus; error?: string; referenceIndex: number; groupIndex: number }
type UImg = { file: File; previewUrl: string }

const uid = () => crypto.randomUUID()

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
  const [model, setModel] = useState<GenerationModel>('doubao-seedream-4.5')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [imageCount, setImageCount] = useState(1)
  const [groupCount, setGroupCount] = useState(1)
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
  const totalCost = (DEFAULT_CREDIT_COSTS[model] ?? 5) * Math.max(1, expectedCount)
  const insufficientCredits = total !== null && total < totalCost
  const isRunning = phase === 'running'
  const canGenerate = mode === 'single'
    ? !!singleRefFile && singleProducts.length > 0 && !isRunning && !insufficientCredits
    : batchRefs.length > 0 && !!batchProduct && !isRunning && !insufficientCredits

  useEffect(() => { if (model === 'doubao-seedream-4.5' && imageSize === '1K') setImageSize('2K') }, [model, imageSize])

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
      const { job_id } = await analyzeSingle({ ...request, trace_id: uid(), client_job_id: uid(), fe_attempt: 1, turboEnabled: false } as any)
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
    if (mode === 'single') {
      if (!singleRefFile || !singleProducts.length) return
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
    if (!batchRefs.length || !batchProduct) return
    const [refs, product] = await Promise.all([uploadFiles(batchRefs.map((x) => x.file)), uploadFile(batchProduct.file)])
    const refUrls = refs.map((x) => x.publicUrl)
    lastRequestRef.current = { refs: refUrls, product: product.publicUrl }
    await runRequest({ mode: 'batch', referenceImages: refUrls, productImage: product.publicUrl, groupCount, model, aspectRatio, imageSize, userPrompt: userPrompt.trim() || undefined }, refUrls.length * groupCount)
  }, [mode, singleRefFile, singleProducts, batchRefs, batchProduct, model, aspectRatio, imageSize, imageCount, groupCount, userPrompt, runRequest])

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
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="inline-flex rounded-lg bg-muted p-1">
        <button type="button" className={`h-8 px-4 text-sm rounded-md ${mode === 'single' ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground'}`} onClick={() => setMode('single')}>{t('singleMode')}</button>
        <button type="button" className={`h-8 px-4 text-sm rounded-md ${mode === 'batch' ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground'}`} onClick={() => setMode('batch')}>{t('batchMode')}</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <section className="rounded-3xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('referenceCardTitle')}</p>
              {mode === 'batch' && (
                <span className="text-xs text-muted-foreground">{batchRefs.length}/12 张</span>
              )}
            </div>
            {mode === 'single' ? (
              <div className="mt-2 rounded-2xl border p-2"><ImageUploader onFileSelected={(f) => { if (singleRefPreview) URL.revokeObjectURL(singleRefPreview); setSingleRefFile(f); setSingleRefPreview(URL.createObjectURL(f)); setCards([]) }} onClear={() => { if (singleRefPreview) URL.revokeObjectURL(singleRefPreview); setSingleRefFile(null); setSingleRefPreview(null) }} previewUrl={singleRefPreview} disabled={isRunning} label={t('uploadReference')} sublabel={tc('uploadSublabel')} /></div>
            ) : (
              <>
                <div className="mt-2 grid grid-cols-3 gap-2">{batchRefs.map((img, i) => <div key={img.previewUrl} className="relative aspect-square overflow-hidden rounded-xl border"><img src={img.previewUrl} alt={`ref-${i + 1}`} className="h-full w-full object-cover" /><button className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white" onClick={() => setBatchRefs((p) => p.filter((_, idx) => idx !== i))}><X className="h-3 w-3" /></button></div>)}{batchRefs.length < 12 && <button className="aspect-square rounded-xl border border-dashed" onClick={() => batchRefInputRef.current?.click()}><Plus className="mx-auto h-5 w-5 text-muted-foreground" /></button>}</div>
                <input ref={batchRefInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { addBatchRefs(e.target.files); e.currentTarget.value = '' }} />
              </>
            )}
          </section>

          <section className="rounded-3xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('productCardTitle')}</p>
              {mode === 'batch' && (
                <span className="text-xs text-muted-foreground">{batchProduct ? '1/1 张' : '0/1 张'}</span>
              )}
            </div>
            {mode === 'single' ? (
              <>
                <div className="mt-2 grid grid-cols-3 gap-2">{singleProducts.map((img, i) => <div key={img.previewUrl} className="relative aspect-square overflow-hidden rounded-xl border"><img src={img.previewUrl} alt={`prod-${i + 1}`} className="h-full w-full object-cover" /><button className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white" onClick={() => setSingleProducts((p) => p.filter((_, idx) => idx !== i))}><X className="h-3 w-3" /></button></div>)}{singleProducts.length < 6 && <button className="aspect-square rounded-xl border border-dashed" onClick={() => productInputRef.current?.click()}><Plus className="mx-auto h-5 w-5 text-muted-foreground" /></button>}</div>
                <input ref={productInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { addSingleProducts(e.target.files); e.currentTarget.value = '' }} />
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-muted-foreground">{t('batchSingleProductHint')}</p>
                {batchProduct ? <div className="relative mt-2 h-24 w-24 overflow-hidden rounded-xl border"><img src={batchProduct.previewUrl} alt="batch-product" className="h-full w-full object-cover" /><button className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white" onClick={() => setBatchProduct(null)}><X className="h-3 w-3" /></button></div> : <button className="mt-2 h-24 w-24 rounded-xl border border-dashed" onClick={() => batchProductInputRef.current?.click()}><Plus className="mx-auto h-5 w-5 text-muted-foreground" /></button>}
                <input ref={batchProductInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBatchProduct({ file: f, previewUrl: URL.createObjectURL(f) }); e.currentTarget.value = '' }} />
              </>
            )}
          </section>

          <section className="rounded-3xl border bg-card p-4 space-y-3">
            <Label>{t('promptTitle')}</Label>
            <Textarea value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} rows={3} placeholder={t('promptPlaceholder')} />
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{tc('model')}</Label><Select value={model} onValueChange={(v) => setModel(v as GenerationModel)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nano-banana">Nano Banana</SelectItem><SelectItem value="nano-banana-pro">Nano Banana Pro</SelectItem><SelectItem value="doubao-seedream-4.5">Doubao Seedream 4.5</SelectItem></SelectContent></Select></div>
              <div><Label>{tc('aspectRatio')}</Label><Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9'] as AspectRatio[]).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>{tc('imageSize')}</Label><Select value={imageSize} onValueChange={(v) => setImageSize(v as ImageSize)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{model !== 'doubao-seedream-4.5' && <SelectItem value="1K">1K</SelectItem>}<SelectItem value="2K">2K</SelectItem><SelectItem value="4K">4K</SelectItem></SelectContent></Select></div>
              <div><Label>{mode === 'batch' ? t('groupCountLabel') : tc('imageCount')}</Label><Select value={String(mode === 'batch' ? groupCount : imageCount)} onValueChange={(v) => mode === 'batch' ? setGroupCount(Number(v)) : setImageCount(Number(v))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 9 }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>{mode === 'batch' ? `${n}${t('groupUnit')}` : `${n}`}</SelectItem>)}</SelectContent></Select></div>
            </div>
            {isRunning ? <Button className="w-full" disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('generating')}</Button> : <Button className="w-full" disabled={!canGenerate} onClick={handleSubmit}><Wand2 className="mr-2 h-4 w-4" />{mode === 'batch' ? t('generateBatchCount', { count: Math.max(1, expectedCount) }) : t('generateOne')}</Button>}
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{t('eta', { seconds: model === 'doubao-seedream-4.5' ? 4 : 5 })}</span><CreditCostBadge cost={totalCost} /></div>
            {insufficientCredits && <button className="text-xs text-primary underline" onClick={() => router.push(`/${locale}/pricing`)}>{tc('buyCredits')}</button>}
          </section>
        </div>

        <div className="rounded-3xl border bg-card p-4 sm:p-5 min-h-[760px]">
          <h2 className="mb-3 text-sm font-semibold">{mode === 'batch' ? t('batchResultTitle') : tc('results')}</h2>
          {phase === 'running' && <div className="space-y-3"><div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-foreground" style={{ width: `${progress}%` }} /></div><p className="text-center text-xs text-muted-foreground">{statusLine}</p><div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>{cards.map((_, i) => <div key={i} className="flex h-[240px] items-center justify-center rounded-2xl border bg-muted/30"><Loader2 className="h-5 w-5 animate-spin" /></div>)}</div></div>}
          {phase === 'success' && <div className="space-y-3"><div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>{cards.map((c, i) => c.status === 'success' && c.url ? <div key={i} className="group relative overflow-hidden rounded-2xl border bg-muted"><img src={c.url} alt={`result-${i + 1}`} className="w-full object-cover" /><div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"><button type="button" onClick={() => void downloadOne(c.url as string, i)} disabled={downloadingIndex === i || downloadingAll} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/30 disabled:opacity-60">{downloadingIndex === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button></div></div> : <div key={i} className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">{c.error ?? tc('error')}</div>)}</div><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Button variant="outline" onClick={downloadAll} disabled={!cards.some((x) => x.status === 'success') || downloadingAll || downloadingIndex !== null}>{downloadingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t('downloadAllSuccess')}</Button><Button variant="outline" onClick={retryFailed} disabled={!cards.some((x) => x.status === 'failed') || downloadingAll || downloadingIndex !== null}>{t('retryFailed')}</Button><Button variant="outline" onClick={handleSubmit} disabled={!canGenerate || downloadingAll || downloadingIndex !== null}><Sparkles className="mr-1 h-4 w-4" />{t('regenerateAll')}</Button></div></div>}
          {phase === 'failed' && <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5"><p className="text-sm text-destructive">{errorMessage ?? tc('error')}</p></div>}
          {phase === 'idle' && <div className="flex min-h-[520px] items-center justify-center"><div className="text-center text-sm text-muted-foreground">{t('waiting')}</div></div>}
        </div>
      </div>
    </div>
  )
}
