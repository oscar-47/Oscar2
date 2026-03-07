'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
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
import { CorePageShell } from '@/components/studio/CorePageShell'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { uploadFiles } from '@/lib/api/upload'
import {
  analyzeProductV2,
  generatePromptsV2Stream,
  generateImage,
  processGenerationJob,
} from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import { createResultAsset, extractResultAssetMetadata } from '@/lib/utils/result-assets'
import { ArrowLeft, ArrowRight, Loader2, ImageIcon, AlertTriangle, RefreshCw, Sparkles, Plus, X } from 'lucide-react'
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
  GenesisAnalysisResult,
  GenesisStyleDirectionKey,
} from '@/types'
import {
  AVAILABLE_MODELS,
  getAvailableModels,
  DEFAULT_MODEL,
  getGenerationCreditCost,
  getSupportedImageSizes,
  isValidModel,
  normalizeGenerationModel,
  sanitizeImageSizeForModel,
} from '@/types'
import { useUserEmail } from '@/lib/hooks/useUserEmail'
import { friendlyError } from '@/lib/utils'

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
const GENESIS_DEFAULT_REQUIREMENTS_ZH = '我的商品是____，主要卖点是____'
const GENESIS_DEFAULT_REQUIREMENTS_EN = 'My product is ____, key selling point is ____'
const GENESIS_STYLE_KEYS: GenesisStyleDirectionKey[] = ['sceneStyle', 'lighting', 'composition']

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

// ─── Concurrency Pool ────────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return []
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, tasks.length))
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(
    Array.from({ length: effectiveConcurrency }, () => worker())
  )
  return results
}

const BATCH_CONCURRENCY = 4

// ─── Types ──────────────────────────────────────────────────────────────────

interface RetryContext {
  prompts: Array<{
    prompt: string
    negativePrompt: string
    title: string
    description: string
  }>
  trace_id: string
}

interface ImageSlot {
  jobId: string
  status: 'pending' | 'done' | 'failed'
  result?: ResultImage
  error?: string
}

type GenesisStyleSelections = Partial<Record<GenesisStyleDirectionKey, string>>
type GenesisCustomStyleTags = Partial<Record<GenesisStyleDirectionKey, string>>

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

function computeCost(model: GenerationModel, _imageSize: ImageSize, imageCount: number): number {
  const base = getGenerationCreditCost(model, _imageSize)
  return base * imageCount
}

function extractResultFromJob(job: GenerationJob, index: number, batchId?: string, batchTimestamp?: number): ResultImage | null {
  const resultData = job.result_data as Record<string, unknown> | null
  const url = job.result_url
    ?? (typeof resultData?.b64_json === 'string' ? `data:image/png;base64,${resultData.b64_json}` : null)
  return url ? createResultAsset({
    url,
    label: `Image ${index + 1}`,
    batchId,
    batchTimestamp,
    ...extractResultAssetMetadata(job.result_data),
    originModule: 'studio-genesis',
  }) : null
}

function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function clipDynamicTag(value: string, isZh: boolean): string {
  return Array.from(value.trim()).slice(0, isZh ? 5 : 24).join('')
}

