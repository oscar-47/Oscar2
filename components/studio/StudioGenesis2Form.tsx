'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, ImageIcon, Layers, Loader2, Sparkles, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { FluidPendingCard } from '@/components/generation/FluidPendingCard'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import type { ProgressStep } from '@/components/generation/GenerationProgress'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { DesignBlueprint } from '@/components/studio/DesignBlueprint'
import { ModelTextHint } from '@/components/studio/ModelTextHint'
import { SectionIcon } from '@/components/shared/SectionIcon'
import {
  analyzeProductV2,
  generateImage,
  generatePromptsV2Stream,
  processGenerationJob,
} from '@/lib/api/edge-functions'
import { uploadFiles } from '@/lib/api/upload'
import { createClient } from '@/lib/supabase/client'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { useUserEmail } from '@/lib/hooks/useUserEmail'
import { clampText, formatTextCounter, TEXT_LIMITS } from '@/lib/input-guard'
import { friendlyError } from '@/lib/utils'
import {
  clearResultAssets as clearStoredResultAssets,
  createResultAsset,
  extractResultAssetMetadata,
  mergeResultAssets,
  readResultAssetSession,
  writeResultAssetSession,
} from '@/lib/utils/result-assets'
import type {
  AnalysisBlueprint,
  AspectRatio,
  BlueprintImagePlan,
  GeneratedPrompt,
  GenerationJob,
  GenerationModel,
  GenesisPhase,
  GenesisCommercialIntent,
  GenesisSceneRecipe,
  ImageSize,
  OutputLanguage,
  ProductVisualIdentity,
} from '@/types'
import {
  DEFAULT_MODEL,
  getAvailableModels,
  getGenerationCreditCost,
  normalizeGenerationModel,
  sanitizeImageSizeForModel,
} from '@/types'

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

const IMAGE_COUNTS = Array.from({ length: 15 }, (_, index) => index + 1)
const ANALYSIS_WAIT_TIMEOUT_MS = 90_000
const BATCH_CONCURRENCY = 4

interface WaitForJobOptions {
  timeoutMs?: number
  timeoutErrorMessage?: string
}

interface ImageSlot {
  jobId: string
  status: 'pending' | 'done' | 'failed'
  result?: ResultImage
  error?: string
}

function uid() {
  return crypto.randomUUID()
}

function patchStep(steps: ProgressStep[], id: string, patch: Partial<ProgressStep>): ProgressStep[] {
  return steps.map((step) => (step.id === id ? { ...step, ...patch } : step))
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return []
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, tasks.length))
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex++
      try {
        results[currentIndex] = { status: 'fulfilled', value: await tasks[currentIndex]() }
      } catch (reason) {
        results[currentIndex] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveConcurrency }, () => worker()))
  return results
}

