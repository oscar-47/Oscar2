'use client'

import { useState, useRef, useCallback } from 'react'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { useLocale } from 'next-intl'
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

function buildTryOnDefaultPlans(typeState: BasicPhotoTypeState): BlueprintImagePlan[] {
  const plans: BlueprintImagePlan[] = []

  if (typeState.whiteBgRetouched.front) {
    plans.push({
      title: '白底精修图（正面）',
      description: '参考主体正面穿着展示，突出服装正面版型与穿着状态',
      design_content: '图片类型：白底精修图（正面）\n主体识别：保持参考主体身份或物种一致，使用正面站姿或正面面对镜头。\n服装识别：完整保留服装正面颜色、材质、版型、图案与关键工艺。\n试穿策略：服装真实穿在参考主体身上，不漂浮、不改款，正面展示穿着效果。\n构图方案：纯白背景，主体居中，突出服装正面轮廓与贴合状态。\n光影方案：柔和影棚光，保证材质纹理和体积感。\n背景描述：纯白无干扰背景。\n配色方案：服装主色与辅色需精确还原，包含 hex 色值。\n文字内容：无文字（纯视觉）。\n视觉氛围关键词：干净、专业、真实、商业电商。',
      type: 'refined',
    })
  }

  if (typeState.whiteBgRetouched.back) {
    plans.push({
      title: '白底精修图（背面）',
      description: '参考主体背面穿着展示，突出服装背部结构与细节',
      design_content: '图片类型：白底精修图（背面）\n主体识别：保持参考主体身份或物种一致，使用背向镜头的稳定姿态。\n服装识别：完整保留服装背面颜色、材质、结构与背部工艺。\n试穿策略：服装真实穿在参考主体身上，不漂浮、不改款，背面展示结构细节。\n构图方案：纯白背景，主体居中，突出背部版型与穿着贴合。\n光影方案：柔和影棚光，清晰表现背部轮廓和材质。\n背景描述：纯白无干扰背景。\n配色方案：服装主色与辅色需精确还原，包含 hex 色值。\n文字内容：无文字（纯视觉）。\n视觉氛围关键词：干净、专业、真实、商业电商。',
      type: 'refined',
    })
  }

  if (typeState.threeDEffect.enabled) {
    plans.push({
      title: '3D立体效果图',
      description: '突出服装穿在参考主体身上的立体感、廓形与层次',
      design_content: '图片类型：3D立体效果图\n主体识别：保持参考主体身份或物种一致，保留主体体态与姿势方向。\n服装识别：完整保留服装颜色、材质、轮廓和关键细节。\n试穿策略：强调服装穿在主体身上的体积感、层次感和自然贴合，不将主体变成 3D 模型或无人台。\n构图方案：中近景或七分身构图，突出服装轮廓与穿着层次。\n光影方案：方向性柔光增强立体感和褶皱层次。\n背景描述：简洁商业背景或纯净过渡背景。\n配色方案：服装主色与辅色需精确还原，包含 hex 色值。\n文字内容：无文字（纯视觉）。\n视觉氛围关键词：立体、层次、质感、商业感。',
      type: '3d',
    })
  }

  if (typeState.mannequin.enabled) {
    plans.push({
      title: '人台图',
      description: '主体标准展示图，严格保留服装原始材质与外观',
      design_content: '图片类型：人台图\n主体识别：保持参考主体身份或物种一致，不得替换为真实无人台。\n服装识别：严格保留衣服原始材质、颜色、款式、剪裁、纹理和面料质感。\n试穿策略：将该类型解释为主体标准展示图，主体自然穿着服装，强调标准化展示与材质真实感。\n构图方案：稳定标准展示构图，突出服装整体外观。\n光影方案：真实棚拍或自然光下的高光、阴影和面料反光。\n背景描述：简洁标准背景，不干扰服装主体。\n配色方案：服装主色与辅色需精确还原，包含 hex 色值。\n文字内容：无文字（纯视觉）。\n视觉氛围关键词：标准化、真实、材质感、专业展示。',
      type: 'mannequin',
    })
  }

  for (let index = 0; index < typeState.detailCloseup.count; index += 1) {
    plans.push({
      title: `细节特写图 ${index + 1}`,
      description: '放大展示服装与主体接触部位的面料、工艺与贴合细节',
      design_content: '图片类型：细节特写图\n主体识别：保持参考主体身份或物种一致，聚焦局部穿着部位。\n服装识别：突出领口、袖口、纽扣、面料纹理或缝线等关键细节。\n试穿策略：展示服装穿在主体身上的局部贴合与真实材质，不改变服装结构。\n构图方案：微距或近景构图，聚焦一个高价值细节。\n光影方案：侧向柔光增强纹理与工艺。\n背景描述：浅景深或柔化背景。\n配色方案：服装主色与辅色需精确还原，包含 hex 色值。\n文字内容：无文字（纯视觉）。\n视觉氛围关键词：精细、质感、工艺、清晰。',
      type: 'detail',
    })
  }

  for (let index = 0; index < typeState.sellingPoint.count; index += 1) {
    plans.push({
      title: `卖点展示图 ${index + 1}`,
      description: '围绕核心卖点构图，突出主体穿着后的视觉记忆点',
      design_content: '图片类型：卖点展示图\n主体识别：保持参考主体身份或物种一致，围绕主体穿着后的使用感或视觉冲击展开。\n服装识别：突出服装最关键的卖点，如版型、功能、材质或设计亮点。\n试穿策略：让服装真实穿在主体身上，通过构图和动作突出卖点，不漂移服装设计。\n构图方案：中景或特写结合，强化卖点区域与视觉层级。\n光影方案：强调光或轮廓光引导焦点。\n背景描述：服务卖点表达的简洁商业场景。\n配色方案：服装主色与辅色需精确还原，包含 hex 色值。\n文字内容：无文字（纯视觉）。\n视觉氛围关键词：高转化、聚焦、记忆点、商业感。',
      type: 'selling_point',
    })
  }

  if (plans.length === 0) {
    plans.push({
      title: '主体试穿方案 1',
      description: '参考主体穿着展示方案',
      design_content: '图片类型：主体试穿展示\n主体识别：保持参考主体身份或物种一致。\n服装识别：保持颜色、材质、版型与关键细节一致。\n试穿策略：服装真实穿在参考主体身上。\n构图方案：中景商业构图。\n光影方案：柔和商业光。\n背景描述：简洁背景。\n配色方案：精确还原服装色值。\n文字内容：无文字（纯视觉）。\n视觉氛围关键词：真实、专业、商业电商。',
    })
  }

  return plans
}

