'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Settings2,
  ShoppingBag,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import type { ProgressStep } from '@/components/generation/GenerationProgress'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { DesignBlueprint } from '@/components/studio/DesignBlueprint'
import { EcomDetailModuleSelector } from '@/components/studio/EcomDetailModuleSelector'
import { ModelTextHint } from '@/components/studio/ModelTextHint'
import { StudioPageHero } from '@/components/studio/StudioPageHero'
import { SupportFeedbackLink } from '@/components/support/SupportFeedbackLink'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { useAdminImageModels } from '@/lib/hooks/useAdminImageModels'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { uploadFiles } from '@/lib/api/upload'
import {
  analyzeProductV2,
  generateImage,
  generatePromptsV2Stream,
  processGenerationJob,
} from '@/lib/api/edge-functions'
import {
  logGenerationAttemptEvent,
  type GenerationAttemptEventStage,
} from '@/lib/api/generation-attempt-events'
import { createClient } from '@/lib/supabase/client'
import { isProviderPolicyBlockedError, toGenerationJobError } from '@/lib/job-errors'
import { friendlyError, generationRetryRefundMessage, isInsufficientCreditsError } from '@/lib/utils'
import { createResultAsset, extractResultAssetMetadata } from '@/lib/utils/result-assets'
import { clampText, formatTextCounter, TEXT_LIMITS } from '@/lib/input-guard'
import {
  buildEcomDetailAnalysisRequirements,
  ECOM_DETAIL_MODULES,
  normalizeEcomDetailBlueprint,
  resolveEcomDetailModules,
} from '@/lib/studio/ecom-detail-modules'
import type {
  AnalysisBlueprint,
  AspectRatio,
  BlueprintImagePlan,
  EcommercePhase,
  EcomDetailModuleDefinition,
  EcomDetailModuleId,
  GeneratedPrompt,
  GenerationJob,
  GenerationModel,
  ImageSize,
  OutputLanguage,
} from '@/types'
import {
  getAvailableModels,
  DEFAULT_MODEL,
  getGenerationCreditCost,
  isValidModel,
  normalizeGenerationModel,
  sanitizeImageSizeForModel,
} from '@/types'
import { useUserEmail } from '@/lib/hooks/useUserEmail'
import {
  WORKFLOW_PENDING_BUTTON_CLASS,
  WORKFLOW_PRIMARY_BUTTON_CLASS,
  WORKFLOW_SECONDARY_BUTTON_CLASS,
  WORKFLOW_WARNING_BUTTON_CLASS,
} from '@/components/studio/workflow-button-styles'

const ASPECT_RATIOS_EN: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 Square' },
  { value: '3:4', label: '3:4 Portrait' },
  { value: '4:3', label: '4:3 Landscape' },
  { value: '4:5', label: '4:5 Portrait' },
  { value: '9:16', label: '9:16 Mobile' },
  { value: '16:9', label: '16:9 Wide' },
]

const ASPECT_RATIOS_ZH: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 方图' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '4:3', label: '4:3 横版' },
  { value: '4:5', label: '4:5 竖版' },
  { value: '9:16', label: '9:16 长图' },
  { value: '16:9', label: '16:9 宽屏' },
]

const OUTPUT_LANGUAGES_EN: { value: OutputLanguage; label: string }[] = [
  { value: 'none', label: 'No Text (Visual Only)' },
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

const OUTPUT_LANGUAGES_ZH = OUTPUT_LANGUAGES_EN.map((lang) =>
  lang.value === 'none'
    ? { ...lang, label: '无文字(纯视觉)' }
    : lang
)

const DEFAULT_REQUIREMENTS_ZH = '我的商品是____，主要卖点是____'
const DEFAULT_REQUIREMENTS_EN = 'My product is ____, key selling point is ____'
const MODULE_ID_SET = new Set(ECOM_DETAIL_MODULES.map((module) => module.id))

interface AnalysisParamSnapshot {
  imagesSignature: string
  requirements: string
  outputLanguage: OutputLanguage
  selectedModulesSignature: string
}

function uid() {
  return crypto.randomUUID()
}

function buildImagesSignature(images: UploadedImage[]): string {
  return images
    .map((img) => `${img.file.name}:${img.file.size}:${img.file.lastModified}`)
    .join('|')
}

function modulesSignature(moduleIds: EcomDetailModuleId[]): string {
  return [...moduleIds].join('|')
}

function isAnalysisStale(
  current: AnalysisParamSnapshot,
  snapshot: AnalysisParamSnapshot | null,
): boolean {
  if (!snapshot) return false
  return (
    snapshot.imagesSignature !== current.imagesSignature ||
    snapshot.requirements !== current.requirements ||
    snapshot.outputLanguage !== current.outputLanguage ||
    snapshot.selectedModulesSignature !== current.selectedModulesSignature
  )
}

function computeCost(
  model: GenerationModel,
  imageSize: ImageSize,
  imageCount: number,
): number {
  if (imageCount <= 0) return 0
  const base = getGenerationCreditCost(model, imageSize)
  return base * imageCount
}

function partialGenerationFailedMessage(count: number, isZh: boolean): string {
  return isZh
    ? `有 ${count} 张图片生成失败，已保留成功结果。`
    : `${count} image(s) failed to generate. Successful results have been kept.`
}

function extractAttemptErrorInfo(error: unknown) {
  const errorCode = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '').trim() || null
    : null
  const rawStatus = typeof error === 'object' && error && 'status' in error
    ? Number((error as { status?: unknown }).status ?? NaN)
    : NaN

  return {
    errorCode,
    errorMessage: error instanceof Error ? (error.message || 'Unknown error') : String(error ?? 'Unknown error'),
    httpStatus: Number.isFinite(rawStatus) ? Math.floor(rawStatus) : null,
  }
}

