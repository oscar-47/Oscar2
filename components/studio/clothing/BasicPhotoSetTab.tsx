'use client'

import { useState, useRef, useCallback } from 'react'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { useLocale, useTranslations } from 'next-intl'
import { Image as ImageIcon, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
  BlueprintCopyAnalysis,
  BlueprintCopyMode,
  BlueprintCopyPlanAdaptation,
  BlueprintCopyRole,
  GeneratedPrompt,
  OutputLanguage,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asTrimmedString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function normalizeOutputLanguage(value: unknown, fallback: OutputLanguage): OutputLanguage {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if ([
    'none', 'en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ar', 'ru',
  ].includes(candidate)) {
    return candidate as OutputLanguage
  }
  return fallback
}

function outputLanguageLabel(value: OutputLanguage, isZh: boolean): string {
  switch (value) {
    case 'none':
      return isZh ? '纯视觉' : 'Visual Only'
    case 'zh':
      return isZh ? '简体中文' : 'Simplified Chinese'
    case 'ja':
      return isZh ? '日语' : 'Japanese'
    case 'ko':
      return isZh ? '韩语' : 'Korean'
    case 'es':
      return isZh ? '西班牙语' : 'Spanish'
    case 'fr':
      return isZh ? '法语' : 'French'
    case 'de':
      return isZh ? '德语' : 'German'
    case 'pt':
      return isZh ? '葡萄牙语' : 'Portuguese'
    case 'ar':
      return isZh ? '阿拉伯语' : 'Arabic'
    case 'ru':
      return isZh ? '俄语' : 'Russian'
    default:
      return isZh ? '英文' : 'English'
  }
}

function sharedCopyRoleLabel(value: BlueprintCopyRole, isZh: boolean): string {
  switch (value) {
    case 'headline+support':
      return isZh ? '标题 + 辅助短句' : 'Headline + Support'
    case 'headline':
      return isZh ? '短标题' : 'Headline'
    case 'label':
      return isZh ? '标签 / 注释' : 'Label / Callout'
    default:
      return isZh ? '纯视觉' : 'Visual Only'
  }
}

function inferPlanType(plan: BlueprintImagePlan): NonNullable<BlueprintImagePlan['type']> {
  const text = `${plan.type ?? ''} ${plan.title} ${plan.description} ${plan.design_content}`.toLowerCase()
  if (/3d|ghost/.test(text)) return '3d'
  if (/人台|mannequin/.test(text)) return 'mannequin'
  if (/细节|特写|macro|detail/.test(text)) return 'detail'
  if (/卖点|selling point/.test(text)) return 'selling_point'
  return 'refined'
}

function normalizePlan(plan: BlueprintImagePlan): BlueprintImagePlan {
  return {
    ...plan,
    type: inferPlanType(plan),
  }
}

function defaultCopyRole(planType: string, visualOnly: boolean): BlueprintCopyRole {
  if (visualOnly) return 'none'
  if (planType === 'detail') return 'label'
  if (planType === 'selling_point') return 'headline+support'
  if (planType === '3d' || planType === 'mannequin') return 'headline+support'
  return 'headline'
}

function defaultAdaptationSummary(planType: string, isZh: boolean, visualOnly: boolean): string {
  if (visualOnly) {
    return isZh
      ? '纯视觉优先，不添加任何新增画面文字，只保留商品主体、材质、结构和光影表达。'
      : 'Visual-only priority. Do not add any new in-image text; keep the focus on the product, material, structure, and lighting.'
  }

  switch (planType) {
    case 'detail':
      return isZh
        ? '使用短标签或工艺注释型文案，靠近细节焦点并保留充足留白，文字不能遮挡材质与车线。'
        : 'Use short labels or craft-callout copy near the detail focal point with enough whitespace, without covering the material or stitching.'
    case 'selling_point':
      return isZh
        ? '使用主标题加卖点短句的层级结构，把文字放在安全留白区内，形成最强卖点聚焦但不遮挡主体。'
        : 'Use a headline plus support-copy hierarchy in a safe whitespace zone to create the strongest selling-point emphasis without covering the product.'
    case '3d':
      return isZh
        ? '以短标题加辅助短句为主，文字层级弱于服装主体，布局需配合立体轮廓与背景纵深。'
        : 'Use a short headline with support text. Keep the text hierarchy weaker than the garment itself and align it with the volumetric silhouette and depth.'
    case 'mannequin':
      return isZh
        ? '允许短标题和辅助短句，文字应服务于版型和穿着感展示，不抢主体视觉重心。'
        : 'Allow a short headline and support copy, but keep the text subordinate to the fit and silhouette presentation.'
    default:
      return isZh
        ? '优先使用短标题或小标签，文字放在安全留白区，不影响商品识别和白底展示效率。'
        : 'Prefer a short headline or badge-style label inside a safe whitespace zone without hurting product recognition or clean showcase efficiency.'
  }
}

function fallbackSharedCopy(mode: BlueprintCopyMode, requirements: string, isZh: boolean): string {
  if (mode === 'visual-only') return ''
  if (requirements.trim()) return requirements.trim()
  return isZh
    ? '高质感面料，清晰版型，细节经得起近看'
    : 'Premium texture, sharp silhouette, and details that hold up close'
}

function normalizeCopyAnalysis(
  rawValue: unknown,
  plans: BlueprintImagePlan[],
  requirements: string,
  outputLanguage: OutputLanguage,
  isZh: boolean,
): BlueprintCopyAnalysis {
  const raw = asRecord(rawValue)
  const fallbackMode: BlueprintCopyMode = outputLanguage === 'none'
    ? 'visual-only'
    : requirements.trim().length > 0
      ? 'user-brief'
      : 'product-inferred'
  const rawMode = asTrimmedString(raw?.mode)
  const mode: BlueprintCopyMode = rawMode === 'user-brief' || rawMode === 'product-inferred' || rawMode === 'visual-only'
    ? rawMode
    : fallbackMode
  const visualOnly = mode === 'visual-only'
  const fallbackResolvedLanguage = visualOnly ? 'none' : outputLanguage
  const resolvedOutputLanguage = normalizeOutputLanguage(
    raw?.resolved_output_language ?? raw?.resolvedOutputLanguage,
    fallbackResolvedLanguage,
  )
  const rawAdaptations = Array.isArray(raw?.per_plan_adaptations ?? raw?.perPlanAdaptations)
    ? (raw?.per_plan_adaptations ?? raw?.perPlanAdaptations) as unknown[]
    : []

  const perPlanAdaptations: BlueprintCopyPlanAdaptation[] = plans.map((plan, index) => {
    const record = asRecord(rawAdaptations[index])
    const planType = asTrimmedString(record?.plan_type ?? record?.planType, plan.type ?? inferPlanType(plan))
    const rawCopyRole = asTrimmedString(record?.copy_role ?? record?.copyRole)
    const copyRole: BlueprintCopyRole = rawCopyRole === 'headline'
      || rawCopyRole === 'headline+support'
      || rawCopyRole === 'label'
      || rawCopyRole === 'none'
      ? rawCopyRole
      : defaultCopyRole(planType, visualOnly)

    return {
      plan_index: Number.isFinite(Number(record?.plan_index ?? record?.planIndex))
        ? Math.max(0, Math.round(Number(record?.plan_index ?? record?.planIndex)))
        : index,
      plan_type: planType,
      copy_role: copyRole,
      adaptation_summary: asTrimmedString(
        record?.adaptation_summary ?? record?.adaptationSummary,
        defaultAdaptationSummary(planType, isZh, visualOnly),
      ),
    }
  })

  return {
    mode,
    source_brief: asTrimmedString(raw?.source_brief ?? raw?.sourceBrief, requirements.trim()),
    brief_summary: asTrimmedString(
      raw?.brief_summary ?? raw?.briefSummary,
      requirements.trim()
        ? requirements.trim()
        : (isZh ? '未输入组图文字，系统将根据产品图自动补全文案。' : 'No brief provided. The system will infer shared copy from the product images.'),
    ),
    product_summary: asTrimmedString(
      raw?.product_summary ?? raw?.productSummary,
      isZh
        ? '已锁定同一件服装的颜色、材质、轮廓与关键结构，用于整批图片保持一致。'
        : 'The same garment identity is locked across the full set, including color, material, silhouette, and key construction details.',
    ),
    resolved_output_language: resolvedOutputLanguage,
    shared_copy: visualOnly
      ? ''
      : asTrimmedString(raw?.shared_copy ?? raw?.sharedCopy, fallbackSharedCopy(mode, requirements, isZh)),
    can_clear_to_visual_only: true,
    per_plan_adaptations: perPlanAdaptations,
  }
}

function buildDefaultPlans(typeState: BasicPhotoTypeState): BlueprintImagePlan[] {
  const plans: BlueprintImagePlan[] = []
  if (typeState.whiteBgRetouched.front) {
    plans.push({
      title: '白底精修图（正面）',
      description: '展示服装正面版型与颜色细节',
      design_content: '白底平铺或模特正面展示，重点表现服装轮廓、主色和做工细节。',
      type: 'refined',
    })
  }
  if (typeState.whiteBgRetouched.back) {
    plans.push({
      title: '白底精修图（背面）',
      description: '展示服装背面版型与工艺细节',
      design_content: '白底背面展示，清晰呈现后背剪裁与结构。',
      type: 'refined',
    })
  }
  if (typeState.threeDEffect.enabled) {
    plans.push(
      {
        title: '3D立体效果图（正面）',
        description: '模特正面穿着展示，突出服装正面版型与立体感',
        design_content: '模特正面站姿穿着展示，通过光影表现服装正面体积感与版型轮廓，保留材质纹理，统一背景与风格。',
        type: '3d',
      },
      {
        title: '3D立体效果图（背面）',
        description: '模特背面穿着展示，呈现背部剪裁与结构',
        design_content: '模特背面站姿穿着展示，清晰呈现后背剪裁、缝线与结构细节，保留材质纹理，与正面图保持统一模特、风格与背景。',
        type: '3d',
      },
      {
        title: '3D立体效果图（侧面）',
        description: '模特侧面穿着展示，展现服装侧面层次',
        design_content: '模特侧面站姿穿着展示，通过侧面角度表现服装层次感与廓形，保留材质纹理，与正面图保持统一模特、风格与背景。',
        type: '3d',
      }
    )
  }
  if (typeState.mannequin.enabled) {
    plans.push({
      title: '人台展示图',
      description: '人台/模特架展示，严格保留衣服原始材质与外观',
      design_content: '人台或模特架展示服装，严格保留衣服的原始材质和外观：颜色、款式、剪裁、纹理、面料质感不做任何改变。模拟摄影棚或自然光下的真实光影效果，包括高光、阴影和面料反光。本质是换场景/换人台展示，不是重新设计衣服。',
      type: 'mannequin',
    })
  }
  for (let i = 0; i < typeState.detailCloseup.count; i += 1) {
    plans.push({
      title: `细节特写图 ${i + 1}`,
      description: '放大展示面料与工艺细节',
      design_content: '聚焦领口、袖口、印花或走线，保证细节清晰度和质感。',
      type: 'detail',
    })
  }
  for (let i = 0; i < typeState.sellingPoint.count; i += 1) {
    plans.push({
      title: `卖点展示图 ${i + 1}`,
      description: '突出产品核心卖点',
      design_content: '围绕核心卖点构图，强化视觉层级与记忆点。',
      type: 'selling_point',
    })
  }
  if (plans.length === 0) {
    plans.push({
      title: '图片方案 1',
      description: '请编辑该图片方案的标题和描述',
      design_content: '请基于产品特征补充该图片方案内容。',
      type: 'refined',
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
      type: 'refined',
    })
  }
  if (!hasBack) {
    // Insert after front plan
    const frontIdx = result.findIndex((p) => planMatchesOrientation(p, 'front'))
    result.splice(frontIdx + 1, 0, {
      title: '白底精修图（背面）',
      description: '展示服装背面版型与工艺细节',
      design_content: '白底背面展示，清晰呈现后背剪裁与结构。',
      type: 'refined',
    })
  }
  return result
}

function normalizeBlueprint(
  resultData: unknown,
  typeState: BasicPhotoTypeState,
  requirements: string,
  outputLanguage: OutputLanguage,
  isZh: boolean,
): AnalysisBlueprint {
  if (isAnalysisBlueprint(resultData)) {
    let plans = resultData.images.length > 0 ? resultData.images.map(normalizePlan) : buildDefaultPlans(typeState)
    plans = enforceWhiteBgPlans(plans, typeState)
    const resultRecord = resultData as unknown as Record<string, unknown>
    return {
      ...resultData,
      images: plans,
      copy_analysis: normalizeCopyAnalysis(
        resultRecord.copy_analysis ?? resultRecord.copyAnalysis,
        plans,
        requirements,
        outputLanguage,
        isZh,
      ),
    }
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
    copy_analysis: normalizeCopyAnalysis(null, fallbackPlans, requirements, outputLanguage, isZh),
  }
}

function stripCopyInstructions(text: string, isZh: boolean): string {
  const filteredLines = text
    .split('\n')
    .filter((line) => {
      const normalized = line.trim()
      if (!normalized) return true
      return !/文案内容|主标题|副标题|描述文案|文字区域|字体体系|文案语言|Typography|Text Content|Main Title|Subtitle|Description Text|Text Area|Copy Language|Heading Font|Body Font/i.test(normalized)
    })
    .join('\n')
    .trim()

  const visualRule = isZh
    ? '纯视觉规则：禁止新增文字叠加，保持纯视觉构图，商品主体、材质和光影优先。'
    : 'Visual-only rule: no added text overlay. Keep the composition purely visual, with product, material, and lighting as the priority.'

  return filteredLines.length > 0 ? `${filteredLines}\n\n${visualRule}` : visualRule
}

function applySharedCopyInstructions(
  text: string,
  adaptation: BlueprintCopyPlanAdaptation,
  sharedCopy: string,
  outputLanguage: OutputLanguage,
  isZh: boolean,
): string {
  const stripped = stripCopyInstructions(text, isZh)
  const label = isZh ? '共享文案策略' : 'Shared Copy Strategy'
  const copyRoleLabel = adaptation.copy_role === 'headline+support'
    ? (isZh ? '标题 + 辅助短句' : 'Headline + Support')
    : adaptation.copy_role === 'headline'
      ? (isZh ? '短标题' : 'Headline')
      : adaptation.copy_role === 'label'
        ? (isZh ? '标签 / 注释' : 'Label / Callout')
        : (isZh ? '纯视觉' : 'Visual Only')
  const languageLabel = outputLanguageLabel(outputLanguage, isZh)

  return `${stripped}\n\n${label}：\n- ${isZh ? '共享主文案' : 'Shared copy'}：${sharedCopy}\n- ${isZh ? '文案角色' : 'Copy role'}：${copyRoleLabel}\n- ${isZh ? '输出语言' : 'Output language'}：${languageLabel}\n- ${isZh ? '适配说明' : 'Adaptation'}：${adaptation.adaptation_summary}`
}

function deriveCopyAnalysisForGeneration(
  copyAnalysis: BlueprintCopyAnalysis | undefined,
  imagePlans: BlueprintImagePlan[],
  sharedCopy: string,
  language: OutputLanguage,
  isZh: boolean,
): BlueprintCopyAnalysis | undefined {
  if (!copyAnalysis) return undefined

  const visualOnly = language === 'none' || sharedCopy.trim().length === 0
  return {
    ...copyAnalysis,
    mode: visualOnly
      ? 'visual-only'
      : copyAnalysis.mode === 'visual-only'
        ? (copyAnalysis.source_brief.trim().length > 0 ? 'user-brief' : 'product-inferred')
        : copyAnalysis.mode,
    resolved_output_language: visualOnly ? 'none' : language,
    shared_copy: visualOnly ? '' : sharedCopy.trim(),
    per_plan_adaptations: imagePlans.map((plan, index) => {
      const existing = copyAnalysis.per_plan_adaptations[index]
      const planType = plan.type ?? inferPlanType(plan)
      return {
        plan_index: index,
        plan_type: existing?.plan_type ?? planType,
        copy_role: visualOnly ? 'none' : (existing?.copy_role ?? defaultCopyRole(planType, false)),
        adaptation_summary: visualOnly
          ? defaultAdaptationSummary(planType, isZh, true)
          : (existing?.adaptation_summary ?? defaultAdaptationSummary(planType, isZh, false)),
      }
    }),
  }
}

function buildBlueprintForGeneration(params: {
  blueprint: AnalysisBlueprint
  imagePlans: BlueprintImagePlan[]
  designSpecs: string
  sharedCopy: string
  language: OutputLanguage
  isZh: boolean
}): { blueprint: AnalysisBlueprint; designSpecs: string; outputLanguage: OutputLanguage; visualOnly: boolean } {
  const { blueprint, imagePlans, designSpecs, sharedCopy, language, isZh } = params
  const visualOnly = language === 'none' || sharedCopy.trim().length === 0
  const derivedCopyAnalysis = deriveCopyAnalysisForGeneration(
    blueprint.copy_analysis,
    imagePlans,
    sharedCopy,
    language,
    isZh,
  )

  const derivedPlans = imagePlans.map((plan, index) => {
    const normalizedPlan = normalizePlan(plan)
    const adaptation = derivedCopyAnalysis?.per_plan_adaptations[index]
    const designContent = visualOnly || !adaptation
      ? stripCopyInstructions(normalizedPlan.design_content, isZh)
      : applySharedCopyInstructions(
          normalizedPlan.design_content,
          adaptation,
          sharedCopy.trim(),
          language,
          isZh,
        )

    return {
      ...normalizedPlan,
      design_content: designContent,
    }
  })

  const derivedDesignSpecs = visualOnly
    ? stripCopyInstructions(designSpecs, isZh)
    : applySharedCopyInstructions(
        designSpecs,
        {
          plan_index: -1,
          plan_type: 'set',
          copy_role: 'headline+support',
          adaptation_summary: isZh
            ? '整批图片共用同一份主文案，每张图仅按构图和图型调整文字层级、位置与留白。'
            : 'The full image set shares one master copy block, while each image only adapts hierarchy, placement, and whitespace by shot type.',
        },
        sharedCopy.trim(),
        language,
        isZh,
      )

  return {
    visualOnly,
    outputLanguage: visualOnly ? 'none' : language,
    designSpecs: derivedDesignSpecs,
    blueprint: {
      ...blueprint,
      images: derivedPlans,
      design_specs: derivedDesignSpecs,
      ...(derivedCopyAnalysis ? { copy_analysis: derivedCopyAnalysis } : {}),
    },
  }
}

function appendSharedCopyGuardrail(params: {
  prompt: string
  sharedCopy: string
  adaptation: BlueprintCopyPlanAdaptation | undefined
  outputLanguage: OutputLanguage
  isZh: boolean
}): string {
  const { prompt, sharedCopy, adaptation, outputLanguage, isZh } = params
  const normalizedCopy = sharedCopy.trim()
  if (!normalizedCopy) return prompt

  const copyRole = sharedCopyRoleLabel(adaptation?.copy_role ?? 'headline', isZh)
  const adaptationSummary = adaptation?.adaptation_summary?.trim() || defaultAdaptationSummary(
    adaptation?.plan_type ?? 'refined',
    isZh,
    false,
  )
  const languageRule = isZh
    ? `所有新增可见文案必须使用${outputLanguageLabel(outputLanguage, true)}，共享主文案必须逐字渲染，不得改写、删减或替换。`
    : `All added visible copy must use ${outputLanguageLabel(outputLanguage, false)} only, and the shared master copy must be rendered verbatim without paraphrase, omission, or substitution.`
  const lines = isZh
    ? [
        '共享主文案硬约束：',
        `- 必须逐字渲染这段共享主文案：${normalizedCopy}`,
        `- 文案角色：${copyRole}`,
        `- 本图适配要求：${adaptationSummary}`,
        `- 文字必须放在安全留白区，不能遮挡商品主体，不能影响商品识别。`,
        `- ${languageRule}`,
      ]
    : [
        'Shared Master Copy Guardrail:',
        `- Render this exact shared master copy verbatim: ${normalizedCopy}`,
        `- Copy role: ${copyRole}`,
        `- Per-image adaptation: ${adaptationSummary}`,
        '- Place the text in safe whitespace only, and do not block or distort the product.',
        `- ${languageRule}`,
      ]

  return `${prompt.trim()}\n\n${lines.join('\n')}`
}

function CopyAnalysisCard({
  sharedCopy,
  onSharedCopyChange,
  t,
}: {
  sharedCopy: string
  onSharedCopyChange: (value: string) => void
  t: (key: string, values?: Record<string, string | number>) => string
}) {
  return (
    <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-[#1a1d24]">{t('analysisAndCopy')}</h3>
          <p className="text-[13px] text-[#7d818d]">
            {t('analysisAndCopyDesc')}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-[24px] border border-[#e0e3e8] bg-[#fbfbfc] p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-[#3b3f49]">{t('sharedMasterCopy')}</p>
          <span className="text-[12px] text-[#7d818d]">
            {t('clearForVisualOnly')}
          </span>
        </div>
        <Textarea
          value={sharedCopy}
          onChange={(e) => onSharedCopyChange(e.target.value)}
          rows={5}
          className="min-h-[152px] resize-none rounded-2xl border-[#d0d4dc] bg-white text-[14px] leading-6"
          placeholder={t('sharedCopyPlaceholder')}
        />
      </div>
    </div>
  )
}

interface BasicPhotoSetTabProps {
  traceId: string
}

export function BasicPhotoSetTab({ traceId }: BasicPhotoSetTabProps) {
  const locale = useLocale()
  const isZh = locale.startsWith('zh')
  const t = useTranslations('studio.clothingStudio')
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
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const { promptProfile } = usePromptProfile(model)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4')
  const [resolution, setResolution] = useState<ImageSize>('1K')

  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const {
    assets: results,
    activeBatchId,
    appendAssets: appendResults,
    clearAssets: clearResults,
  } = useResultAssetSession('clothing-basic-photo')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analysisBlueprint, setAnalysisBlueprint] = useState<AnalysisBlueprint | null>(null)
  const [editableDesignSpecs, setEditableDesignSpecs] = useState('')
  const [editableImagePlans, setEditableImagePlans] = useState<BlueprintImagePlan[]>([])
  const [editableSharedCopy, setEditableSharedCopy] = useState('')
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])

  // Session persistence removed: text persisted but images didn't on refresh.

  const abortRef = useRef<AbortController | null>(null)

  const isProcessing = phase === 'analyzing' || phase === 'generating'
  const canStart = productImages.length > 0 && countSelectedTypes(typeState) > 0
  const backendLocale = language === 'zh' ? 'zh-CN' : language === 'en' ? 'en' : (isZh ? 'zh-CN' : 'en')
  const currentCopyAnalysis = analysisBlueprint?.copy_analysis

  const set = useCallback((id: string, patch: Partial<ProgressStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!canStart) return
    const abort = new AbortController()
    abortRef.current = abort
    const batchId = uid()
    const batchTimestamp = Date.now()

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: t('stepLabelUpload'), status: 'pending' },
      { id: 'analyze', label: t('stepLabelAnalyzeProduct'), status: 'pending' },
      { id: 'preview', label: t('stepLabelDesignPlan'), status: 'pending' },
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
        promptProfile,
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

      const blueprint = normalizeBlueprint(
        analysisJob.result_data,
        typeState,
        requirements,
        language as OutputLanguage,
        isZh,
      )
      setAnalysisBlueprint(blueprint)
      setEditableDesignSpecs(blueprint.design_specs)
      setEditableImagePlans(blueprint.images)
      setEditableSharedCopy(blueprint.copy_analysis?.shared_copy ?? '')

      set('preview', { status: 'done' })
      setProgress(100)
      setPhase('preview')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(friendlyError((err as Error).message ?? t('analysisFailed'), true))
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase('input')
    }
  }, [canStart, productImages, typeState, requirements, backendLocale, language, traceId, set, promptProfile, isZh, t])

  const handleGenerate = useCallback(async () => {
    if (!analysisBlueprint || editableImagePlans.length === 0) return
    const abort = new AbortController()
    abortRef.current = abort
    const batchId = uid()
    const batchTimestamp = Date.now()

    const initialSteps: ProgressStep[] = [
      { id: 'upload', label: t('stepLabelUpload'), status: 'done' },
      { id: 'analyze', label: t('stepLabelAnalyzeProduct'), status: 'done' },
      { id: 'preview', label: t('stepLabelDesignPlan'), status: 'done' },
      { id: 'prompts', label: t('stepLabelGeneratePrompts'), status: 'pending' },
      { id: 'generate', label: t('stepLabelGenerateImages'), status: 'pending' },
      { id: 'done', label: t('stepLabelDone'), status: 'pending' },
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

      const generationBlueprint = buildBlueprintForGeneration({
        blueprint: analysisBlueprint,
        imagePlans: editableImagePlans,
        designSpecs: editableDesignSpecs,
        sharedCopy: editableSharedCopy,
        language: language as OutputLanguage,
        isZh,
      })

      set('prompts', { status: 'active' })
      let promptText = ''
      const stream = await generatePromptsV2Stream(
        {
          analysisJson: generationBlueprint.blueprint,
          design_specs: generationBlueprint.designSpecs,
          promptProfile,
          imageCount: editableImagePlans.length,
          targetLanguage: backendLocale,
          outputLanguage: generationBlueprint.outputLanguage,
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
      const generationCopyAnalysis = generationBlueprint.blueprint.copy_analysis
      const prompts = Array.from({ length: editableImagePlans.length }, (_, i) => {
        const gp = parsedPrompts[i] ?? parsedPrompts[i % Math.max(parsedPrompts.length, 1)]
        // Use || so empty prompt strings also fall back to design_content
        const basePrompt = gp?.prompt || editableImagePlans[i].design_content
        return appendSharedCopyGuardrail({
          prompt: basePrompt,
          sharedCopy: editableSharedCopy,
          adaptation: generationCopyAnalysis?.per_plan_adaptations[i],
          outputLanguage: generationBlueprint.outputLanguage,
          isZh,
        })
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
          promptProfile,
          model,
          aspectRatio,
          imageSize: resolution,
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
          ...createResultAsset({
            url: j.result_url!,
            label: editableImagePlans[i]?.title ?? t('imageIndexLabel', { index: i + 1 }),
            batchId,
            batchTimestamp,
            ...extractResultAssetMetadata(j.result_data),
            originModule: 'clothing-basic-photo',
          }),
        }))
      appendResults(newResults, {
        activeBatchId: batchId,
        activeBatchTimestamp: batchTimestamp,
      })
      setPhase('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(friendlyError((err as Error).message ?? t('generationFailed'), true))
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase('preview')
    } finally {
      refreshCredits()
    }
  }, [
    analysisBlueprint,
    appendResults,
    editableImagePlans,
    editableDesignSpecs,
    editableSharedCopy,
    uploadedUrls,
    productImages,
    model,
    aspectRatio,
    resolution,
    backendLocale,
    language,
    isZh,
    promptProfile,
    traceId,
    set,
    t,
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
    setEditableSharedCopy('')
    setUploadedUrls([])
  }, [clearResults])

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
              <h3 className="text-[15px] font-semibold text-[#1a1d24]">{t('productImageTitle')}</h3>
              <p className="text-[13px] text-[#7d818d]">{t('productImageDesc')}</p>
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
            label={t('dragOrClickUpload')}
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
          disabled={isProcessing}
        />

        <GenerationTypeSelector
          typeState={typeState}
          onTypeStateChange={setTypeState}
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
            {t('analyzeProduct')}
          </Button>
        )}
        {phase === 'analyzing' && (
          <Button variant="outline" onClick={handleCancel} className="h-14 w-full rounded-2xl border-[#cbced6] bg-white text-[#202227]">
            {t('cancelAnalysis')}
          </Button>
        )}
        {phase === 'preview' && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleReset} className="h-14 flex-1 rounded-2xl border-[#cbced6] bg-white text-[#202227]">
              {t('restart')}
            </Button>
            <Button onClick={handleGenerate} className="h-14 flex-1 rounded-2xl bg-[#191b22] text-base font-semibold text-white hover:bg-[#111318]">
              <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
              {t('generateImages')}
            </Button>
          </div>
        )}
        {phase === 'generating' && (
          <Button variant="outline" onClick={handleCancel} className="h-14 w-full rounded-2xl border-[#cbced6] bg-white text-[#202227]">
            {t('cancelGeneration')}
          </Button>
        )}
        {phase === 'complete' && (
          <Button variant="outline" onClick={handleReset} className="h-14 w-full rounded-2xl border-[#cbced6] bg-white text-[#202227]">
            {t('regenerate')}
          </Button>
        )}
      </div>
    </>
  )

  const persistedHistoryGallery = results.length > 0 ? (
    <ResultGallery
      images={results}
      activeBatchId={activeBatchId}
      aspectRatio={aspectRatio}
      historyInitiallyExpanded={false}
      onClear={clearResults}
      editorSessionKey="clothing-basic-photo"
      originModule="clothing-basic-photo"
    />
  ) : null

  const rightPanel = (() => {
    if (phase === 'input') {
      if (persistedHistoryGallery) return <div className="space-y-4">{persistedHistoryGallery}</div>
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
            {t('emptyStateBasicLine1')}
            <br />
            {t('emptyStateBasicLine2')}
          </p>
        </div>
      )
    }

    if (phase === 'preview') {
      return (
        <div className="space-y-4">
          {currentCopyAnalysis && (
            <CopyAnalysisCard
              sharedCopy={editableSharedCopy}
              onSharedCopyChange={setEditableSharedCopy}
              t={t}
            />
          )}
          <DesignBlueprint
            designSpecs={editableDesignSpecs}
            onDesignSpecsChange={setEditableDesignSpecs}
            imagePlans={editableImagePlans}
            aspectRatio={aspectRatio}
            showDesignSpecs={false}
            onImagePlanChange={(i, plan) => {
              setEditableImagePlans((prev) => prev.map((p, idx) => (idx === i ? plan : p)))
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
      const subtitle =
        phase === 'generating'
          ? t('generatingSubtitleBasic')
          : t('analyzingSubtitleBasic')

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
