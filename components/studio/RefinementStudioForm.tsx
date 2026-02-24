'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ImageUploader } from '@/components/upload/ImageUploader'
import { GenerationProgress, type ProgressStep } from '@/components/generation/GenerationProgress'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { uploadFile } from '@/lib/api/upload'
import { analyzeProductV2, generateImage } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { GenerationModel, AspectRatio, ImageSize, GenerationJob } from '@/types'
import { DEFAULT_CREDIT_COSTS } from '@/types'

function uid() { return crypto.randomUUID() }

function waitForJob(jobId: string, signal: AbortSignal): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer)
      supabase.removeChannel(channel)
    }
    function done(job: GenerationJob) { if (settled) return; settled = true; cleanup(); resolve(job) }
    function fail(err: Error) { if (settled) return; settled = true; cleanup(); reject(err) }
    async function checkOnce() {
      const { data } = await supabase.from('generation_jobs').select('*').eq('id', jobId).single()
      if (!data) return
      const job = data as GenerationJob
      if (job.status === 'success') done(job)
      else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
    }
    signal.addEventListener('abort', () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true })
    const channel = supabase.channel(`wait:${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` }, (p) => {
        const job = p.new as GenerationJob
        if (job.status === 'success') done(job)
        else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      }).subscribe()
    void checkOnce()
    pollTimer = setInterval(() => { void checkOnce() }, 2000)
  })
}

export function RefinementStudioForm() {
  const t = useTranslations('studio.refinementStudio')
  const tc = useTranslations('studio.common')
  const ts = useTranslations('studio.refinementStudioSteps')
  const locale = useLocale()
  const router = useRouter()

  const [productFile, setProductFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [model, setModel] = useState<GenerationModel>('nano-banana-pro')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [whiteBackground, setWhiteBackground] = useState(true)

  const [isRunning, setIsRunning] = useState(false)
  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ResultImage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { total } = useCredits()
  const cost = DEFAULT_CREDIT_COSTS[model] ?? 5
  const insufficientCredits = total !== null && total < cost

  const handleSubmit = useCallback(async () => {
    if (!productFile) return
    const trace_id = uid()
    const client_job_id = uid()
    const abort = new AbortController()
    abortRef.current = abort

    const initialSteps: ProgressStep[] = [
      { id: 'upload',   label: ts('upload'),   status: 'pending' },
      { id: 'analyze',  label: ts('analyze'),  status: 'pending' },
      { id: 'generate', label: ts('generate'), status: 'pending' },
      { id: 'done',     label: ts('done'),     status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(0)
    setResults([])
    setErrorMessage(null)
    setIsRunning(true)

    const set = (id: string, patch: Partial<ProgressStep>) =>
      setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

    try {
      // 1. Upload
      set('upload', { status: 'active' })
      const { publicUrl: productImage } = await uploadFile(productFile)
      set('upload', { status: 'done' })
      setProgress(25)

      // 2. Analyze (refinement mode)
      set('analyze', { status: 'active' })
      const { job_id: analysisJobId } = await analyzeProductV2({
        productImage,
        clothingMode: 'refinement_analysis',
        whiteBackground,
        uiLanguage: locale,
        targetLanguage: locale,
        trace_id,
      })
      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      set('analyze', { status: 'done' })
      setProgress(55)

      // 3. Generate refined image
      set('generate', { status: 'active' })
      const { job_id: genJobId } = await generateImage({
        productImage,
        prompt: String(analysisJob.result_data ?? ''),
        model,
        aspectRatio,
        imageSize,
        turboEnabled: false,
        imageCount: 1,
        client_job_id,
        fe_attempt: 1,
        trace_id,
        workflowMode: 'product',
      })
      const genJob = await waitForJob(genJobId, abort.signal)
      set('generate', { status: 'done' })
      set('done', { status: 'done' })
      setProgress(100)

      if (genJob.result_url) setResults([{ url: genJob.result_url }])
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(err instanceof Error ? err.message : tc('error'))
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
    } finally {
      setIsRunning(false)
      refreshCredits()
    }
  }, [productFile, model, aspectRatio, imageSize, whiteBackground, locale, tc, ts])

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>{tc('productImage')}</Label>
            <ImageUploader
              onFileSelected={(f) => { setProductFile(f); setPreviewUrl(URL.createObjectURL(f)) }}
              onClear={() => { setProductFile(null); setPreviewUrl(null) }}
              previewUrl={previewUrl}
              disabled={isRunning}
              label={tc('uploadLabel')}
              sublabel={tc('uploadSublabel')}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{tc('model')}</Label>
              <Select value={model} onValueChange={(v) => setModel(v as GenerationModel)} disabled={isRunning}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nano-banana">Nano Banana</SelectItem>
                  <SelectItem value="nano-banana-pro">Nano Banana Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tc('aspectRatio')}</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)} disabled={isRunning}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['1:1', '3:4', '4:3', '9:16', '16:9'] as AspectRatio[]).map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tc('imageSize')}</Label>
              <Select value={imageSize} onValueChange={(v) => setImageSize(v as ImageSize)} disabled={isRunning}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1K">1K</SelectItem>
                  <SelectItem value="2K">2K</SelectItem>
                  <SelectItem value="4K">4K</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="rs-white" checked={whiteBackground} onCheckedChange={setWhiteBackground} disabled={isRunning} />
            <Label htmlFor="rs-white">{t('whiteBackground')}</Label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            {isRunning ? (
              <Button variant="outline" onClick={() => { abortRef.current?.abort(); setIsRunning(false) }}>{tc('stop')}</Button>
            ) : (
              <Button onClick={handleSubmit} disabled={!productFile || insufficientCredits} className="flex-1">
                {t('generate')}
              </Button>
            )}
            <CreditCostBadge cost={cost} />
            {insufficientCredits && (
              <button type="button" className="text-xs text-primary underline" onClick={() => router.push(`/${locale}/pricing`)}>
                {tc('buyCredits')}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {steps.length > 0 && (
            <div className="rounded-xl border p-5">
              <GenerationProgress steps={steps} overallProgress={progress} errorMessage={errorMessage} />
            </div>
          )}
          {results.length > 0 && <ResultGallery images={results} />}
        </div>
      </div>
    </div>
  )
}