function extractGenesisBriefHints(requirements: string, isZh: boolean): { product: string; sellingPoints: string[] } {
  const cleaned = requirements.trim()
  if (!cleaned) return { product: '', sellingPoints: [] }

  if (isZh) {
    const normalized = cleaned.replace(/\s+/g, ' ').replace(/[：:]/g, '是')
    const productMatch = normalized.match(/(?:我的商品|商品|产品)\s*是\s*([^，,。；;\n]+)/)
    const sellingMatch = normalized.match(/(?:主要卖点|卖点)\s*是\s*([^。;\n]+)/)

    return {
      product: (productMatch?.[1] ?? '').trim(),
      sellingPoints: (sellingMatch?.[1] ?? '')
        .split(/[，,、/|；;\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4),
    }
  }

  const normalized = cleaned.replace(/\s+/g, ' ')
  const productMatch = normalized.match(/(?:my product is|product is)\s+([^,.;\n]+)/i)
  const sellingMatch = normalized.match(/(?:key selling points? are|key selling point is|selling points? are|selling point is)\s+([^.;\n]+)/i)

  return {
    product: (productMatch?.[1] ?? '').trim(),
    sellingPoints: (sellingMatch?.[1] ?? '')
      .split(/[,/|;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4),
  }
}

function buildGenesisCopyFallback(requirements: string, outputLanguage: OutputLanguage, isZh: boolean): string {
  if (outputLanguage === 'none') return ''

  const { product, sellingPoints } = extractGenesisBriefHints(requirements, isZh)
  if (isZh) {
    if (product && sellingPoints.length > 0) return `${product}，${sellingPoints.join('，')}`
    if (product) return `${product}，突出核心卖点`
    if (sellingPoints.length > 0) return `主打${sellingPoints.join('，')}`
    return requirements.trim()
  }

  if (product && sellingPoints.length > 0) return `${product}: ${sellingPoints.join(', ')}`
  if (product) return `${product} with standout selling points`
  if (sellingPoints.length > 0) return `Highlight ${sellingPoints.join(', ')}`
  return requirements.trim()
}

function copyPlanMatchesBrief(copyPlan: string, requirements: string, isZh: boolean): boolean {
  const { product, sellingPoints } = extractGenesisBriefHints(requirements, isZh)
  const keywords = [product, ...sellingPoints]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (keywords.length === 0) return true

  const normalizedCopy = copyPlan.replace(/\s+/g, '').toLowerCase()
  return keywords.some((keyword) => normalizedCopy.includes(keyword.replace(/\s+/g, '').toLowerCase()))
}

function getGenesisDefaultRequirements(isZh: boolean): string {
  return isZh ? GENESIS_DEFAULT_REQUIREMENTS_ZH : GENESIS_DEFAULT_REQUIREMENTS_EN
}

function getGenesisDimensionLabel(key: GenesisStyleDirectionKey, isZh: boolean): string {
  if (key === 'sceneStyle') return isZh ? '场景风格' : 'Scene Style'
  if (key === 'lighting') return isZh ? '光影氛围' : 'Lighting'
  return isZh ? '构图视角' : 'Composition'
}

function getGenesisFallbackOptions(key: GenesisStyleDirectionKey, isZh: boolean): string[] {
  if (isZh) {
    if (key === 'sceneStyle') return ['极简', '生活感', '高级感']
    if (key === 'lighting') return ['柔光', '自然光', '层次光']
    return ['正视角', '微俯拍', '特写']
  }
  if (key === 'sceneStyle') return ['minimal', 'lifestyle', 'premium']
  if (key === 'lighting') return ['soft light', 'daylight', 'contrast']
  return ['front', 'overhead', 'close-up']
}

function normalizeGenesisAnalysisResult(
  resultData: unknown,
  isZh: boolean,
  requirements: string,
  outputLanguage: OutputLanguage,
): GenesisAnalysisResult {
  const fallbackSummary = requirements.trim()
    || (isZh
      ? '根据产品图分析产品特征，并围绕核心卖点生成主图。'
      : 'Analyze the product images and generate hero images around the key selling points.')

  let parsed: Record<string, unknown> | null = null
  if (resultData && typeof resultData === 'object') {
    parsed = resultData as Record<string, unknown>
  } else if (typeof resultData === 'string') {
    try {
      const json = JSON.parse(resultData)
      if (json && typeof json === 'object') parsed = json as Record<string, unknown>
    } catch {
      parsed = null
    }
  }

  const rawDirections = parsed?.style_directions ?? parsed?.styleDirections ?? {}
  const styleDirections = GENESIS_STYLE_KEYS.map((key) => {
    const rawRecord = Array.isArray(rawDirections)
      ? rawDirections.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).key === key) as Record<string, unknown> | undefined
      : rawDirections && typeof rawDirections === 'object'
        ? (rawDirections as Record<string, unknown>)[key] as Record<string, unknown> | undefined
        : undefined
    const options = Array.from(new Set(
      (Array.isArray(rawRecord?.options) ? rawRecord.options : [])
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => clipDynamicTag(item, isZh))
        .filter(Boolean)
    )).slice(0, 3)
    const finalOptions = options.length > 0 ? options : getGenesisFallbackOptions(key, isZh)
    const recommendedRaw = typeof rawRecord?.recommended === 'string'
      ? clipDynamicTag(rawRecord.recommended, isZh)
      : ''
    return {
      key,
      options: finalOptions,
      recommended: finalOptions.includes(recommendedRaw) ? recommendedRaw : (finalOptions[0] ?? null),
    }
  })

  const rawCopyPlan = typeof parsed?.copy_plan === 'string' && parsed.copy_plan.trim()
    ? parsed.copy_plan
    : typeof parsed?.copyPlan === 'string' && parsed.copyPlan.trim()
      ? parsed.copyPlan
      : ''
  const fallbackCopyPlan = buildGenesisCopyFallback(requirements, outputLanguage, isZh)

  const rawIdentity = (parsed?.product_visual_identity ?? parsed?.productVisualIdentity) as Record<string, unknown> | undefined
  let productVisualIdentity: GenesisAnalysisResult['product_visual_identity']
  if (rawIdentity && typeof rawIdentity === 'object') {
    const sc = rawIdentity.secondary_colors ?? rawIdentity.secondaryColors
    const kf = rawIdentity.key_features ?? rawIdentity.keyFeatures
    productVisualIdentity = {
      primary_color: String(rawIdentity.primary_color ?? rawIdentity.primaryColor ?? ''),
      secondary_colors: Array.isArray(sc) ? sc.map(String) : [],
      material: String(rawIdentity.material ?? ''),
      key_features: Array.isArray(kf) ? kf.map(String) : [],
    }
  }

  return {
    product_summary: typeof parsed?.product_summary === 'string' && parsed.product_summary.trim()
      ? parsed.product_summary
      : typeof parsed?.productSummary === 'string' && parsed.productSummary.trim()
        ? parsed.productSummary
        : fallbackSummary,
    product_visual_identity: productVisualIdentity,
    style_directions: styleDirections,
    copy_plan: outputLanguage === 'none'
      ? ''
      : rawCopyPlan && copyPlanMatchesBrief(rawCopyPlan, requirements, isZh)
        ? rawCopyPlan
        : fallbackCopyPlan,
    _ai_meta: (parsed?._ai_meta && typeof parsed._ai_meta === 'object'
      ? parsed._ai_meta
      : { model: 'unknown', usage: {}, provider: 'fallback', image_count: 1, target_language: isZh ? 'zh' : 'en' }) as GenesisAnalysisResult['_ai_meta'],
  }
}

function buildImagesSignature(images: UploadedImage[]): string {
  return images
    .map((img) => `${img.file.name}:${img.file.size}:${img.file.lastModified}`)
    .join('|')
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

function asTrimmedString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : fallback
}

function fallbackPlanTitle(index: number, isZh: boolean): string {
  return isZh ? `图片方案 ${index + 1}` : `Image Plan ${index + 1}`
}

function fallbackPlanDescription(isZh: boolean): string {
  return isZh ? '请编辑该图片方案的描述。' : 'Edit this image plan description.'
}

function fallbackPlanDesignContent(isZh: boolean): string {
  return isZh
    ? '请根据产品特征补充画面描述、构图方式和光影方案。'
    : 'Complete this plan with product-focused scene description, composition, and lighting.'
}

function fallbackPromptFromPlan(plan: BlueprintImagePlan, isZh: boolean): string {
  const designContent = plan.design_content.trim()
  if (designContent.length > 0) return designContent
  const title = asTrimmedString(plan.title, isZh ? '产品图方案' : 'Product image plan')
  const description = asTrimmedString(plan.description, isZh ? '突出产品卖点' : 'Highlight product selling points')
  return isZh
    ? `${title}。${description}。保持产品外观一致，商业摄影质感，高清细节。`
    : `${title}. ${description}. Keep product appearance consistent, with commercial photography quality and clear details.`
}

function buildFallbackPrompts(
  plans: BlueprintImagePlan[],
  isZh: boolean,
): GeneratedPrompt[] {
  return plans.map((plan) => ({
    prompt: fallbackPromptFromPlan(plan, isZh),
    title: asTrimmedString(plan.title, ''),
    negative_prompt: '',
    marketing_hook: '',
    priority: 0,
  }))
}

function selectedGenesisStyleLabels(
  analysis: GenesisAnalysisResult,
  selections: GenesisStyleSelections,
): string[] {
  return analysis.style_directions
    .map((group) => selections[group.key] ?? group.recommended ?? group.options[0] ?? '')
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index)
}