function waitForJob(jobId: string, signal: AbortSignal): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let nudgeTimer: ReturnType<typeof setInterval> | null = null

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer)
      if (nudgeTimer) clearInterval(nudgeTimer)
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
      else if (job.status === 'failed') fail(toGenerationJobError(job))
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
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'generation_jobs',
          filter: `id=eq.${jobId}`,
        },
        () => {
          void checkOnce()
        },
      )
      .subscribe()

    void checkOnce()
    pollTimer = setInterval(() => {
      void checkOnce()
    }, 2000)
    nudgeTimer = setInterval(() => {
      void processGenerationJob(jobId)
    }, 8000)
  })
}

function normalizePrompt(item: unknown): GeneratedPrompt | null {
  if (typeof item === 'string') {
    const prompt = item.trim()
    return prompt ? { prompt, title: '', negative_prompt: '', marketing_hook: '', priority: 0 } : null
  }
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (!prompt) return null

  return {
    prompt,
    title: typeof record.title === 'string' ? record.title : '',
    negative_prompt: typeof record.negative_prompt === 'string' ? record.negative_prompt : '',
    marketing_hook: typeof record.marketing_hook === 'string' ? record.marketing_hook : '',
    priority: Math.round(Math.max(0, Math.min(10, Number(record.priority) || 0))),
  }
}

function parsePromptArray(rawText: string, expectedCount: number): GeneratedPrompt[] {
  const text = rawText.trim()
  const candidates: string[] = [text]

  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeFenceMatch?.[1]) candidates.push(codeFenceMatch[1].trim())

  const jsonArrayMatch = text.match(/\[[\s\S]*\]/)
  if (jsonArrayMatch?.[0]) candidates.push(jsonArrayMatch[0].trim())

  const truncatedMatch = text.match(/\[[\s\S]*\}/)
  if (truncatedMatch?.[0]) candidates.push(`${truncatedMatch[0]}]`)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) {
        const prompts = parsed.map(normalizePrompt).filter((item): item is GeneratedPrompt => item !== null)
        if (prompts.length > 0) return prompts
      }
    } catch {
      continue
    }
  }

  const fallback = text
    .split(/\n{2,}|\n(?=\d+[\.\)、])/)
    .map((item) => item.trim())
    .filter((item) => item.length > 20)

  if (fallback.length > 0) {
    return fallback.map((prompt) => ({
      prompt,
      title: '',
      negative_prompt: '',
      marketing_hook: '',
      priority: 0,
    }))
  }

  return Array.from({ length: Math.max(1, expectedCount) }, () => ({
    prompt: text,
    title: '',
    negative_prompt: '',
    marketing_hook: '',
    priority: 0,
  }))
}