function buildTryOnFallbackSpecs(isZh: boolean): string {
  if (isZh) {
    return `# 主体试穿设计规范

## 核心视觉基调
- 整体方向：真实自然的商业试穿展示
- 背景环境：简洁干净，不干扰主体与服装
- 色彩调性：以服装真实色彩为核心

## 全局摄影参数建议
- 镜头建议：50mm-85mm 商业人像或主体展示镜头
- 布光原则：柔和主光搭配轮廓光，保留材质纹理
- 画质要求：高清、锐利、无明显噪点

## 主体识别摘要
- 主体类型：以参考主体图为准，保持身份或物种一致
- 锁定规则：不得人化动物，不得动物化人类，不得改变体态结构

## 服装基础特征
- 保持服装颜色、材质、版型、图案、logo、结构和关键工艺细节
- 服装必须真实穿在主体身上，不能漂浮或改款

## 文字系统规范
- 默认纯视觉，无新增文字
- 若需文字，必须遵守目标语言约束`
  }

  return `# Try-on Design Specifications

## Overall Visual Theme
- Direction: realistic commercial try-on presentation
- Background: clean and uncluttered
- Color tone: led by the garment's true color

## Global Photography Specs
- Lens: 50mm-85mm commercial portrait or subject showcase
- Lighting: soft key light with subtle rim light
- Quality: high-detail, sharp, low-noise

## Subject Recognition Summary
- Subject type must follow the reference subject image
- Never humanize animals or animalize humans

## Garment Core Traits
- Preserve color, material, silhouette, logo, print, construction, and key details
- The garment must be naturally worn by the reference subject

## Typography System
- Default to visual-only composition
- Any added text must follow the target language rules`
}