function buildGenesisIdentityLockBlock(
  analysis: GenesisAnalysisResult,
  isZh: boolean,
): { designSpecs: string; promptBlock: string } {
  const identity = analysis.product_visual_identity
  const primaryColor = identity?.primary_color?.trim()
  const material = identity?.material?.trim()
  const keyFeatures = (identity?.key_features ?? [])
    .map((item) => item.trim())
    .filter(Boolean)

  const detailLines = [
    primaryColor
      ? (isZh ? `- 主色锚定：${primaryColor}` : `- Color anchor: ${primaryColor}`)
      : (isZh ? '- 主色锚定：严格保持产品图真实主色，不得错色。' : '- Color anchor: keep the true product color from the reference images, no recoloring.'),
    material
      ? (isZh ? `- 材质锚定：${material}` : `- Material anchor: ${material}`)
      : (isZh ? '- 材质锚定：严格保持原始材质，不得替换材质。' : '- Material anchor: preserve the original material, no material swap.'),
    keyFeatures.length > 0
      ? (isZh ? `- 关键特征：${keyFeatures.join('、')}` : `- Key features: ${keyFeatures.join(', ')}`)
      : (isZh ? '- 关键特征：保留产品图中可见的 logo、五金、纹理、车线、轮廓与结构。' : '- Key features: preserve the visible logo, hardware, texture, stitching, silhouette, and structure from the reference images.'),
    isZh
      ? '- 硬约束：必须是同一 SKU，同一商品，不得改色、改材质、改 logo、改五金、改纹理、改版型、改结构。'
      : '- Hard lock: exact same SKU and same product. Do not change color, material, logo, hardware, texture, silhouette, proportions, or structure.',
  ]

  return {
    designSpecs: detailLines.join('\n'),
    promptBlock: isZh
      ? `【商品身份锁定】${detailLines.map((line) => line.replace(/^- /, '')).join('；')}`
      : `Product identity lock: ${detailLines.map((line) => line.replace(/^- /, '')).join('; ')}`,
  }
}

function buildGenesisSharedCopyRule(copyPlan: string, outputLanguage: OutputLanguage, isZh: boolean): string {
  const normalizedCopy = copyPlan.trim()
  if (!normalizedCopy) {
    return isZh
      ? '无新增文字叠加，输出纯视觉主图；不得擅自添加任何宣传文案。'
      : 'No added text overlay. Generate a pure visual hero image and do not invent extra copy.'
  }
  if (outputLanguage === 'none') {
    return isZh
      ? `虽然当前输出语言为纯视觉，但用户手动提供了文案，必须原文使用以下文字，不得翻译，不得改写：${normalizedCopy}`
      : `The user manually provided copy in visual-only mode. Use this exact copy verbatim without translation or paraphrase: ${normalizedCopy}`
  }
  return isZh
    ? `必须在画面中呈现以下同一份共享文案原文，不得改写，不得遗漏，并明确文字位置、层级、留白与可读性，且文字不得遮挡商品主体：${normalizedCopy}`
    : `Render this exact shared copy in the image without paraphrasing or omission. Define text placement, hierarchy, whitespace, readability, and ensure the copy does not block the product: ${normalizedCopy}`
}

function buildGenesisHeroBlueprint(params: {
  genesisAnalysis: GenesisAnalysisResult
  styleSelections: GenesisStyleSelections
  copyPlan: string
  imageCount: number
  isZh: boolean
  outputLanguage: OutputLanguage
}): AnalysisBlueprint {
  const { genesisAnalysis, styleSelections, copyPlan, imageCount, isZh, outputLanguage } = params
  const styleLabels = selectedGenesisStyleLabels(genesisAnalysis, styleSelections)
  const styleSummary = styleLabels.length > 0
    ? (isZh ? `统一风格方向：${styleLabels.join(' / ')}` : `Unified style directions: ${styleLabels.join(' / ')}`)
    : (isZh ? '统一风格方向：延续分析推荐风格。' : 'Unified style directions: follow the recommended analysis styles.')
  const identityLock = buildGenesisIdentityLockBlock(genesisAnalysis, isZh)
  const copyRule = buildGenesisSharedCopyRule(copyPlan, outputLanguage, isZh)
  const normalizedCount = Math.max(1, Math.min(15, Number(imageCount || 1)))

  const images: BlueprintImagePlan[] = Array.from({ length: normalizedCount }, (_, index) => {
    const roleIndex = index + 1
    let title = ''
    let description = ''
    let variationRule = ''

    if (roleIndex === 1) {
      title = isZh ? '主视觉封面' : 'Hero Cover'
      description = isZh ? '第一张负责稳定建立商品识别与核心卖点，不做激进变化。' : 'Stabilize product recognition and lead with the core selling point without aggressive variation.'
      variationRule = isZh
        ? '使用最稳妥的主视觉构图，产品为绝对主体，机位自然，突出完整轮廓与真实颜色。'
        : 'Use the safest hero composition with the product as the absolute subject, a natural camera angle, and strong emphasis on the full silhouette and true color.'
    } else if (roleIndex === 2) {
      title = isZh ? '角度变化图' : 'Angle Variation'
      description = isZh ? '仅做机位和景别变化，仍保持同款商品身份完全不变。' : 'Vary only camera angle and framing while preserving the exact same product identity.'
      variationRule = isZh
        ? '通过轻微角度变化增强立体感，可调整场景和背景，但不得改动商品结构与颜色。'
        : 'Use a modest camera-angle variation to add dimension. Scene and background may change, but the product structure and color must remain unchanged.'
    } else if (roleIndex === 3) {
      title = isZh ? '特征强化图' : 'Feature Reinforcement'
      description = isZh ? '放大核心五官与材质识别点，证明商品细节没有漂移。' : 'Magnify the signature features and material cues to prove the product details remain stable.'
      variationRule = isZh
        ? '聚焦最关键的材质、logo、五金、纹理或结构细节，同时保留完整商品识别。'
        : 'Focus on the most important material, logo, hardware, texture, or structure details while keeping the product immediately recognizable.'
    } else {
      title = isZh ? `构图变化图 ${roleIndex}` : `Composition Variation ${roleIndex}`
      description = isZh ? '在不改款前提下做构图、景别或场景变化。' : 'Vary composition, framing, or scene without changing the product design.'
      variationRule = isZh
        ? `做第 ${roleIndex} 张差异化版本，只允许调整景别、构图、背景和光线，不得改动商品本体。`
        : `Create variation ${roleIndex} by changing only framing, composition, background, and lighting while keeping the product itself identical.`
    }

    const designParts = [
      isZh ? `图片职责：${description}` : `Image role: ${description}`,
      styleSummary,
      variationRule,
      copyRule,
      identityLock.promptBlock,
      isZh
        ? '允许变化：场景、背景、光线、镜头、裁切、构图、景别。'
        : 'Allowed changes: scene, background, lighting, lens choice, crop, composition, and framing.',
      isZh
        ? '禁止变化：商品颜色、材质、logo、印花、五金、纹理、车线、轮廓、比例、结构。'
        : 'Forbidden changes: product color, material, logo, print, hardware, texture, stitching, silhouette, proportions, and structure.',
    ]

    return {
      id: `hero-plan-${roleIndex}`,
      title,
      description,
      design_content: designParts.join('\n'),
    }
  })

  return {
    images,
    design_specs: [
      styleSummary,
      buildGenesisSharedCopyRule(copyPlan, outputLanguage, isZh),
      identityLock.designSpecs,
      isZh
        ? '整组主图必须保持同一商品、同一色号、同一材质、同一结构，只做商业化画面表达变化。'
        : 'The full hero-image set must preserve the same product, same colorway, same material, and same construction, with only commercial presentation changes.',
    ].join('\n'),
    _ai_meta: {
      ...genesisAnalysis._ai_meta,
      image_count: normalizedCount,
      target_language: outputLanguage,
    },
  }
}

