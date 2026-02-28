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
import type { ProgressStep } from '@/components/generation/GenerationProgress'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { DesignBlueprint } from '@/components/studio/DesignBlueprint'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { uploadFiles } from '@/lib/api/upload'
import {
  analyzeProductV2,
  generatePromptsV2Stream,
  generateImage,
  processGenerationJob,
} from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, ArrowRight, Loader2, ImageIcon, AlertTriangle, RefreshCw, Sparkles, Zap } from 'lucide-react'
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

const ASPECT_RATIOS_EN: { value: AspectRatio; label: string }[] = [
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

const ASPECT_RATIOS_ZH: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 方图' },
  { value: '2:3', label: '2:3 竖版' },
  { value: '3:2', label: '3:2 横版' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '4:3', label: '4:3 横版' },
  { value: '4:5', label: '4:5 竖版' },
  { value: '5:4', label: '5:4 横版' },
  { value: '9:16', label: '9:16 长图' },
  { value: '16:9', label: '16:9 宽屏' },
  { value: '21:9', label: '21:9 超宽屏' },
]

const IMAGE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

const RESOLUTION_OPTIONS_EN: { value: ImageSize; label: string; proOnly: boolean }[] = [
  { value: '1K', label: '1K Standard', proOnly: false },
  { value: '2K', label: '2K HD (Pro)', proOnly: true },
  { value: '4K', label: '4K UHD (Pro)', proOnly: true },
]

const RESOLUTION_OPTIONS_ZH: { value: ImageSize; label: string; proOnly: boolean }[] = [
  { value: '1K', label: '1K 标清', proOnly: false },
  { value: '2K', label: '2K 高清 (仅Pro)', proOnly: true },
  { value: '4K', label: '4K 超清 (仅Pro)', proOnly: true },
]

