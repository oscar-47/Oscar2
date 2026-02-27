'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { GenerationProgress, type ProgressStep } from '@/components/generation/GenerationProgress'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { ClothingSettingsSection } from './ClothingSettingsSection'
import { GenerationTypeSelector, countSelectedTypes } from './GenerationTypeSelector'
import type { BasicPhotoTypeState, ClothingPhase } from './types'
import { uploadFile } from '@/lib/api/upload'
import { analyzeProductV2, generatePromptsV2Stream, generateImage } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { GenerationModel, AspectRatio, ImageSize, GenerationJob } from '@/types'

function uid() {
  return crypto.randomUUID()
}

function waitForJob(jobId: string, signal: AbortSignal): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer)
      supabase.removeChannel(channel)
    }
    function done(job: GenerationJob) {
      if (settled) return
      settled = true
      cleanup()
      resolve(job)
    }
    function fail(err: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
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

interface BasicPhotoSetTabProps {
  traceId: string
}

export function BasicPhotoSetTab({ traceId }: BasicPhotoSetTabProps) {
  const [phase, setPhase] = useState<ClothingPhase>('input')
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [typeState, setTypeState] = useState<BasicPhotoTypeState>({
    whiteBgRetouched: { front: false, back: false },
    threeDEffect: { enabled: false, whiteBackground: false },
    mannequin: { enabled: false, whiteBackground: false },
    detailCloseup: { count: 0 },
    sellingPoint: { count: 0 },
  })
  const [requirements, setRequirements] = useState('')
  const [language, setLanguage] = useState('zh')
  const [model, setModel] = useState<GenerationModel>('nano-banana-pro')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [resolution, setResolution] = useState<ImageSize>('2K')
  const [turboEnabled, setTurboEnabled] = useState(false)

  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ResultImage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isProcessing = phase === 'analyzing' || phase === 'generating'
  const canStart = productImages.length > 0 && countSelectedTypes(typeState) > 0

  const set = useCallback((id: string, patch: Partial<ProgressStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!canStart) return
    const abort = new AbortController()
    abortRef.current = abort

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: '上传图片', status: 'pending' },
      { id: 'analyze', label: '分析产品', status: 'pending' },
      { id: 'preview', label: '生成设计方案', status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(0)
    setErrorMessage(null)
    setPhase('analyzing')

    try {
      // 1. Upload product images
      set('upload', { status: 'active' })
      const uploadedProductUrls = await Promise.all(
        productImages.map((img) => uploadFile(img.file).then((r) => r.publicUrl))
      )
      set('upload', { status: 'done' })
      setProgress(30)

      // 2. Analyze
      set('analyze', { status: 'active' })
      const { job_id: analysisJobId } = await analyzeProductV2({
        productImage: uploadedProductUrls[0],
        productImages: uploadedProductUrls,
        clothingMode: 'product_analysis',
        whiteBgRetouched: typeState.whiteBgRetouched,
        threeDEffect: typeState.threeDEffect,
        mannequin: typeState.mannequin,
        detailCloseup: typeState.detailCloseup,
        sellingPoint: typeState.sellingPoint,
        requirements,
        uiLanguage: language,
        targetLanguage: language,
        trace_id: traceId,
      })
      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      set('analyze', { status: 'done' })
      setProgress(70)

      // 3. Generate prompts (SSE)
      set('preview', { status: 'active' })
      let promptText = ''
      const stream = await generatePromptsV2Stream(
        {
          analysisJson: analysisJob.result_data,
          targetLanguage: language,
          stream: true,
          trace_id: traceId,
          clothingMode: 'prompt_generation',
        },
        abort.signal
      )
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (payload && payload !== '[DONE]') {
              promptText += payload
              set('preview', { status: 'active', streamedText: promptText })
            }
          }
        }
      }
      set('preview', { status: 'done', streamedText: promptText })
      setProgress(100)
      setPhase('preview')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage((err as Error).message ?? '分析失败')
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase('input')
    }
  }, [canStart, productImages, typeState, requirements, language, traceId, set])

  const handleGenerate = useCallback(async () => {
    const abort = new AbortController()
    abortRef.current = abort

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: '上传图片', status: 'done' },
      { id: 'analyze', label: '分析产品', status: 'done' },
      { id: 'preview', label: '生成设计方案', status: 'done' },
      { id: 'generate', label: '生成图片', status: 'pending' },
      { id: 'done', label: '完成', status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(75)
    setErrorMessage(null)
    setPhase('generating')

    try {
      // Re-upload (or use cached URLs)
      const uploadedProductUrls = await Promise.all(
        productImages.map((img) => uploadFile(img.file).then((r) => r.publicUrl))
      )

      // Get prompt from preview step
      const promptText = steps.find((s) => s.id === 'preview')?.streamedText ?? ''

      // Generate multiple images based on type count
      const totalCount = countSelectedTypes(typeState)
      set('generate', { status: 'active' })

      const jobIds: string[] = []
      for (let i = 0; i < totalCount; i++) {
        const { job_id } = await generateImage({
          productImage: uploadedProductUrls[0],
          productImages: uploadedProductUrls,
          prompt: promptText,
          model,
          aspectRatio,
          imageSize: resolution,
          turboEnabled,
          workflowMode: 'product',
          client_job_id: `${uid()}_${i}`,
          fe_attempt: 1,
          trace_id: traceId,
        })
        jobIds.push(job_id)
      }

      const imageJobs = await Promise.all(jobIds.map((id) => waitForJob(id, abort.signal)))
      set('generate', { status: 'done' })
      set('done', { status: 'done' })
      setProgress(100)

      const newResults: ResultImage[] = imageJobs
        .filter((j) => j.result_url)
        .map((j, i) => ({
          url: j.result_url!,
          label: `图片 ${i + 1}`,
        }))
      setResults(newResults)
      setPhase('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage((err as Error).message ?? '生成失败')
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase('preview')
    }
  }, [productImages, model, aspectRatio, resolution, turboEnabled, traceId, typeState, steps, set])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setSteps([])
    setProgress(0)
    setResults([])
    setErrorMessage(null)
  }, [])

  return (
    <div className="space-y-6">
      {/* Input Phase */}
      {phase === 'input' && (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>产品图片</Label>
            <MultiImageUploader
              images={productImages}
              onAdd={(files) => {
                const newImages = files.map((f) => ({
                  file: f,
                  previewUrl: URL.createObjectURL(f),
                }))
                setProductImages((prev) => [...prev, ...newImages])
              }}
              onRemove={(index) => {
                setProductImages((prev) => prev.filter((_, i) => i !== index))
              }}
              maxImages={5}
              label="上传产品图片"
            />
          </div>

          <GenerationTypeSelector
            typeState={typeState}
            onTypeStateChange={setTypeState}
          />

          <ClothingSettingsSection
            requirements={requirements}
            onRequirementsChange={setRequirements}
            language={language}
            onLanguageChange={setLanguage}
            model={model}
            onModelChange={setModel}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            resolution={resolution}
            onResolutionChange={setResolution}
            turboEnabled={turboEnabled}
            onTurboChange={setTurboEnabled}
          />

          <Button onClick={handleAnalyze} disabled={!canStart} className="w-full">
            开始分析
          </Button>
        </div>
      )}

      {/* Analyzing Phase */}
      {phase === 'analyzing' && (
        <div className="rounded-xl border p-5">
          <GenerationProgress steps={steps} overallProgress={progress} errorMessage={errorMessage} />
          <Button variant="outline" onClick={() => abortRef.current?.abort()} className="mt-4 w-full">
            取消
          </Button>
        </div>
      )}

      {/* Preview Phase */}
      {phase === 'preview' && (
        <div className="space-y-4">
          <div className="rounded-xl border p-5">
            <GenerationProgress steps={steps} overallProgress={progress} errorMessage={errorMessage} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleReset} className="flex-1">
              重新开始
            </Button>
            <Button onClick={handleGenerate} className="flex-1">
              生成图片
            </Button>
          </div>
        </div>
      )}

      {/* Generating Phase */}
      {phase === 'generating' && (
        <div className="rounded-xl border p-5">
          <GenerationProgress steps={steps} overallProgress={progress} errorMessage={errorMessage} />
          <Button variant="outline" onClick={() => abortRef.current?.abort()} className="mt-4 w-full">
            取消
          </Button>
        </div>
      )}

      {/* Complete Phase */}
      {phase === 'complete' && (
        <div className="space-y-4">
          <ResultGallery images={results} />
          <Button variant="outline" onClick={handleReset} className="w-full">
            重新生成
          </Button>
        </div>
      )}
    </div>
  )
}