function normalizeAnalysisBlueprintResult(
  resultData: unknown,
  expectedCount: number,
  isZh: boolean,
): AnalysisBlueprint | null {
  if (isAnalysisBlueprint(resultData)) return resultData

  let parsed: Record<string, unknown> | null = null
  if (resultData && typeof resultData === 'object') {
    parsed = resultData as Record<string, unknown>
  } else if (typeof resultData === 'string') {
    try {
      const json = JSON.parse(resultData)
      if (json && typeof json === 'object') {
        parsed = json as Record<string, unknown>
      }
    } catch {
      parsed = null
    }
  }
  if (!parsed) return null

  const rawImages = Array.isArray(parsed.images)
    ? parsed.images
    : Array.isArray(parsed.image_plans)
      ? parsed.image_plans
      : Array.isArray(parsed.plans)
        ? parsed.plans
        : []

  const images: BlueprintImagePlan[] = rawImages
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item, index) => {
      const title = asTrimmedString(item.title, '')
        || asTrimmedString(item.name, '')
        || fallbackPlanTitle(index, isZh)
      const description = asTrimmedString(item.description, '')
        || asTrimmedString(item.desc, '')
        || fallbackPlanDescription(isZh)
      const designContent = asTrimmedString(item.design_content, '')
        || asTrimmedString(item.designContent, '')
        || asTrimmedString(item.prompt, '')
        || asTrimmedString(item.content, '')
        || description
      const id = typeof item.id === 'string' ? item.id : undefined
      return {
        id,
        title,
        description,
        design_content: designContent,
      }
    })

  const normalizedCount = Math.max(1, Math.min(15, Number(expectedCount || 1)))
  while (images.length < normalizedCount) {
    images.push({
      title: fallbackPlanTitle(images.length, isZh),
      description: fallbackPlanDescription(isZh),
      design_content: fallbackPlanDesignContent(isZh),
    })
  }
  const normalizedImages = images.slice(0, normalizedCount)

  const designSpecs = asTrimmedString(parsed.design_specs, '')
    || asTrimmedString(parsed.designSpecs, '')
    || asTrimmedString(parsed.specs, '')
    || (isZh
      ? '请统一所有图片的色彩体系、构图逻辑与光影风格。'
      : 'Keep color system, composition logic, and lighting style consistent across all images.')

  const meta = parsed._ai_meta && typeof parsed._ai_meta === 'object'
    ? (parsed._ai_meta as Record<string, unknown>)
    : {}
  const imageCountMeta = Number(meta.image_count)
  return {
    images: normalizedImages,
    design_specs: designSpecs,
    _ai_meta: {
      model: asTrimmedString(meta.model, 'unknown'),
      usage: meta.usage && typeof meta.usage === 'object' ? meta.usage as Record<string, unknown> : {},
      provider: asTrimmedString(meta.provider, 'fallback'),
      image_count: Number.isFinite(imageCountMeta) && imageCountMeta > 0 ? Math.round(imageCountMeta) : normalizedImages.length,
      target_language: asTrimmedString(meta.target_language, isZh ? 'zh' : 'en'),
    },
  }
}