function waitForJob(jobId: string, signal: AbortSignal, options?: WaitForJobOptions): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let nudgeTimer: ReturnType<typeof setInterval> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer)
      if (nudgeTimer) clearInterval(nudgeTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      supabase.removeChannel(channel)
    }

    function done(job: GenerationJob) {
      if (settled) return
      settled = true
      cleanup()
      resolve(job)
    }

    function fail(error: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
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
    }

    signal.addEventListener(
      'abort',
      () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
      { once: true },
    )

    const channel = supabase
      .channel(`wait:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const partial = payload.new as Partial<GenerationJob>
          if (partial.status === 'success' || partial.status === 'failed') {
            void checkOnce()
          }
        },
      )
      .subscribe()

    void checkOnce()
    void processGenerationJob(jobId)
    pollTimer = setInterval(() => void checkOnce(), 2000)
    nudgeTimer = setInterval(() => void processGenerationJob(jobId), 8000)

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        fail(new Error(options.timeoutErrorMessage ?? 'JOB_WAIT_TIMEOUT'))
      }, options.timeoutMs)
    }
  })
}

function toCssAspectRatio(aspectRatio: AspectRatio): string {
  const [width, height] = aspectRatio.split(':').map((value) => Number(value))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '4 / 3'
  return `${width} / ${height}`
}

function computeCost(model: GenerationModel, imageSize: ImageSize, imageCount: number): number {
  return getGenerationCreditCost(model, imageSize) * imageCount
}

function extractResultFromJob(job: GenerationJob, index: number, batchId?: string, batchTimestamp?: number): ResultImage | null {
  const resultData = job.result_data as Record<string, unknown> | null
  const url = job.result_url
    ?? (typeof resultData?.b64_json === 'string' ? `data:image/png;base64,${resultData.b64_json}` : null)

  return url
      ? createResultAsset({
        url,
        label: `Image ${index + 1}`,
        batchId,
        batchTimestamp,
        ...extractResultAssetMetadata(job.result_data),
        originModule: 'studio-genesis',
      })
    : null
}

function normalizePrompt(item: unknown): GeneratedPrompt | null {
  if (typeof item === 'string') {
    const prompt = item.trim()
    return prompt
      ? { prompt, title: '', negative_prompt: '', marketing_hook: '', priority: 0 }
      : null
  }

  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (!prompt) return null

  return {
    prompt,
    title: typeof record.title === 'string' ? record.title.trim() : '',
    negative_prompt: typeof record.negative_prompt === 'string' ? record.negative_prompt.trim() : '',
    marketing_hook: typeof record.marketing_hook === 'string' ? record.marketing_hook.trim() : '',
    priority: Number.isFinite(Number(record.priority)) ? Math.max(0, Math.min(10, Number(record.priority))) : 0,
  }
}

function parsePromptArray(rawText: string): GeneratedPrompt[] {
  const text = rawText.trim()
  if (!text) return []

  const candidates = [text]
  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeFenceMatch?.[1]) candidates.push(codeFenceMatch[1].trim())

  const jsonArrayMatch = text.match(/\[[\s\S]*\]/)
  if (jsonArrayMatch?.[0]) candidates.push(jsonArrayMatch[0].trim())

  const truncatedMatch = text.match(/\[[\s\S]*\}/)
  if (truncatedMatch?.[0]) candidates.push(`${truncatedMatch[0]}]`)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (!Array.isArray(parsed)) continue
      const prompts = parsed.map(normalizePrompt).filter((item): item is GeneratedPrompt => item !== null)
      if (prompts.length > 0) return prompts
    } catch {
      // Ignore invalid candidates and keep trying JSON-shaped inputs.
    }
  }

  return []
}

function asTrimmedString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : fallback
}

function fallbackPlanTitle(index: number) {
  return `Image Plan ${index + 1}`
}

function fallbackPlanDescription() {
  return 'Build a commercially staged hero concept with layered depth, directional lighting, and protected whitespace while preserving the exact product.'
}

function fallbackPlanContent(index: number) {
  return [
    `## Image [${index + 1}]`,
    '',
    '**Design Goal**: Build a commercially staged hero image that preserves the exact product identity and avoids a flat packshot look.',
    '',
    '**In-Graphic Elements**:',
    '- Product: keep the uploaded product as the clear hero subject with all visible structure and material cues intact.',
    '- Support Elements: use restrained surface accents, controlled reflections, or shadow details that reinforce the product story without overpowering it.',
    '- Background: avoid an empty backdrop; create at least foreground-to-background depth with breathable whitespace.',
    '',
    '**Composition Plan**:',
    '- Product Proportion: product occupies roughly 58%-68% of the frame',
    '- Layout Method: use an asymmetrical commercial layout or restrained diagonal flow rather than a flat centered display',
    '- Subject Angle: introduce a subtle tilt or camera-angle shift while preserving silhouette and proportions',
    '- Text Area: reserve a side safe zone and never let text cover the product',
    '',
    '**Atmosphere Creation**:',
    '- Mood Keywords: premium commercial, tactile material, layered depth',
    '- Light and Shadow Effects: use a directional key light with contour support and realistic shadow falloff',
    '- Lens / Aperture Reference: 70mm-100mm commercial lens, f/5.6-f/8 for controlled depth and clean structure',
  ].join('\n')
}