const OUTPUT_LANGUAGES_EN: { value: OutputLanguage; label: string }[] = [
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

const OUTPUT_LANGUAGES_ZH: { value: OutputLanguage; label: string }[] = [
  { value: 'none', label: '无文字(纯视觉)' },
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
  const base = Math.max(DEFAULT_CREDIT_COSTS[model] ?? 5, 5)
  let perImage: number
  if (turboEnabled) {
    perImage = base + (imageSize === '1K' ? 8 : imageSize === '2K' ? 12 : 16)
  } else {
    perImage = base
  }
  return perImage * imageCount
}

function extractResultFromJob(job: GenerationJob, index: number): ResultImage | null {
  const resultData = job.result_data as Record<string, unknown> | null
  const url = job.result_url
    ?? (typeof resultData?.b64_json === 'string' ? `data:image/png;base64,${resultData.b64_json}` : null)
  return url ? { url, label: `Image ${index + 1}` } : null
}

function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function localizeImagePlansForZh(imagePlans: BlueprintImagePlan[]): BlueprintImagePlan[] {
  return imagePlans.map((plan, index) => {
    const title = hasCjkText(plan.title) ? plan.title : `图片方案 ${index + 1}`
    const description = hasCjkText(plan.description) ? plan.description : '请编辑该图片方案的标题和描述'
    return { ...plan, title, description }
  })
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

const PHASE_STEPS_ZH: { phase: GenesisPhase; label: string; num: number }[] = [
  { phase: 'input', label: '输入', num: 1 },
  { phase: 'analyzing', label: '分析中', num: 2 },
  { phase: 'preview', label: '确认规划', num: 3 },
  { phase: 'generating', label: '生成中', num: 4 },
  { phase: 'complete', label: '完成', num: 5 },
]

const PHASE_STEPS_EN: { phase: GenesisPhase; label: string; num: number }[] = [
  { phase: 'input', label: 'Upload', num: 1 },
  { phase: 'analyzing', label: 'Analyzing', num: 2 },
  { phase: 'preview', label: 'Preview', num: 3 },
  { phase: 'generating', label: 'Generating', num: 4 },
  { phase: 'complete', label: 'Complete', num: 5 },
]

function StepIndicator({ currentPhase, locale }: { currentPhase: GenesisPhase; locale: string }) {
  const phaseOrder = ['input', 'analyzing', 'preview', 'generating', 'complete']
  const currentIdx = phaseOrder.indexOf(currentPhase)
  const steps = locale === 'zh' ? PHASE_STEPS_ZH : PHASE_STEPS_EN

  return (
    <div className="flex w-full items-center justify-center overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const isDone = i < currentIdx
        const isCurrent = i === currentIdx
        const isPastOrCurrent = isDone || isCurrent
        return (
          <div key={step.phase} className="flex shrink-0 items-center">
            <div className="flex items-center gap-2">
              {isCurrent ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#191b22] text-xs font-semibold text-white">
                  {step.num}
                </span>
              ) : (
                <span className={`w-4 text-center text-sm ${isDone ? 'font-medium text-[#202227]' : 'text-[#6f7380]'}`}>
                  {step.num}
                </span>
              )}
              <span
                className={`text-sm ${
                  isPastOrCurrent ? 'font-medium text-[#202227]' : 'text-[#6f7380]'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="mx-3 h-px w-8 bg-[#d8dbe1] sm:mx-5 sm:w-12" />
            )}
          </div>
        )
      })}
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

function toCssAspectRatio(aspectRatio: AspectRatio): string {
  const [w, h] = aspectRatio.split(':').map((v) => Number(v))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '4 / 3'
  return `${w} / ${h}`
}

function ImageSlotCard({
  slot,
  index,
  aspectRatio,
  isZh,
}: {
  slot: ImageSlot
  index: number
  aspectRatio: AspectRatio
  isZh: boolean
}) {
  const boxAspectRatio = toCssAspectRatio(aspectRatio)

  if (slot.status === 'done' && slot.result) {
    return (
      <div className="group relative w-[220px] max-w-full overflow-hidden rounded-xl border border-[#d5d9e2] bg-[#eceef2]" style={{ aspectRatio: boxAspectRatio }}>
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
      <div className="flex w-[220px] max-w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-destructive/40 bg-destructive/5 p-4 text-center" style={{ aspectRatio: boxAspectRatio }}>
        <AlertTriangle className="h-6 w-6 text-destructive mb-2" />
        <p className="text-xs text-destructive font-medium">{isZh ? '生成失败' : 'Failed'}</p>
        {slot.error && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{slot.error}</p>}
      </div>
    )
  }

  // pending
  return (
    <div className="flex w-[220px] max-w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#cfd4dd] bg-[#f4f5f7] p-4" style={{ aspectRatio: boxAspectRatio }}>
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin mb-2" />
      <p className="text-xs text-muted-foreground">{isZh ? '生成中' : 'Pending'}</p>
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
  const [model, setModel] = useState<GenerationModel>('flux-kontext-pro')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>('none')

  // Locale-aware constants
  const ASPECT_RATIOS = locale === 'zh' ? ASPECT_RATIOS_ZH : ASPECT_RATIOS_EN
  const RESOLUTION_OPTIONS = locale === 'zh' ? RESOLUTION_OPTIONS_ZH : RESOLUTION_OPTIONS_EN
  const OUTPUT_LANGUAGES = locale === 'zh' ? OUTPUT_LANGUAGES_ZH : OUTPUT_LANGUAGES_EN

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
  const [analyzingMessageIndex, setAnalyzingMessageIndex] = useState(0)
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
  const isZh = locale.startsWith('zh')
  const backendLocale = isZh ? 'zh-CN' : 'en'
  const leftCardClass = 'rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6'
  const panelInputClass = 'h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px]'
  const rightPanelTitle = phase === 'analyzing'
    ? (isZh ? '分析中...' : 'Analyzing...')
    : phase === 'preview'
      ? t('planPreview')
    : phase === 'generating'
      ? (isZh ? '生成中...' : 'Generating...')
      : isZh
        ? '生成结果'
        : tc('results')
  const rightPanelSubtitle = phase === 'analyzing'
    ? (isZh ? '正在分析产品并生成设计规范' : 'Analyzing product and generating design specs')
    : phase === 'preview'
      ? t('planPreviewDesc')
    : phase === 'generating'
      ? (isZh ? '正在根据规划生成图片' : 'Generating images from the approved blueprint')
      : isZh
        ? '上传产品图并点击分析开始'
        : "Upload product images and click 'Analyze' to start."

  // Derived: is the left panel disabled?
  const leftPanelDisabled = phase === 'analyzing' || phase === 'generating'
  const leftParamsDisabled = leftPanelDisabled || phase === 'preview' || phase === 'complete'



  useEffect(() => {
    if (phase !== 'analyzing' || analyzingMessages.length === 0) return
    const timer = setInterval(() => {
      setAnalyzingMessageIndex((prev) => (prev + 1) % analyzingMessages.length)
    }, 2600)
    return () => clearInterval(timer)
  }, [phase, analyzingMessages.length])

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
        uiLanguage: backendLocale,
        targetLanguage: backendLocale,
        outputLanguage,
        trace_id,
      })

      // Nudge worker to start processing (fire-and-forget)
      processGenerationJob(analysisJobId).catch(() => {})

      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      if (!isAnalysisBlueprint(analysisJob.result_data)) {
        throw new Error('Analysis output format mismatch')
      }
      const rawBlueprint = analysisJob.result_data
      const blueprint: AnalysisBlueprint = isZh
        ? { ...rawBlueprint, images: localizeImagePlansForZh(rawBlueprint.images ?? []) }
        : rawBlueprint

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
  }, [productImages, requirements, imageCount, outputLanguage, backendLocale, isZh, t, tc])

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
          targetLanguage: backendLocale,
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
  }, [analysisBlueprint, editableImagePlans, editableDesignSpecs, uploadedUrls, model, aspectRatio, imageSize, turboEnabled, outputLanguage, backendLocale, t, tc])

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
          className="h-14 w-full rounded-2xl bg-[#191b22] text-base font-semibold text-white hover:bg-[#13151a] disabled:bg-[#9a9ca3] disabled:text-white"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {t('analyze')}
        </Button>
      )
    }

    if (phase === 'analyzing') {
      return (
        <Button
          size="lg"
          disabled
          className="h-14 w-full rounded-2xl bg-[#9a9ca3] text-base font-semibold text-white"
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          {t('steps.analyze')}
        </Button>
      )
    }

    if (phase === 'preview') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-3xl border border-[#d0d4dc] bg-white px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${turboEnabled ? 'bg-[#e7f8ee] text-[#22b968]' : 'bg-[#eceef2] text-[#7a7f8b]'}`}>
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-[#1a1d24]">{isZh ? 'Turbo 加速模式' : t('turboBoost')}</p>
                <p className="text-[13px] text-[#7d818d]">{isZh ? '更快、更稳定' : t('turboBoostDesc')}</p>
              </div>
            </div>
            <Switch
              checked={turboEnabled}
              onCheckedChange={setTurboEnabled}
              className="h-8 w-14 border-0 data-[state=checked]:bg-[#1a1d24] data-[state=unchecked]:bg-[#d8d9dd]"
            />
          </div>

          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={insufficientCredits}
            className="h-14 w-full rounded-3xl bg-[#171a22] text-[17px] font-semibold text-white hover:bg-[#11131a] disabled:bg-[#9ca1ad]"
          >
            <ArrowRight className="mr-2 h-5 w-5" />
            {isZh
              ? `确认生成 ${editableImagePlans.length} 张图片`
              : `Generate ${editableImagePlans.length} ${editableImagePlans.length > 1 ? 'images' : 'image'}`}
          </Button>

          <p className="text-center text-[14px] text-[#7b808c]">
            {isZh ? `消耗 ${totalCost} 积分` : `Cost ${totalCost} credits`}
          </p>

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
            variant="outline"
            size="lg"
            onClick={handleBackToInput}
            className="h-14 w-full rounded-3xl border-[#d9dde4] bg-[#f1f3f6] text-[17px] font-semibold text-[#1e2128] hover:bg-[#e8ebf0]"
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            {t('backToEdit')}
          </Button>
        </div>
      )
    }

    if (phase === 'generating') {
      return (
        <div className="space-y-3">
          <Button
            size="lg"
            disabled
            className="h-14 w-full rounded-3xl bg-[#8f9199] text-[17px] font-semibold text-white"
          >
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('steps.generate')}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={handleStop}
            className="h-14 w-full rounded-3xl border-[#d9dde4] bg-[#f1f3f6] text-[17px] font-semibold text-[#1e2128] hover:bg-[#e8ebf0]"
          >
            {tc('stop')}
          </Button>
        </div>
      )
    }

    // complete
    return (
      <div className="space-y-3">
        <Button
          size="lg"
          onClick={handleNewGeneration}
          className="h-14 w-full rounded-3xl bg-[#111318] text-[17px] font-semibold text-white hover:bg-[#0a0b10]"
        >
          {t('newGeneration')}
        </Button>
        {analysisBlueprint && (
          <Button
            variant="outline"
            size="lg"
            onClick={handleBackToPreview}
            className="h-14 w-full rounded-3xl border-[#d9dde4] bg-[#f1f3f6] text-[17px] font-semibold text-[#1e2128] hover:bg-[#e8ebf0]"
          >
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
        <div className="flex min-h-[520px] flex-col items-center justify-center px-4 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#ececef] text-[#7f8390]">
            <Sparkles className="h-8 w-8" />
          </div>
          <p className="max-w-[320px] text-base leading-7 text-[#7b808c]">{t('emptyState')}</p>
        </div>
      )
    }

    if (phase === 'analyzing') {
      return (
        <CoreProcessingStatus
          title={isZh ? '分析中...' : 'Analyzing...'}
          subtitle={isZh ? '正在分析产品并生成设计规范' : 'Analyzing product and generating design specs'}
          progress={progress}
          statusLine={analyzingMessages[analyzingMessageIndex] ?? ''}
          showHeader={false}
          statusPlacement="below"
        />
      )
    }

    if (phase === 'preview') {
      return (
        <DesignBlueprint
          designSpecs={editableDesignSpecs}
          onDesignSpecsChange={setEditableDesignSpecs}
          imagePlans={editableImagePlans}
          aspectRatio={aspectRatio}
          onImagePlanChange={(i, plan) => {
            setEditableImagePlans((prev) => prev.map((p, idx) => (idx === i ? plan : p)))
          }}
        />
      )
    }

    if (phase === 'generating') {
      const activeStepLabel =
        [...steps].reverse().find((step) => step.status === 'active')?.label
      const generatingStatusLine = isZh
        ? '正在模拟物理级光影分布...'
        : (activeStepLabel ?? 'Simulating physically accurate light distribution...')

      return (
        <div className="space-y-6">
          <CoreProcessingStatus
            title={isZh ? '生成中...' : 'Generating...'}
            subtitle={isZh ? '正在根据规划生成图片' : 'Generating images from the approved blueprint'}
            progress={progress}
            statusLine={generatingStatusLine}
            showHeader={false}
            statusPlacement="below"
          />

          {imageSlots.length > 0 && (
            <div className="flex flex-wrap content-start items-start gap-3">
              {imageSlots.map((slot, i) => (
                <ImageSlotCard
                  key={slot.jobId || `slot-${i}`}
                  slot={slot}
                  index={i}
                  aspectRatio={aspectRatio}
                  isZh={isZh}
                />
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
          <ResultGallery images={results} aspectRatio={aspectRatio} />
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
    <CorePageShell maxWidthClass="max-w-[1360px]" contentClassName="space-y-7">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d0d4dc] bg-[#f1f3f6] px-4 py-1.5 text-xs font-medium text-[#202227]">
            <Sparkles className="h-4 w-4" />
            <span>{isZh ? 'AI 组图生成' : 'AI Product Gallery'}</span>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#17181d] sm:text-4xl">{t('title')}</h1>
          <p className="mx-auto mt-3 max-w-4xl text-sm leading-relaxed text-[#70727a] sm:text-base">{t('description')}</p>
        </div>

        <StepIndicator currentPhase={phase} locale={locale} />

        <div className="grid gap-6 xl:grid-cols-[540px_minmax(0,1fr)]">
          <div className="space-y-5">
            <fieldset disabled={leftPanelDisabled}>
              <div className={`${leftCardClass} ${leftPanelDisabled ? 'opacity-70' : ''}`}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[15px] font-semibold text-[#1a1d24]">{tc('productImage')}</h3>
                    <p className="text-[13px] text-[#7d818d]">{isZh ? '上传清晰的产品图片' : tc('uploadSublabel')}</p>
                  </div>
                  <span className="text-[13px] text-[#6f7380]">{productImages.length}/6</span>
                </div>
                <MultiImageUploader
                  images={productImages}
                  onAdd={handleAddImages}
                  onRemove={handleRemoveImage}
                  maxImages={6}
                  compactAfterUpload
                  thumbnailGridCols={3}
                  showIndexBadge
                  label={isZh ? '多图上传建议仅上传必要的视角或sku图，图片不是越多越好' : tc('uploadLabel')}
                  hideDefaultFooter={isZh}
                  footerText={`${productImages.length}/6 images · max 10 MB each`}
                  dropzoneClassName="min-h-[186px] rounded-[20px] border-[#d0d4dc] bg-[#f1f3f6] px-6 py-8 hover:border-[#bcc2ce] hover:bg-[#eef1f4]"
                  labelClassName={isZh ? 'max-w-[260px] text-sm leading-6 text-[#2b2f38]' : undefined}
                  footerClassName="text-xs text-[#8b8f99]"
                />
              </div>
            </fieldset>

            <div className={leftCardClass}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[#1a1d24]">{isZh ? '组图要求' : 'Requirements'}</h3>
                  <p className="text-[13px] text-[#7d818d]">{isZh ? '描述您的产品信息和期望的图片风格' : 'Describe your product and desired image style'}</p>
                </div>
              </div>

              <Textarea
                id="sg-req"
                placeholder={isZh
                  ? '建议输入：产品名称、卖点、目标人群、详情图风格等\n\n例如：这是一款日式抹茶沐浴露，主打天然成分和舒缓放松功效，目标人群为25-40岁女性白领，希望详情图风格简约高级...'
                  : tc('requirementsPlaceholder')}
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                rows={5}
                disabled={leftPanelDisabled}
                className="min-h-[128px] resize-none rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] leading-6"
              />

              <div className="mt-4 space-y-1.5">
                <Label className="text-[13px] font-medium text-[#5a5e6b]">{t('outputLanguage')}</Label>
                <Select
                  value={outputLanguage}
                  onValueChange={(v) => setOutputLanguage(v as OutputLanguage)}
                  disabled={leftParamsDisabled}
                >
                  <SelectTrigger className={panelInputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTPUT_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value}>{lang.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-[#5a5e6b]">{tc('model')}</Label>
                  <Select
                    value={model}
                    onValueChange={(v) => setModel(v as GenerationModel)}
                    disabled={leftParamsDisabled}
                  >
                    <SelectTrigger className={panelInputClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flux-kontext-pro">{isZh ? '标准' : 'Standard'}</SelectItem>
                      <SelectItem value="gemini-flash-image">{isZh ? '极速' : 'Fast'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-[#5a5e6b]">{tc('aspectRatio')}</Label>
                  <Select
                    value={aspectRatio}
                    onValueChange={(v) => setAspectRatio(v as AspectRatio)}
                    disabled={leftParamsDisabled}
                  >
                    <SelectTrigger className={panelInputClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASPECT_RATIOS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-[#5a5e6b]">{tc('imageSize')}</Label>
                  <Select
                    value={imageSize}
                    onValueChange={(v) => setImageSize(v as ImageSize)}
                    disabled={leftParamsDisabled}
                  >
                    <SelectTrigger className={panelInputClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_OPTIONS.map((opt) => (
                        <SelectItem
                          key={opt.value}
                          value={opt.value}
                          disabled={false}
                        >
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-[#5a5e6b]">{tc('imageCount')}</Label>
                  <Select
                    value={String(imageCount)}
                    onValueChange={(v) => setImageCount(Number(v))}
                    disabled={leftParamsDisabled}
                  >
                    <SelectTrigger className={panelInputClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IMAGE_COUNTS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {locale === 'zh' ? ' 张' : (n === 1 ? ' Image' : ' Images')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {renderLeftButton()}
          </div>

          <div className="flex min-h-[760px] flex-col rounded-[30px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#1a1d24]">{rightPanelTitle}</h3>
                <p className="text-[13px] text-[#7d818d]">{rightPanelSubtitle}</p>
              </div>
            </div>
            <div className="flex-1">
              {renderRightPanel()}
            </div>
          </div>
        </div>
    </CorePageShell>
  )
}