function mergePromptsWithFallback(
  parsedPrompts: GeneratedPrompt[],
  plans: BlueprintImagePlan[],
  isZh: boolean,
): GeneratedPrompt[] {
  const fallbackPrompts = buildFallbackPrompts(plans, isZh)
  return plans.map((plan, index) => {
    const parsed = parsedPrompts[index]
    const fallback = fallbackPrompts[index]
    if (!parsed) return fallback
    const prompt = asTrimmedString(parsed.prompt, fallback.prompt)
    return {
      ...parsed,
      prompt,
      title: asTrimmedString(parsed.title, asTrimmedString(plan.title, fallback.title)),
      negative_prompt: asTrimmedString(parsed.negative_prompt, ''),
      marketing_hook: asTrimmedString(parsed.marketing_hook, ''),
      priority: Number.isFinite(Number(parsed.priority)) ? Number(parsed.priority) : 0,
    }
  })
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

// ─── Reanalyze helper ─────────────────────────────────────────────────────────

interface AnalysisParamSnapshot {
  imagesSignature: string
  requirements: string
  imageCount: number
  outputLanguage: OutputLanguage
}

function isAnalysisStale(
  current: { imagesSignature: string; requirements: string; imageCount: number; outputLanguage: OutputLanguage },
  snapshot: AnalysisParamSnapshot | null,
): boolean {
  if (!snapshot) return false
  return (
    snapshot.imagesSignature !== current.imagesSignature ||
    snapshot.requirements !== current.requirements ||
    snapshot.imageCount !== current.imageCount ||
    snapshot.outputLanguage !== current.outputLanguage
  )
}

function promptBlueprintPreview(
  blueprint: AnalysisBlueprint,
  images: BlueprintImagePlan[],
): AnalysisBlueprint {
  return {
    images,
    design_specs: blueprint.design_specs ?? '',
    _ai_meta: blueprint._ai_meta,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StudioGenesisForm() {
  const t = useTranslations('studio.genesis')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const router = useRouter()
  const isZh = locale.startsWith('zh')
  const userEmail = useUserEmail()
  const defaultRequirements = getGenesisDefaultRequirements(isZh)

  // ── Input state ──
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [requirements, setRequirements] = useState(defaultRequirements)
  const [imageCount, setImageCount] = useState(1)
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('2K')
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>(isZh ? 'zh' : 'en')
  // Locale-aware constants
  const ASPECT_RATIOS = locale === 'zh' ? ASPECT_RATIOS_ZH : ASPECT_RATIOS_EN
  const RESOLUTION_OPTIONS = getSupportedImageSizes(model).map((value) => ({
    value,
    label: locale === 'zh'
      ? `${value} ${value === '1K' ? '标清' : value === '2K' ? '高清' : '超清'} (${value === '1K' ? '1024px' : value === '2K' ? '2048px' : '4096px'})`
      : `${value} (${value === '1K' ? '1024px' : value === '2K' ? '2048px' : '4096px'})`,
  }))
  const OUTPUT_LANGUAGES = locale === 'zh' ? OUTPUT_LANGUAGES_ZH : OUTPUT_LANGUAGES_EN

  // ── Preview state ──
  const [genesisAnalysis, setGenesisAnalysis] = useState<GenesisAnalysisResult | null>(null)
  const [styleSelections, setStyleSelections] = useState<GenesisStyleSelections>({})
  const [customStyleTags, setCustomStyleTags] = useState<GenesisCustomStyleTags>({})
  const [customTagInputs, setCustomTagInputs] = useState<GenesisCustomStyleTags>({})
  const [activeCustomInputKey, setActiveCustomInputKey] = useState<GenesisStyleDirectionKey | null>(null)
  const [copyPlan, setCopyPlan] = useState('')
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])
  const [analysisParams, setAnalysisParams] = useState<AnalysisParamSnapshot | null>(null)

  // ── Flow state ──
  const [phase, setPhase] = useState<GenesisPhase>('input')
  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [progress, setProgress] = useState(0)
  const {
    assets: results,
    appendAssets: appendResults,
    clearAssets: clearResults,
  } = useResultAssetSession('studio-genesis-v2')
  const [imageSlots, setImageSlots] = useState<ImageSlot[]>([])
  const [failedSlotIndices, setFailedSlotIndices] = useState<number[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analyzingMessageIndex, setAnalyzingMessageIndex] = useState(0)
  const [retryContext, setRetryContext] = useState<RetryContext | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Session persistence removed: text persisted but images didn't, causing
  // inconsistent UX on refresh. All state now resets on page reload.

  const { total } = useCredits()
  const totalCost = computeCost(model, imageSize, imageCount)
  const insufficientCredits = total !== null && total < totalCost
  const analyzingMessages = [
    t('analyzingStep1'),
    t('analyzingStep2'),
    t('analyzingStep3'),
    t('analyzingStep4'),
  ]
  const backendLocale = isZh ? 'zh-CN' : 'en'
  const leftCardClass = 'rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6'
  const panelInputClass = 'h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px]'
  const rightPanelTitle = phase === 'analyzing'
    ? (isZh ? '分析中...' : 'Analyzing...')
    : phase === 'preview'
      ? (isZh ? '风格与文案' : 'Style & Copy')
    : phase === 'generating'
      ? (isZh ? '生成中...' : 'Generating...')
      : isZh
        ? '生成结果'
        : tc('results')
  const rightPanelSubtitle = phase === 'analyzing'
    ? (isZh ? '正在分析产品并生成风格与文案' : 'Analyzing product and preparing style and copy')
    : phase === 'preview'
      ? (isZh ? '确认风格方向与共享文案后生成主图' : 'Review style directions and shared copy before generation')
    : phase === 'generating'
      ? (isZh ? '正在根据风格与文案生成主图' : 'Generating hero images from approved style and copy')
      : isZh
        ? '上传产品图并点击分析开始'
        : "Upload product images and click 'Analyze' to start."

  // Derived: is the left panel disabled?
  const leftPanelDisabled = phase === 'analyzing' || phase === 'generating'
  const keyParamsDisabled = phase === 'analyzing' || phase === 'generating' || phase === 'complete'
  const genParamsDisabled = leftPanelDisabled || phase === 'preview' || phase === 'complete'
  const needsReanalyze = phase === 'preview' && isAnalysisStale({
    imagesSignature: buildImagesSignature(productImages),
    requirements,
    imageCount,
    outputLanguage,
  }, analysisParams)

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
    setAnalysisParams(null)
    setStyleSelections({})
    setCustomStyleTags({})
    setCustomTagInputs({})
    setActiveCustomInputKey(null)
  }, [])

  // ── Phase 1: Analyze & Blueprint ──
  const handleAnalyze = useCallback(async () => {
    if (productImages.length === 0) return
    const trace_id = uid()
    const abort = new AbortController()
    abortRef.current = abort
    const fallbackPhase: GenesisPhase = genesisAnalysis ? 'preview' : 'input'

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
        outputLanguage,
        studioType: 'genesis',
        trace_id,
      })

      // Nudge worker to start processing (fire-and-forget)
      processGenerationJob(analysisJobId).catch(() => {})

      const analysisJob = await waitForJob(analysisJobId, abort.signal)
      set('analyze', { status: 'done' })
      setProgress(100)
      const analysis = normalizeGenesisAnalysisResult(analysisJob.result_data, isZh, requirements, outputLanguage)
      setGenesisAnalysis(analysis)
      setCopyPlan(analysis.copy_plan ?? '')
      setStyleSelections(
        analysis.style_directions.reduce<GenesisStyleSelections>((acc, group) => {
          if (group.recommended) acc[group.key] = group.recommended
          return acc
        }, {})
      )
      setCustomStyleTags({})
      setCustomTagInputs({})
      setActiveCustomInputKey(null)
      setPhase('preview')
      setAnalysisParams({
        imagesSignature: buildImagesSignature(productImages),
        requirements,
        imageCount,
        outputLanguage,
      })
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(friendlyError(err instanceof Error ? err.message : tc('error'), isZh))
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase(fallbackPhase)
    }
  }, [productImages, requirements, imageCount, outputLanguage, backendLocale, isZh, t, tc, genesisAnalysis])

  // ── Phase 2: Confirm & Generate ──
  const handleGenerate = useCallback(async () => {
    if (isAnalysisStale({
      imagesSignature: buildImagesSignature(productImages),
      requirements,
      imageCount,
      outputLanguage,
    }, analysisParams)) {
      setErrorMessage(t('reanalyzeWarning'))
      return
    }
    if (!genesisAnalysis) return
    const trace_id = uid()
    const client_job_id = uid()
    const batchId = uid()
    const batchTimestamp = Date.now()
    const abort = new AbortController()
    abortRef.current = abort

    setPhase('generating')
    setSteps([
      { id: 'prompts', label: t('steps.prompts'), status: 'pending' },
      { id: 'generate', label: t('steps.generate'), status: 'pending' },
      { id: 'done', label: t('steps.done'), status: 'pending' },
    ])
    setProgress(0)
    setImageSlots([])
    setFailedSlotIndices([])
    setErrorMessage(null)

    const set = (id: string, patch: Partial<ProgressStep>) =>
      setSteps((prev) => patchStep(prev, id, patch))

    try {
      set('prompts', { status: 'active' })
      setProgress(10)

      const blueprint = buildGenesisHeroBlueprint({
        genesisAnalysis,
        styleSelections,
        copyPlan,
        imageCount,
        isZh,
        outputLanguage,
      })

      let promptText = ''
      const promptStream = await generatePromptsV2Stream(
        {
          module: 'genesis',
          analysisJson: blueprint,
          design_specs: blueprint.design_specs,
          imageCount: blueprint.images.length,
          targetLanguage: backendLocale,
          outputLanguage,
          stream: true,
          trace_id,
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
          if (!payload || payload === '[DONE]' || payload.startsWith('[ERROR]')) continue
          try {
            const chunk = JSON.parse(payload) as PromptSseChunk
            if (chunk.fullText) promptText = chunk.fullText
          } catch {
            promptText += payload
          }
        }
      }
      const promptObjects = parsePromptArray(promptText, blueprint.images.length)
      const mergedPrompts = mergePromptsWithFallback(promptObjects, blueprint.images, isZh)
      const prompts = mergedPrompts
        .map((item, index) => ({
          prompt: item.prompt.trim(),
          negativePrompt: item.negative_prompt.trim(),
          title: item.title.trim() || blueprint.images[index]?.title || '',
          description: blueprint.images[index]?.description ?? '',
        }))
      if (prompts.some((item) => item.prompt.length === 0)) {
        throw new Error('No prompts available — please re-analyze')
      }
      setRetryContext({ prompts, trace_id })
      set('prompts', { status: 'done' })

      // Generate images — one per prompt
      set('generate', { status: 'active' })
      setProgress(25)

      // Create initial slots
      const initialSlots: ImageSlot[] = prompts.map(() => ({
        jobId: '',
        status: 'pending' as const,
      }))
      setImageSlots(initialSlots)

      const submissionResults = await runWithConcurrency(
        prompts.map((promptTask, i) => () =>
          generateImage({
            productImage: uploadedUrls[0],
            productImages: uploadedUrls,
            prompt: promptTask.prompt,
            negativePrompt: promptTask.negativePrompt || undefined,
            model,
            aspectRatio,
            imageSize,
            imageCount: 1,
            client_job_id: `${client_job_id}_${i}`,
            fe_attempt: 1,
            trace_id,
            metadata: {
              is_batch: true,
              batch_index: i,
              image_size: imageSize,
              product_images: uploadedUrls,
              product_visual_identity: genesisAnalysis.product_visual_identity ?? null,
              hero_plan_title: promptTask.title,
              hero_plan_description: promptTask.description,
            },
          }).then((r) => r.job_id)
        ),
        BATCH_CONCURRENCY,
      )

      // Extract job IDs + batch-update slots in ONE call
      const imageJobIds: (string | null)[] = submissionResults.map((r) =>
        r.status === 'fulfilled' ? r.value : null
      )
      setImageSlots((prev) =>
        prev.map((s, i) => {
          if (imageJobIds[i]) return { ...s, jobId: imageJobIds[i]! }
          if (submissionResults[i].status === 'rejected') return { ...s, status: 'failed', error: 'Submission failed' }
          return s
        })
      )

      // Nudge worker for each image job with staggered delay to avoid API rate limits
      imageJobIds.forEach((id, i) => {
        if (id) {
          setTimeout(() => {
            processGenerationJob(id).catch(() => {})
          }, i * 3000) // 3s interval between nudges
        }
      })

      // Wait for each job independently, updating slots as they complete
      const settledJobs = await Promise.allSettled(
        imageJobIds.map((id, i) => {
          if (!id) return Promise.reject(new Error('Submission failed'))
          return waitForJob(id, abort.signal).then((job) => {
            const result = extractResultFromJob(job, i, batchId, batchTimestamp)
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
        })
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
      appendResults(successResults)
      setFailedSlotIndices(failedIndices)

      if (successResults.length === 0) {
        setErrorMessage(t('allImagesFailed'))
      }

      setPhase('complete')
      refreshCredits()
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return
      setErrorMessage(friendlyError(err instanceof Error ? err.message : tc('error'), isZh))
      setSteps((prev) =>
        prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s))
      )
    }
  }, [analysisParams, appendResults, aspectRatio, backendLocale, copyPlan, genesisAnalysis, imageCount, imageSize, isZh, model, outputLanguage, productImages, requirements, styleSelections, t, tc, uploadedUrls])

  const handleBackToInput = useCallback(() => {
    setPhase('input')
    setSteps([])
    setProgress(0)
    setErrorMessage(null)
    setAnalysisParams(null)
    setRetryContext(null)
    setStyleSelections({})
    setCustomStyleTags({})
    setCustomTagInputs({})
    setActiveCustomInputKey(null)
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
    clearResults()
    setImageSlots([])
    setFailedSlotIndices([])
    setErrorMessage(null)
    setGenesisAnalysis(null)
    setCopyPlan('')
    setUploadedUrls([])
    setAnalysisParams(null)
    setRetryContext(null)
    setStyleSelections({})
    setCustomStyleTags({})
    setCustomTagInputs({})
    setActiveCustomInputKey(null)
    setRequirements(defaultRequirements)
  }, [clearResults, defaultRequirements])

  // ─── handleRetryFailed ────────────────────────────────────────────────────

  const handleRetryFailed = useCallback(async () => {
    if (!retryContext || failedSlotIndices.length === 0) return

    // Capture indices BEFORE any state changes
    const indicesToRetry = [...failedSlotIndices]

    // Switch to generating phase — enables Stop button and blocks navigation
    setPhase('generating')
    const abort = new AbortController()
    abortRef.current = abort
    setErrorMessage(null)

    // Reset steps/progress for retry visibility
    setSteps([
      { id: 'retry', label: t('retryingFailed'), status: 'active' },
    ])
    setProgress(0)

    const { prompts, trace_id } = retryContext

    // Reset failed slots to pending
    setImageSlots((prev) =>
      prev.map((s, i) => indicesToRetry.includes(i) ? { ...s, status: 'pending', error: undefined } : s)
    )
    setFailedSlotIndices([])

    try {
      const retryTasks = indicesToRetry.map((slotIdx) => () =>
        generateImage({
          productImage: uploadedUrls[0],
          productImages: uploadedUrls,
          prompt: prompts[slotIdx]?.prompt ?? '',
          negativePrompt: prompts[slotIdx]?.negativePrompt || undefined,
          model, aspectRatio, imageSize,
          imageCount: 1,
          client_job_id: `${uid()}_retry_${slotIdx}`,
          fe_attempt: 2, trace_id,
          metadata: {
            is_batch: true,
            batch_index: slotIdx,
            image_size: imageSize,
            product_images: uploadedUrls,
            product_visual_identity: genesisAnalysis?.product_visual_identity ?? null,
            hero_plan_title: prompts[slotIdx]?.title ?? '',
            hero_plan_description: prompts[slotIdx]?.description ?? '',
          },
        }).then((r) => r.job_id)
      )

      const submissionResults = await runWithConcurrency(retryTasks, BATCH_CONCURRENCY)

      const retryJobMap = indicesToRetry.map((slotIdx, ri) => {
        const r = submissionResults[ri]
        return { slotIdx, jobId: r.status === 'fulfilled' ? r.value : null }
      })

      // Batch-update slots
      setImageSlots((prev) =>
        prev.map((s, i) => {
          const entry = retryJobMap.find((e) => e.slotIdx === i)
          if (!entry) return s
          if (entry.jobId) return { ...s, jobId: entry.jobId }
          return { ...s, status: 'failed', error: 'Retry submission failed' }
        })
      )

      // Nudge workers
      retryJobMap.forEach(({ jobId }, ri) => {
        if (jobId) setTimeout(() => processGenerationJob(jobId).catch(() => {}), ri * 3000)
      })

      const retrySettled = await Promise.allSettled(
        retryJobMap.map(({ slotIdx, jobId }) => {
          if (!jobId) return Promise.reject(new Error('Submission failed'))
          return waitForJob(jobId, abort.signal).then((job) => {
            const result = extractResultFromJob(job, slotIdx)
            setImageSlots((prev) =>
              prev.map((s, i) => i === slotIdx ? { ...s, status: 'done', result: result ?? undefined } : s)
            )
            return { slotIdx, result }
          }).catch((err) => {
            setImageSlots((prev) =>
              prev.map((s, i) => i === slotIdx ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Failed' } : s)
            )
            throw err
          })
        })
      )

      // Append successful retry results (failed slots had no entry in results before)
      const retryResults: ResultImage[] = []
      const newFailedIndices: number[] = []
      retrySettled.forEach((settled, ri) => {
        if (settled.status === 'fulfilled' && settled.value?.result) {
          retryResults.push(settled.value.result)
        } else {
          // Rejected OR fulfilled-but-no-result → still failed
          newFailedIndices.push(retryJobMap[ri].slotIdx)
        }
      })
      appendResults(retryResults)
      setFailedSlotIndices(newFailedIndices)
      refreshCredits()

      // Only set complete if not aborted (handleStop sets 'input')
      if (!abort.signal.aborted) {
        setPhase('complete')
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return // handleStop already set phase='input'
      setErrorMessage(friendlyError(err instanceof Error ? err.message : 'Retry failed', isZh))
      if (!abort.signal.aborted) {
        setPhase('complete')
      }
    }
  }, [appendResults, retryContext, failedSlotIndices, uploadedUrls, model, aspectRatio, imageSize, isZh, t, genesisAnalysis])

  const handleStyleSelect = useCallback((key: GenesisStyleDirectionKey, value: string) => {
    setStyleSelections((prev) => ({
      ...prev,
      [key]: prev[key] === value ? undefined : value,
    }))
  }, [])

  const handleAddCustomTag = useCallback((key: GenesisStyleDirectionKey) => {
    const raw = (customTagInputs[key] ?? '').trim()
    if (!raw) return
    setErrorMessage(null)
    setCustomStyleTags((prev) => ({ ...prev, [key]: raw }))
    setStyleSelections((prev) => ({ ...prev, [key]: raw }))
    setCustomTagInputs((prev) => ({ ...prev, [key]: '' }))
    setActiveCustomInputKey(null)
  }, [customTagInputs])

  const handleRemoveCustomTag = useCallback((key: GenesisStyleDirectionKey) => {
    setCustomStyleTags((prev) => {
      const next = { ...prev }
      const removed = next[key]
      delete next[key]
      setStyleSelections((prevSelections) => {
        if (prevSelections[key] !== removed) return prevSelections
        const nextSelections = { ...prevSelections }
        delete nextSelections[key]
        return nextSelections
      })
      return next
    })
    setCustomTagInputs((prev) => ({ ...prev, [key]: '' }))
    setActiveCustomInputKey(null)
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
          {needsReanalyze && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-medium">{t('reanalyzeWarning')}</p>
            </div>
          )}

          {needsReanalyze ? (
            <Button
              size="lg"
              onClick={handleAnalyze}
              className="h-14 w-full rounded-3xl bg-amber-600 text-[17px] font-semibold text-white hover:bg-amber-700"
            >
              <RefreshCw className="mr-2 h-5 w-5" />
              {t('reanalyze')}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={insufficientCredits}
              className="h-14 w-full rounded-3xl bg-[#171a22] text-[17px] font-semibold text-white hover:bg-[#11131a] disabled:bg-[#9ca1ad]"
            >
              <ArrowRight className="mr-2 h-5 w-5" />
              {isZh
                ? `确认生成 ${imageCount} 张主图`
                : `Generate ${imageCount} ${imageCount > 1 ? 'hero images' : 'hero image'}`}
            </Button>
          )}

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
        {genesisAnalysis && (
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
      if (results.length > 0) {
        return (
          <div className="space-y-6">
            <ResultGallery
              images={results}
              aspectRatio={aspectRatio}
              onClear={clearResults}
              editorSessionKey="studio-genesis-v2"
              originModule="studio-genesis"
            />
          </div>
        )
      }
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
        <div className="space-y-6">
          <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#1a1d24]">{isZh ? '风格方向' : 'Style Direction'}</h3>
                <p className="text-[13px] text-[#7d818d]">{isZh ? 'AI 已生成动态标签，可取消或新增自定义标签。用户自定义标签不限制字数。' : 'AI generated dynamic tags. You can deselect or add one custom tag per dimension. Custom tags are not length-limited.'}</p>
              </div>
            </div>

            <div className="space-y-4">
              {genesisAnalysis?.style_directions.map((group) => {
                const selectedValue = styleSelections[group.key]
                const customTag = customStyleTags[group.key]
                const isAdding = activeCustomInputKey === group.key
                return (
                  <div key={group.key}>
                    <p className="mb-2 text-[13px] font-medium text-[#5a5e6b]">
                      {getGenesisDimensionLabel(group.key, isZh)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {group.options.map((option) => {
                        const isActive = selectedValue === option
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => handleStyleSelect(group.key, option)}
                            className={isActive
                              ? 'rounded-full bg-[#191b22] px-3 py-1.5 text-[13px] font-medium text-white transition-colors'
                              : 'rounded-full border border-[#d0d4dc] bg-[#f1f3f6] px-3 py-1.5 text-[13px] font-medium text-[#5a5e6b] transition-colors hover:border-[#191b22]'}
                          >
                            {option}
                          </button>
                        )
                      })}
                      {customTag && (
                        <span className={selectedValue === customTag
                          ? 'inline-flex items-center gap-1 rounded-full bg-[#171a22] px-3 py-1.5 text-[13px] font-medium text-white'
                          : 'inline-flex items-center gap-1 rounded-full border border-[#171a22] bg-white px-3 py-1.5 text-[13px] font-medium text-[#171a22]'}>
                          <button type="button" onClick={() => handleStyleSelect(group.key, customTag)}>
                            {customTag}
                          </button>
                          <button type="button" onClick={() => handleRemoveCustomTag(group.key)}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                      {!customTag && !isAdding && (
                        <button
                          type="button"
                          onClick={() => setActiveCustomInputKey(group.key)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#d0d4dc] bg-white px-3 py-1.5 text-[13px] font-medium text-[#5a5e6b] hover:border-[#191b22]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {isZh ? '新增' : 'Add'}
                        </button>
                      )}
                    </div>
                    {isAdding && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={customTagInputs[group.key] ?? ''}
                          onChange={(e) => setCustomTagInputs((prev) => ({ ...prev, [group.key]: e.target.value }))}
                          placeholder={isZh ? '输入自定义标签' : 'Enter a custom tag'}
                          className="h-10 flex-1 rounded-2xl border border-[#d0d4dc] bg-[#f1f3f6] px-3 text-[13px] text-[#1a1d24] outline-none"
                        />
                        <Button type="button" size="sm" onClick={() => handleAddCustomTag(group.key)}>
                          {isZh ? '确认' : 'Add'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setActiveCustomInputKey(null)}>
                          {isZh ? '取消' : 'Cancel'}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]">
                <ImageIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#1a1d24]">{isZh ? '文案规划' : 'Copy Plan'}</h3>
                <p className="text-[13px] text-[#7d818d]">
                  {outputLanguage === 'none'
                    ? (isZh ? '当前为纯视觉语言，AI 默认不写文案；你仍可手动输入。' : 'Visual-only language is selected. AI leaves copy empty by default, but you can still type your own copy.')
                    : (isZh ? '同一份文案会应用到所有生成图片；清空即生成纯图片版。' : 'The same copy will be applied to all generated images. Clear it for a pure visual version.')}
                </p>
              </div>
            </div>
            <Textarea
              value={copyPlan}
              onChange={(e) => setCopyPlan(e.target.value)}
              rows={6}
              className="min-h-[180px] resize-none rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] leading-6"
              placeholder={isZh ? '输入共享文案，所有图片共用；留空则生成纯图片版。' : 'Enter shared copy for all images. Leave empty for a pure visual version.'}
            />
          </div>
        </div>
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
          <ResultGallery
            images={results}
            aspectRatio={aspectRatio}
            onClear={clearResults}
            editorSessionKey="studio-genesis-v2"
            originModule="studio-genesis"
          />
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
              onClick={handleRetryFailed}
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
            <Button variant="outline" size="sm" onClick={handleRetryFailed} className="mt-4">
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
            <span>{isZh ? 'AI 主图生成' : 'AI Hero Image Generator'}</span>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#17181d] sm:text-4xl">{t('title')}</h1>
          <p className="mx-auto mt-3 max-w-4xl text-sm leading-relaxed text-[#70727a] sm:text-base">{t('description')}</p>
        </div>

        <StepIndicator currentPhase={phase} locale={locale} />

        {errorMessage && phase !== 'complete' && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

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
                  <h3 className="text-[15px] font-semibold text-[#1a1d24]">{isZh ? '主图要求' : 'Hero Image Brief'}</h3>
                  <p className="text-[13px] text-[#7d818d]">{isZh ? '默认文案可直接修改或删除，用户要求优先于产品图分析。' : 'Edit or remove the default brief. The user brief takes priority over image inference.'}</p>
                </div>
              </div>

              <Textarea
                id="sg-req"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                rows={5}
                disabled={leftPanelDisabled}
                className="min-h-[128px] resize-none rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] leading-6 text-[#1a1d24]"
              />

              <div className="mt-4 space-y-1.5">
                <Label className="text-[13px] font-medium text-[#5a5e6b]">{t('outputLanguage')}</Label>
                <Select
                  value={outputLanguage}
                  onValueChange={(v) => setOutputLanguage(v as OutputLanguage)}
                  disabled={keyParamsDisabled}
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
                    onValueChange={(v) => {
                      const nextModel = normalizeGenerationModel(v) as GenerationModel
                      setModel(nextModel)
                      setImageSize((current) => sanitizeImageSizeForModel(nextModel, current))
                    }}
                    disabled={genParamsDisabled}
                  >
                    <SelectTrigger className={panelInputClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getAvailableModels(userEmail).map((m) => (
                        <SelectItem key={m.value} value={m.value}>{locale.startsWith('zh') ? m.tierLabel.zh : m.tierLabel.en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-[#5a5e6b]">{tc('aspectRatio')}</Label>
                  <Select
                    value={aspectRatio}
                    onValueChange={(v) => setAspectRatio(v as AspectRatio)}
                    disabled={genParamsDisabled}
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
                    disabled={genParamsDisabled}
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
                    disabled={keyParamsDisabled}
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