function normalizeTryOnBlueprint(resultData: unknown, typeState: BasicPhotoTypeState, isZh: boolean): AnalysisBlueprint {
  const fallbackPlans = buildTryOnDefaultPlans(typeState)

  if (!isAnalysisBlueprint(resultData)) {
    return {
      images: fallbackPlans,
      design_specs: buildTryOnFallbackSpecs(isZh),
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
    design_specs: resultData.design_specs || buildTryOnFallbackSpecs(isZh),
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
      { id: 'upload', label: '上传图片', status: 'pending' },
      { id: 'analyze', label: '分析产品与主体', status: 'pending' },
      { id: 'preview', label: '生成设计方案', status: 'pending' },
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

      const blueprint = normalizeTryOnBlueprint(analysisJob.result_data, typeState, isZhLocale)
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
      setErrorMessage(friendlyError((err as Error).message ?? '分析失败', true))
      setSteps((prev) => prev.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setPhase('input')
    }
  }, [backendLocale, canStart, isZhLocale, language, modelImage, productImages, requirements, set, traceId, typeState, promptProfile])

  const handleGenerate = useCallback(async () => {
    if (!analysisBlueprint || editableImagePlans.length === 0) return
    const abort = new AbortController()
    abortRef.current = abort
    const batchId = uid()
    const batchTimestamp = Date.now()

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: '上传图片', status: 'done' },
      { id: 'analyze', label: '分析产品与主体', status: 'done' },
      { id: 'preview', label: '生成设计方案', status: 'done' },
      { id: 'generate', label: '生成图片', status: 'pending' },
      { id: 'done', label: '完成', status: 'pending' },
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
        throw new Error('本次生成全部失败，请检查 prompt 或重新分析')
      }

      appendResults(successfulResults, {
        activeBatchId: batchId,
        activeBatchTimestamp: batchTimestamp,
      })
      set('generate', { status: 'done' })
      set('done', { status: failureCount > 0 ? 'error' : 'done' })
      setProgress(100)
      setErrorMessage(failureCount > 0 ? `有 ${failureCount} 张图片生成失败，已保留成功结果。` : null)
      setPhase('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(friendlyError((err as Error).message ?? '生成失败', true))
      setSteps((prev) => prev.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setPhase('preview')
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
            label="拖拽或点击上传"
          />
        </div>

        <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 space-y-3">
          <div className="flex items-center gap-3">
            <SectionIcon icon={User} />
            <div>
              <h3 className="text-[15px] font-semibold text-[#1a1d24]">主体图片</h3>
              <p className="text-[13px] text-[#7d818d]">上传参考主体图，AI 生成功能仅支持真人模特</p>
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
            上传产品图、主体图并选择生成类型后
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
      )
    }

    if (phase === 'analyzing' || phase === 'generating') {
      const activeStep =
        [...steps].reverse().find((step) => step.status === 'active')?.label
        ?? (phase === 'generating' ? '生成中' : '分析中')
      const title = phase === 'generating' ? '生成中...' : '分析中...'
      const subtitle = phase === 'generating' ? '正在根据方案逐项生成图片' : '正在分析产品与主体并生成文字方案'

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
        {results.length > 0 && (
          <ResultGallery
            images={results}
            activeBatchId={activeBatchId}
            aspectRatio={aspectRatio}
            onClear={clearResults}
            editorSessionKey="clothing-model-tryon"
            originModule="clothing-model-tryon"
          />
        )}
        {results.length === 0 && errorMessage && (
          <div className="text-center text-sm text-destructive">{errorMessage}</div>
        )}
      </div>
    )
  })()

  return { leftPanel, rightPanel, phase, previewCount: editableImagePlans.length }
}