export function EcomStudioForm() {
  const t = useTranslations('studio.ecomStudio')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const isZh = locale.startsWith('zh')
  const userEmail = useUserEmail()
  useAdminImageModels(userEmail)
  const backendLocale = isZh ? 'zh-CN' : 'en'
  const defaultRequirements = isZh ? DEFAULT_REQUIREMENTS_ZH : DEFAULT_REQUIREMENTS_EN
  const aspectRatios = isZh ? ASPECT_RATIOS_ZH : ASPECT_RATIOS_EN
  const outputLanguages = isZh ? OUTPUT_LANGUAGES_ZH : OUTPUT_LANGUAGES_EN
  const panelInputClass = 'h-11 rounded-2xl border-border bg-secondary text-[14px]'
  const leftCardClass = 'rounded-[28px] border border-border bg-white p-5 sm:p-6'

  const [phase, setPhase] = useState<EcommercePhase>('input')
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [requirements, setRequirements] = useState(defaultRequirements)
  const [selectedDetailModules, setSelectedDetailModules] = useState<EcomDetailModuleId[]>([])
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const { promptProfile } = usePromptProfile(model)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>(isZh ? 'zh' : 'en')

  const [analysisBlueprint, setAnalysisBlueprint] = useState<AnalysisBlueprint | null>(null)
  const [editableDesignSpecs, setEditableDesignSpecs] = useState('')
  const [editableImagePlans, setEditableImagePlans] = useState<BlueprintImagePlan[]>([])
  const [analysisParams, setAnalysisParams] = useState<AnalysisParamSnapshot | null>(null)

  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const {
    assets: results,
    activeBatchId,
    appendAssets: appendResults,
    clearAssets: clearResults,
  } = useResultAssetSession('ecom-studio')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const { total: credits } = useCredits()

  // --- Onboarding for first-time users ---
  type OnboardingStep = 'welcome' | 'modules-selected' | null
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null)
  const onboardingDismissed = useRef(false)

  // Show onboarding guide for new users (no sample image — saves credits)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('shopix_ecom_onboarding_v1')) return
    setOnboardingStep('welcome')
  }, [])

  const dismissOnboarding = useCallback(() => {
    setOnboardingStep(null)
    onboardingDismissed.current = true
    try { localStorage.setItem('shopix_ecom_onboarding_v1', 'true') } catch {}
  }, [])

  // Session persistence removed: text persisted but images didn't on refresh.

  const selectedModules = resolveEcomDetailModules(selectedDetailModules)
  const currentImageCount = phase === 'preview' || phase === 'generating' || phase === 'complete'
    ? editableImagePlans.length
    : selectedModules.length
  const totalCost = computeCost(model, imageSize, currentImageCount)
  const insufficientCredits = credits !== null && totalCost > 0 && credits < totalCost
  const currentSnapshot: AnalysisParamSnapshot = {
    imagesSignature: buildImagesSignature(productImages),
    requirements,
    outputLanguage,
    selectedModulesSignature: modulesSignature(selectedDetailModules),
  }
  const needsReanalyze = phase === 'preview' && isAnalysisStale(currentSnapshot, analysisParams)
  const isProcessing = phase === 'analyzing' || phase === 'generating'
  const hasPersistedResults = results.length > 0

  const setStep = useCallback((id: string, patch: Partial<ProgressStep>) => {
    setSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...patch } : step)))
  }, [])

  const resetToInputIfNeeded = useCallback(() => {
    setPhase((prev) => {
      if (prev !== 'complete' && prev !== 'preview') return prev
      setAnalysisBlueprint(null)
      setAnalysisParams(null)
      setUploadedUrls([])
      return 'input'
    })
  }, [])

  const handleAddImages = useCallback((files: File[]) => {
    setProductImages((prev) => [
      ...prev,
      ...files.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])
    setErrorMessage(null)
    resetToInputIfNeeded()
  }, [resetToInputIfNeeded])

  const handleRemoveImage = useCallback((index: number) => {
    setProductImages((prev) => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((_, currentIndex) => currentIndex !== index)
    })
    resetToInputIfNeeded()
  }, [resetToInputIfNeeded])

  const handleToggleModule = useCallback((id: EcomDetailModuleId) => {
    setSelectedDetailModules((prev) => (
      prev.includes(id)
        ? prev.filter((currentId) => currentId !== id)
        : [...prev, id].sort((a, b) => {
            const moduleA = ECOM_DETAIL_MODULES.find((module) => module.id === a)?.sortOrder ?? 0
            const moduleB = ECOM_DETAIL_MODULES.find((module) => module.id === b)?.sortOrder ?? 0
            return moduleA - moduleB
          })
    ))
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (productImages.length === 0 || selectedModules.length === 0) return
    if (onboardingStep) dismissOnboarding()
    const abort = new AbortController()
    abortRef.current = abort
    const traceId = uid()
    const batchId = uid()
    const batchTimestamp = Date.now()
    const nextSnapshot: AnalysisParamSnapshot = {
      imagesSignature: buildImagesSignature(productImages),
      requirements,
      outputLanguage,
      selectedModulesSignature: modulesSignature(selectedDetailModules),
    }

    setPhase('analyzing')
    setSteps([
      { id: 'upload', label: isZh ? '上传图片' : 'Upload Images', status: 'pending' },
      { id: 'analyze', label: isZh ? '分析产品' : 'Analyze Product', status: 'pending' },
      { id: 'preview', label: isZh ? '生成详情页规划方案' : 'Build Detail Plan', status: 'pending' },
    ])
    setProgress(0)
    setErrorMessage(null)

    try {
      setStep('upload', { status: 'active' })
      const uploaded = await uploadFiles(productImages.map((item) => item.file))
      const urls = uploaded.map((item) => item.publicUrl)
      setUploadedUrls(urls)
      setStep('upload', { status: 'done' })
      setProgress(30)

      setStep('analyze', { status: 'active' })
      const { job_id } = await analyzeProductV2({
        productImage: urls[0],
        productImages: urls,
        promptProfile,
        requirements: buildEcomDetailAnalysisRequirements({
          requirements,
          selectedModuleIds: selectedDetailModules,
          isZh,
        }),
        imageCount: selectedModules.length,
        uiLanguage: backendLocale,
        outputLanguage,
        studioType: 'ecom-detail',
        trace_id: traceId,
        ecomDetailModules: selectedModules as EcomDetailModuleDefinition[],
      })

      const analysisJob = await waitForJob(job_id, abort.signal)
      setStep('analyze', { status: 'done' })
      setProgress(72)

      const blueprint = normalizeEcomDetailBlueprint(
        analysisJob.result_data,
        selectedDetailModules,
        isZh,
        outputLanguage,
      )
      setAnalysisBlueprint(blueprint)
      setEditableDesignSpecs(blueprint.design_specs)
      setEditableImagePlans(blueprint.images)
      setAnalysisParams(nextSnapshot)
      setStep('preview', { status: 'done' })
      setProgress(100)
      setPhase('preview')
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      const message = friendlyError((error as Error).message ?? 'Analysis failed', isZh)
      if (isProviderPolicyBlockedError(error) && typeof window !== 'undefined') {
        window.alert(message)
      }
      setErrorMessage(message)
      setSteps((prev) => prev.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setPhase('input')
    }
  }, [
    backendLocale,
    isZh,
    productImages,
    promptProfile,
    requirements,
    selectedDetailModules,
    selectedModules,
    setStep,
    outputLanguage,
  ])

  const handleGenerate = useCallback(async () => {
    if (!analysisBlueprint || editableImagePlans.length === 0) return
    if (needsReanalyze) {
      setErrorMessage(isZh ? '输入已变更，请先重新生成详情页规划方案。' : 'Inputs changed. Please re-generate the detail plan first.')
      return
    }

    const abort = new AbortController()
    abortRef.current = abort
    const traceId = uid()
    const batchId = uid()
    const batchTimestamp = Date.now()

    setPhase('generating')
    setSteps([
      { id: 'prompts', label: isZh ? '生成提示词' : 'Generate Prompts', status: 'pending' },
      { id: 'generate', label: isZh ? '生成图片' : 'Generate Images', status: 'pending' },
      { id: 'done', label: isZh ? '完成' : 'Done', status: 'pending' },
    ])
    setProgress(8)
    setErrorMessage(null)

    let queuedJobCount = 0
    let currentStage: GenerationAttemptEventStage = 'prepare_inputs'
    let stageFailureLogged = false
    const baseEventMetadata = {
      aspectRatio,
      imageSize,
      model,
      moduleCount: editableImagePlans.length,
      outputLanguage,
      promptProfile,
      selectedModules: selectedDetailModules,
    }
    const logAttempt = (
      stage: GenerationAttemptEventStage,
      status: 'started' | 'success' | 'failed' | 'partial',
      options?: { error?: unknown; metadata?: Record<string, unknown> }
    ) => {
      const errorInfo = options?.error ? extractAttemptErrorInfo(options.error) : null
      void logGenerationAttemptEvent({
        traceId,
        studioType: 'ecom-detail',
        stage,
        status,
        errorCode: errorInfo?.errorCode ?? null,
        errorMessage: errorInfo?.errorMessage ?? null,
        httpStatus: errorInfo?.httpStatus ?? null,
        metadata: {
          ...baseEventMetadata,
          ...(options?.metadata ?? {}),
        },
      })
    }

    logAttempt('prepare_inputs', 'started')
    try {
      const productUrls = uploadedUrls.length > 0
        ? uploadedUrls
        : (await uploadFiles(productImages.map((item) => item.file))).map((item) => item.publicUrl)
      if (uploadedUrls.length === 0) setUploadedUrls(productUrls)
      logAttempt('prepare_inputs', 'success', {
        metadata: {
          uploadedImageCount: productUrls.length,
          reusedUploadedUrls: uploadedUrls.length > 0,
        },
      })

      currentStage = 'prompt_generate'
      logAttempt('prompt_generate', 'started', {
        metadata: {
          uploadedImageCount: productUrls.length,
        },
      })
      setStep('prompts', { status: 'active' })
      let promptText = ''
      let promptStreamError: Error | null = null
      const promptStream = await generatePromptsV2Stream(
        {
          analysisJson: {
            images: editableImagePlans,
            design_specs: editableDesignSpecs,
            _ai_meta: analysisBlueprint._ai_meta,
          },
          design_specs: editableDesignSpecs,
          promptProfile,
          imageCount: editableImagePlans.length,
          targetLanguage: backendLocale,
          outputLanguage,
          stream: true,
          trace_id: traceId,
          module: 'ecom-detail',
        },
        abort.signal,
      )

      const reader = promptStream.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload || payload === '[DONE]') continue
          if (payload.startsWith('[ERROR]')) {
            promptStreamError = new Error(payload.slice('[ERROR]'.length).trim() || 'Prompt generation failed')
            continue
          }
          try {
            const parsed = JSON.parse(payload) as { fullText?: string; error?: string }
            if (typeof parsed.error === 'string' && parsed.error.trim()) {
              promptStreamError = new Error(parsed.error.trim())
              continue
            }
            promptText = parsed.fullText ?? promptText
          } catch {
            promptText += payload
          }
        }
      }

      if (promptStreamError) {
        throw promptStreamError
      }

      const parsedPrompts = parsePromptArray(promptText, editableImagePlans.length)
      const prompts = editableImagePlans.map((plan, index) => (
        parsedPrompts[index]?.prompt
          || parsedPrompts[parsedPrompts.length - 1]?.prompt
          || `${plan.title}\n${plan.design_content}`
      ))
      logAttempt('prompt_generate', 'success', {
        metadata: {
          promptCount: prompts.length,
          promptTextLength: promptText.length,
        },
      })

      currentStage = 'image_queue'
      logAttempt('image_queue', 'started', {
        metadata: {
          promptCount: prompts.length,
        },
      })
      setStep('prompts', { status: 'done' })
      setStep('generate', { status: 'active' })
      setProgress(38)

      const submissionResults = await Promise.allSettled(
        prompts.map((prompt, index) =>
          generateImage({
            productImage: productUrls[0],
            productImages: productUrls,
            prompt,
            promptProfile,
            model,
            aspectRatio,
            imageSize,
            client_job_id: `${uid()}_${index}`,
            fe_attempt: 1,
            trace_id: traceId,
            metadata: {
              module_id: editableImagePlans[index]?.id ?? null,
              module_name: editableImagePlans[index]?.title ?? null,
              selected_modules: selectedDetailModules,
              module_count: editableImagePlans.length,
              module_order: editableImagePlans.map((plan) => plan.id ?? plan.title),
            },
          }).then((result) => ({ jobId: result.job_id, index })),
        ),
      )

      const queuedJobs = submissionResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      queuedJobCount = queuedJobs.length
      const submissionFailureCount = submissionResults.filter((result) => result.status === 'rejected').length

      if (queuedJobs.length === 0) {
        const firstSubmissionError = submissionResults.find((result) => result.status === 'rejected')
        const firstError = firstSubmissionError?.status === 'rejected'
          ? firstSubmissionError.reason
          : new Error('No image jobs were queued')
        stageFailureLogged = true
        logAttempt('image_queue', 'failed', {
          error: firstError,
          metadata: {
            failedSubmissionCount: submissionFailureCount,
            promptCount: prompts.length,
            queuedJobCount,
          },
        })
        throw firstError
      }

      const firstRejectedSubmission = submissionResults.find((result) => result.status === 'rejected')
      logAttempt('image_queue', submissionFailureCount > 0 ? 'partial' : 'success', {
        error: firstRejectedSubmission?.status === 'rejected' ? firstRejectedSubmission.reason : undefined,
        metadata: {
          failedSubmissionCount: submissionFailureCount,
          promptCount: prompts.length,
          queuedJobCount,
        },
      })

      currentStage = 'batch_complete'
      const settledJobs = await Promise.allSettled(
        queuedJobs.map(({ jobId, index }) =>
          waitForJob(jobId, abort.signal).then((job) => ({ job, index })),
        ),
      )

      const nextResults: ResultImage[] = []
      let failureCount = submissionFailureCount
      let firstFailure: unknown = firstRejectedSubmission?.status === 'rejected'
        ? firstRejectedSubmission.reason
        : null

      settledJobs.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { job, index } = result.value
          const resultUrl = job.result_url
          if (!resultUrl) {
            failureCount += 1
            if (!firstFailure) {
              firstFailure = new Error('No output image returned')
            }
            return
          }

          nextResults.push({
            ...createResultAsset({
              url: resultUrl,
              label: editableImagePlans[index]?.title ?? `${isZh ? '模块' : 'Module'} ${index + 1}`,
              batchId,
              batchTimestamp,
              ...extractResultAssetMetadata(job.result_data),
              originModule: 'ecom-studio',
            }),
          })
          return
        }

        failureCount += 1
        if (!firstFailure) {
          firstFailure = result.status === 'rejected'
            ? result.reason
            : new Error('No output image returned')
        }
      })

      if (nextResults.length === 0) {
        const finalError = firstFailure instanceof Error ? firstFailure : new Error('No output image returned')
        stageFailureLogged = true
        logAttempt('batch_complete', 'failed', {
          error: finalError,
          metadata: {
            failureCount,
            queuedJobCount,
            successCount: 0,
          },
        })
        throw finalError
      }

      logAttempt('batch_complete', failureCount > 0 ? 'partial' : 'success', {
        error: failureCount > 0 ? firstFailure : undefined,
        metadata: {
          failureCount,
          queuedJobCount,
          successCount: nextResults.length,
        },
      })

      setStep('generate', { status: 'done' })
      setStep('done', { status: failureCount > 0 ? 'error' : 'done' })
      setProgress(100)
      appendResults(nextResults, {
        activeBatchId: batchId,
        activeBatchTimestamp: batchTimestamp,
      })
      setErrorMessage(failureCount > 0 ? partialGenerationFailedMessage(failureCount, isZh) : null)
      setPhase('complete')
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      const rawMsg = (error as Error).message ?? 'Generation failed'
      const message = isInsufficientCreditsError(error)
        ? friendlyError(rawMsg, isZh)
        : queuedJobCount > 0
          ? generationRetryRefundMessage(isZh)
          : friendlyError(rawMsg, isZh)
      if (isProviderPolicyBlockedError(error) && typeof window !== 'undefined') {
        window.alert(message)
      }
      if (!stageFailureLogged) {
        logAttempt(currentStage, 'failed', {
          error,
          metadata: {
            queuedJobCount,
          },
        })
      }
      setErrorMessage(message)
      setSteps((prev) => prev.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setPhase('preview')
    } finally {
      refreshCredits()
    }
  }, [
    appendResults,
    analysisBlueprint,
    aspectRatio,
    backendLocale,
    editableDesignSpecs,
    editableImagePlans,
    imageSize,
    isZh,
    model,
    needsReanalyze,
    outputLanguage,
    promptProfile,
    productImages,
    selectedDetailModules,
    setStep,
    uploadedUrls,
  ])

  const handleBackToInput = useCallback(() => {
    setPhase('input')
    setSteps([])
    setProgress(0)
    setErrorMessage(null)
    setAnalysisParams(null)
  }, [])

  const handleBackToPreview = useCallback(() => {
    setPhase('preview')
    setSteps([])
    setProgress(0)
    setErrorMessage(null)
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setPhase(analysisBlueprint ? 'preview' : 'input')
  }, [analysisBlueprint])

  const handleNewGeneration = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setProductImages([])
    setRequirements(defaultRequirements)
    setSelectedDetailModules([])
    setAnalysisBlueprint(null)
    setEditableDesignSpecs('')
    setEditableImagePlans([])
    setAnalysisParams(null)
    setSteps([])
    setProgress(0)
    clearResults()
    setErrorMessage(null)
    setUploadedUrls([])
  }, [clearResults, defaultRequirements])

  const rightPanelTitle = phase === 'preview'
    ? (isZh ? '详情页规划方案' : 'Detail Page Plan')
    : hasPersistedResults
      ? (isZh ? '生成结果' : 'Results')
      : phase === 'generating'
        ? (isZh ? '生成中...' : 'Generating...')
        : phase === 'analyzing'
          ? (isZh ? '规划中...' : 'Planning...')
          : (isZh ? '详情页模块结果区' : 'Detail Page Workspace')

  const rightPanelSubtitle = phase === 'preview'
    ? (isZh ? '确认并微调每个详情页模块后再生成图片' : 'Review and refine each detail-page module before generating images')
    : hasPersistedResults
      ? (isZh ? '每个模块对应 1 张结果图' : 'One generated image per module')
      : phase === 'generating'
        ? (isZh ? '正在根据规划生成模块图片' : 'Generating module images from the approved plan')
        : phase === 'analyzing'
          ? (isZh ? '正在分析产品并生成详情页规划方案' : 'Analyzing the product and building the detail-page plan')
          : t('emptyState')

  return (
    <CorePageShell maxWidthClass="max-w-[1360px]">
      <StudioPageHero
        icon={ShoppingBag}
        badge={t('badge')}
        title={t('title')}
        description={t('description')}
        badgeClassName="border-amber-200/80 bg-amber-50/90 text-amber-700"
      />

      {errorMessage && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{errorMessage}</p>
          <SupportFeedbackLink className="mt-2" />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[540px_minmax(0,1fr)]">
        <div className="space-y-5">
          <fieldset disabled={isProcessing}>
            <div className={`${leftCardClass} ${isProcessing ? 'opacity-70' : ''}`}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <ImageIcon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-[15px] font-semibold text-foreground">{t('productImage')}</h3>
                  <p className="text-[13px] text-muted-foreground">
                    {isZh ? '可上传多张，但必须是同一个产品。多角度/细节图效果最好。' : 'You can upload multiple images, but they must be the same product. Multiple angles and detail shots work best.'}
                  </p>
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
                label={isZh ? '拖拽或点击上传同款商品参考图' : 'Drop or click to upload same-product reference images'}
                hideDefaultFooter
                dropzoneClassName="min-h-[186px] rounded-2xl border-border bg-secondary px-6 py-8 hover:border-muted-foreground hover:bg-muted"
                labelClassName="text-sm leading-6 text-foreground"
              />
            </div>
          </fieldset>

          {/* Onboarding walkthrough — zero credit cost */}
          {onboardingStep === 'welcome' && (
            <div className="relative overflow-hidden rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/40 px-5 py-5 sm:px-6 sm:py-6">
              <button
                type="button"
                onClick={dismissOnboarding}
                className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground/50 hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>

              <p className="text-[15px] font-bold text-foreground">
                {isZh ? '3步生成专业详情页' : '3 Steps to Professional Detail Pages'}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {isZh ? '上传商品图 → 选择模块 → AI自动生成，无需浪费积分试用' : 'Upload product photos, pick modules, and let AI generate — no credits spent on demos'}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-3">
                {/* Step 1 */}
                <div className="relative rounded-xl border border-border bg-white/80 p-3 sm:p-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100/80 text-blue-600">
                    <Upload className="h-4 w-4" />
                  </div>
                  <p className="mt-2.5 text-[13px] font-semibold text-foreground">
                    {isZh ? '上传商品图' : 'Upload Photos'}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {isZh ? '支持多张、多角度' : 'Multi-image supported'}
                  </p>
                  <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-muted-foreground/30 sm:block hidden">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>

                {/* Step 2 */}
                <div className="relative rounded-xl border border-border bg-white/80 p-3 sm:p-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100/80 text-violet-600">
                    <LayoutGrid className="h-4 w-4" />
                  </div>
                  <p className="mt-2.5 text-[13px] font-semibold text-foreground">
                    {isZh ? '选择详情模块' : 'Pick Modules'}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {isZh ? '主图、场景、细节等' : 'Hero, scene, detail, etc.'}
                  </p>
                  <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-muted-foreground/30 sm:block hidden">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>

                {/* Step 3 */}
                <div className="rounded-xl border border-border bg-white/80 p-3 sm:p-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100/80 text-emerald-600">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <p className="mt-2.5 text-[13px] font-semibold text-foreground">
                    {isZh ? 'AI生成详情页' : 'AI Generates'}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {isZh ? '专业排版即刻呈现' : 'Pro layouts in seconds'}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={dismissOnboarding}
                  className="rounded-full bg-foreground px-5 py-2 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90 press-scale"
                >
                  {isZh ? '开始创作' : 'Start Creating'}
                </button>
                <span className="text-[12px] text-muted-foreground">
                  {isZh ? '每张图约 15-50 积分' : '~15-50 credits per image'}
                </span>
              </div>
            </div>
          )}

          <div className={leftCardClass}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">
                  {isZh ? '组图要求' : 'Detail Page Brief'}
                </h3>
                <p className="text-[13px] text-muted-foreground">
                  {isZh ? '复用主图生成的最新输入结构，用户要求优先于图片分析。' : 'Uses the latest Genesis-style brief. User requirements override image inference.'}
                </p>
              </div>
            </div>

            <Textarea
              value={requirements}
              onChange={(event) => setRequirements(clampText(event.target.value, TEXT_LIMITS.brief))}
              rows={5}
              maxLength={TEXT_LIMITS.brief}
              disabled={isProcessing}
              placeholder={t('descriptionPlaceholder')}
              className="min-h-[128px] resize-none rounded-2xl border-border bg-secondary text-[14px] leading-6"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {formatTextCounter(requirements, TEXT_LIMITS.brief, isZh)}
            </p>

            <div className="mt-4 space-y-1.5">
              <Label className="text-[13px] font-medium text-muted-foreground">
                {isZh ? '输出语言' : 'Output Language'}
              </Label>
              <Select
                value={outputLanguage}
                onValueChange={(value) => setOutputLanguage(value as OutputLanguage)}
                disabled={isProcessing}
              >
                <SelectTrigger className={panelInputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {outputLanguages.map((language) => (
                    <SelectItem key={language.value} value={language.value}>
                      {language.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">{tc('model')}</Label>
                <Select
                  value={model}
                  onValueChange={(value) => {
                    const nextModel = normalizeGenerationModel(value) as GenerationModel
                    setModel(nextModel)
                    setImageSize((current) => sanitizeImageSizeForModel(nextModel, current))
                  }}
                  disabled={isProcessing}
                >
                  <SelectTrigger className={panelInputClass}>
                    <SelectValue />
                  </SelectTrigger>
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
                  disabled={isProcessing}
                >
                  <SelectTrigger className={panelInputClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {aspectRatios.map((ratio) => (
                      <SelectItem key={ratio.value} value={ratio.value}>
                        {ratio.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <EcomDetailModuleSelector
            selectedIds={selectedDetailModules}
            onToggle={handleToggleModule}
            disabled={isProcessing}
            isZh={isZh}
            highlight={onboardingStep === 'welcome'}
          />

          {phase === 'input' && (
            <div className="space-y-3">
              {insufficientCredits && selectedModules.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p>
                    {isZh
                      ? `生成 ${selectedModules.length} 张图片需要 ${totalCost} 积分，当前余额 ${credits ?? 0} 积分。`
                      : `Generating ${selectedModules.length} images costs ${totalCost} credits. Current balance: ${credits ?? 0}.`}
                  </p>
                  <a
                    href={`/${locale}/pricing`}
                    className="mt-1.5 inline-block text-[13px] font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
                  >
                    {isZh ? '购买积分 →' : 'Buy Credits →'}
                  </a>
                </div>
              )}
              <Button
                size="lg"
                onClick={handleAnalyze}
                disabled={productImages.length === 0 || selectedModules.length === 0}
                className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} w-full`}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {t('analyzeButton')}
              </Button>
              {selectedModules.length > 0 && !insufficientCredits && (
                <p className="text-center text-[13px] text-muted-foreground">
                  {isZh ? `预计消耗 ${totalCost} 积分` : `Estimated cost: ${totalCost} credits`}
                </p>
              )}
            </div>
          )}

          {phase === 'analyzing' && (
            <Button
              size="lg"
              disabled
              className={`${WORKFLOW_PENDING_BUTTON_CLASS} w-full`}
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isZh ? '正在生成详情页规划方案' : 'Building detail page plan'}
            </Button>
          )}

          {phase === 'preview' && (
            <div className="space-y-4">
              {needsReanalyze && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {isZh ? '上传图、组图要求、输出语言或详情页模块已变更，请先重新生成详情页规划方案。' : 'Images, brief, output language, or modules changed. Please rebuild the detail plan first.'}
                </div>
              )}
              {insufficientCredits && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {tc('insufficientCredits')}
                </div>
              )}
              {needsReanalyze ? (
                <Button
                  size="lg"
                  onClick={handleAnalyze}
                  className={`${WORKFLOW_WARNING_BUTTON_CLASS} w-full`}
                >
                  <RefreshCw className="mr-2 h-5 w-5" />
                  {isZh ? '重新生成详情页规划方案' : 'Rebuild Detail Page Plan'}
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={handleGenerate}
                  disabled={editableImagePlans.length === 0 || insufficientCredits}
                  className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} w-full`}
                >
                  {isZh
                    ? `确认生成 ${editableImagePlans.length} 张图片`
                    : `Generate ${editableImagePlans.length} ${editableImagePlans.length === 1 ? 'image' : 'images'}`}
                </Button>
              )}
              <p className="text-center text-[14px] text-muted-foreground">
                {isZh ? `消耗 ${totalCost} 积分` : `Cost ${totalCost} credits`}
              </p>
              <Button
                variant="outline"
                size="lg"
                onClick={handleBackToInput}
                className={`${WORKFLOW_SECONDARY_BUTTON_CLASS} w-full`}
              >
                <ArrowLeft className="mr-2 h-5 w-5" />
                {isZh ? '返回编辑' : 'Back to Edit'}
              </Button>
            </div>
          )}

          {phase === 'generating' && (
            <div className="space-y-3">
              <Button
                size="lg"
                disabled
                className="h-14 w-full rounded-3xl bg-primary text-[17px] font-semibold text-white"
              >
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isZh ? '正在生成图片' : 'Generating Images'}
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={handleStop}
                className="h-14 w-full rounded-3xl border-border bg-secondary text-[17px] font-semibold text-foreground hover:bg-muted"
              >
                {tc('stop')}
              </Button>
            </div>
          )}

          {phase === 'complete' && (
            <div className="space-y-3">
              <Button
                size="lg"
                onClick={handleNewGeneration}
                className="h-14 w-full rounded-3xl bg-primary text-[17px] font-semibold text-white hover:bg-primary"
              >
                {isZh ? '新建生成' : 'New Generation'}
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={handleBackToPreview}
                className="h-14 w-full rounded-3xl border-border bg-secondary text-[17px] font-semibold text-foreground hover:bg-muted"
              >
                <ArrowLeft className="mr-2 h-5 w-5" />
                {isZh ? '返回规划方案' : 'Back to Plan'}
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-[30px] border border-border bg-white p-6 xl:p-8">
          <div className="mb-6">
            <h2 className="text-[18px] font-semibold text-foreground">{rightPanelTitle}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{rightPanelSubtitle}</p>
          </div>

          {phase === 'input' && !hasPersistedResults && (
            <div className="flex min-h-[620px] flex-col items-center justify-center px-4 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Sparkles className="h-8 w-8" />
              </div>
              <p className="max-w-[360px] text-base leading-7 text-muted-foreground">{t('emptyState')}</p>
            </div>
          )}

          {(phase === 'analyzing' || phase === 'generating') && (
            <CoreProcessingStatus
              title={phase === 'analyzing' ? (isZh ? '规划中...' : 'Planning...') : (isZh ? '生成中...' : 'Generating...')}
              subtitle={phase === 'analyzing'
                ? (isZh ? '正在分析产品并生成详情页规划方案' : 'Analyzing product and creating detail-page plan')
                : (isZh ? '正在根据规划逐模块生成图片' : 'Generating one image per approved module')}
              progress={progress}
              statusLine={[...steps].reverse().find((step) => step.status === 'active')?.label ?? ''}
              showHeader={false}
              statusPlacement="below"
            />
          )}

          {phase === 'preview' && (
            <DesignBlueprint
              designSpecs={editableDesignSpecs}
              onDesignSpecsChange={setEditableDesignSpecs}
              imagePlans={editableImagePlans}
              onImagePlanChange={(index, plan) => {
                setEditableImagePlans((prev) => prev.map((item, currentIndex) => (currentIndex === index ? plan : item)))
              }}
            />
          )}

          {hasPersistedResults && (
            <ResultGallery
              images={results}
              activeBatchId={activeBatchId}
              aspectRatio={aspectRatio}
              onClear={clearResults}
              editorSessionKey="ecom-studio"
              originModule="ecom-studio"
            />
          )}
        </div>
      </div>
    </CorePageShell>
  )
}
