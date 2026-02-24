'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { GenerationProgress, type ProgressStep } from '@/components/generation/GenerationProgress'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'
import { DesignBlueprint } from '@/components/studio/DesignBlueprint'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { uploadFiles } from '@/lib/api/upload'
import {
  analyzeProductV2,
  generatePromptsV2Stream,
  generateImage,
  processGenerationJob,
} from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, ImageIcon, AlertTriangle, RefreshCw } from 'lucide-react'
import type {
  GenerationModel,
  AspectRatio,
  ImageSize,
  GenerationJob,
  GenesisPhase,
  OutputLanguage,
  AnalysisBlueprint,
  BlueprintImagePlan,
  PromptSseChunk,
  GeneratedPrompt,
} from '@/types'
import { DEFAULT_CREDIT_COSTS } from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 Square' },
  { value: '2:3', label: '2:3 Portrait' },
  { value: '3:2', label: '3:2 Landscape' },
  { value: '3:4', label: '3:4 Portrait' },
  { value: '4:3', label: '4:3 Landscape' },
  { value: '4:5', label: '4:5 Portrait' },
  { value: '5:4', label: '5:4 Landscape' },
  { value: '9:16', label: '9:16 Mobile' },
  { value: '16:9', label: '16:9 Wide' },
  { value: '21:9', label: '21:9 UltraWide' },
]

const IMAGE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

const RESOLUTION_OPTIONS: { value: ImageSize; label: string; proOnly: boolean }[] = [
  { value: '1K', label: '1K Standard', proOnly: false },
  { value: '2K', label: '2K HD (Pro)', proOnly: true },
  { value: '4K', label: '4K UHD (Pro)', proOnly: true },
]

const OUTPUT_LANGUAGES: { value: OutputLanguage; label: string }[] = [
  { value: 'none', label: 'None Text(Visual Only)' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'ar', label: 'العربية' },
  { value: 'ru', label: 'Русский' },
]

// ─── Types ──────────────────────────────────────────────────────────────────

interface ImageSlot {
  jobId: string
  status: 'pending' | 'done' | 'failed'
  result?: ResultImage
  error?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID()
}

