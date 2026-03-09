'use client'

import { useState, useRef, useCallback } from 'react'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { useLocale, useTranslations } from 'next-intl'
import { Image as ImageIcon, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import type { ProgressStep } from '@/components/generation/GenerationProgress'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { DesignBlueprint } from '@/components/studio/DesignBlueprint'
import { ModelImageSection } from './ModelImageSection'
import { ClothingSettingsSection } from './ClothingSettingsSection'
import { AIModelGeneratorDialog } from './AIModelGeneratorDialog'
import { GenerationTypeSelector, countSelectedTypes } from './GenerationTypeSelector'
import type { BasicPhotoTypeState, ClothingPhase } from './types'
import { uploadFile } from '@/lib/api/upload'
import { analyzeProductV2, generatePromptsV2Stream, generateImage } from '@/lib/api/edge-functions'
import { refreshCredits } from '@/lib/hooks/useCredits'
import { createClient } from '@/lib/supabase/client'
import { createResultAsset, extractResultAssetMetadata } from '@/lib/utils/result-assets'
import type {
  GenerationModel,
  AspectRatio,
  ImageSize,
  GenerationJob,
  AnalysisBlueprint,
  BlueprintImagePlan,
  GeneratedPrompt,
} from '@/types'
import { DEFAULT_MODEL } from '@/types'
import { friendlyError } from '@/lib/utils'

function uid() {
  return crypto.randomUUID()
}

type ClothingTranslation = (key: string, values?: Record<string, string | number>) => string

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

function normalizePrompt(item: unknown): GeneratedPrompt | null {
  if (typeof item === 'string') {
    const prompt = item.trim()
    return prompt ? { prompt, title: '', negative_prompt: '', marketing_hook: '', priority: 0 } : null
  }
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : ''
  if (!prompt) return null
  return {
    prompt,
    title: typeof obj.title === 'string' ? obj.title : '',
    negative_prompt: typeof obj.negative_prompt === 'string' ? obj.negative_prompt : '',
    marketing_hook: typeof obj.marketing_hook === 'string' ? obj.marketing_hook : '',
    priority: Math.round(Math.max(0, Math.min(10, Number(obj.priority) || 0))),
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
      const arr = JSON.parse(candidate)
      if (Array.isArray(arr)) {
        const prompts = arr.map(normalizePrompt).filter((value): value is GeneratedPrompt => value !== null)
        if (prompts.length > 0) return prompts
      }
    } catch {
      // fallback below
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

function isBlueprintImagePlan(value: unknown): value is BlueprintImagePlan {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.title === 'string' && typeof item.description === 'string' && typeof item.design_content === 'string'
}

function isAnalysisBlueprint(value: unknown): value is AnalysisBlueprint {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Array.isArray(obj.images) && obj.images.every(isBlueprintImagePlan) && typeof obj.design_specs === 'string'
}

function planMatchesOrientation(plan: BlueprintImagePlan, orientation: 'front' | 'back'): boolean {
  const text = `${plan.title} ${plan.description} ${plan.design_content}`.toLowerCase()
  if (orientation === 'front') return /正面|front/.test(text)
  return /背面|back/.test(text)
}

function buildTryOnDefaultPlans(typeState: BasicPhotoTypeState, t: ClothingTranslation): BlueprintImagePlan[] {
  const plans: BlueprintImagePlan[] = []

  if (typeState.whiteBgRetouched.front) {
    plans.push({
      title: t('tryOnDefaultPlans.whiteBg.front.title'),
      description: t('tryOnDefaultPlans.whiteBg.front.description'),
      design_content: t('tryOnDefaultPlans.whiteBg.front.designContent'),
      type: 'refined',
    })
  }

  if (typeState.whiteBgRetouched.back) {
    plans.push({
      title: t('tryOnDefaultPlans.whiteBg.back.title'),
      description: t('tryOnDefaultPlans.whiteBg.back.description'),
      design_content: t('tryOnDefaultPlans.whiteBg.back.designContent'),
      type: 'refined',
    })
  }

  if (typeState.threeDEffect.enabled) {
    plans.push({
      title: t('tryOnDefaultPlans.threeD.title'),
      description: t('tryOnDefaultPlans.threeD.description'),
      design_content: t('tryOnDefaultPlans.threeD.designContent'),
      type: '3d',
    })
  }

  if (typeState.mannequin.enabled) {
    plans.push({
      title: t('tryOnDefaultPlans.mannequin.title'),
      description: t('tryOnDefaultPlans.mannequin.description'),
      design_content: t('tryOnDefaultPlans.mannequin.designContent'),
      type: 'mannequin',
    })
  }

  for (let index = 0; index < typeState.detailCloseup.count; index += 1) {
    plans.push({
      title: t('tryOnDefaultPlans.detail.title', { index: index + 1 }),
      description: t('tryOnDefaultPlans.detail.description'),
      design_content: t('tryOnDefaultPlans.detail.designContent'),
      type: 'detail',
    })
  }

  for (let index = 0; index < typeState.sellingPoint.count; index += 1) {
    plans.push({
      title: t('tryOnDefaultPlans.sellingPoint.title', { index: index + 1 }),
      description: t('tryOnDefaultPlans.sellingPoint.description'),
      design_content: t('tryOnDefaultPlans.sellingPoint.designContent'),
      type: 'selling_point',
    })
  }

  if (plans.length === 0) {
    plans.push({
      title: t('tryOnDefaultPlans.fallback.title'),
      description: t('tryOnDefaultPlans.fallback.description'),
      design_content: t('tryOnDefaultPlans.fallback.designContent'),
    })
  }

  return plans
}

function buildTryOnFallbackSpecs(t: ClothingTranslation): string {
  return [
    `# ${t('tryOnFallbackSpecs.title')}`,
    '',
    `## ${t('tryOnFallbackSpecs.visualThemeTitle')}`,
    `- ${t('tryOnFallbackSpecs.visualThemeDirection')}`,
    `- ${t('tryOnFallbackSpecs.visualThemeBackground')}`,
    `- ${t('tryOnFallbackSpecs.visualThemeColorTone')}`,
    '',
    `## ${t('tryOnFallbackSpecs.photoSpecsTitle')}`,
    `- ${t('tryOnFallbackSpecs.photoSpecsLens')}`,
    `- ${t('tryOnFallbackSpecs.photoSpecsLighting')}`,
    `- ${t('tryOnFallbackSpecs.photoSpecsQuality')}`,
    '',
    `## ${t('tryOnFallbackSpecs.subjectSummaryTitle')}`,
    `- ${t('tryOnFallbackSpecs.subjectSummaryType')}`,
    `- ${t('tryOnFallbackSpecs.subjectSummaryLock')}`,
    '',
    `## ${t('tryOnFallbackSpecs.garmentTraitsTitle')}`,
    `- ${t('tryOnFallbackSpecs.garmentTraitsPreserve')}`,
    `- ${t('tryOnFallbackSpecs.garmentTraitsWear')}`,
    '',
    `## ${t('tryOnFallbackSpecs.typographyTitle')}`,
    `- ${t('tryOnFallbackSpecs.typographyVisualOnly')}`,
    `- ${t('tryOnFallbackSpecs.typographyLanguage')}`,
  ].join('\n')
}

function normalizeTryOnBlueprint(
  resultData: unknown,
  typeState: BasicPhotoTypeState,
  isZh: boolean,
  t: ClothingTranslation,
): AnalysisBlueprint {
  const fallbackPlans = buildTryOnDefaultPlans(typeState, t)

  if (!isAnalysisBlueprint(resultData)) {
    return {
      images: fallbackPlans,
      design_specs: buildTryOnFallbackSpecs(t),
      _ai_meta: {
        model: 'unknown',
        usage: {},
        provider: 'fallback',
        image_count: fallbackPlans.length,
        target_language: isZh ? 'zh-CN' : 'en',
      },
      subject_profile: {
        subject_type: 'unknown',
        identity_anchor: isZh ? '保持参考主体一致' : 'Keep the reference subject consistent',
      },
      garment_profile: {
        category: isZh ? '服装' : 'garment',
      },
      tryon_strategy: {
        selected_type_count: fallbackPlans.length,
      },
    }
  }

  const images = fallbackPlans.map((fallbackPlan, index) => {
    const plan = resultData.images[index]
    if (!plan) return fallbackPlan
    return {
      ...fallbackPlan,
      ...plan,
      type: fallbackPlan.type ?? plan.type,
    }
  })

  if (typeState.whiteBgRetouched.front && !images.some((plan) => planMatchesOrientation(plan, 'front'))) {
    images[0] = fallbackPlans.find((plan) => planMatchesOrientation(plan, 'front')) ?? images[0]
  }
  if (typeState.whiteBgRetouched.back && !images.some((plan) => planMatchesOrientation(plan, 'back'))) {
    const fallbackBack = fallbackPlans.find((plan) => planMatchesOrientation(plan, 'back'))
    const backIndex = images.findIndex((plan) => plan.title.includes('背面'))
    if (fallbackBack && backIndex >= 0) images[backIndex] = fallbackBack
  }

  return {
    ...resultData,
    images,
    design_specs: resultData.design_specs || buildTryOnFallbackSpecs(t),
  }
}

function normalizePromptObjects(prompts: GeneratedPrompt[], plans: BlueprintImagePlan[]): GeneratedPrompt[] {
  return Array.from({ length: plans.length }, (_, index) => {
    const generated = prompts[index] ?? prompts[index % Math.max(prompts.length, 1)]
    if (generated?.prompt) return generated
    return {
      prompt: plans[index]?.design_content ?? '',
      title: plans[index]?.title ?? '',
      negative_prompt: '',
      marketing_hook: '',
      priority: 0,
    }
  })
}

function buildTryOnRequirements(language: string): string {
  if (language === 'zh' || language === 'zh-CN') {
    return '将这件产品穿到参考主体身上。请先识别参考主体类型：如果主体是人类，保持人物身份与体态一致；如果主体是宠物或其他动物，保持物种、毛色、体态与头部特征一致。再分析服装品类：上衣类优先半身或七分身展示，下装类优先全身展示，连衣裙或套装优先全身展示。服装必须真实穿在主体身上，禁止漂浮、改款、换主体类型。'
  }
  return 'Put this product on the reference subject. Identify the subject type first: if the subject is human, preserve identity and body traits; if the subject is a pet or another animal, preserve species, coat color, body shape, and head traits. Then analyze the garment category: upper-body garments should prefer half-body or three-quarter framing, lower-body garments should prefer full-body framing, and dresses or full outfits should prefer full-body framing. The garment must be naturally worn by the subject with no floating clothes, redesign, or subject-type drift.'
}

interface ModelTryOnTabProps {
  traceId: string
}

export function ModelTryOnTab({ traceId }: ModelTryOnTabProps) {
  const locale = useLocale()
  const isZhLocale = locale.startsWith('zh')
  const t = useTranslations('studio.clothingStudio')
  const [phase, setPhase] = useState<ClothingPhase>('input')
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [modelImage, setModelImage] = useState<UploadedImage | null>(null)
  const [typeState, setTypeState] = useState<BasicPhotoTypeState>({
    whiteBgRetouched: { front: false, back: false },
    threeDEffect: { enabled: false, whiteBackground: false },
    mannequin: { enabled: false, whiteBackground: false },
    detailCloseup: { count: 0 },
    sellingPoint: { count: 0 },
  })
  const [requirements, setRequirements] = useState('')
  const [language, setLanguage] = useState('zh')
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const { promptProfile } = usePromptProfile(model)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [resolution, setResolution] = useState<ImageSize>('1K')
  const [showAIModelDialog, setShowAIModelDialog] = useState(false)

  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const {
    assets: results,
    activeBatchId,
    appendAssets: appendResults,
    clearAssets: clearResults,
  } = useResultAssetSession('clothing-model-tryon')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analysisBlueprint, setAnalysisBlueprint] = useState<AnalysisBlueprint | null>(null)
  const [editableDesignSpecs, setEditableDesignSpecs] = useState('')
  const [editableImagePlans, setEditableImagePlans] = useState<BlueprintImagePlan[]>([])
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([])
  const [uploadedProductUrls, setUploadedProductUrls] = useState<string[]>([])
  const [uploadedSubjectUrl, setUploadedSubjectUrl] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const isProcessing = phase === 'analyzing' || phase === 'generating'
  const canStart = productImages.length > 0 && modelImage !== null && countSelectedTypes(typeState) > 0
  const backendLocale = language === 'zh' ? 'zh-CN' : language === 'en' ? 'en' : (isZhLocale ? 'zh-CN' : 'en')

  const set = useCallback((id: string, patch: Partial<ProgressStep>) => {
    setSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...patch } : step)))
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!canStart) return
    const abort = new AbortController()
    abortRef.current = abort
    const batchId = uid()
    const batchTimestamp = Date.now()

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: t('stepLabelUpload'), status: 'pending' },
      { id: 'analyze', label: t('stepLabelAnalyzeSubject'), status: 'pending' },
      { id: 'preview', label: t('stepLabelDesignPlan'), status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(0)
    setErrorMessage(null)
    setPhase('analyzing')

    try {
      set('upload', { status: 'active' })
      const nextProductUrls = await Promise.all(
        productImages.map((img) => uploadFile(img.file).then((result) => result.publicUrl))
      )
      const { publicUrl: nextSubjectUrl } = await uploadFile(modelImage!.file)
      setUploadedProductUrls(nextProductUrls)
      setUploadedSubjectUrl(nextSubjectUrl)
      set('upload', { status: 'done' })
      setProgress(30)

      set('analyze', { status: 'active' })
      const effectiveRequirements = requirements.trim() || buildTryOnRequirements(language)
      const { job_id: analysisJobId } = await analyzeProductV2({
        productImage: nextProductUrls[0],
        productImages: nextProductUrls,
        promptProfile,
        modelImage: nextSubjectUrl,
        clothingMode: 'model_strategy',
        imageCount: countSelectedTypes(typeState),
        mannequinEnabled: typeState.mannequin.enabled,
        mannequinWhiteBackground: typeState.mannequin.whiteBackground,
        threeDEnabled: typeState.threeDEffect.enabled,
        threeDWhiteBackground: typeState.threeDEffect.whiteBackground,
        whiteBackground: typeState.whiteBgRetouched.front || typeState.whiteBgRetouched.back,
        whiteBgFront: typeState.whiteBgRetouched.front,
        whiteBgBack: typeState.whiteBgRetouched.back,
        detailCloseupCount: typeState.detailCloseup.count,
        sellingPointCount: typeState.sellingPoint.count,
        requirements: effectiveRequirements,
        uiLanguage: backendLocale,
        targetLanguage: backendLocale,
        outputLanguage: language,
        trace_id: traceId,
      })
      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      set('analyze', { status: 'done' })
      setProgress(65)

      const blueprint = normalizeTryOnBlueprint(analysisJob.result_data, typeState, isZhLocale, t)
      setAnalysisBlueprint(blueprint)
      setEditableDesignSpecs(blueprint.design_specs)
      setEditableImagePlans(blueprint.images)

      set('preview', { status: 'active' })
      let promptText = ''
      const stream = await generatePromptsV2Stream(
        {
          analysisJson: blueprint,
          design_specs: blueprint.design_specs,
          promptProfile,
          imageCount: blueprint.images.length,
          targetLanguage: backendLocale,
          outputLanguage: language,
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
          if (!payload || payload === '[DONE]' || payload.startsWith('[ERROR]')) continue
          try {
            const parsed = JSON.parse(payload) as { fullText?: string }
            promptText = parsed.fullText ?? promptText + payload
          } catch {
            promptText += payload
          }
        }
      }

      const promptObjects = normalizePromptObjects(parsePromptArray(promptText, blueprint.images.length), blueprint.images)
      setGeneratedPrompts(promptObjects)
      set('preview', { status: 'done' })
      setProgress(100)
      setPhase('preview')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(friendlyError((err as Error).message ?? t('analysisFailed'), true))
      setSteps((prev) => prev.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setPhase('input')
    }
  }, [backendLocale, canStart, isZhLocale, language, modelImage, productImages, requirements, set, traceId, typeState, promptProfile, t])

  const handleGenerate = useCallback(async () => {
    if (!analysisBlueprint || editableImagePlans.length === 0) return
    const abort = new AbortController()
    abortRef.current = abort
    const batchId = uid()
    const batchTimestamp = Date.now()

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: t('stepLabelUpload'), status: 'done' },
      { id: 'analyze', label: t('stepLabelAnalyzeSubject'), status: 'done' },
      { id: 'preview', label: t('stepLabelDesignPlan'), status: 'done' },
      { id: 'generate', label: t('stepLabelGenerateImages'), status: 'pending' },
      { id: 'done', label: t('stepLabelDone'), status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(72)
    setErrorMessage(null)
    setPhase('generating')

    try {
      const nextProductUrls = uploadedProductUrls.length > 0
        ? uploadedProductUrls
        : await Promise.all(productImages.map((img) => uploadFile(img.file).then((result) => result.publicUrl)))
      if (uploadedProductUrls.length === 0) {
        setUploadedProductUrls(nextProductUrls)
      }

      const nextSubjectUrl = uploadedSubjectUrl
        ?? (await uploadFile(modelImage!.file)).publicUrl
      if (!uploadedSubjectUrl) {
        setUploadedSubjectUrl(nextSubjectUrl)
      }

      const modifiedBlueprint: AnalysisBlueprint = {
        ...analysisBlueprint,
        images: editableImagePlans,
        design_specs: editableDesignSpecs,
      }

      const prompts = normalizePromptObjects(generatedPrompts, editableImagePlans)
      set('generate', { status: 'active' })

      const settledJobs = await Promise.allSettled(
        editableImagePlans.map(async (plan, index) => {
          const promptObj = prompts[index]
          const metadata = modifiedBlueprint.garment_profile
            ? {
                product_visual_identity: {
                  primary_color: String(modifiedBlueprint.garment_profile.color_anchor ?? ''),
                  material: String(modifiedBlueprint.garment_profile.material ?? ''),
                  key_features: Array.isArray(modifiedBlueprint.garment_profile.key_features)
                    ? modifiedBlueprint.garment_profile.key_features
                    : [],
                },
                hero_plan_title: plan.title,
                hero_plan_description: plan.description,
              }
            : undefined

          const { job_id } = await generateImage({
            productImage: nextProductUrls[0],
            productImages: nextProductUrls,
            modelImage: nextSubjectUrl,
            prompt: promptObj.prompt || plan.design_content,
            negativePrompt: promptObj.negative_prompt,
            promptProfile,
            model,
            aspectRatio,
            imageSize: resolution,
            workflowMode: 'model',
            metadata,
            client_job_id: `${uid()}_${index}`,
            fe_attempt: 1,
            trace_id: traceId,
          })

          return {
            plan,
            job: await waitForJob(job_id, abort.signal),
          }
        })
      )

      const successfulResults: ResultImage[] = []
      let failureCount = 0

      settledJobs.forEach((result) => {
        if (result.status !== 'fulfilled') {
          failureCount += 1
          return
        }
        if (!result.value.job.result_url) {
          failureCount += 1
          return
        }
        successfulResults.push(
          createResultAsset({
            url: result.value.job.result_url,
            label: result.value.plan.title,
            batchId,
            batchTimestamp,
            ...extractResultAssetMetadata(result.value.job.result_data),
            originModule: 'clothing-model-tryon',
          })
        )
      })

      if (successfulResults.length === 0) {
        throw new Error(t('allGenerationsFailed'))
      }

      appendResults(successfulResults, {
        activeBatchId: batchId,
        activeBatchTimestamp: batchTimestamp,
      })
      set('generate', { status: 'done' })
      set('done', { status: failureCount > 0 ? 'error' : 'done' })
      setProgress(100)
      setErrorMessage(failureCount > 0 ? t('partialGenerationFailed', { count: failureCount }) : null)
      setPhase('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(friendlyError((err as Error).message ?? t('generationFailed'), true))
      setSteps((prev) => prev.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setPhase('preview')
    } finally {
      refreshCredits()
    }
  }, [
    analysisBlueprint,
    appendResults,
    aspectRatio,
    editableDesignSpecs,
    editableImagePlans,
    generatedPrompts,
    model,
    modelImage,
    promptProfile,
    productImages,
    resolution,
    set,
    t,
    traceId,
    uploadedProductUrls,
    uploadedSubjectUrl,
  ])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setSteps([])
    setProgress(0)
    clearResults()
    setErrorMessage(null)
    setAnalysisBlueprint(null)
    setEditableDesignSpecs('')
    setEditableImagePlans([])
    setGeneratedPrompts([])
    setUploadedProductUrls([])
    setUploadedSubjectUrl(null)
  }, [clearResults])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const leftPanel = (
    <>
      <fieldset disabled={isProcessing} className="space-y-4">
        <div className="rounded-2xl border border-border bg-background p-5 space-y-3">
          <div className="flex items-center gap-3">
            <SectionIcon icon={ImageIcon} />
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">{t('productImageTitle')}</h3>
              <p className="text-[13px] text-muted-foreground">{t('productImageDesc')}</p>
            </div>
            <span className="text-[13px] text-muted-foreground">{productImages.length}/5</span>
          </div>
          <MultiImageUploader
            images={productImages}
            onAdd={(files) => {
              const newImages = files.map((file) => ({
                file,
                previewUrl: URL.createObjectURL(file),
              }))
              setProductImages((prev) => [...prev, ...newImages])
            }}
            onRemove={(index) => {
              setProductImages((prev) => prev.filter((_, imageIndex) => imageIndex !== index))
            }}
            maxImages={5}
            label={t('dragOrClickUpload')}
          />
        </div>

        <div className="rounded-2xl border border-border bg-background p-5 space-y-3">
          <div className="flex items-center gap-3">
            <SectionIcon icon={User} />
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">{t('subjectImageTitle')}</h3>
              <p className="text-[13px] text-muted-foreground">{t('subjectImageDesc')}</p>
            </div>
          </div>
          <ModelImageSection
            modelImage={modelImage}
            onModelImageChange={setModelImage}
            onGenerateAIModel={() => setShowAIModelDialog(true)}
            disabled={isProcessing}
          />
        </div>

        <GenerationTypeSelector
          typeState={typeState}
          onTypeStateChange={setTypeState}
          disabled={isProcessing}
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
          disabled={isProcessing}
        />
      </fieldset>

      <div className="pt-3">
        {phase === 'input' && (
          <Button
            onClick={handleAnalyze}
            disabled={!canStart}
            className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-white hover:bg-primary disabled:bg-text-tertiary disabled:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            {t('analyzeProduct')}
          </Button>
        )}
        {phase === 'analyzing' && (
          <Button variant="outline" onClick={handleCancel} className="w-full h-12 rounded-2xl">
            {t('cancelAnalysis')}
          </Button>
        )}
        {phase === 'preview' && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleReset} className="flex-1 h-12 rounded-2xl">
              {t('restart')}
            </Button>
            <Button
              onClick={handleGenerate}
              className="h-12 flex-1 rounded-2xl bg-primary text-base font-semibold text-white hover:bg-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
              {t('generateImages')}
            </Button>
          </div>
        )}
        {phase === 'generating' && (
          <Button variant="outline" onClick={handleCancel} className="w-full h-12 rounded-2xl">
            {t('cancelGeneration')}
          </Button>
        )}
        {phase === 'complete' && (
          <Button variant="outline" onClick={handleReset} className="w-full h-12 rounded-2xl">
            {t('regenerate')}
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

  const persistedHistoryGallery = results.length > 0 ? (
    <ResultGallery
      images={results}
      activeBatchId={activeBatchId}
      aspectRatio={aspectRatio}
      historyInitiallyExpanded={false}
      onClear={clearResults}
      editorSessionKey="clothing-model-tryon"
      originModule="clothing-model-tryon"
    />
  ) : null

  const rightPanel = (() => {
    if (phase === 'input') {
      if (persistedHistoryGallery) return <div className="space-y-4">{persistedHistoryGallery}</div>
      return (
        <div className="flex min-h-[700px] flex-col items-center justify-center text-center text-muted-foreground">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
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
            {t('emptyStateTryOnLine1')}
            <br />
            {t('emptyStateTryOnLine2')}
          </p>
        </div>
      )
    }

    if (phase === 'preview') {
      return (
        <div className="space-y-4">
          <DesignBlueprint
            designSpecs={editableDesignSpecs}
            onDesignSpecsChange={setEditableDesignSpecs}
            imagePlans={editableImagePlans}
            onImagePlanChange={(index, plan) => {
              setEditableImagePlans((prev) => prev.map((item, itemIndex) => (itemIndex === index ? plan : item)))
            }}
            generatedPrompts={generatedPrompts}
            onPromptChange={(index, prompt) => {
              setGeneratedPrompts((prev) => prev.map((item, itemIndex) => (
                itemIndex === index ? { ...item, prompt } : item
              )))
            }}
          />
          {persistedHistoryGallery}
        </div>
      )
    }

    if (phase === 'analyzing' || phase === 'generating') {
      const activeStep =
        [...steps].reverse().find((step) => step.status === 'active')?.label
        ?? (phase === 'generating' ? t('activeStepGenerating') : t('activeStepAnalyzing'))
      const title = phase === 'generating' ? t('generatingTitle') : t('analyzingTitle')
      const subtitle = phase === 'generating' ? t('generatingSubtitleTryOn') : t('analyzingSubtitleTryOn')

      return (
        <div className="space-y-4">
          <CoreProcessingStatus
            title={title}
            subtitle={subtitle}
            progress={progress}
            statusLine={errorMessage ?? activeStep}
            showHeader={false}
            statusPlacement="below"
          />
          {persistedHistoryGallery}
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {persistedHistoryGallery}
        {results.length === 0 && errorMessage && (
          <div className="text-center text-sm text-destructive">{errorMessage}</div>
        )}
      </div>
    )
  })()

  return { leftPanel, rightPanel, phase, previewCount: editableImagePlans.length }
}