function normalizeBlueprint(resultData: unknown, expectedCount: number, outputLanguage: OutputLanguage): AnalysisBlueprint | null {
  let parsed: Record<string, unknown> | null = null

  if (resultData && typeof resultData === 'object' && !Array.isArray(resultData)) {
    parsed = resultData as Record<string, unknown>
  } else if (typeof resultData === 'string') {
    try {
      const json = JSON.parse(resultData)
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        parsed = json as Record<string, unknown>
      }
    } catch {
      parsed = null
    }
  }

  if (!parsed) return null

  const parseSceneRecipe = (value: unknown): GenesisSceneRecipe | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    return {
      shot_role: asTrimmedString(record.shot_role, ''),
      hero_focus: asTrimmedString(record.hero_focus, ''),
      product_ratio: asTrimmedString(record.product_ratio, ''),
      layout_method: asTrimmedString(record.layout_method, ''),
      subject_angle: asTrimmedString(record.subject_angle, ''),
      support_elements: asTrimmedString(record.support_elements, ''),
      background_surface: asTrimmedString(record.background_surface, ''),
      background_elements: asTrimmedString(record.background_elements, ''),
      decorative_elements: asTrimmedString(record.decorative_elements, ''),
      lighting_setup: asTrimmedString(record.lighting_setup, ''),
      lens_hint: asTrimmedString(record.lens_hint, ''),
      text_zone: asTrimmedString(record.text_zone, ''),
      mood_keywords: asTrimmedString(record.mood_keywords, ''),
    }
  }

  const parseCommercialIntent = (value: unknown): GenesisCommercialIntent | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    return {
      archetype: asTrimmedString(record.archetype, 'generic') as GenesisCommercialIntent['archetype'],
      brief_summary: asTrimmedString(record.brief_summary, ''),
      visual_tone: asTrimmedString(record.visual_tone, ''),
      mood_keywords: Array.isArray(record.mood_keywords)
        ? record.mood_keywords.map((item) => asTrimmedString(item, '')).filter(Boolean)
        : [],
      composition_bias: asTrimmedString(record.composition_bias, ''),
      set_treatment: asTrimmedString(record.set_treatment, ''),
      lighting_bias: asTrimmedString(record.lighting_bias, ''),
      copy_strategy: asTrimmedString(record.copy_strategy, ''),
    }
  }

  const rawImages = Array.isArray(parsed.images)
    ? parsed.images
    : Array.isArray(parsed.image_plans)
      ? parsed.image_plans
      : Array.isArray(parsed.plans)
        ? parsed.plans
        : []

  const images: BlueprintImagePlan[] = rawImages
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `genesis2-plan-${index + 1}`,
      title: asTrimmedString(item.title, fallbackPlanTitle(index)),
      description: asTrimmedString(item.description, fallbackPlanDescription()),
      design_content: asTrimmedString(
        item.design_content ?? item.designContent ?? item.content,
        fallbackPlanContent(index),
      ),
      type: typeof item.type === 'string' ? item.type as BlueprintImagePlan['type'] : undefined,
      scene_recipe: parseSceneRecipe(item.scene_recipe ?? item.sceneRecipe),
    }))

  const normalizedCount = Math.max(1, Math.min(15, Number(expectedCount || images.length || 1)))
  while (images.length < normalizedCount) {
    const index = images.length
    images.push({
      id: `genesis2-plan-${index + 1}`,
      title: fallbackPlanTitle(index),
      description: fallbackPlanDescription(),
      design_content: fallbackPlanContent(index),
    })
  }

  const meta = parsed._ai_meta && typeof parsed._ai_meta === 'object'
    ? parsed._ai_meta as Record<string, unknown>
    : {}
  const productVisualIdentity = parsed.product_visual_identity && typeof parsed.product_visual_identity === 'object'
    ? parsed.product_visual_identity as ProductVisualIdentity
    : parsed.productVisualIdentity && typeof parsed.productVisualIdentity === 'object'
      ? parsed.productVisualIdentity as ProductVisualIdentity
      : undefined

  const blueprint: AnalysisBlueprint = {
    images: images.slice(0, normalizedCount),
    design_specs: asTrimmedString(
      parsed.design_specs ?? parsed.designSpecs,
      '# Overall Design Specifications',
    ),
    _ai_meta: {
      model: asTrimmedString(meta.model, 'unknown'),
      usage: meta.usage && typeof meta.usage === 'object' ? meta.usage as Record<string, unknown> : {},
      provider: asTrimmedString(meta.provider, 'fallback'),
      image_count: Number.isFinite(Number(meta.image_count)) ? Math.round(Number(meta.image_count)) : normalizedCount,
      target_language: asTrimmedString(meta.target_language, outputLanguage),
    },
    product_summary: asTrimmedString(parsed.product_summary ?? parsed.productSummary, ''),
    product_visual_identity: productVisualIdentity,
    commercial_intent: parseCommercialIntent(parsed.commercial_intent ?? parsed.commercialIntent),
  }

  return blueprint
}

function buildGenerationBlueprint(
  blueprint: AnalysisBlueprint,
  outputLanguage: OutputLanguage,
  imageCount: number,
): AnalysisBlueprint {
  const normalizedCount = Math.max(1, Math.min(15, Number(imageCount || blueprint.images.length || 1)))
  const images = blueprint.images.slice(0, normalizedCount)

  while (images.length < normalizedCount) {
    const index = images.length
    images.push({
      id: `genesis2-plan-${index + 1}`,
      title: fallbackPlanTitle(index),
      description: fallbackPlanDescription(),
      design_content: fallbackPlanContent(index),
    })
  }

  const { copy_analysis: _ignoredCopyAnalysis, ...baseBlueprint } = blueprint
  const nextBlueprint: AnalysisBlueprint = {
    ...baseBlueprint,
    images,
    _ai_meta: {
      ...blueprint._ai_meta,
      image_count: normalizedCount,
      target_language: outputLanguage,
    },
  }

  return nextBlueprint
}

function fallbackPromptFromPlan(plan: BlueprintImagePlan): string {
  if (plan.design_content.trim()) return plan.design_content.trim()
  return `${plan.title}. ${plan.description}. Keep the exact same product identity with commercial photography quality and clean detail.`
}

function mergePromptsWithFallback(parsedPrompts: GeneratedPrompt[], plans: BlueprintImagePlan[]): GeneratedPrompt[] {
  return plans.map((plan, index) => {
    const parsed = parsedPrompts[index]
    return {
      prompt: asTrimmedString(parsed?.prompt, fallbackPromptFromPlan(plan)),
      title: asTrimmedString(parsed?.title, plan.title),
      negative_prompt: asTrimmedString(parsed?.negative_prompt, ''),
      marketing_hook: asTrimmedString(parsed?.marketing_hook, ''),
      priority: Number.isFinite(Number(parsed?.priority)) ? Number(parsed?.priority) : 0,
    }
  })
}


