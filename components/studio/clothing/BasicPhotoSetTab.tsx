'use client'

import { useState, useRef, useCallback } from 'react'
import { useSessionPersistence } from '@/lib/hooks/useSessionPersistence'
import { useLocale } from 'next-intl'
import { Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import type { ProgressStep } from '@/components/generation/GenerationProgress'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { DesignBlueprint } from '@/components/studio/DesignBlueprint'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { ClothingSettingsSection } from './ClothingSettingsSection'
import { GenerationTypeSelector, countSelectedTypes } from './GenerationTypeSelector'
import type { BasicPhotoTypeState, ClothingPhase } from './types'
import { uploadFile } from '@/lib/api/upload'
import { analyzeProductV2, generatePromptsV2Stream, generateImage } from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import type {
  GenerationModel,
  AspectRatio,
  ImageSize,
  GenerationJob,
  AnalysisBlueprint,
  BlueprintImagePlan,
  GeneratedPrompt,
} from '@/types'
import { isValidModel, STYLE_DIMENSIONS, buildStylePrefix } from '@/types'
import type { StyleDimensionKey } from '@/types'
import { StyleDimensionRadio } from '@/components/studio/StyleDimensionRadio'

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

function normalizePrompt(item: unknown): GeneratedPrompt | null {
  // Accept bare strings (v1 compat) and objects (v2)
  if (typeof item === 'string') {
    const s = item.trim()
    return s ? { prompt: s, title: '', negative_prompt: '', marketing_hook: '', priority: 0 } : null
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

  // Try truncation salvage: find last complete object
  const truncatedMatch = text.match(/\[[\s\S]*\}/)
  if (truncatedMatch?.[0]) {
    candidates.push(truncatedMatch[0] + ']')
  }

  for (const candidate of candidates) {
    try {
      const arr = JSON.parse(candidate)
      if (Array.isArray(arr)) {
        const prompts = arr.map(normalizePrompt).filter((v): v is GeneratedPrompt => v !== null)
        if (prompts.length > 0) return prompts
      }
    } catch {
      // fallback below
    }
  }

  // Paragraph fallback
  const fallback = text.split(/\n{2,}|\n(?=\d+[\.\)、])/).map(s => s.trim()).filter(s => s.length > 20)
  if (fallback.length > 0) return fallback.map(s => ({ prompt: s, title: '', negative_prompt: '', marketing_hook: '', priority: 0 }))

  return Array.from({ length: Math.max(1, expectedCount) }, () => ({ prompt: text, title: '', negative_prompt: '', marketing_hook: '', priority: 0 }))
}

function isBlueprintImagePlan(value: unknown): value is BlueprintImagePlan {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.title === 'string'
    && typeof item.description === 'string'
    && typeof item.design_content === 'string'
  )
}

function isAnalysisBlueprint(value: unknown): value is AnalysisBlueprint {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Array.isArray(obj.images) && obj.images.every(isBlueprintImagePlan) && typeof obj.design_specs === 'string'
}

