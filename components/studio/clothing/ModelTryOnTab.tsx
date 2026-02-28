'use client'

import { useState, useRef, useCallback } from 'react'
import { Image as ImageIcon, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import type { ProgressStep } from '@/components/generation/GenerationProgress'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { ModelImageSection } from './ModelImageSection'
import { ClothingSettingsSection } from './ClothingSettingsSection'
import { AIModelGeneratorDialog } from './AIModelGeneratorDialog'
import { PreviewTileGrid } from '@/components/generation/PreviewTileGrid'
import { uploadFile } from '@/lib/api/upload'
import { analyzeProductV2, generatePromptsV2Stream, generateImage } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type { GenerationModel, AspectRatio, ImageSize, GenerationJob, ClothingPhase } from '@/types'

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

interface ModelTryOnTabProps {
  traceId: string
}

export function ModelTryOnTab({ traceId }: ModelTryOnTabProps) {
  const [phase, setPhase] = useState<ClothingPhase>('input')
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [modelImage, setModelImage] = useState<UploadedImage | null>(null)
  const [requirements, setRequirements] = useState('')
  const [language, setLanguage] = useState('zh')
  const [model, setModel] = useState<GenerationModel>('flux-kontext-pro')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [resolution, setResolution] = useState<ImageSize>('2K')
  const [turboEnabled, setTurboEnabled] = useState(false)
  const [showAIModelDialog, setShowAIModelDialog] = useState(false)

  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ResultImage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isProcessing = phase === 'analyzing' || phase === 'generating'
  const canStart = productImages.length > 0 && modelImage !== null

  const set = useCallback((id: string, patch: Partial<ProgressStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!canStart) return
    const abort = new AbortController()
    abortRef.current = abort

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: '上传图片', status: 'pending' },
      { id: 'analyze', label: '分析产品与模特', status: 'pending' },
      { id: 'preview', label: '生成设计方案', status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(0)
    setErrorMessage(null)
    setPhase('analyzing')

    try {
      set('upload', { status: 'active' })
      const uploadedProductUrls = await Promise.all(
        productImages.map((img) => uploadFile(img.file).then((r) => r.publicUrl))
      )
      const { publicUrl: uploadedModelUrl } = await uploadFile(modelImage!.file)
      set('upload', { status: 'done' })
      setProgress(30)

      set('analyze', { status: 'active' })
      const { job_id: analysisJobId } = await analyzeProductV2({
        productImage: uploadedProductUrls[0],
        productImages: uploadedProductUrls,
        modelImage: uploadedModelUrl,
        clothingMode: 'model_strategy',
        requirements,
        uiLanguage: language,
        targetLanguage: language,
        trace_id: traceId,
      })
      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      set('analyze', { status: 'done' })
      setProgress(70)

      set('preview', { status: 'active' })
      let promptText = ''
      const stream = await generatePromptsV2Stream(
        {
          analysisJson: analysisJob.result_data,
          targetLanguage: language,
          stream: true,
          trace_id: traceId,
          clothingMode: 'model_prompt_generation',
        },
        abort.signal
      )
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload) as { fullText?: string }
            promptText = parsed.fullText ?? promptText
          } catch {
            promptText += payload
          }
          set('preview', { status: 'active', streamedText: promptText })
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
  }, [canStart, productImages, modelImage, requirements, language, traceId, set])

  const handleGenerate = useCallback(async () => {
    const abort = new AbortController()
    abortRef.current = abort

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: '上传图片', status: 'done' },
      { id: 'analyze', label: '分析产品与模特', status: 'done' },
      { id: 'preview', label: '生成设计方案', status: 'done' },
      { id: 'generate', label: '生成图片', status: 'pending' },
      { id: 'done', label: '完成', status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(75)
    setErrorMessage(null)
    setPhase('generating')

    try {
      const uploadedProductUrls = await Promise.all(
        productImages.map((img) => uploadFile(img.file).then((r) => r.publicUrl))
      )
      const { publicUrl: uploadedModelUrl } = await uploadFile(modelImage!.file)

      const promptText = steps.find((s) => s.id === 'preview')?.streamedText ?? ''

      set('generate', { status: 'active' })
      const { job_id: imageJobId } = await generateImage({
        productImage: uploadedProductUrls[0],
        productImages: uploadedProductUrls,
        modelImage: uploadedModelUrl,
        prompt: promptText,
        model,
        aspectRatio,
        imageSize: resolution,
        turboEnabled,
        workflowMode: 'model',
        client_job_id: uid(),
        fe_attempt: 1,
        trace_id: traceId,
      })
      const imageJob = await waitForJob(imageJobId, abort.signal)
      set('generate', { status: 'done' })
      set('done', { status: 'done' })
      setProgress(100)

      if (imageJob.result_url) {
        setResults([{ url: imageJob.result_url, label: '模特试穿效果' }])
      }
      setPhase('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage((err as Error).message ?? '生成失败')
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase('preview')
    }
  }, [productImages, modelImage, model, aspectRatio, resolution, turboEnabled, traceId, steps, set])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setSteps([])
    setProgress(0)
    setResults([])
    setErrorMessage(null)
  }, [])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // ─── Left Panel (form inputs) ───
  const leftPanel = (
    <>
      <fieldset disabled={isProcessing} className="space-y-4">
        {/* Product Image Card */}
        <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 space-y-3">
          <div className="flex items-center gap-3">
            <SectionIcon icon={ImageIcon} />
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-[#1a1d24]">产品图</h3>
              <p className="text-[13px] text-[#7d818d]">上传多角度产品图或细节图</p>
            </div>
            <span className="text-[13px] text-[#6f7380]">{productImages.length}/5</span>
          </div>
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
            label="拖拽或点击上传"
          />
        </div>

        {/* Model Image Card */}
        <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 space-y-3">
          <div className="flex items-center gap-3">
            <SectionIcon icon={User} />
            <div>
              <h3 className="text-[15px] font-semibold text-[#1a1d24]">模特图片</h3>
              <p className="text-[13px] text-[#7d818d]">上传模特照片或AI生成</p>
            </div>
          </div>
          <ModelImageSection
            modelImage={modelImage}
            onModelImageChange={setModelImage}
            onGenerateAIModel={() => setShowAIModelDialog(true)}
          />
        </div>

        {/* Settings Card (ClothingSettingsSection already has card styling) */}
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
          disabled={isProcessing}
        />
      </fieldset>

      {/* Action buttons */}
      <div className="pt-3">
        {phase === 'input' && (
          <Button
            onClick={handleAnalyze}
            disabled={!canStart}
            className="h-12 w-full rounded-2xl bg-[#191b22] text-base font-semibold text-white hover:bg-[#111318] disabled:bg-[#9a9ca3] disabled:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            分析产品
          </Button>
        )}
        {phase === 'analyzing' && (
          <Button variant="outline" onClick={handleCancel} className="w-full h-12 rounded-2xl">
            取消分析
          </Button>
        )}
        {phase === 'preview' && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleReset} className="flex-1 h-12 rounded-2xl">
              重新开始
            </Button>
            <Button
              onClick={handleGenerate}
              className="h-12 flex-1 rounded-2xl bg-[#191b22] text-base font-semibold text-white hover:bg-[#111318]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
              生成图片
            </Button>
          </div>
        )}
        {phase === 'generating' && (
          <Button variant="outline" onClick={handleCancel} className="w-full h-12 rounded-2xl">
            取消生成
          </Button>
        )}
        {phase === 'complete' && (
          <Button variant="outline" onClick={handleReset} className="w-full h-12 rounded-2xl">
            重新生成
          </Button>
        )}
      </div>

      <AIModelGeneratorDialog
        open={showAIModelDialog}
        onOpenChange={setShowAIModelDialog}
        onGenerate={(models) => {
          if (models.length > 0) {
            setModelImage(models[0])
          }
        }}
        productImages={productImages}
      />
    </>
  )

  // ─── Right Panel (status / results) ───
  const rightPanel = (() => {
    if (phase === 'input') {
      return (
        <div className="flex min-h-[700px] flex-col items-center justify-center text-center text-[#7f838f]">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#eceef2] text-[#717682]">
            <svg
              className="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <p className="text-sm leading-relaxed">
            上传产品图片和模特图片后
            <br />
            点击“分析产品”开始
          </p>
        </div>
      )
    }

    if (phase === 'analyzing' || phase === 'generating') {
      const activeStep =
        [...steps].reverse().find((step) => step.status === 'active')?.label
        ?? (phase === 'generating' ? '生成中' : '分析中')
      const title = phase === 'generating' ? '生成中...' : '分析中...'
      const subtitle = phase === 'generating' ? '正在根据规划生成图片' : '正在分析产品并生成设计规范'

      return (
        <CoreProcessingStatus
          title={title}
          subtitle={subtitle}
          progress={progress}
          statusLine={errorMessage ?? activeStep}
          showHeader={false}
          statusPlacement="below"
        />
      )
    }

    if (phase === 'preview') {
      return (
        <div className="space-y-4">
          <PreviewTileGrid
            count={1}
            aspectRatio={aspectRatio}
            labels={['模特试穿预览']}
          />
          <p className="text-sm text-[#7d818d]">方案已生成，请确认后开始生成</p>
        </div>
      )
    }

    // complete
    return (
      <div className="space-y-4">
        {results.length > 0 && <ResultGallery images={results} aspectRatio={aspectRatio} />}
        {results.length === 0 && errorMessage && (
          <div className="text-center text-sm text-destructive">{errorMessage}</div>
        )}
      </div>
    )
  })()

  return { leftPanel, rightPanel, phase, previewCount: phase === 'preview' ? 1 : results.length }
}