function ImageSlotCard({ slot, index, aspectRatio, isZh }: { slot: ImageSlot; index: number; aspectRatio: AspectRatio; isZh: boolean }) {
  const boxAspectRatio = toCssAspectRatio(aspectRatio)

  if (slot.status === 'done' && slot.result) {
    return (
      <div className="group relative w-[220px] max-w-full overflow-hidden rounded-xl border border-border bg-muted" style={{ aspectRatio: boxAspectRatio }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slot.result.url}
          alt={slot.result.label ?? `Image ${index + 1}`}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  if (slot.status === 'failed') {
    return (
      <div
        className="flex w-[220px] max-w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 p-4 text-center"
        style={{ aspectRatio: boxAspectRatio }}
      >
        <div className="space-y-2">
          <AlertTriangle className="mx-auto h-5 w-5 text-red-500" />
          <p className="text-xs text-red-600">{slot.error || (isZh ? '生成失败' : 'Failed')}</p>
        </div>
      </div>
    )
  }

  return <FluidPendingCard aspectRatio={boxAspectRatio} className="w-[220px] max-w-full" />
}

function StepIndicator({ currentPhase, t }: { currentPhase: GenesisPhase; t: (key: string) => string }) {
  const steps: Array<{ phase: GenesisPhase; label: string; num: number }> = [
    { phase: 'input', label: t('stepInput'), num: 1 },
    { phase: 'analyzing', label: t('stepAnalyzing'), num: 2 },
    { phase: 'preview', label: t('stepPreview'), num: 3 },
    { phase: 'generating', label: t('stepGenerating'), num: 4 },
    { phase: 'complete', label: t('stepComplete'), num: 5 },
  ]
  const order: GenesisPhase[] = ['input', 'analyzing', 'preview', 'generating', 'complete']
  const currentIndex = order.indexOf(currentPhase)

  return (
    <div className="flex w-full items-center justify-center overflow-x-auto pb-1">
      {steps.map((step, index) => {
        const isDone = index < currentIndex
        const isCurrent = index === currentIndex
        return (
          <div key={step.phase} className="flex shrink-0 items-center">
            <div className="flex items-center gap-2">
              <span className={isCurrent
                ? 'flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-white'
                : isDone
                  ? 'w-4 text-center text-sm font-medium text-foreground'
                  : 'w-4 text-center text-sm text-muted-foreground'}>
                {isCurrent && (currentPhase === 'analyzing' || currentPhase === 'generating')
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : step.num}
              </span>
              <span className={isDone || isCurrent ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'}>
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className="mx-3 h-px w-8 bg-border sm:mx-5 sm:w-12" />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function StudioGenesis2Form() {
  const t = useTranslations('studio.genesis2')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const router = useRouter()
  const isZh = locale.startsWith('zh')
  const defaultOutputLanguage: OutputLanguage = isZh ? 'zh' : 'en'
  const userEmail = useUserEmail()

  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [requirements, setRequirements] = useState('')
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [imageCount, setImageCount] = useState(1)
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>(defaultOutputLanguage)
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])
  const [phase, setPhase] = useState<GenesisPhase>('input')
  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const [blueprint, setBlueprint] = useState<AnalysisBlueprint | null>(null)
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([])
  const [imageSlots, setImageSlots] = useState<ImageSlot[]>([])
  const [failedSlotIndices, setFailedSlotIndices] = useState<number[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analyzingMessageIndex, setAnalyzingMessageIndex] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const {
    assets: results,
    activeBatchId,
    activeBatchTimestamp,
    appendAssets: appendResults,
    clearAssets: clearResults,
    restored,
  } = useResultAssetSession('studio-genesis-v2')

  const { total } = useCredits()
  const { promptProfile } = usePromptProfile(model)
  const totalCost = computeCost(model, imageSize, imageCount)
  const insufficientCredits = total !== null && total < totalCost
  const analysisUiLanguage = isZh ? 'zh' : 'en'
  const leftCardClass = 'rounded-2xl border border-border bg-background p-5 sm:p-6'
  const inputClass = 'h-11 rounded-2xl border-border bg-muted text-[14px]'
  const ASPECT_RATIOS = isZh ? ASPECT_RATIOS_ZH : ASPECT_RATIOS_EN
  const OUTPUT_LANGUAGES = isZh ? OUTPUT_LANGUAGES_ZH : OUTPUT_LANGUAGES_EN
  const analyzingMessages = [
    t('analyzingStep1'),
    t('analyzingStep2'),
    t('analyzingStep3'),
    t('analyzingStep4'),
  ]

  useEffect(() => {
    if (phase !== 'analyzing') return
    const timer = setInterval(() => {
      setAnalyzingMessageIndex((current) => (current + 1) % analyzingMessages.length)
    }, 2400)
    return () => clearInterval(timer)
  }, [analyzingMessages.length, phase])

  useEffect(() => {
    setImageSize((current) => sanitizeImageSizeForModel(model, current))
  }, [model])

  useEffect(() => {
    if (!restored) return

    const currentSession = readResultAssetSession('studio-genesis-v2')
    const legacySession = readResultAssetSession('studio-genesis-2')
    if (legacySession.assets.length === 0) return

    const mergedAssets = mergeResultAssets(currentSession.assets, legacySession.assets)
    writeResultAssetSession('studio-genesis-v2', {
      assets: mergedAssets,
      activeBatchId: currentSession.activeBatchId ?? legacySession.activeBatchId,
      activeBatchTimestamp: currentSession.activeBatchTimestamp ?? legacySession.activeBatchTimestamp,
    })
    clearStoredResultAssets('studio-genesis-2')
  }, [restored])

  const handleAddImages = useCallback((files: File[]) => {
    const nextImages = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setProductImages((current) => [...current, ...nextImages])
    setErrorMessage(null)
  }, [])

  const handleRemoveImage = useCallback((index: number) => {
    setProductImages((current) => {
      const removed = current[index]
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((_, currentIndex) => currentIndex !== index)
    })
  }, [])

  const resetWorkflow = useCallback(() => {
    setPhase('input')
    setSteps([])
    setProgress(0)
    setBlueprint(null)
    if (generatedPrompts.length > 0) setGeneratedPrompts([])
    setUploadedUrls([])
    setImageSlots([])
    setFailedSlotIndices([])
    setErrorMessage(null)
  }, [generatedPrompts.length])

  const handleNewGeneration = useCallback(() => {
    setProductImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
    setRequirements('')
    setModel(DEFAULT_MODEL)
    setAspectRatio('3:4')
    setImageSize('1K')
    setImageCount(1)
    setOutputLanguage(defaultOutputLanguage)
    resetWorkflow()
  }, [defaultOutputLanguage, resetWorkflow])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setSteps([])
    setProgress(0)
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (productImages.length === 0) return
    const traceId = uid()
    const abort = new AbortController()
    abortRef.current = abort

    setPhase('analyzing')
    setSteps([
      { id: 'upload', label: t('stepUpload'), status: 'pending' },
      { id: 'analyze', label: t('stepAnalyze'), status: 'pending' },
    ])
    setProgress(0)
    setErrorMessage(null)

    const setStep = (id: string, patch: Partial<ProgressStep>) => {
      setSteps((current) => patchStep(current, id, patch))
    }

    try {
      setStep('upload', { status: 'active' })
      const uploadResults = await uploadFiles(productImages.map((item) => item.file))
      const urls = uploadResults.map((item) => item.publicUrl)
      setUploadedUrls(urls)
      setStep('upload', { status: 'done' })
      setProgress(35)

      setStep('analyze', { status: 'active' })
      const { job_id: jobId } = await analyzeProductV2({
        productImage: urls[0],
        productImages: urls,
        promptProfile,
        requirements: requirements.trim() || undefined,
        uiLanguage: analysisUiLanguage,
        targetLanguage: outputLanguage,
        outputLanguage,
        imageCount,
        studioType: 'genesis',
        trace_id: traceId,
      })

      const job = await waitForJob(jobId, abort.signal, {
        timeoutMs: ANALYSIS_WAIT_TIMEOUT_MS,
        timeoutErrorMessage: 'GENESIS2_ANALYSIS_TIMEOUT',
      })
      const nextBlueprint = normalizeBlueprint(job.result_data, imageCount, outputLanguage)
      if (!nextBlueprint) throw new Error('Invalid analysis blueprint')

      setBlueprint(nextBlueprint)
      setGeneratedPrompts([])
      setPhase('preview')
      setStep('analyze', { status: 'done' })
      setProgress(100)
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      const message = error instanceof Error ? error.message : tc('error')
      setErrorMessage(message === 'GENESIS2_ANALYSIS_TIMEOUT' ? t('analysisTimeout') : friendlyError(message, isZh))
      setPhase('input')
      setSteps((current) => current.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
    }
  }, [analysisUiLanguage, imageCount, isZh, outputLanguage, productImages, promptProfile, requirements, t, tc])

  const handleGenerate = useCallback(async () => {
    if (!blueprint || uploadedUrls.length === 0) return

    const traceId = uid()
    const clientJobId = uid()
    const batchId = uid()
    const batchTimestamp = Date.now()
    const abort = new AbortController()
    abortRef.current = abort

    setPhase('generating')
    setSteps([
      { id: 'prompts', label: t('stepPrompts'), status: 'pending' },
      { id: 'generate', label: t('stepGenerate'), status: 'pending' },
      { id: 'done', label: t('stepDone'), status: 'pending' },
    ])
    setProgress(0)
    setErrorMessage(null)
    setFailedSlotIndices([])

    const setStep = (id: string, patch: Partial<ProgressStep>) => {
      setSteps((current) => patchStep(current, id, patch))
    }

    try {
      const generationBlueprint = buildGenerationBlueprint(blueprint, outputLanguage, imageCount)

      setStep('prompts', { status: 'active' })
      setProgress(12)
      const promptStream = await generatePromptsV2Stream({
        module: 'genesis',
        analysisJson: generationBlueprint,
        design_specs: generationBlueprint.design_specs,
        promptProfile,
        imageCount: generationBlueprint.images.length,
        targetLanguage: outputLanguage,
        outputLanguage,
        stream: true,
        trace_id: traceId,
      }, abort.signal)

      const reader = promptStream.getReader()
      const decoder = new TextDecoder()
      let promptText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload || payload === '[DONE]' || payload.startsWith('[ERROR]')) continue
          try {
            const chunk = JSON.parse(payload) as { fullText?: string }
            if (typeof chunk.fullText === 'string') promptText = chunk.fullText
          } catch {
            promptText += payload
          }
        }
      }

      const parsedPrompts = parsePromptArray(promptText)
      if (parsedPrompts.length === 0) {
        throw new Error('GENESIS2_PROMPTS_MISSING')
      }
      const prompts = mergePromptsWithFallback(parsedPrompts, generationBlueprint.images)
      setGeneratedPrompts(prompts)

      setStep('prompts', { status: 'done' })
      setStep('generate', { status: 'active' })
      setProgress(28)
      setImageSlots(prompts.map(() => ({ jobId: '', status: 'pending' as const })))

      const submissions = await runWithConcurrency(
        prompts.map((item, index) => () => generateImage({
          productImage: uploadedUrls[0],
          productImages: uploadedUrls,
          prompt: item.prompt,
          negativePrompt: item.negative_prompt || undefined,
          promptProfile,
          model,
          aspectRatio,
          imageSize,
          imageCount: 1,
          turboEnabled: false,
          trace_id: traceId,
          client_job_id: `${clientJobId}-${index}`,
          fe_attempt: 1,
          metadata: {
            is_batch: true,
            batch_index: index,
            image_size: imageSize,
            product_images: uploadedUrls,
            product_visual_identity: generationBlueprint.product_visual_identity ?? null,
            hero_plan_title: item.title || generationBlueprint.images[index]?.title || '',
            hero_plan_description: generationBlueprint.images[index]?.description ?? '',
          },
        }).then((response) => response.job_id)),
        BATCH_CONCURRENCY,
      )

      const jobIds = submissions.map((result) => (result.status === 'fulfilled' ? result.value : null))
      setImageSlots((current) => current.map((slot, index) => {
        const jobId = jobIds[index]
        if (jobId) return { ...slot, jobId }
        return { ...slot, status: 'failed', error: isZh ? '提交失败' : 'Submission failed' }
      }))

      const settledJobs = await Promise.allSettled(
        jobIds.map((jobId, index) => {
          if (!jobId) return Promise.reject(new Error('Submission failed'))
          return waitForJob(jobId, abort.signal).then((job) => {
            const result = extractResultFromJob(job, index, batchId, batchTimestamp)
            setImageSlots((current) => current.map((slot, currentIndex) => (
              currentIndex === index ? { ...slot, status: 'done', result: result ?? undefined } : slot
            )))
            return { index, result }
          }).catch((error) => {
            setImageSlots((current) => current.map((slot, currentIndex) => (
              currentIndex === index
                ? { ...slot, status: 'failed', error: error instanceof Error ? error.message : 'Failed' }
                : slot
            )))
            throw error
          })
        }),
      )

      const successResults: ResultImage[] = []
      const failedIndices: number[] = []
      settledJobs.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.result) {
          successResults.push(result.value.result)
        } else {
          failedIndices.push(index)
        }
      })

      appendResults(successResults, {
        activeBatchId: batchId,
        activeBatchTimestamp: batchTimestamp,
      })
      setFailedSlotIndices(failedIndices)
      setStep('generate', { status: 'done' })
      setStep('done', { status: 'done' })
      setProgress(100)
      setPhase('complete')
      refreshCredits()

      if (successResults.length === 0) {
        setErrorMessage(t('allImagesFailed'))
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      const message = error instanceof Error ? error.message : tc('error')
      setErrorMessage(message === 'GENESIS2_PROMPTS_MISSING'
        ? t('promptsMissing')
        : friendlyError(message, isZh))
      setSteps((current) => current.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setPhase('preview')
    }
  }, [
    appendResults,
    aspectRatio,
    blueprint,
    imageCount,
    imageSize,
    isZh,
    model,
    outputLanguage,
    promptProfile,
    t,
    tc,
    uploadedUrls,
  ])

  const persistedGallery = results.length > 0 ? (
    <ResultGallery
      images={results}
      activeBatchId={activeBatchId}
      aspectRatio={aspectRatio}
      onClear={clearResults}
      editorSessionKey="studio-genesis-v2"
      originModule="studio-genesis"
    />
  ) : null

  const rightPanelTitle = phase === 'analyzing'
    ? t('analyzingTitle')
    : phase === 'preview'
      ? t('previewTitle')
      : phase === 'generating'
        ? t('generatingTitle')
        : phase === 'complete'
          ? t('resultsTitle')
          : t('livePreviewTitle')
  const rightPanelSubtitle = phase === 'analyzing'
    ? t('analyzingSubtitle')
    : phase === 'preview'
      ? t('previewSubtitle')
      : phase === 'generating'
        ? t('generatingSubtitle')
        : phase === 'complete'
          ? t('resultsSubtitle')
          : t('livePreviewSubtitle')

  const renderLeftButton = () => {
    if (phase === 'input') {
      return (
        <Button
          size="lg"
          onClick={handleAnalyze}
          disabled={productImages.length === 0}
          className="h-14 w-full rounded-2xl bg-foreground text-base font-semibold text-white hover:bg-foreground/90 disabled:bg-muted-foreground"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {t('analyzeButton')}
        </Button>
      )
    }

    if (phase === 'analyzing') {
      return (
        <Button size="lg" disabled className="h-14 w-full rounded-2xl bg-muted-foreground text-base font-semibold text-white">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('analyzingButton')}
        </Button>
      )
    }

    if (phase === 'preview') {
      return (
        <div className="space-y-4">
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={insufficientCredits}
            className="h-14 w-full rounded-3xl bg-foreground text-[17px] font-semibold text-white hover:bg-foreground/90 disabled:bg-muted-foreground"
          >
            <ArrowRight className="mr-2 h-5 w-5" />
            {t('generateButton', { count: imageCount })}
          </Button>

          <p className="text-center text-[14px] text-muted-foreground">
            {isZh ? `消耗 ${totalCost} 积分` : `Cost ${totalCost} credits`}
          </p>

          {insufficientCredits && (
            <div className="text-center">
              <p className="mb-2 text-sm text-destructive">{tc('insufficientCredits')}</p>
              <Button variant="outline" size="sm" onClick={() => router.push(`/${locale}/pricing`)}>
                {tc('buyCredits')}
              </Button>
            </div>
          )}

          <Button
            variant="outline"
            size="lg"
            onClick={resetWorkflow}
            className="h-14 w-full rounded-3xl border-border bg-muted text-[17px] font-semibold text-foreground hover:bg-secondary"
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
          <Button size="lg" disabled className="h-14 w-full rounded-3xl bg-muted-foreground text-[17px] font-semibold text-white">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('generatingButton')}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={handleStop}
            className="h-14 w-full rounded-3xl border-border bg-muted text-[17px] font-semibold text-foreground hover:bg-secondary"
          >
            {tc('stop')}
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <Button
          size="lg"
          onClick={handleNewGeneration}
          className="h-14 w-full rounded-3xl bg-foreground text-[17px] font-semibold text-white hover:bg-foreground/90"
        >
          {t('newGeneration')}
        </Button>
      </div>
    )
  }

  return (
    <CorePageShell maxWidthClass="max-w-[1360px]" contentClassName="space-y-7">
      <div className="mb-7 flex items-start gap-3">
        <SectionIcon icon={Layers} className="mt-1" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
              {t('badge')}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      <StepIndicator currentPhase={phase} t={t} />

      {errorMessage && phase !== 'complete' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-7 xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className="space-y-5">
          <fieldset disabled={phase === 'analyzing' || phase === 'generating'}>
            <div className={`${leftCardClass} ${phase === 'analyzing' || phase === 'generating' ? 'opacity-70' : ''}`}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <ImageIcon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-[15px] font-semibold text-foreground">{t('productSource')}</h3>
                  <p className="text-[13px] text-muted-foreground">{t('productSourceDesc')}</p>
                </div>
                <span className="text-[13px] text-muted-foreground">{productImages.length}/6</span>
              </div>
              <MultiImageUploader
                images={productImages}
                onAdd={handleAddImages}
                onRemove={handleRemoveImage}
                maxImages={6}
                compactAfterUpload
                thumbnailGridCols={3}
                showIndexBadge
                label={t('uploadHint')}
                hideDefaultFooter={isZh}
                footerText={`${productImages.length}/6 images · max 10 MB each`}
                dropzoneClassName="min-h-[186px] rounded-[20px] border-border bg-muted px-6 py-8 hover:border-border/80 hover:bg-secondary"
                labelClassName={isZh ? 'max-w-[260px] text-sm leading-6 text-foreground' : undefined}
                footerClassName="text-xs text-muted-foreground"
              />
            </div>
          </fieldset>

          <div className={leftCardClass}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">{t('briefTitle')}</h3>
                <p className="text-[13px] text-muted-foreground">{t('briefDesc')}</p>
              </div>
            </div>

            <Textarea
              value={requirements}
              onChange={(event) => setRequirements(clampText(event.target.value, TEXT_LIMITS.brief))}
              rows={5}
              maxLength={TEXT_LIMITS.brief}
              disabled={phase === 'analyzing' || phase === 'generating'}
              className="min-h-[128px] resize-none rounded-2xl border-border bg-muted text-[14px] leading-6 text-foreground"
              placeholder={t('briefPlaceholder')}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {formatTextCounter(requirements, TEXT_LIMITS.brief, isZh)}
            </p>

            <div className="mt-4 space-y-1.5">
              <Label className="text-[13px] font-medium text-muted-foreground">{t('outputLanguage')}</Label>
              <Select value={outputLanguage} onValueChange={(value) => setOutputLanguage(value as OutputLanguage)} disabled={phase === 'analyzing' || phase === 'generating'}>
                <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTPUT_LANGUAGES.map((language) => (
                    <SelectItem key={language.value} value={language.value}>{language.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">{tc('model')}</Label>
                <Select
                  value={model}
                  onValueChange={(value) => {
                    const nextModel = normalizeGenerationModel(value) as GenerationModel
                    setModel(nextModel)
                    setImageSize((current) => sanitizeImageSizeForModel(nextModel, current))
                  }}
                  disabled={phase === 'analyzing' || phase === 'generating'}
                >
                  <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getAvailableModels(userEmail).map((availableModel) => (
                      <SelectItem key={availableModel.value} value={availableModel.value}>
                        {isZh ? availableModel.tierLabel.zh : availableModel.tierLabel.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ModelTextHint />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">{tc('aspectRatio')}</Label>
                <Select
                  value={aspectRatio}
                  onValueChange={(value) => setAspectRatio(value as AspectRatio)}
                  disabled={phase === 'analyzing' || phase === 'generating'}
                >
                  <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIOS.map((ratio) => (
                      <SelectItem key={ratio.value} value={ratio.value}>{ratio.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">{tc('imageCount')}</Label>
                <Select
                  value={String(imageCount)}
                  onValueChange={(value) => setImageCount(Math.max(1, Math.min(15, Number(value) || 1)))}
                  disabled={phase === 'analyzing' || phase === 'generating'}
                >
                  <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMAGE_COUNTS.map((count) => (
                      <SelectItem key={count} value={String(count)}>{t('quantityValue', { count })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {renderLeftButton()}
            </div>
          </div>
        </div>

        <div className="flex min-h-[760px] flex-col rounded-2xl border border-border bg-background p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">{rightPanelTitle}</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{rightPanelSubtitle}</p>
            </div>
          </div>

          <div className="flex-1">
            {phase === 'input' && (
              persistedGallery ? (
                <div className="space-y-6">{persistedGallery}</div>
              ) : (
                <div className="flex min-h-[520px] flex-col items-center justify-center px-4 text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Sparkles className="h-8 w-8" />
                  </div>
                  <div className="space-y-2 text-sm leading-7 text-muted-foreground">
                    <p>{t('emptyStateLine1')}</p>
                    <p>{t('emptyStateLine2')}</p>
                  </div>
                </div>
              )
            )}

            {phase === 'analyzing' && (
              <div className="space-y-6">
                <CoreProcessingStatus
                  title={t('analyzingTitle')}
                  subtitle={t('analyzingSubtitle')}
                  progress={progress}
                  statusLine={analyzingMessages[analyzingMessageIndex] ?? ''}
                  showHeader={false}
                  statusPlacement="below"
                />
                {persistedGallery}
              </div>
            )}

            {phase === 'preview' && blueprint && (
              <div className="space-y-6">
                <DesignBlueprint
                  translationNamespace="studio.genesis2"
                  designSpecs={blueprint.design_specs}
                  onDesignSpecsChange={(value) => setBlueprint((current) => current ? { ...current, design_specs: value } : current)}
                  imagePlans={blueprint.images}
                  onImagePlanChange={(index, plan) => {
                    setBlueprint((current) => current ? {
                      ...current,
                      images: current.images.map((item, currentIndex) => (currentIndex === index ? plan : item)),
                    } : current)
                  }}
                />

                {persistedGallery}
              </div>
            )}

            {phase === 'generating' && (
              <div className="space-y-6">
                <CoreProcessingStatus
                  title={t('generatingTitle')}
                  subtitle={t('generatingSubtitle')}
                  progress={progress}
                  statusLine={t('generatingStatus')}
                  showHeader={false}
                  statusPlacement="below"
                />

                {imageSlots.length > 0 && (
                  <div className="flex flex-wrap content-start items-start gap-3">
                    {imageSlots.map((slot, index) => (
                      <ImageSlotCard key={slot.jobId || `slot-${index}`} slot={slot} index={index} aspectRatio={aspectRatio} isZh={isZh} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {phase === 'complete' && (
              <div className="space-y-6">
                {persistedGallery}

                {failedSlotIndices.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{t('partialFailed', { count: failedSlotIndices.length })}</span>
                  </div>
                )}

                {results.length === 0 && !errorMessage && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <AlertTriangle className="mb-3 h-10 w-10 text-destructive" />
                    <p className="text-sm font-medium text-destructive">{t('allImagesFailed')}</p>
                  </div>
                )}

                {errorMessage && (
                  <div className="text-center text-sm text-destructive">{errorMessage}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </CorePageShell>
  )
}