function buildDefaultPlans(typeState: BasicPhotoTypeState): BlueprintImagePlan[] {
  const plans: BlueprintImagePlan[] = []
  if (typeState.whiteBgRetouched.front) {
    plans.push({
      title: '白底精修图（正面）',
      description: '展示服装正面版型与颜色细节',
      design_content: '白底平铺或模特正面展示，重点表现服装轮廓、主色和做工细节。',
    })
  }
  if (typeState.whiteBgRetouched.back) {
    plans.push({
      title: '白底精修图（背面）',
      description: '展示服装背面版型与工艺细节',
      design_content: '白底背面展示，清晰呈现后背剪裁与结构。',
    })
  }
  if (typeState.threeDEffect.enabled) {
    plans.push(
      {
        title: '3D立体效果图（正面）',
        description: '模特正面穿着展示，突出服装正面版型与立体感',
        design_content: '模特正面站姿穿着展示，通过光影表现服装正面体积感与版型轮廓，保留材质纹理，统一背景与风格。',
      },
      {
        title: '3D立体效果图（背面）',
        description: '模特背面穿着展示，呈现背部剪裁与结构',
        design_content: '模特背面站姿穿着展示，清晰呈现后背剪裁、缝线与结构细节，保留材质纹理，与正面图保持统一模特、风格与背景。',
      },
      {
        title: '3D立体效果图（侧面）',
        description: '模特侧面穿着展示，展现服装侧面层次',
        design_content: '模特侧面站姿穿着展示，通过侧面角度表现服装层次感与廓形，保留材质纹理，与正面图保持统一模特、风格与背景。',
      }
    )
  }
  if (typeState.mannequin.enabled) {
    plans.push({
      title: '人台展示图',
      description: '人台/模特架展示，严格保留衣服原始材质与外观',
      design_content: '人台或模特架展示服装，严格保留衣服的原始材质和外观：颜色、款式、剪裁、纹理、面料质感不做任何改变。模拟摄影棚或自然光下的真实光影效果，包括高光、阴影和面料反光。本质是换场景/换人台展示，不是重新设计衣服。',
    })
  }
  for (let i = 0; i < typeState.detailCloseup.count; i += 1) {
    plans.push({
      title: `细节特写图 ${i + 1}`,
      description: '放大展示面料与工艺细节',
      design_content: '聚焦领口、袖口、印花或走线，保证细节清晰度和质感。',
    })
  }
  for (let i = 0; i < typeState.sellingPoint.count; i += 1) {
    plans.push({
      title: `卖点展示图 ${i + 1}`,
      description: '突出产品核心卖点',
      design_content: '围绕核心卖点构图，强化视觉层级与记忆点。',
    })
  }
  if (plans.length === 0) {
    plans.push({
      title: '图片方案 1',
      description: '请编辑该图片方案的标题和描述',
      design_content: '请基于产品特征补充该图片方案内容。',
    })
  }
  return plans
}

/** Check if a plan title/content refers to front or back orientation. */
function planMatchesOrientation(plan: BlueprintImagePlan, orientation: 'front' | 'back'): boolean {
  const text = `${plan.title} ${plan.description} ${plan.design_content}`.toLowerCase()
  if (orientation === 'front') return /正面|front/.test(text)
  return /背面|back/.test(text)
}

/**
 * Enforce that front/back white-bg plans exist when both are selected.
 * AI might merge them into a single plan or omit one — we inject defaults.
 */
function enforceWhiteBgPlans(plans: BlueprintImagePlan[], typeState: BasicPhotoTypeState): BlueprintImagePlan[] {
  const needFront = typeState.whiteBgRetouched.front
  const needBack = typeState.whiteBgRetouched.back
  if (!needFront || !needBack) return plans

  const hasFront = plans.some((p) => planMatchesOrientation(p, 'front'))
  const hasBack = plans.some((p) => planMatchesOrientation(p, 'back'))
  if (hasFront && hasBack) return plans

  const result = [...plans]
  if (!hasFront) {
    result.unshift({
      title: '白底精修图（正面）',
      description: '展示服装正面版型与颜色细节',
      design_content: '白底平铺或模特正面展示，重点表现服装轮廓、主色和做工细节。',
    })
  }
  if (!hasBack) {
    // Insert after front plan
    const frontIdx = result.findIndex((p) => planMatchesOrientation(p, 'front'))
    result.splice(frontIdx + 1, 0, {
      title: '白底精修图（背面）',
      description: '展示服装背面版型与工艺细节',
      design_content: '白底背面展示，清晰呈现后背剪裁与结构。',
    })
  }
  return result
}

function normalizeBlueprint(
  resultData: unknown,
  typeState: BasicPhotoTypeState
): AnalysisBlueprint {
  if (isAnalysisBlueprint(resultData)) {
    let plans = resultData.images.length > 0 ? resultData.images : buildDefaultPlans(typeState)
    plans = enforceWhiteBgPlans(plans, typeState)
    return { ...resultData, images: plans }
  }

  const fallbackPlans = buildDefaultPlans(typeState)
  return {
    images: fallbackPlans,
    design_specs: '所有图片须保持统一的服装电商视觉规范，强调材质、版型与细节展示。',
    _ai_meta: {
      model: 'unknown',
      usage: {},
      provider: 'fallback',
      image_count: fallbackPlans.length,
      target_language: 'zh-CN',
    },
  }
}