function waitForJob(jobId: string, signal: AbortSignal): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let nudgeCount = 0

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
      const { data } = await supabase
        .from('generation_jobs')
        .select('*')
        .eq('id', jobId)
        .single()
      if (!data) return
      const job = data as GenerationJob
      if (job.status === 'success') done(job)
      else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      else {
        // Still processing — nudge again if stuck
        nudgeCount++
        if (nudgeCount > 0 && nudgeCount % 2 === 0) {
          processGenerationJob(jobId).catch(() => {})
        }
      }
    }

    signal.addEventListener(
      'abort',
      () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
      { once: true }
    )

    const channel = supabase
      .channel(`wait:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const partial = payload.new as Partial<GenerationJob>
          if (partial.status === 'success' || partial.status === 'failed') {
            // Realtime payload may lack large fields (result_data/result_url),
            // so re-fetch the full row instead of using payload directly
            void checkOnce()
          }
        }
      )
      .subscribe()

    void checkOnce()
    pollTimer = setInterval(() => {
      void checkOnce()
    }, 2000)
  })
}

function patchStep(
  steps: ProgressStep[],
  id: string,
  patch: Partial<ProgressStep>
): ProgressStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
}

function computeCost(model: GenerationModel, turboEnabled: boolean, imageSize: ImageSize, imageCount: number): number {
  let perImage: number
  if (turboEnabled) {
    perImage = imageSize === '1K' ? 8 : imageSize === '2K' ? 12 : 17
  } else {
    perImage = DEFAULT_CREDIT_COSTS[model] ?? 5
  }
  return perImage * imageCount
}

function extractResultFromJob(job: GenerationJob, index: number): ResultImage | null {
  const resultData = job.result_data as Record<string, unknown> | null
  const url = job.result_url
    ?? (typeof resultData?.b64_json === 'string' ? `data:image/png;base64,${resultData.b64_json}` : null)
  return url ? { url, label: `Image ${index + 1}` } : null
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

const PHASE_STEPS: { phase: GenesisPhase; label: string; num: number }[] = [
  { phase: 'input', label: 'Input', num: 1 },
  { phase: 'analyzing', label: 'Analyzing', num: 2 },
  { phase: 'preview', label: 'Plan Preview', num: 3 },
  { phase: 'generating', label: 'Generating', num: 4 },
  { phase: 'complete', label: 'Complete', num: 5 },
]

function StepIndicator({ currentPhase }: { currentPhase: GenesisPhase }) {
  const phaseOrder = ['input', 'analyzing', 'preview', 'generating', 'complete']
  const currentIdx = phaseOrder.indexOf(currentPhase)

  return (
    <div className="flex items-center justify-center gap-1 mb-8">
      {PHASE_STEPS.map((step, i) => {
        const isDone = i < currentIdx
        const isCurrent = i === currentIdx
        return (
          <div key={step.phase} className="flex items-center gap-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  isDone
                    ? 'bg-primary text-primary-foreground'
                    : isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isDone ? '✓' : step.num}
              </span>
              <span className={`text-sm ${isCurrent ? 'font-semibold' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
            </div>
            {i < PHASE_STEPS.length - 1 && (
              <span className="mx-2 h-px w-8 bg-border" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Analyzing Animation ────────────────────────────────────────────────────

function AnalyzingAnimation({ messages }: { messages: string[] }) {
  const [msgIdx, setMsgIdx] = useState(0)

  useEffect(() => {
    if (messages.length === 0) return
    const timer = setInterval(() => {
      setMsgIdx((prev) => (prev + 1) % messages.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [messages])

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <p className="text-lg font-semibold">Analyzing...</p>
      <p className="text-sm text-muted-foreground animate-pulse">
        {messages[msgIdx] ?? ''}
      </p>
    </div>
  )
}

// ─── Prompt parsing ─────────────────────────────────────────────────────────

function parsePromptArray(rawText: string, expectedCount: number): string[] {
  const text = rawText.trim()
  const candidates: string[] = [text]

  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeFenceMatch?.[1]) candidates.push(codeFenceMatch[1].trim())

  const jsonArrayMatch = text.match(/\[[\s\S]*\]/)
  if (jsonArrayMatch?.[0]) candidates.push(jsonArrayMatch[0].trim())

  for (const candidate of candidates) {
    try {
      const arr = JSON.parse(candidate)
      if (Array.isArray(arr)) {
        const prompts = arr
          .map((item) => (item && typeof item === 'object' ? (item as GeneratedPrompt).prompt : null))
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        if (prompts.length > 0) return prompts
      }
    } catch {
      // fallback below
    }
  }

  const fallback = text
    .split(/\n{2,}|\n(?=\d+[\.\)、])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)

  if (fallback.length > 0) return fallback
  return Array.from({ length: Math.max(1, expectedCount) }, () => text)
}

function isBlueprintImagePlan(value: unknown): value is BlueprintImagePlan {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.title === 'string' &&
    typeof item.description === 'string' &&
    typeof item.design_content === 'string'
  )
}

function isAnalysisBlueprint(value: unknown): value is AnalysisBlueprint {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj.images) || !obj.images.every(isBlueprintImagePlan)) return false
  if (typeof obj.design_specs !== 'string') return false
  return true
}

// ─── Image Slot Card ────────────────────────────────────────────────────────

function ImageSlotCard({ slot, index }: { slot: ImageSlot; index: number }) {
  if (slot.status === 'done' && slot.result) {
    return (
      <div className="group relative rounded-xl overflow-hidden border border-border bg-muted aspect-[4/3]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slot.result.url}
          alt={slot.result.label ?? `Image ${index + 1}`}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <a
            href={slot.result.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
          >
            <ImageIcon className="h-4 w-4 text-white" />
          </a>
        </div>
      </div>
    )
  }

  if (slot.status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-destructive/40 bg-destructive/5 aspect-[4/3] p-4 text-center">
        <AlertTriangle className="h-6 w-6 text-destructive mb-2" />
        <p className="text-xs text-destructive font-medium">Failed</p>
        {slot.error && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{slot.error}</p>}
      </div>
    )
  }

  // pending
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/20 bg-muted/30 aspect-[4/3] p-4">
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin mb-2" />
      <p className="text-xs text-muted-foreground">Pending</p>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StudioGenesisForm() {
  const t = useTranslations('studio.genesis')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const router = useRouter()

  // ── Input state ──
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [requirements, setRequirements] = useState('')
  const [imageCount, setImageCount] = useState(1)
  const [model, setModel] = useState<GenerationModel>('nano-banana')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>('none')

  // ── Preview state ──
  const [turboEnabled, setTurboEnabled] = useState(false)
  const [analysisBlueprint, setAnalysisBlueprint] = useState<AnalysisBlueprint | null>(null)
  const [editableDesignSpecs, setEditableDesignSpecs] = useState('')
  const [editableImagePlans, setEditableImagePlans] = useState<BlueprintImagePlan[]>([])
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])

  // ── Flow state ──
  const [phase, setPhase] = useState<GenesisPhase>('input')
  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ResultImage[]>([])
  const [imageSlots, setImageSlots] = useState<ImageSlot[]>([])
  const [failedSlotIndices, setFailedSlotIndices] = useState<number[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { total } = useCredits()
  const totalCost = computeCost(model, turboEnabled, imageSize, imageCount)
  const insufficientCredits = total !== null && total < totalCost
  const analyzingMessages = [
    t('analyzingStep1'),
    t('analyzingStep2'),
    t('analyzingStep3'),
    t('analyzingStep4'),
  ]

  // Derived: is the left panel disabled?
  const leftPanelDisabled = phase === 'analyzing' || phase === 'generating'
  const leftParamsDisabled = leftPanelDisabled || phase === 'preview' || phase === 'complete'

  // Enforce resolution constraint: nano-banana → 1K only
  useEffect(() => {
    if (model === 'nano-banana' && imageSize !== '1K') {
      setImageSize('1K')
    }
  }, [model, imageSize])

  // ── Image handlers ──
  const handleAddImages = useCallback((files: File[]) => {
    const newImages: UploadedImage[] = files.map((f) => ({
      file: f,
      previewUrl: URL.createObjectURL(f),
    }))
    setProductImages((prev) => [...prev, ...newImages])
    setResults([])
    setErrorMessage(null)
  }, [])

  const handleRemoveImage = useCallback((index: number) => {
    setProductImages((prev) => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
  }, [])

  // ── Phase 1: Analyze & Blueprint ──
  const handleAnalyze = useCallback(async () => {
    if (productImages.length === 0) return
    const trace_id = uid()
    const abort = new AbortController()
    abortRef.current = abort

    setPhase('analyzing')
    setSteps([
      { id: 'upload', label: t('steps.upload'), status: 'pending' },
      { id: 'analyze', label: t('steps.analyze'), status: 'pending' },
    ])
    setProgress(0)
    setErrorMessage(null)

    const set = (id: string, patch: Partial<ProgressStep>) =>
      setSteps((prev) => patchStep(prev, id, patch))

    try {
      // 1. Upload all images
      set('upload', { status: 'active' })
      const uploadResults = await uploadFiles(productImages.map((img) => img.file))
      const urls = uploadResults.map((r) => r.publicUrl)
      setUploadedUrls(urls)
      set('upload', { status: 'done' })
      setProgress(30)

      // 2. Analyze product
      set('analyze', { status: 'active' })
      const { job_id: analysisJobId } = await analyzeProductV2({
        productImage: urls[0],
        productImages: urls,
        requirements: requirements || undefined,
        imageCount,
        uiLanguage: locale,
        targetLanguage: locale,
        outputLanguage,
        trace_id,
      })

      // Nudge worker to start processing (fire-and-forget)
      processGenerationJob(analysisJobId).catch(() => {})

      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      if (!isAnalysisBlueprint(analysisJob.result_data)) {
        throw new Error('Analysis output format mismatch')
      }
      const blueprint = analysisJob.result_data

      set('analyze', { status: 'done' })
      setProgress(100)

      // 3. Enter Plan Preview
      setAnalysisBlueprint(blueprint)
      setEditableDesignSpecs(blueprint.design_specs ?? '')
      setEditableImagePlans([...(blueprint.images ?? [])])
      setPhase('preview')
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(err instanceof Error ? err.message : tc('error'))
      setPhase('input')
    }
  }, [productImages, requirements, imageCount, outputLanguage, locale, t, tc])

  // ── Phase 2: Confirm & Generate ──
  const handleGenerate = useCallback(async () => {
    if (!analysisBlueprint) return
    const trace_id = uid()
    const client_job_id = uid()
    const abort = new AbortController()
    abortRef.current = abort

    setPhase('generating')
    setSteps([
      { id: 'prompts', label: t('steps.prompts'), status: 'pending' },
      { id: 'generate', label: t('steps.generate'), status: 'pending' },
      { id: 'done', label: t('steps.done'), status: 'pending' },
    ])
    setProgress(0)
    setResults([])
    setImageSlots([])
    setFailedSlotIndices([])
    setErrorMessage(null)

    const set = (id: string, patch: Partial<ProgressStep>) =>
      setSteps((prev) => patchStep(prev, id, patch))

    try {
      // 1. Generate prompts — pass edited blueprint
      set('prompts', { status: 'active' })
      const modifiedBlueprint: AnalysisBlueprint = {
        images: editableImagePlans,
        design_specs: editableDesignSpecs,
        _ai_meta: analysisBlueprint._ai_meta,
      }

      let promptText = ''
      const stream = await generatePromptsV2Stream(
        {
          analysisJson: modifiedBlueprint,
          design_specs: editableDesignSpecs,
          imageCount: editableImagePlans.length,
          targetLanguage: locale,
          outputLanguage,
          stream: true,
          trace_id,
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
            if (payload && payload !== '[DONE]' && !payload.startsWith('[ERROR]')) {
              try {
                const chunk = JSON.parse(payload) as PromptSseChunk
                if (chunk.fullText) {
                  promptText = chunk.fullText
                }
              } catch {
                promptText += payload
              }
            }
          }
        }
      }
      set('prompts', { status: 'done' })
      setProgress(40)

      // 2. Parse structured prompt JSON
      const parsedPrompts = parsePromptArray(promptText, editableImagePlans.length)
      const prompts = Array.from({ length: editableImagePlans.length }, (_, i) => {
        const value = parsedPrompts[i] ?? parsedPrompts[i % parsedPrompts.length]
        return value ?? promptText
      })
      if (prompts.length === 0) {
        throw new Error('No prompts generated from SSE response')
      }

      // 3. Generate images — one per prompt
      set('generate', { status: 'active' })
      setProgress(55)

      // Create initial slots
      const initialSlots: ImageSlot[] = prompts.map(() => ({
        jobId: '',
        status: 'pending' as const,
      }))
      setImageSlots(initialSlots)

      const imageJobIds = await Promise.all(
        prompts.map((prompt, i) =>
          generateImage({
            productImage: uploadedUrls[0],
            productImages: uploadedUrls,
            prompt,
            model,
            aspectRatio,
            imageSize,
            turboEnabled,
            imageCount: 1,
            client_job_id: `${client_job_id}_${i}`,
            fe_attempt: 1,
            trace_id,
            metadata: {
              is_batch: true,
              batch_index: i,
              image_size: imageSize,
              product_images: uploadedUrls,
            },
          }).then((r) => r.job_id)
        )
      )

      // Update slots with job IDs
      setImageSlots(imageJobIds.map((jobId) => ({ jobId, status: 'pending' })))

      // Nudge worker for each image job with staggered delay to avoid API rate limits
      imageJobIds.forEach((id, i) => {
        setTimeout(() => {
          processGenerationJob(id).catch(() => {})
        }, i * 3000) // 3s interval between nudges
      })

      // Wait for each job independently, updating slots as they complete
      const settledJobs = await Promise.allSettled(
        imageJobIds.map((id, i) =>
          waitForJob(id, abort.signal).then((job) => {
            const result = extractResultFromJob(job, i)
            setImageSlots((prev) =>
              prev.map((s, idx) =>
                idx === i ? { ...s, status: 'done', result: result ?? undefined } : s
              )
            )
            return { index: i, job, result }
          }).catch((err) => {
            setImageSlots((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Failed' }
                  : s
              )
            )
            throw err
          })
        )
      )

      // Collect results
      const successResults: ResultImage[] = []
      const failedIndices: number[] = []
      settledJobs.forEach((settled, i) => {
        if (settled.status === 'fulfilled' && settled.value.result) {
          successResults.push(settled.value.result)
        } else {
          failedIndices.push(i)
        }
      })

      set('generate', { status: 'done' })
      set('done', { status: 'done' })
      setProgress(100)
      setResults(successResults)
      setFailedSlotIndices(failedIndices)

      if (successResults.length === 0) {
        setErrorMessage(t('allImagesFailed'))
      }

      setPhase('complete')
      refreshCredits()
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(err instanceof Error ? err.message : tc('error'))
      setSteps((prev) =>
        prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s))
      )
    }
  }, [analysisBlueprint, editableImagePlans, editableDesignSpecs, uploadedUrls, model, aspectRatio, imageSize, turboEnabled, outputLanguage, locale, t, tc])

  const handleBackToInput = useCallback(() => {
    setPhase('input')
    setSteps([])
    setProgress(0)
    setErrorMessage(null)
  }, [])

  const handleBackToPreview = useCallback(() => {
    setPhase('preview')
    setSteps([])
    setProgress(0)
    setErrorMessage(null)
  }, [])

  const handleNewGeneration = useCallback(() => {
    setPhase('input')
    setSteps([])
    setProgress(0)
    setResults([])
    setImageSlots([])
    setFailedSlotIndices([])
    setErrorMessage(null)
    setAnalysisBlueprint(null)
    setEditableDesignSpecs('')
    setEditableImagePlans([])
    setUploadedUrls([])
  }, [])

  // ─── Render ────────────────────────────────────────────────────────────────

  // Determine button state
  const renderLeftButton = () => {
    if (phase === 'input') {
      return (
        <Button
          size="lg"
          onClick={handleAnalyze}
          disabled={productImages.length === 0}
          className="w-full"
        >
          {t('analyze')}
        </Button>
      )
    }

    if (phase === 'analyzing') {
      return (
        <Button
          size="lg"
          disabled
          className="w-full"
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          {t('steps.analyze')}
        </Button>
      )
    }

    if (phase === 'preview') {
      return (
        <div className="space-y-3">
          {/* Turbo Boost */}
          <div className="flex items-center justify-between p-3 rounded-xl border bg-card">
            <div>
              <p className="text-sm font-semibold">{t('turboBoost')}</p>
              <p className="text-xs text-muted-foreground">{t('turboBoostDesc')}</p>
            </div>
            <Switch
              checked={turboEnabled}
              onCheckedChange={setTurboEnabled}
            />
          </div>

          <div className="flex justify-end">
            <CreditCostBadge cost={totalCost} />
          </div>

          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={insufficientCredits}
            className="w-full"
          >
            {t('confirmGenerate', { count: editableImagePlans.length, cost: totalCost })}
          </Button>

          {insufficientCredits && (
            <div className="text-center">
              <p className="text-sm text-destructive mb-2">{tc('insufficientCredits')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/${locale}/pricing`)}
              >
                {tc('buyCredits')}
              </Button>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToInput}
            className="w-full"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('backToEdit')}
          </Button>
        </div>
      )
    }

    if (phase === 'generating') {
      return (
        <div className="space-y-3">
          <Button size="lg" disabled className="w-full">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('steps.generate')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleStop} className="w-full">
            {tc('stop')}
          </Button>
        </div>
      )
    }

    // complete
    return (
      <div className="space-y-3">
        <Button size="lg" onClick={handleNewGeneration} className="w-full">
          {t('newGeneration')}
        </Button>
        {analysisBlueprint && (
          <Button variant="outline" size="sm" onClick={handleBackToPreview} className="w-full">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('backToEdit')}
          </Button>
        )}
      </div>
    )
  }

  // Right panel content
  const renderRightPanel = () => {
    if (phase === 'input') {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center text-muted-foreground min-h-[400px]">
          <ImageIcon className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">{t('emptyState')}</p>
        </div>
      )
    }

    if (phase === 'analyzing') {
      return (
        <div className="space-y-6">
          <AnalyzingAnimation messages={analyzingMessages} />
          <div className="max-w-md mx-auto">
            <GenerationProgress steps={steps} overallProgress={progress} errorMessage={errorMessage} />
          </div>
        </div>
      )
    }

    if (phase === 'preview') {
      return (
        <DesignBlueprint
          designSpecs={editableDesignSpecs}
          onDesignSpecsChange={setEditableDesignSpecs}
          imagePlans={editableImagePlans}
          onImagePlanChange={(i, plan) => {
            setEditableImagePlans((prev) => prev.map((p, idx) => (idx === i ? plan : p)))
          }}
        />
      )
    }

    if (phase === 'generating') {
      return (
        <div className="space-y-6">
          <div className="max-w-md mx-auto rounded-xl border p-5">
            <GenerationProgress steps={steps} overallProgress={progress} errorMessage={errorMessage} />
          </div>

          {imageSlots.length > 0 && (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {imageSlots.map((slot, i) => (
                <ImageSlotCard key={slot.jobId || `slot-${i}`} slot={slot} index={i} />
              ))}
            </div>
          )}
        </div>
      )
    }

    // complete
    return (
      <div className="space-y-6">
        {results.length > 0 && (
          <ResultGallery images={results} />
        )}

        {/* Show failed slots */}
        {failedSlotIndices.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>{t('partialFailed', { count: failedSlotIndices.length })}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackToPreview}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {t('retryFailed')}
            </Button>
          </div>
        )}

        {results.length === 0 && !errorMessage && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
            <p className="text-sm text-destructive font-medium">{t('allImagesFailed')}</p>
            <Button variant="outline" size="sm" onClick={handleBackToPreview} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-1" />
              {tc('tryAgain')}
            </Button>
          </div>
        )}

        {errorMessage && (
          <div className="text-center text-sm text-destructive">{errorMessage}</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-1">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentPhase={phase} />

      {/* Fixed dual-column layout */}
      <div className="grid gap-6" style={{ gridTemplateColumns: '420px 1fr' }}>
        {/* ── Left panel (always visible) ── */}
        <div className="space-y-5">
          {/* Product Source */}
          <fieldset disabled={leftPanelDisabled}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{tc('productImage')}</Label>
                <span className="text-xs text-muted-foreground">{productImages.length}/6</span>
              </div>
              <MultiImageUploader
                images={productImages}
                onAdd={handleAddImages}
                onRemove={handleRemoveImage}
                maxImages={6}
                label={tc('uploadLabel')}
              />
              <p className="text-xs text-muted-foreground">{tc('uploadSublabel')}</p>
            </div>
          </fieldset>

          {/* Design Brief */}
          <div className="space-y-2">
            <Label htmlFor="sg-req">{t('designBrief')}</Label>
            <Textarea
              id="sg-req"
              placeholder={tc('requirementsPlaceholder')}
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={3}
              disabled={leftPanelDisabled}
            />
          </div>

          {/* Output Language */}
          <div className="space-y-2">
            <Label>{t('outputLanguage')}</Label>
            <Select
              value={outputLanguage}
              onValueChange={(v) => setOutputLanguage(v as OutputLanguage)}
              disabled={leftParamsDisabled}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTPUT_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>{lang.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model + Aspect Ratio */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{tc('model')}</Label>
              <Select
                value={model}
                onValueChange={(v) => setModel(v as GenerationModel)}
                disabled={leftParamsDisabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nano-banana">Nano Banana</SelectItem>
                  <SelectItem value="nano-banana-pro">Nano Banana Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tc('aspectRatio')}</Label>
              <Select
                value={aspectRatio}
                onValueChange={(v) => setAspectRatio(v as AspectRatio)}
                disabled={leftParamsDisabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Resolution + Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{tc('imageSize')}</Label>
              <Select
                value={imageSize}
                onValueChange={(v) => setImageSize(v as ImageSize)}
                disabled={leftParamsDisabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      disabled={opt.proOnly && model !== 'nano-banana-pro'}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tc('imageCount')}</Label>
              <Select
                value={String(imageCount)}
                onValueChange={(v) => setImageCount(Number(v))}
                disabled={leftParamsDisabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMAGE_COUNTS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} {n === 1 ? 'Image' : 'Images'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-2">
            {renderLeftButton()}
          </div>
        </div>

        {/* ── Right panel (dynamic content) ── */}
        <div className="min-h-[400px]">
          {renderRightPanel()}
        </div>
      </div>
    </div>
  )
}