interface BasicPhotoSetTabProps {
  traceId: string
}

export function BasicPhotoSetTab({ traceId }: BasicPhotoSetTabProps) {
  const locale = useLocale()
  const isZh = locale.startsWith('zh')
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
  const [language, setLanguage] = useState('none')
  const [model, setModel] = useState<GenerationModel>('or-gemini-3.1-flash')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4')
  const [resolution, setResolution] = useState<ImageSize>('2K')
  const [turboEnabled, setTurboEnabled] = useState(false)
  const [styleDimensions, setStyleDimensions] = useState<Partial<Record<StyleDimensionKey, string>>>({})

  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ResultImage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analysisBlueprint, setAnalysisBlueprint] = useState<AnalysisBlueprint | null>(null)
  const [editableDesignSpecs, setEditableDesignSpecs] = useState('')
  const [editableImagePlans, setEditableImagePlans] = useState<BlueprintImagePlan[]>([])
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])

  useSessionPersistence(
    'clothing-basic-photo',
    () => ({
      requirements, language, model, aspectRatio, resolution, turboEnabled, styleDimensions,
      results: results.filter((r) => r.url && !r.url.startsWith('data:')),
    }),
    (s) => {
      if (typeof s.requirements === 'string') setRequirements(s.requirements)
      if (typeof s.language === 'string') setLanguage(s.language)
      if (typeof s.model === 'string' && isValidModel(s.model)) setModel(s.model as GenerationModel)
      if (typeof s.aspectRatio === 'string') setAspectRatio(s.aspectRatio as AspectRatio)
      if (typeof s.resolution === 'string') setResolution(s.resolution as ImageSize)
      if (typeof s.turboEnabled === 'boolean') setTurboEnabled(s.turboEnabled)
      if (s.styleDimensions && typeof s.styleDimensions === 'object') {
        const restored: Partial<Record<StyleDimensionKey, string>> = {}
        const validKeys = new Set(STYLE_DIMENSIONS.map(d => d.key))
        for (const [k, v] of Object.entries(s.styleDimensions as Record<string, string>)) {
          if (validKeys.has(k as StyleDimensionKey) && typeof v === 'string') {
            const dim = STYLE_DIMENSIONS.find(d => d.key === k)
            if (dim?.options.some(o => o.value === v)) {
              restored[k as StyleDimensionKey] = v
            }
          }
        }
        if (Object.keys(restored).length > 0) setStyleDimensions(restored)
      }
      if (Array.isArray(s.results)) {
        const restored = (s.results as ResultImage[]).filter((r) => r.url && typeof r.url === 'string')
        if (restored.length > 0) setResults(restored)
      }
    }
  )

  const abortRef = useRef<AbortController | null>(null)

  const isProcessing = phase === 'analyzing' || phase === 'generating'
  const canStart = productImages.length > 0 && countSelectedTypes(typeState) > 0
  const backendLocale = language === 'zh' ? 'zh-CN' : language === 'en' ? 'en' : (isZh ? 'zh-CN' : 'en')

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
      set('upload', { status: 'active' })
      const uploadedProductUrls = await Promise.all(
        productImages.map((img) => uploadFile(img.file).then((r) => r.publicUrl))
      )
      setUploadedUrls(uploadedProductUrls)
      set('upload', { status: 'done' })
      setProgress(30)

      set('analyze', { status: 'active' })
      const { job_id: analysisJobId } = await analyzeProductV2({
        productImage: uploadedProductUrls[0],
        productImages: uploadedProductUrls,
        clothingMode: 'product_analysis',
        // FIX #1: send imageCount so backend generates correct number of plans
        imageCount: countSelectedTypes(typeState),
        // FIX #2: flatten nested type state into flat backend fields
        mannequinEnabled: typeState.mannequin.enabled,
        mannequinWhiteBackground: typeState.mannequin.whiteBackground,
        threeDEnabled: typeState.threeDEffect.enabled,
        threeDWhiteBackground: typeState.threeDEffect.whiteBackground,
        whiteBackground: typeState.whiteBgRetouched.front || typeState.whiteBgRetouched.back,
        // FIX #3: send type breakdown for AI prompt
        whiteBgFront: typeState.whiteBgRetouched.front,
        whiteBgBack: typeState.whiteBgRetouched.back,
        detailCloseupCount: typeState.detailCloseup.count,
        sellingPointCount: typeState.sellingPoint.count,
        requirements,
        uiLanguage: backendLocale,
        targetLanguage: backendLocale,
        outputLanguage: language,
        trace_id: traceId,
      })
      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      set('analyze', { status: 'done' })
      setProgress(70)

      const blueprint = normalizeBlueprint(analysisJob.result_data, typeState)
      setAnalysisBlueprint(blueprint)
      setEditableDesignSpecs(blueprint.design_specs)
      setEditableImagePlans(blueprint.images)
      set('preview', { status: 'done' })
      setProgress(100)
      setPhase('preview')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage((err as Error).message ?? '分析失败')
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase('input')
    }
  }, [canStart, productImages, typeState, requirements, backendLocale, language, traceId, set])

  const handleGenerate = useCallback(async () => {
    if (!analysisBlueprint || editableImagePlans.length === 0) return
    const abort = new AbortController()
    abortRef.current = abort

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: '上传图片', status: 'done' },
      { id: 'analyze', label: '分析产品', status: 'done' },
      { id: 'preview', label: '生成设计方案', status: 'done' },
      { id: 'prompts', label: '生成提示词', status: 'pending' },
      { id: 'generate', label: '生成图片', status: 'pending' },
      { id: 'done', label: '完成', status: 'pending' },
    ]
    setSteps(initialSteps)
    setProgress(55)
    setErrorMessage(null)
    setPhase('generating')

    try {
      const uploadedProductUrls = uploadedUrls.length > 0
        ? uploadedUrls
        : await Promise.all(productImages.map((img) => uploadFile(img.file).then((r) => r.publicUrl)))
      if (uploadedUrls.length === 0) {
        setUploadedUrls(uploadedProductUrls)
      }

      const modifiedBlueprint: AnalysisBlueprint = {
        images: editableImagePlans,
        design_specs: editableDesignSpecs,
        _ai_meta: analysisBlueprint._ai_meta,
      }

      set('prompts', { status: 'active' })
      let promptText = ''
      const stream = await generatePromptsV2Stream(
        {
          analysisJson: modifiedBlueprint,
          design_specs: editableDesignSpecs,
          imageCount: editableImagePlans.length,
          targetLanguage: backendLocale,
          outputLanguage: language,
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

      const parsedPrompts = parsePromptArray(promptText, editableImagePlans.length)
      const stylePrefix = buildStylePrefix(styleDimensions)
      const prompts = Array.from({ length: editableImagePlans.length }, (_, i) => {
        const gp = parsedPrompts[i] ?? parsedPrompts[i % Math.max(parsedPrompts.length, 1)]
        // Use || so empty prompt strings also fall back to design_content
        const basePrompt = gp?.prompt || editableImagePlans[i].design_content
        return stylePrefix + basePrompt
      })

      set('prompts', { status: 'done' })
      set('generate', { status: 'active' })
      setProgress(72)

      const jobIds: string[] = []
      for (let i = 0; i < prompts.length; i += 1) {
        const { job_id } = await generateImage({
          productImage: uploadedProductUrls[0],
          productImages: uploadedProductUrls,
          prompt: prompts[i],
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
          label: editableImagePlans[i]?.title ?? `图片 ${i + 1}`,
        }))
      setResults(newResults)
      setPhase('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage((err as Error).message ?? '生成失败')
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase('preview')
    }
  }, [
    analysisBlueprint,
    editableImagePlans,
    editableDesignSpecs,
    uploadedUrls,
    productImages,
    model,
    aspectRatio,
    resolution,
    turboEnabled,
    styleDimensions,
    backendLocale,
    language,
    traceId,
    set,
  ])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setSteps([])
    setProgress(0)
    setResults([])
    setErrorMessage(null)
    setAnalysisBlueprint(null)
    setEditableDesignSpecs('')
    setEditableImagePlans([])
    setUploadedUrls([])
    setStyleDimensions({})
  }, [])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const leftPanel = (
    <>
      <fieldset disabled={isProcessing} className="space-y-4">
        <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <SectionIcon icon={ImageIcon} />
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-[#1a1d24]">产品图</h3>
              <p className="text-[13px] text-[#7d818d]">上传多角度产品图或细节图</p>
            </div>
            <span className="text-[13px] text-[#6f7380]">{productImages.length}/6</span>
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
            maxImages={6}
            compactAfterUpload
            thumbnailGridCols={3}
            showIndexBadge
            label="拖拽或点击上传"
            hideDefaultFooter
            dropzoneClassName="min-h-[190px] rounded-[20px] border-[#d0d4dc] bg-[#f1f3f6] px-6 py-8 hover:border-[#bcc2ce] hover:bg-[#eceff4]"
            labelClassName="text-base font-medium text-[#5f6471]"
            footerClassName="text-sm text-[#8b8f99]"
          />
        </div>

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

        <GenerationTypeSelector
          typeState={typeState}
          onTypeStateChange={setTypeState}
          disabled={isProcessing}
        />

        <StyleDimensionRadio
          values={styleDimensions}
          onChange={(key, value) => {
            setStyleDimensions(prev => {
              const next = { ...prev }
              if (value === null) {
                delete next[key]
              } else {
                next[key] = value
              }
              return next
            })
          }}
          disabled={isProcessing}
        />
      </fieldset>

      <div className="pt-2">
        {phase === 'input' && (
          <Button
            onClick={handleAnalyze}
            disabled={!canStart}
            className="h-14 w-full rounded-2xl bg-[#191b22] text-base font-semibold text-white hover:bg-[#111318] disabled:bg-[#9a9ca3] disabled:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            分析产品
          </Button>
        )}
        {phase === 'analyzing' && (
          <Button variant="outline" onClick={handleCancel} className="h-14 w-full rounded-2xl border-[#cbced6] bg-white text-[#202227]">
            取消分析
          </Button>
        )}
        {phase === 'preview' && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleReset} className="h-14 flex-1 rounded-2xl border-[#cbced6] bg-white text-[#202227]">
              重新开始
            </Button>
            <Button onClick={handleGenerate} className="h-14 flex-1 rounded-2xl bg-[#191b22] text-base font-semibold text-white hover:bg-[#111318]">
              <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
              生成图片
            </Button>
          </div>
        )}
        {phase === 'generating' && (
          <Button variant="outline" onClick={handleCancel} className="h-14 w-full rounded-2xl border-[#cbced6] bg-white text-[#202227]">
            取消生成
          </Button>
        )}
        {phase === 'complete' && (
          <Button variant="outline" onClick={handleReset} className="h-14 w-full rounded-2xl border-[#cbced6] bg-white text-[#202227]">
            重新生成
          </Button>
        )}
      </div>
    </>
  )

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
            上传产品图片并填写要求后
            <br />
            点击“分析产品”开始
          </p>
        </div>
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

    if (phase === 'analyzing' || phase === 'generating') {
      const activeStep =
        [...steps].reverse().find((step) => step.status === 'active')?.label
        ?? (phase === 'generating' ? '生成中' : '分析中')
      const title = phase === 'generating' ? '生成中...' : '分析中...'
      const subtitle =
        phase === 'generating'
          ? '正在根据规划生成图片'
          : '正在分析产品并生成设计规范'

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

    return (
      <div className="space-y-4">
        {results.length > 0 && <ResultGallery images={results} aspectRatio={aspectRatio} />}
        {results.length === 0 && errorMessage && (
          <div className="text-center text-sm text-destructive">{errorMessage}</div>
        )}
      </div>
    )
  })()

  return { leftPanel, rightPanel, phase, previewCount: editableImagePlans.length }
}
