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
import { DesignBlueprint } from '@/components/studio/DesignBlueprint'
import { ModelTextHint } from '@/components/studio/ModelTextHint'
import { useCredits, refreshCredits } from '@/lib/hooks/useCredits'
import { usePromptProfile } from '@/lib/hooks/usePromptProfile'
import { useAdminImageModels } from '@/lib/hooks/useAdminImageModels'
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
import { clampText, formatTextCounter, TEXT_LIMITS } from '@/lib/input-guard'
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
  getAvailableModels,
  DEFAULT_MODEL,
  getGenerationCreditCost,
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
const ANALYSIS_WAIT_TIMEOUT_MS = 90_000
const ANALYSIS_TIMEOUT_ERROR = 'GENESIS_ANALYSIS_TIMEOUT'

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

interface WaitForJobOptions {
  timeoutMs?: number
  timeoutErrorMessage?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID()
}

function waitForJob(jobId: string, signal: AbortSignal, options?: WaitForJobOptions): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    let nudgeCount = 0

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
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

    async function handleTimeout() {
      try {
        await checkOnce()
      } catch {
        // Ignore and fall through to the timeout error below.
      }

      fail(new Error(options?.timeoutErrorMessage ?? 'JOB_WAIT_TIMEOUT'))
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

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        void handleTimeout()
      }, options.timeoutMs)
    }
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
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                  {step.num}
                </span>
              ) : (
                <span className={`w-4 text-center text-sm ${isDone ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                  {step.num}
                </span>
              )}
              <span
                className={`text-sm ${
                  isPastOrCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="mx-3 h-px w-8 bg-border sm:mx-5 sm:w-12" />
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
  let foundStructuredCandidate = false

  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeFenceMatch?.[1]) {
    candidates.push(codeFenceMatch[1].trim())
    foundStructuredCandidate = true
  }

  const jsonArrayMatch = text.match(/\[[\s\S]*\]/)
  if (jsonArrayMatch?.[0]) {
    candidates.push(jsonArrayMatch[0].trim())
    foundStructuredCandidate = true
  }

  // Try truncation salvage: find last complete object
  const truncatedMatch = text.match(/\[[\s\S]*\}/)
  if (truncatedMatch?.[0]) {
    candidates.push(truncatedMatch[0] + ']')
    foundStructuredCandidate = true
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

  if (foundStructuredCandidate) return []

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
  analysis: { style_directions?: GenesisAnalysisResult['style_directions'] } | null,
  selections: GenesisStyleSelections,
): string[] {
  const groups = Array.isArray(analysis?.style_directions) ? analysis.style_directions : []
  return groups
    .map((group) => selections[group.key] ?? group.recommended ?? group.options[0] ?? '')
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index)
}

function buildGenesisIdentityLockLines(
  productSummary: string,
  identity: GenesisAnalysisResult['product_visual_identity'] | AnalysisBlueprint['product_visual_identity'],
  isZh: boolean,
): string[] {
  const primaryColor = identity?.primary_color?.trim()
  const material = identity?.material?.trim()
  const keyFeatures = (identity?.key_features ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
  const summary = productSummary.trim()

  return [
    summary
      ? (isZh ? `- 商品锚定：${summary}` : `- Product anchor: ${summary}`)
      : (isZh ? '- 商品锚定：保持上传商品本体与核心卖点一致。' : '- Product anchor: keep the uploaded product identity and hero selling points intact.'),
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
      ? '- 硬约束：必须是同一 SKU、同一商品，不得改色、改材质、改 logo、改五金、改纹理、改版型、改结构。'
      : '- Hard lock: exact same SKU and same product. Do not change color, material, logo, hardware, texture, silhouette, proportions, or structure.',
  ]
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

function defaultGenesisCopyRole(index: number, hasCopy: boolean): 'headline' | 'headline+support' | 'label' | 'none' {
  if (!hasCopy) return 'none'
  if (index === 0) return 'headline+support'
  if (index === 1) return 'headline'
  return 'label'
}

function defaultGenesisCopyAdaptation(index: number, hasCopy: boolean, isZh: boolean): string {
  if (!hasCopy) {
    return isZh
      ? '纯视觉构图，无新增文字，依靠光影、材质和构图表达商业感。'
      : 'Visual-only composition with no added text. Let lighting, material, and framing carry the commercial mood.'
  }
  if (index === 0) {
    return isZh
      ? '主标题配辅助短句，放在安全留白区，层级清晰，文字不得遮挡商品主体。'
      : 'Use a headline with one support line in a safe whitespace zone. Keep hierarchy clear and never cover the product.'
  }
  if (index === 1) {
    return isZh
      ? '使用短标题或短标签，文字弱于商品主体，保持留白和可读性。'
      : 'Use a short headline or label. Keep the typography weaker than the product and preserve whitespace and readability.'
  }
  return isZh
    ? '优先使用短标签或一句短促辅助文案，放在边缘留白区，避免压住商品。'
    : 'Prefer a short label or compact support line in the edge whitespace area and avoid sitting on top of the product.'
}

type GenesisTemplateSectionKey =
  | 'colorSystem'
  | 'typographyCopySystem'
  | 'visualLanguage'
  | 'photographyStyle'
  | 'qualityRequirements'

type GenesisSectionRequirement = {
  label: string
  line: string
}

function shortGenesisCue(value: string, isZh: boolean, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  const chars = Array.from(normalized)
  return chars.slice(0, isZh ? 30 : 72).join('').trim() || fallback
}

function normalizeGenesisTemplateHeadingLabel(value: string): string {
  return value
    .replace(/^#+\s*/, '')
    .replace(/[*`]/g, '')
    .replace(/[：:]/g, '')
    .replace(/[()（）]/g, '')
    .replace(/\//g, '')
    .replace(/-/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function detectGenesisTemplateSectionKey(heading: string): GenesisTemplateSectionKey | null {
  const label = normalizeGenesisTemplateHeadingLabel(heading)
  if (label.includes('色彩系统') || label.includes('colorsystem')) return 'colorSystem'
  if (
    label.includes('字体系统文案系统') ||
    label.includes('字体文案系统') ||
    (label.includes('typography') && label.includes('copy')) ||
    (label.includes('font') && label.includes('copy'))
  ) {
    return 'typographyCopySystem'
  }
  if (label.includes('视觉语言') || label.includes('visuallanguage')) return 'visualLanguage'
  if (label.includes('摄影风格') || label.includes('photographystyle')) return 'photographyStyle'
  if (label.includes('品质要求') || label.includes('qualityrequirements')) return 'qualityRequirements'
  return null
}

function extractGenesisTemplateSections(raw: string): {
  sections: Partial<Record<GenesisTemplateSectionKey, string[]>>
  extras: string[]
} {
  const sections: Partial<Record<GenesisTemplateSectionKey, string[]>> = {}
  const extras: string[] = []
  let currentSection: GenesisTemplateSectionKey | 'extras' | null = null
  const lines = raw.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (currentSection && currentSection !== 'extras') {
        sections[currentSection] = [...(sections[currentSection] ?? []), '']
      } else if (currentSection === 'extras' && extras.length > 0 && extras[extras.length - 1] !== '') {
        extras.push('')
      }
      continue
    }

    if (/^#\s+/.test(trimmed)) {
      continue
    }
    if (/^>\s*/.test(trimmed)) {
      continue
    }

    const headingMatch = trimmed.match(/^##+\s*(.+)$/)
    if (headingMatch) {
      const key = detectGenesisTemplateSectionKey(headingMatch[1])
      currentSection = key ?? 'extras'
      if (!key) extras.push(trimmed.replace(/^##+\s*/, ''))
      continue
    }

    if (currentSection && currentSection !== 'extras') {
      sections[currentSection] = [...(sections[currentSection] ?? []), line]
      continue
    }

    extras.push(line)
  }

  return { sections, extras }
}

function hasGenesisTemplateLabel(lines: string[], label: string): boolean {
  const normalizedLabel = normalizeGenesisTemplateHeadingLabel(label)
  return lines.some((line) => {
    const cleaned = normalizeGenesisTemplateHeadingLabel(line.replace(/^-+\s*/, ''))
    return cleaned.includes(normalizedLabel)
  })
}

function normalizeGenesisExtraLines(extraLines: string[], isZh: boolean): string[] {
  const cleaned = extraLines
    .map((line) => line.trim())
    .filter(Boolean)

  return cleaned.map((line) => {
    if (line.startsWith('-')) return line
    return isZh ? `- 补充说明：${line}` : `- Additional note: ${line}`
  })
}

function composeGenesisTemplateSection(
  rawLines: string[],
  requirements: GenesisSectionRequirement[],
  extraLines: string[] = [],
): string {
  const cleanedRaw = rawLines
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line.length === 0 && arr[index - 1]?.length === 0))
  const merged = [...cleanedRaw]

  requirements.forEach((item) => {
    if (!hasGenesisTemplateLabel(cleanedRaw, item.label)) {
      merged.push(item.line)
    }
  })

  extraLines.forEach((line) => {
    if (!merged.includes(line)) merged.push(line)
  })

  return merged.filter((line, index, arr) => !(line.length === 0 && arr[index - 1]?.length === 0)).join('\n').trim()
}

function buildGenesisStyleDirectionNote(labels: string[], isZh: boolean): string | null {
  if (labels.length === 0) return null
  return isZh
    ? `- 统一风格方向：${labels.join(' / ')}`
    : `- Unified style direction: ${labels.join(' / ')}`
}

function buildGenesisColorRequirements(params: {
  isZh: boolean
  productSummary: string
  identity?: AnalysisBlueprint['product_visual_identity']
}): GenesisSectionRequirement[] {
  const { isZh, productSummary, identity } = params
  const primaryColor = identity?.primary_color?.trim()
  const secondaryColors = (identity?.secondary_colors ?? []).map((item) => item.trim()).filter(Boolean)
  const material = identity?.material?.trim()

  return isZh
    ? [
        {
          label: '主色调',
          line: primaryColor
            ? `- 主色调：锁定商品真实主色 ${primaryColor}，围绕主体延展主画面色锚，不得偏色。`
            : `- 主色调：围绕商品真实主色建立商业主画面色锚，确保 ${shortGenesisCue(productSummary, true, '商品主体')} 识别稳定。`,
        },
        {
          label: '辅助色',
          line: secondaryColors.length > 0
            ? `- 辅助色：从 ${secondaryColors.join('、')} 与材质反光中提炼点缀色，强化层次但不抢主体。`
            : `- 辅助色：从品牌调性、材质反光与卖点信息中提炼点缀色，控制对比度与商业质感。`,
        },
        {
          label: '背景色',
          line: material
            ? `- 背景色：选择与 ${material} 质感兼容的商业背景色，保证商品边缘、阴影和高光层次清晰。`
            : `- 背景色：使用与商品卖点匹配的商业背景色和表面材质，保证主体轮廓与留白区清晰。`,
        },
      ]
    : [
        {
          label: 'Primary Color',
          line: primaryColor
            ? `- Primary Color: lock the product's true dominant color ${primaryColor} as the hero palette anchor with no color drift.`
            : `- Primary Color: build the hero palette around the product's true dominant color so ${shortGenesisCue(productSummary, false, 'the product')} stays instantly recognizable.`,
        },
        {
          label: 'Secondary Color',
          line: secondaryColors.length > 0
            ? `- Secondary Color: extract accents from ${secondaryColors.join(', ')} and material reflections without stealing focus from the product.`
            : `- Secondary Color: derive restrained accents from brand tone, material reflections, and selling points to add depth without noise.`,
        },
        {
          label: 'Background Color',
          line: material
            ? `- Background Color: choose a commercial background palette and surface treatment that matches the ${material} finish and keeps product edges readable.`
            : `- Background Color: use a product-appropriate commercial backdrop and surface tone that keeps silhouette, shadow, and whitespace separation clear.`,
        },
      ]
}

function buildGenesisTypographyRequirements(params: {
  isZh: boolean
  outputLanguage: OutputLanguage
  sharedCopy: string
}): GenesisSectionRequirement[] {
  const { isZh, outputLanguage, sharedCopy } = params
  const copyRule = buildGenesisSharedCopyRule(sharedCopy, outputLanguage, isZh)

  return isZh
    ? [
        {
          label: '标题字体',
          line: '- 标题字体：选择与商品气质一致的商业展示标题字形，确保标题有明确视觉主次但不压过商品主体。',
        },
        {
          label: '正文字体',
          line: '- 正文字体：使用清晰易读的辅助字形支撑信息层级，避免说明文堆砌和密集排版。',
        },
        {
          label: '字号层级',
          line: '- 字号层级：大标题:副标题:正文 = 3:1.8:1，默认每张图不超过 2 组文字区。',
        },
        {
          label: '文案规则',
          line: `- 文案规则：${copyRule} 主标题 <= 12 个中文字符，辅助短句 <= 18 个中文字符，标签 <= 8 个中文字符。`,
        },
      ]
    : [
        {
          label: 'Heading Font',
          line: '- Heading Font: choose a commercial display face that matches the product mood and keeps the headline visually strong without overpowering the product.',
        },
        {
          label: 'Body Font',
          line: '- Body Font: use a clear supporting face for secondary information and avoid dense paragraph-style blocks.',
        },
        {
          label: 'Hierarchy',
          line: '- Hierarchy: headline:support:body = 3:1.8:1, with no more than 2 text groups per image by default.',
        },
        {
          label: 'Copy Rules',
          line: `- Copy Rules: ${copyRule} Keep headlines compact, support lines short, and labels minimal.`,
        },
      ]
}

function buildGenesisVisualRequirements(params: {
  isZh: boolean
  productSummary: string
  styleLabels: string[]
}): GenesisSectionRequirement[] {
  const { isZh, productSummary, styleLabels } = params
  const styleNote = buildGenesisStyleDirectionNote(styleLabels, isZh)
  const noteTail = styleNote ? ` ${styleNote.replace(/^- /, '')}` : ''

  return isZh
    ? [
        {
          label: '装饰元素',
          line: `- 装饰元素：围绕 ${shortGenesisCue(productSummary, true, '商品卖点')} 选择相关表面、道具、材质肌理或结构化背景，不引入无关品类元素。${noteTail}`,
        },
        {
          label: '图标风格',
          line: '- 图标风格：默认使用极简线条或不使用图标，所有辅助元素都必须弱于商品主体。',
        },
        {
          label: '留白原则',
          line: '- 留白原则：保持约 30%-40% 可用留白，商品区、文字区与背景层次要清晰分离。',
        },
      ]
    : [
        {
          label: 'Decorative Elements',
          line: `- Decorative Elements: choose surfaces, props, texture cues, or structured backgrounds that directly support ${shortGenesisCue(productSummary, false, 'the product story')} and avoid irrelevant category language.${noteTail ? ` ${noteTail}` : ''}`,
        },
        {
          label: 'Icon Style',
          line: '- Icon Style: default to minimal line icons or no icons at all so every supporting element stays weaker than the product.',
        },
        {
          label: 'Whitespace Principle',
          line: '- Whitespace Principle: keep roughly 30%-40% usable negative space with clear separation between product zone, text zone, and background depth.',
        },
      ]
}

function buildGenesisPhotographyRequirements(params: {
  isZh: boolean
  identity?: AnalysisBlueprint['product_visual_identity']
}): GenesisSectionRequirement[] {
  const { isZh, identity } = params
  const material = identity?.material?.trim()

  return isZh
    ? [
        {
          label: '光线',
          line: material
            ? `- 光线：根据 ${material} 的表面反光与体积感设计主光、轮廓光和补光，突出边缘、阴影与材质层次。`
            : '- 光线：采用能拉开主体层次的商业主光、轮廓光与补光组合，避免把商品拍平。',
        },
        {
          label: '景深',
          line: '- 景深：优先中浅景深，保持商品主体绝对清晰，背景适度虚化并保留空间层次。',
        },
        {
          label: '相机参数参考',
          line: '- 相机参数参考：优先使用 85mm 商业产品镜头或适合类目的稳定机位，避免广角畸变与廉价视角。',
        },
      ]
    : [
        {
          label: 'Lighting',
          line: material
            ? `- Lighting: design key light, rim light, and fill light around the reflective and volumetric behavior of the ${material} surface.`
            : '- Lighting: use a commercial key/rim/fill setup that gives the product real volume, edge definition, and texture separation.',
        },
        {
          label: 'Depth of Field',
          line: '- Depth of Field: prefer medium-to-shallow depth so the product stays tack sharp while the background remains controlled and layered.',
        },
        {
          label: 'Camera Reference',
          line: '- Camera Reference: favor an 85mm product-photography lens or another category-appropriate commercial angle with no cheap wide-angle distortion.',
        },
      ]
}

function buildGenesisQualityRequirements(isZh: boolean): GenesisSectionRequirement[] {
  return isZh
    ? [
        { label: '分辨率', line: '- 分辨率：8K' },
        { label: '风格', line: '- 风格：高端商业主图摄影 / 电商广告级视觉' },
        { label: '真实感', line: '- 真实感：超写实 / 准确材质物理表现 / 照片级细节' },
      ]
    : [
        { label: 'Resolution', line: '- Resolution: 8K' },
        { label: 'Style', line: '- Style: high-end commercial hero photography / e-commerce advertising grade' },
        { label: 'Realism', line: '- Realism: hyper-realistic with accurate material physics and photo-grade detail' },
      ]
}

function normalizeGenesisDesignSpecsTemplate(params: {
  rawDesignSpecs: string
  isZh: boolean
  productSummary: string
  identity?: AnalysisBlueprint['product_visual_identity']
  sharedCopy: string
  outputLanguage: OutputLanguage
  styleLabels: string[]
}): string {
  const { rawDesignSpecs, isZh, productSummary, identity, sharedCopy, outputLanguage, styleLabels } = params
  const { sections, extras } = extractGenesisTemplateSections(rawDesignSpecs)
  const normalizedExtras = normalizeGenesisExtraLines(extras, isZh)

  const composedSections: Record<GenesisTemplateSectionKey, string> = {
    colorSystem: composeGenesisTemplateSection(
      sections.colorSystem ?? [],
      buildGenesisColorRequirements({ isZh, productSummary, identity }),
    ),
    typographyCopySystem: composeGenesisTemplateSection(
      sections.typographyCopySystem ?? [],
      buildGenesisTypographyRequirements({ isZh, outputLanguage, sharedCopy }),
    ),
    visualLanguage: composeGenesisTemplateSection(
      sections.visualLanguage ?? [],
      buildGenesisVisualRequirements({ isZh, productSummary, styleLabels }),
    ),
    photographyStyle: composeGenesisTemplateSection(
      sections.photographyStyle ?? [],
      buildGenesisPhotographyRequirements({ isZh, identity }),
    ),
    qualityRequirements: composeGenesisTemplateSection(
      sections.qualityRequirements ?? [],
      buildGenesisQualityRequirements(isZh),
      normalizedExtras,
    ),
  }

  return [
    isZh ? '# 整体设计规范' : '# Overall Design Specifications',
    isZh
      ? '> 所有图片必须遵循以下统一规范，确保视觉连贯性'
      : '> All images must follow the unified specifications below to ensure visual consistency',
    '',
    isZh ? '## 色彩系统' : '## Color System',
    composedSections.colorSystem,
    '',
    isZh ? '## 字体系统/文案系统' : '## Font System',
    composedSections.typographyCopySystem,
    '',
    isZh ? '## 视觉语言' : '## Visual Language',
    composedSections.visualLanguage,
    '',
    isZh ? '## 摄影风格' : '## Photography Style',
    composedSections.photographyStyle,
    '',
    isZh ? '## 品质要求' : '## Quality Requirements',
    composedSections.qualityRequirements,
  ].join('\n').trim()
}

function buildGenesisPlanProductAppearance(params: {
  isZh: boolean
  productSummary: string
  identity?: AnalysisBlueprint['product_visual_identity']
}): string {
  const { isZh, productSummary, identity } = params
  const primaryColor = identity?.primary_color?.trim()
  const material = identity?.material?.trim()
  const keyFeatures = (identity?.key_features ?? []).map((item) => item.trim()).filter(Boolean)
  const summary = shortGenesisCue(productSummary, isZh, isZh ? '上传商品主体' : 'the uploaded product')
  const features = keyFeatures.length > 0
    ? (isZh ? `关键特征包括 ${keyFeatures.join('、')}` : `Key features include ${keyFeatures.join(', ')}`)
    : (isZh ? '保留原图可见的 logo、五金、纹理与结构细节' : 'Preserve the visible logo, hardware, texture, and structural details')

  return isZh
    ? `必须严格保持与参考图同一 SKU、同一商品。主体表现为 ${summary}；${primaryColor ? `真实主色为 ${primaryColor}；` : ''}${material ? `材质为 ${material}；` : ''}${features}。`
    : `The subject in this image must stay strictly consistent with the same SKU and product from the reference image. The product appearance should match ${summary}; ${primaryColor ? `the true dominant color is ${primaryColor}; ` : ''}${material ? `the material is ${material}; ` : ''}${features}.`
}

function buildGenesisPlanGraphicElements(params: {
  isZh: boolean
  productSummary: string
  styleLabels: string[]
}): string[] {
  const { isZh, productSummary, styleLabels } = params
  const summaryCue = shortGenesisCue(productSummary, isZh, isZh ? '商品卖点' : 'the hero selling point')
  const styleCue = styleLabels.length > 0 ? styleLabels.join(' / ') : (isZh ? '统一商业风格' : 'a coherent commercial direction')

  return [
    isZh
      ? `- 装饰元素：围绕 ${summaryCue} 使用与商品相关的商业摄影元素、表面材质或折射/投影细节。`
      : `- Decorative elements: use commercial-photography props, surfaces, or refraction/shadow details that reinforce ${summaryCue}.`,
    isZh ? `- 统一风格：${styleCue}` : `- Unified style direction: ${styleCue}`,
    isZh
      ? '- 安全留白：预留约 30%-40% 可用留白给标题或呼吸空间，不能压迫商品。'
      : '- Safe whitespace: keep roughly 30%-40% usable negative space for typography or breathing room without crowding the product.',
  ]
}

function buildGenesisPlanCompositionLines(index: number, isZh: boolean): string[] {
  if (isZh) {
    if (index === 0) {
      return [
        '- 商品占比：主体约占画面 60%-70%',
        '- 布局方式：中心构图，保持稳定商业主视觉',
        '- 文字区域：优先预留右上或左上安全区，文字不得遮挡商品主体',
      ]
    }
    if (index === 1) {
      return [
        '- 商品占比：主体约占画面 55%-65%',
        '- 布局方式：通过轻微角度变化建立层次感，但轮廓与比例保持不变',
        '- 文字区域：只允许一个轻量标题或标签区，保持留白',
      ]
    }
    return [
      '- 商品占比：主体约占画面 50%-60%',
      '- 布局方式：收紧景别，突出材质、工艺或卖点细节',
      '- 文字区域：如需文字，仅使用边缘安全区并保持商品无遮挡',
    ]
  }

  if (index === 0) {
    return [
      '- Product Proportion: product occupies roughly 60%-70% of the frame',
      '- Layout Method: centered hero composition with stable commercial focus',
      '- Text Area: reserve a top-left or top-right safe zone and never let text cover the product',
    ]
  }
  if (index === 1) {
    return [
      '- Product Proportion: product occupies roughly 55%-65% of the frame',
      '- Layout Method: introduce a restrained angle shift while keeping silhouette and proportion identical',
      '- Text Area: allow only one light headline or label zone with generous whitespace',
    ]
  }
  return [
    '- Product Proportion: product occupies roughly 50%-60% of the frame',
    '- Layout Method: tighter framing to emphasize material, craft, or hero feature detail',
    '- Text Area: if typography is used, keep it in the edge safe zone without touching the product',
  ]
}

function buildGenesisPlanContentLines(params: {
  index: number
  isZh: boolean
  productSummary: string
  identity?: AnalysisBlueprint['product_visual_identity']
  styleLabels: string[]
}): string[] {
  const { index, isZh, productSummary, identity, styleLabels } = params
  const material = identity?.material?.trim()
  const primaryColor = identity?.primary_color?.trim()
  const keyFeatures = (identity?.key_features ?? []).map((item) => item.trim()).filter(Boolean)
  const styleCue = styleLabels.length > 0 ? styleLabels.join(' / ') : (isZh ? '统一商业风格' : 'a coherent commercial direction')
  const focus = index === 0
    ? (isZh ? '第一眼商品识别与核心卖点' : 'instant product recognition and the core selling point')
    : index === 1
      ? (isZh ? '轮廓、角度和层次变化' : 'silhouette, angle, and layered depth')
      : (isZh ? '材质、工艺或关键卖点细节' : 'material, craft, or key selling-point detail')

  return isZh
    ? [
        `- 展示重点：${focus}`,
        `- 核心卖点：围绕 ${shortGenesisCue(productSummary, true, '商品卖点')} 展开，${material ? `强化 ${material} 的质感，` : ''}${primaryColor ? `稳住 ${primaryColor} 的色锚，` : ''}不得改款或偏色。`,
        '- 背景元素：使用与商品匹配的商业背景层次、表面材质和阴影结构，保持主体边缘清晰。',
        `- 装饰元素：${keyFeatures.length > 0 ? `允许弱化呼应 ${keyFeatures.join('、')} 的视觉元素` : '允许极简商业辅助元素'}，风格统一为 ${styleCue}。`,
      ]
    : [
        `- Focus of Display: ${focus}`,
        `- Key Selling Points: build around ${shortGenesisCue(productSummary, false, 'the product story')}; ${material ? `reinforce the ${material} texture, ` : ''}${primaryColor ? `keep ${primaryColor} as the color anchor, ` : ''}and do not redesign or recolor the product.`,
        '- Background Elements: use a commercial backdrop, surface treatment, and shadow structure that keep the product edge clean and readable.',
        `- Decorative Elements: ${keyFeatures.length > 0 ? `allow subtle supporting elements that echo ${keyFeatures.join(', ')}` : 'allow only restrained supporting elements'} within ${styleCue}.`,
      ]
}

function buildGenesisTextContentLines(params: {
  isZh: boolean
  outputLanguage: OutputLanguage
  sharedCopy: string
  copyRole: 'headline' | 'headline+support' | 'label' | 'none'
  adaptationSummary: string
}): string[] {
  const { isZh, outputLanguage, sharedCopy, copyRole, adaptationSummary } = params
  const lines = sharedCopy.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  const main = lines[0] ?? ''
  const subtitle = lines[1] ?? ''
  const description = sharedCopy.trim() && copyRole !== 'none'
    ? (adaptationSummary || (isZh ? '按共享主文案做短版式排版，保持清晰层级与安全留白。' : 'Use the shared master copy in a short-form layout with clear hierarchy and safe whitespace.'))
    : (isZh ? '无新增文字，保持纯视觉表达。' : 'No added visible text. Keep the frame visual-only.')
  const languageLabel = outputLanguage === 'none'
    ? (isZh ? '纯视觉' : 'Visual Only')
    : outputLanguageLabel(outputLanguage, false)

  return [
    isZh ? `- 主标题：${main || '无'}` : `- Main Title: ${main || 'None'}`,
    isZh ? `- 副标题：${subtitle || '无'}` : `- Subtitle: ${subtitle || 'None'}`,
    isZh ? `- 说明文字：${description}（使用 ${languageLabel}）` : `- Description Text: ${description} (Using ${languageLabel})`,
  ]
}

function buildGenesisAtmosphereLines(params: {
  isZh: boolean
  identity?: AnalysisBlueprint['product_visual_identity']
  styleLabels: string[]
  title: string
}): string[] {
  const { isZh, identity, styleLabels, title } = params
  const material = identity?.material?.trim()
  const mood = styleLabels.length > 0 ? styleLabels.join(', ') : (isZh ? '高级商业感、真实材质、清晰焦点' : 'premium commercial mood, real material tactility, clear visual focus')

  return isZh
    ? [
        `- 氛围关键词：${mood}，围绕“${title}”建立镜头记忆点`,
        `- 光影效果：${material ? `根据 ${material} 的反光与体积感控制主光、轮廓光与高光层次` : '使用商业主光、轮廓光与补光'}，保留中浅景深与真实阴影过渡。`,
      ]
    : [
        `- Mood Keywords: ${mood}, built around the shot memory of "${title}"`,
        `- Light and Shadow Effects: ${material ? `tune the key light, rim light, and highlight roll-off to the ${material} surface` : 'use a commercial key light, rim light, and fill light setup'}, while keeping medium-shallow depth and realistic shadow falloff.`,
      ]
}

function buildGenesisPlanComposition(index: number, isZh: boolean): string {
  if (index === 0) {
    return isZh
      ? '主商品占画面约 55%-70%，机位稳，轮廓完整，优先建立第一眼识别与商业主视觉。'
      : 'Keep the hero product at roughly 55%-70% of frame with a stable camera angle and full-silhouette recognition.'
  }
  if (index === 1) {
    return isZh
      ? '通过轻微角度变化或景别变化增强立体感，保持商品轮廓、比例与关键结构绝对稳定。'
      : 'Use a restrained angle or framing change to add dimension while keeping silhouette, proportion, and key structure identical.'
  }
  if (index === 2) {
    return isZh
      ? '收紧景别，突出材质、工艺或关键卖点细节，同时保留足够商品识别。'
      : 'Tighten the framing to emphasize material, craft, or key selling-point detail while keeping the product recognizable.'
  }
  return isZh
    ? `做第 ${index + 1} 张差异化版本，只调整构图、裁切、景别与背景层次，不改动商品本体。`
    : `Create variation ${index + 1} by changing only composition, crop, framing, and background depth while keeping the product itself unchanged.`
}

function buildGenesisPlanSceneCue(params: {
  isZh: boolean
  productSummary: string
  identity?: AnalysisBlueprint['product_visual_identity']
  styleLabels: string[]
}): string {
  const { isZh, productSummary, identity, styleLabels } = params
  const material = identity?.material?.trim()
  const styleCue = styleLabels.length > 0 ? styleLabels.join(' / ') : (isZh ? '统一商业风格' : 'one coherent commercial style system')
  const summaryCue = shortGenesisCue(productSummary, isZh, isZh ? '商品核心卖点' : 'the product story')

  return isZh
    ? `围绕 ${summaryCue} 组织背景、道具、表面材质与空间层次；${material ? `强化 ${material} 的质感回应，` : ''}吸收 ${styleCue}，但不得引入无关品类元素。`
    : `Build background, props, surface materials, and spatial depth around ${summaryCue}; ${material ? `echo the ${material} finish, ` : ''}absorb ${styleCue}, but do not introduce irrelevant category cues.`
}

function buildGenesisPlanLightingCue(params: {
  isZh: boolean
  identity?: AnalysisBlueprint['product_visual_identity']
}): string {
  const { isZh, identity } = params
  const material = identity?.material?.trim()
  return isZh
    ? `${material ? `根据 ${material} 的表面反光控制主光与高光，` : ''}使用商业级主光、轮廓光与补光，保留清晰边缘、高光层次与中浅景深。`
    : `${material ? `Tune the key light and highlight roll-off to the ${material} surface, ` : ''}using a commercial key/rim/fill setup with clear edge definition, highlight hierarchy, and medium-shallow depth of field.`
}

function buildGenesisPlanTypographyCue(params: {
  isZh: boolean
  outputLanguage: OutputLanguage
  sharedCopy: string
  copyRole: 'headline' | 'headline+support' | 'label' | 'none'
  adaptationSummary: string
}): string {
  const { isZh, outputLanguage, sharedCopy, copyRole, adaptationSummary } = params
  if (outputLanguage === 'none' || !sharedCopy.trim() || copyRole === 'none') {
    return isZh
      ? '无新增文字，保留 30%-40% 安全留白，用纯视觉构图表达商业感。'
      : 'No added typography. Preserve 30%-40% safe whitespace and let the visual composition carry the commercial mood.'
  }

  return isZh
    ? `使用共享主文案“${sharedCopy.trim()}”，本图文案角色为 ${copyRole}；${adaptationSummary || '文字必须落在安全留白区，层级清晰，且不得遮挡商品主体。'}`
    : `Use the shared master copy "${sharedCopy.trim()}" with copy role ${copyRole}; ${adaptationSummary || 'Typography must sit in safe whitespace with clear hierarchy and must not cover the product.'}`
}

function buildGenesisPlanMoodCue(params: {
  isZh: boolean
  styleLabels: string[]
  title: string
}): string {
  const { isZh, styleLabels, title } = params
  const styleCue = styleLabels.length > 0 ? styleLabels.join(' / ') : (isZh ? '统一商业大片感' : 'coherent commercial hero mood')
  return isZh
    ? `${styleCue}、商品真实质感、清晰卖点焦点、克制排版，围绕“${title}”建立镜头记忆点。`
    : `${styleCue}, real product tactility, clear selling-point focus, and restrained typography built around the shot idea "${title}".`
}

function normalizeGenesisImagePlanTemplate(params: {
  index: number
  plan: BlueprintImagePlan
  isZh: boolean
  productSummary: string
  identity?: AnalysisBlueprint['product_visual_identity']
  styleLabels: string[]
  sharedCopy: string
  outputLanguage: OutputLanguage
  copyRole: 'headline' | 'headline+support' | 'label' | 'none'
  adaptationSummary: string
}): BlueprintImagePlan {
  const {
    index,
    plan,
    isZh,
    productSummary,
    identity,
    styleLabels,
    sharedCopy,
    outputLanguage,
    copyRole,
    adaptationSummary,
  } = params
  const roleIndex = index + 1
  const title = asTrimmedString(plan.title, fallbackPlanTitle(index, isZh))
  const description = asTrimmedString(plan.description, fallbackPlanDescription(isZh))
  const rawSupplement = asTrimmedString(plan.design_content, '')
  const supplement = rawSupplement
    ? rawSupplement.replace(/\s+/g, ' ').trim()
    : ''

  const parts = [
    isZh ? `## 图片 [${roleIndex}]：${title}` : `## Image [${roleIndex}]: ${title}`,
    isZh ? `**设计目标**：${description}` : `**Design Goal**: ${description}`,
    isZh
      ? `**商品外观**：${buildGenesisPlanProductAppearance({ isZh: true, productSummary, identity })}`
      : `**Product Appearance**: ${buildGenesisPlanProductAppearance({ isZh: false, productSummary, identity })}`,
    isZh ? '**画内元素**：' : '**In-Graphic Elements**:',
    ...buildGenesisPlanGraphicElements({ isZh, productSummary, styleLabels }),
    '',
    isZh ? '**构图规划**：' : '**Composition Plan**:',
    ...buildGenesisPlanCompositionLines(index, isZh),
    '',
    isZh ? '**内容元素**：' : '**Content Elements**:',
    ...buildGenesisPlanContentLines({ index, isZh, productSummary, identity, styleLabels }),
    '',
    isZh ? `**文字内容**（使用 ${outputLanguage === 'none' ? '纯视觉' : outputLanguageLabel(outputLanguage, false)}）：` : `**Text Content** (Using ${outputLanguage === 'none' ? 'Visual Only' : outputLanguageLabel(outputLanguage, false)}):`,
    ...buildGenesisTextContentLines({ isZh, outputLanguage, sharedCopy, copyRole, adaptationSummary }),
    '',
    isZh ? '**氛围营造**：' : '**Atmosphere Creation**:',
    ...buildGenesisAtmosphereLines({ isZh, identity, styleLabels, title }),
  ]

  if (supplement && !parts.some((part) => part.includes(supplement))) {
    parts.push(
      isZh
        ? `**补充执行说明**：${supplement}`
        : `**Additional Execution Notes**: ${supplement}`,
    )
  }

  return {
    ...plan,
    title,
    description,
    design_content: parts.join('\n\n'),
  }
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
  const normalizedCount = Math.max(1, Math.min(15, Number(imageCount || 1)))
  const sharedCopy = outputLanguage === 'none' ? '' : copyPlan.trim()
  const hasCopy = sharedCopy.length > 0

  const images: BlueprintImagePlan[] = Array.from({ length: normalizedCount }, (_, index) => {
    const roleIndex = index + 1
    let title = ''
    let description = ''

    if (roleIndex === 1) {
      title = isZh ? '主视觉封面' : 'Hero Cover'
      description = isZh ? '第一张负责稳定建立商品识别与核心卖点，不做激进变化。' : 'Stabilize product recognition and lead with the core selling point without aggressive variation.'
    } else if (roleIndex === 2) {
      title = isZh ? '角度变化图' : 'Angle Variation'
      description = isZh ? '仅做机位和景别变化，仍保持同款商品身份完全不变。' : 'Vary only camera angle and framing while preserving the exact same product identity.'
    } else if (roleIndex === 3) {
      title = isZh ? '特征强化图' : 'Feature Reinforcement'
      description = isZh ? '放大核心五官与材质识别点，证明商品细节没有漂移。' : 'Magnify the signature features and material cues to prove the product details remain stable.'
    } else {
      title = isZh ? `构图变化图 ${roleIndex}` : `Composition Variation ${roleIndex}`
      description = isZh ? '在不改款前提下做构图、景别或场景变化。' : 'Vary composition, framing, or scene without changing the product design.'
    }

    return normalizeGenesisImagePlanTemplate({
      index,
      plan: {
        id: `hero-plan-${roleIndex}`,
        title,
        description,
        design_content: '',
      },
      isZh,
      productSummary: genesisAnalysis.product_summary,
      identity: genesisAnalysis.product_visual_identity,
      styleLabels,
      sharedCopy,
      outputLanguage,
      copyRole: hasCopy ? defaultGenesisCopyRole(index, true) : 'none',
      adaptationSummary: defaultGenesisCopyAdaptation(index, hasCopy, isZh),
    })
  })

  return {
    images,
    design_specs: normalizeGenesisDesignSpecsTemplate({
      rawDesignSpecs: '',
      isZh,
      productSummary: genesisAnalysis.product_summary,
      identity: genesisAnalysis.product_visual_identity,
      sharedCopy,
      outputLanguage,
      styleLabels,
    }),
    _ai_meta: {
      ...genesisAnalysis._ai_meta,
      image_count: normalizedCount,
      target_language: outputLanguage,
    },
    copy_analysis: {
      mode: outputLanguage === 'none' || !hasCopy ? 'visual-only' : 'product-inferred',
      source_brief: '',
      brief_summary: genesisAnalysis.product_summary,
      product_summary: genesisAnalysis.product_summary,
      resolved_output_language: outputLanguage,
      shared_copy: sharedCopy,
      can_clear_to_visual_only: true,
      per_plan_adaptations: images.map((_, index) => ({
        plan_index: index,
        plan_type: index === 0 ? 'hero' : index === 1 ? 'angle' : 'feature',
        copy_role: hasCopy ? defaultGenesisCopyRole(index, true) : 'none',
        adaptation_summary: defaultGenesisCopyAdaptation(index, hasCopy, isZh),
      })),
    },
    product_summary: genesisAnalysis.product_summary,
    product_visual_identity: genesisAnalysis.product_visual_identity,
    style_directions: genesisAnalysis.style_directions,
  }
}

function normalizeAnalysisBlueprintResult(
  resultData: unknown,
  expectedCount: number,
  isZh: boolean,
): AnalysisBlueprint | null {
  if (isAnalysisBlueprint(resultData)) {
    const rawCopyAnalysis = resultData.copy_analysis
    const sharedCopy = rawCopyAnalysis?.shared_copy ?? ''
    const outputLanguage = (rawCopyAnalysis?.resolved_output_language ?? (isZh ? 'zh' : 'en')) as OutputLanguage
    const styleLabels = selectedGenesisStyleLabels(
      resultData.style_directions ? { style_directions: resultData.style_directions } : null,
      {},
    )
    const normalizedImages = resultData.images.map((plan, index) => {
      const existing = rawCopyAnalysis?.per_plan_adaptations?.[index]
      return normalizeGenesisImagePlanTemplate({
        index,
        plan,
        isZh,
        productSummary: resultData.product_summary ?? rawCopyAnalysis?.product_summary ?? '',
        identity: resultData.product_visual_identity,
        styleLabels,
        sharedCopy,
        outputLanguage,
        copyRole: existing?.copy_role ?? defaultGenesisCopyRole(index, sharedCopy.trim().length > 0),
        adaptationSummary: existing?.adaptation_summary ?? defaultGenesisCopyAdaptation(index, sharedCopy.trim().length > 0, isZh),
      })
    })

    return {
      ...resultData,
      images: normalizedImages,
      design_specs: normalizeGenesisDesignSpecsTemplate({
        rawDesignSpecs: resultData.design_specs,
        isZh,
        productSummary: resultData.product_summary ?? rawCopyAnalysis?.product_summary ?? '',
        identity: resultData.product_visual_identity,
        sharedCopy,
        outputLanguage,
        styleLabels,
      }),
    }
  }

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
      id: `hero-plan-${images.length + 1}`,
      title: fallbackPlanTitle(images.length, isZh),
      description: fallbackPlanDescription(isZh),
      design_content: fallbackPlanDesignContent(isZh),
    })
  }
  const meta = parsed._ai_meta && typeof parsed._ai_meta === 'object'
    ? (parsed._ai_meta as Record<string, unknown>)
    : {}
  const imageCountMeta = Number(meta.image_count)
  const rawCopyAnalysis = parsed.copy_analysis && typeof parsed.copy_analysis === 'object' && !Array.isArray(parsed.copy_analysis)
    ? parsed.copy_analysis as Record<string, unknown>
    : parsed.copyAnalysis && typeof parsed.copyAnalysis === 'object' && !Array.isArray(parsed.copyAnalysis)
      ? parsed.copyAnalysis as Record<string, unknown>
      : null
  const rawPerPlanAdaptations = Array.isArray(rawCopyAnalysis?.per_plan_adaptations ?? rawCopyAnalysis?.perPlanAdaptations)
    ? (rawCopyAnalysis?.per_plan_adaptations ?? rawCopyAnalysis?.perPlanAdaptations) as Array<Record<string, unknown>>
    : []
  const normalizedStyleDirections = Array.isArray(parsed.style_directions) || parsed.style_directions && typeof parsed.style_directions === 'object'
    ? normalizeGenesisAnalysisResult(parsed, isZh, '', isZh ? 'zh' : 'en').style_directions
    : Array.isArray(parsed.styleDirections) || parsed.styleDirections && typeof parsed.styleDirections === 'object'
      ? normalizeGenesisAnalysisResult(parsed, isZh, '', isZh ? 'zh' : 'en').style_directions
      : undefined
  const outputLanguage = asTrimmedString(
    rawCopyAnalysis?.resolved_output_language ?? rawCopyAnalysis?.resolvedOutputLanguage,
    isZh ? 'zh' : 'en',
  ) as OutputLanguage
  const sharedCopy = asTrimmedString(rawCopyAnalysis?.shared_copy ?? rawCopyAnalysis?.sharedCopy, '')
  const productSummary = asTrimmedString(parsed.product_summary ?? parsed.productSummary, '')
  const productVisualIdentity = parsed.product_visual_identity && typeof parsed.product_visual_identity === 'object'
    ? parsed.product_visual_identity as AnalysisBlueprint['product_visual_identity']
    : parsed.productVisualIdentity && typeof parsed.productVisualIdentity === 'object'
      ? parsed.productVisualIdentity as AnalysisBlueprint['product_visual_identity']
      : undefined
  const styleLabels = selectedGenesisStyleLabels(
    normalizedStyleDirections ? { style_directions: normalizedStyleDirections } : null,
    {},
  )
  const normalizedImages = images.slice(0, normalizedCount).map((plan, index) => {
    const adaptation = rawPerPlanAdaptations[index]
    const copyRole = adaptation?.copy_role === 'headline' || adaptation?.copy_role === 'headline+support' || adaptation?.copy_role === 'label' || adaptation?.copy_role === 'none'
      ? adaptation.copy_role
      : adaptation?.copyRole === 'headline' || adaptation?.copyRole === 'headline+support' || adaptation?.copyRole === 'label' || adaptation?.copyRole === 'none'
        ? adaptation.copyRole
        : defaultGenesisCopyRole(index, sharedCopy.trim().length > 0)

    return normalizeGenesisImagePlanTemplate({
      index,
      plan,
      isZh,
      productSummary,
      identity: productVisualIdentity,
      styleLabels,
      sharedCopy,
      outputLanguage,
      copyRole,
      adaptationSummary: asTrimmedString(
        adaptation?.adaptation_summary ?? adaptation?.adaptationSummary,
        defaultGenesisCopyAdaptation(index, sharedCopy.trim().length > 0, isZh),
      ),
    })
  })

  return {
    images: normalizedImages,
    design_specs: normalizeGenesisDesignSpecsTemplate({
      rawDesignSpecs: asTrimmedString(parsed.design_specs, '')
        || asTrimmedString(parsed.designSpecs, '')
        || asTrimmedString(parsed.specs, ''),
      isZh,
      productSummary,
      identity: productVisualIdentity,
      sharedCopy,
      outputLanguage,
      styleLabels,
    }),
    _ai_meta: {
      model: asTrimmedString(meta.model, 'unknown'),
      usage: meta.usage && typeof meta.usage === 'object' ? meta.usage as Record<string, unknown> : {},
      provider: asTrimmedString(meta.provider, 'fallback'),
      image_count: Number.isFinite(imageCountMeta) && imageCountMeta > 0 ? Math.round(imageCountMeta) : normalizedImages.length,
      target_language: asTrimmedString(meta.target_language, isZh ? 'zh' : 'en'),
    },
    ...(rawCopyAnalysis ? {
      copy_analysis: {
        mode: rawCopyAnalysis.mode === 'user-brief' || rawCopyAnalysis.mode === 'product-inferred' || rawCopyAnalysis.mode === 'visual-only'
          ? rawCopyAnalysis.mode
          : 'product-inferred',
        source_brief: asTrimmedString(rawCopyAnalysis.source_brief ?? rawCopyAnalysis.sourceBrief, ''),
        brief_summary: asTrimmedString(rawCopyAnalysis.brief_summary ?? rawCopyAnalysis.briefSummary, ''),
        product_summary: asTrimmedString(rawCopyAnalysis.product_summary ?? rawCopyAnalysis.productSummary, ''),
        resolved_output_language: outputLanguage,
        shared_copy: sharedCopy,
        can_clear_to_visual_only: true,
        per_plan_adaptations: rawPerPlanAdaptations.map((item, index) => ({
          plan_index: Number.isFinite(Number(item.plan_index ?? item.planIndex)) ? Number(item.plan_index ?? item.planIndex) : index,
          plan_type: asTrimmedString(item.plan_type ?? item.planType, 'hero'),
          copy_role: item.copy_role === 'headline' || item.copy_role === 'headline+support' || item.copy_role === 'label' || item.copy_role === 'none'
            ? item.copy_role
            : item.copyRole === 'headline' || item.copyRole === 'headline+support' || item.copyRole === 'label' || item.copyRole === 'none'
              ? item.copyRole
              : 'none',
          adaptation_summary: asTrimmedString(item.adaptation_summary ?? item.adaptationSummary, ''),
        })),
      },
    } : {}),
    product_summary: productSummary,
    product_visual_identity: productVisualIdentity,
    style_directions: normalizedStyleDirections,
  }
}

function prepareGenesisBlueprintForGeneration(params: {
  blueprint: AnalysisBlueprint
  genesisAnalysis: GenesisAnalysisResult | null
  styleSelections: GenesisStyleSelections
  copyPlan: string
  imageCount: number
  isZh: boolean
  outputLanguage: OutputLanguage
  requirements: string
}): AnalysisBlueprint {
  const { blueprint, genesisAnalysis, styleSelections, copyPlan, imageCount, isZh, outputLanguage, requirements } = params
  const normalizedCount = Math.max(1, Math.min(15, Number(imageCount || blueprint.images.length || 1)))
  const images = blueprint.images.slice(0, normalizedCount)

  while (images.length < normalizedCount) {
    const index = images.length
    images.push({
      id: `hero-plan-${index + 1}`,
      title: fallbackPlanTitle(index, isZh),
      description: fallbackPlanDescription(isZh),
      design_content: fallbackPlanDesignContent(isZh),
    })
  }

  const sharedCopy = outputLanguage === 'none' ? '' : copyPlan.trim()
  const hasCopy = sharedCopy.length > 0
  const existingCopyAnalysis = blueprint.copy_analysis
  const styleLabels = selectedGenesisStyleLabels(
    genesisAnalysis ?? (blueprint.style_directions ? { style_directions: blueprint.style_directions } : null),
    styleSelections,
  )
  const normalizedImages = images.map((plan, index) => {
    const existing = existingCopyAnalysis?.per_plan_adaptations?.[index]
    const copyRole = hasCopy ? (existing?.copy_role ?? defaultGenesisCopyRole(index, true)) : 'none'

    return normalizeGenesisImagePlanTemplate({
      index,
      plan,
      isZh,
      productSummary: blueprint.product_summary || genesisAnalysis?.product_summary || '',
      identity: blueprint.product_visual_identity || genesisAnalysis?.product_visual_identity,
      styleLabels,
      sharedCopy,
      outputLanguage,
      copyRole,
      adaptationSummary: hasCopy
        ? (existing?.adaptation_summary || defaultGenesisCopyAdaptation(index, true, isZh))
        : defaultGenesisCopyAdaptation(index, false, isZh),
    })
  })

  return {
    ...blueprint,
    images: normalizedImages,
    design_specs: normalizeGenesisDesignSpecsTemplate({
      rawDesignSpecs: blueprint.design_specs,
      isZh,
      productSummary: blueprint.product_summary || genesisAnalysis?.product_summary || '',
      identity: blueprint.product_visual_identity || genesisAnalysis?.product_visual_identity,
      sharedCopy,
      outputLanguage,
      styleLabels,
    }),
    _ai_meta: {
      ...blueprint._ai_meta,
      image_count: normalizedCount,
      target_language: outputLanguage,
    },
    copy_analysis: {
      mode: outputLanguage === 'none' || !hasCopy
        ? 'visual-only'
        : existingCopyAnalysis?.mode === 'user-brief' || requirements.trim().length > 0
          ? 'user-brief'
          : 'product-inferred',
      source_brief: existingCopyAnalysis?.source_brief ?? requirements.trim(),
      brief_summary: existingCopyAnalysis?.brief_summary || genesisAnalysis?.product_summary || requirements.trim(),
      product_summary: existingCopyAnalysis?.product_summary || genesisAnalysis?.product_summary || '',
      resolved_output_language: outputLanguage,
      shared_copy: sharedCopy,
      can_clear_to_visual_only: true,
      per_plan_adaptations: normalizedImages.map((_, index) => {
        const existing = existingCopyAnalysis?.per_plan_adaptations?.[index]
        return {
          plan_index: index,
          plan_type: existing?.plan_type || (index === 0 ? 'hero' : index === 1 ? 'angle' : 'feature'),
          copy_role: hasCopy ? (existing?.copy_role ?? defaultGenesisCopyRole(index, true)) : 'none',
          adaptation_summary: hasCopy
            ? (existing?.adaptation_summary || defaultGenesisCopyAdaptation(index, true, isZh))
            : defaultGenesisCopyAdaptation(index, false, isZh),
        }
      }),
    },
    product_summary: blueprint.product_summary || genesisAnalysis?.product_summary,
    product_visual_identity: blueprint.product_visual_identity || genesisAnalysis?.product_visual_identity,
    style_directions: blueprint.style_directions || genesisAnalysis?.style_directions,
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
      <div className="group relative w-[220px] max-w-full overflow-hidden rounded-xl border border-border bg-muted" style={{ aspectRatio: boxAspectRatio }}>
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
    <div className="flex w-[220px] max-w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface p-4" style={{ aspectRatio: boxAspectRatio }}>
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

// ─── Component ───────────────────────────────────────────────────────────────

export function StudioGenesisForm() {
  const t = useTranslations('studio.genesis')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const router = useRouter()
  const isZh = locale.startsWith('zh')
  const userEmail = useUserEmail()
  useAdminImageModels(userEmail)
  const defaultRequirements = getGenesisDefaultRequirements(isZh)

  // ── Input state ──
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [requirements, setRequirements] = useState(defaultRequirements)
  const [imageCount, setImageCount] = useState(1)
  const [model, setModel] = useState<GenerationModel>(DEFAULT_MODEL)
  const { promptProfile } = usePromptProfile(model)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>(isZh ? 'zh' : 'en')
  // Locale-aware constants
  const ASPECT_RATIOS = locale === 'zh' ? ASPECT_RATIOS_ZH : ASPECT_RATIOS_EN
  const OUTPUT_LANGUAGES = locale === 'zh' ? OUTPUT_LANGUAGES_ZH : OUTPUT_LANGUAGES_EN

  // ── Preview state ──
  const [genesisAnalysis, setGenesisAnalysis] = useState<GenesisAnalysisResult | null>(null)
  const [genesisBlueprint, setGenesisBlueprint] = useState<AnalysisBlueprint | null>(null)
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
    activeBatchId,
    activeBatchTimestamp,
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
  const leftCardClass = 'rounded-[28px] border border-border bg-white p-5 sm:p-6'
  const panelInputClass = 'h-11 rounded-2xl border-border bg-secondary text-[14px]'
  const rightPanelTitle = phase === 'analyzing'
    ? (isZh ? '分析中...' : 'Analyzing...')
    : phase === 'preview'
      ? (isZh ? '主图蓝图' : 'Hero Blueprint')
    : phase === 'generating'
      ? (isZh ? '生成中...' : 'Generating...')
      : isZh
        ? '生成结果'
        : tc('results')
  const rightPanelSubtitle = phase === 'analyzing'
    ? (isZh ? '正在分析产品并生成风格与文案' : 'Analyzing product and preparing style and copy')
    : phase === 'preview'
      ? (isZh ? '编辑主图商业蓝图、可选风格微调与共享主文案后生成主图' : 'Edit the hero blueprint, optional style refinements, and shared master copy before generation')
    : phase === 'generating'
      ? (isZh ? '正在根据确认后的主图蓝图生成图片' : 'Generating hero images from the approved blueprint')
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
    setGenesisBlueprint(null)
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
        promptProfile,
        requirements: requirements || undefined,
        imageCount,
        uiLanguage: backendLocale,
        outputLanguage,
        studioType: 'genesis',
        trace_id,
      })

      // Nudge worker to start processing (fire-and-forget)
      processGenerationJob(analysisJobId).catch(() => {})

      const analysisJob = await waitForJob(analysisJobId, abort.signal, {
        timeoutMs: ANALYSIS_WAIT_TIMEOUT_MS,
        timeoutErrorMessage: ANALYSIS_TIMEOUT_ERROR,
      })
      set('analyze', { status: 'done' })
      setProgress(100)
      const analysis = normalizeGenesisAnalysisResult(analysisJob.result_data, isZh, requirements, outputLanguage)
      const initialStyleSelections = analysis.style_directions.reduce<GenesisStyleSelections>((acc, group) => {
        if (group.recommended) acc[group.key] = group.recommended
        return acc
      }, {})
      const parsedBlueprint = normalizeAnalysisBlueprintResult(analysisJob.result_data, imageCount, isZh)
        ?? buildGenesisHeroBlueprint({
          genesisAnalysis: analysis,
          styleSelections: initialStyleSelections,
          copyPlan: analysis.copy_plan ?? '',
          imageCount,
          isZh,
          outputLanguage,
        })
      setGenesisAnalysis(analysis)
      setGenesisBlueprint(parsedBlueprint)
      setCopyPlan(parsedBlueprint.copy_analysis?.shared_copy ?? analysis.copy_plan ?? '')
      setStyleSelections(initialStyleSelections)
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
      const rawMessage = err instanceof Error ? err.message : tc('error')
      setErrorMessage(
        rawMessage === ANALYSIS_TIMEOUT_ERROR
          ? t('analysisTimeout')
          : friendlyError(rawMessage, isZh)
      )
      setSteps((prev) => prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)))
      setPhase(fallbackPhase)
    }
  }, [productImages, requirements, imageCount, outputLanguage, backendLocale, isZh, t, tc, genesisAnalysis, promptProfile])

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
    if (!genesisBlueprint) return
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

      const blueprint = prepareGenesisBlueprintForGeneration({
        blueprint: genesisBlueprint,
        genesisAnalysis,
        styleSelections,
        copyPlan,
        imageCount,
        isZh,
        outputLanguage,
        requirements,
      })

      let promptText = ''
      const promptStream = await generatePromptsV2Stream(
        {
          module: 'genesis',
          analysisJson: blueprint,
          design_specs: blueprint.design_specs,
          promptProfile,
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
            promptProfile,
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
              product_visual_identity: genesisAnalysis?.product_visual_identity ?? null,
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
      appendResults(successResults, {
        activeBatchId: batchId,
        activeBatchTimestamp: batchTimestamp,
      })
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
  }, [analysisParams, appendResults, aspectRatio, backendLocale, copyPlan, genesisAnalysis, genesisBlueprint, imageCount, imageSize, isZh, model, outputLanguage, productImages, requirements, styleSelections, t, tc, uploadedUrls, promptProfile])

  const handleBackToInput = useCallback(() => {
    setPhase('input')
    setSteps([])
    setProgress(0)
    setErrorMessage(null)
    setAnalysisParams(null)
    setGenesisBlueprint(null)
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
    setGenesisBlueprint(null)
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
          promptProfile,
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
            const result = extractResultFromJob(
              job,
              slotIdx,
              activeBatchId,
              activeBatchTimestamp,
            )
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
      appendResults(retryResults, {
        activeBatchId,
        activeBatchTimestamp,
      })
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
  }, [activeBatchId, activeBatchTimestamp, appendResults, retryContext, failedSlotIndices, uploadedUrls, model, aspectRatio, imageSize, isZh, t, genesisAnalysis, promptProfile])

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

  const handleCopyPlanChange = useCallback((value: string) => {
    const nextValue = clampText(value, TEXT_LIMITS.sharedCopy)
    setCopyPlan(nextValue)
    setGenesisBlueprint((prev) => prev ? {
      ...prev,
      copy_analysis: {
        mode: nextValue.trim().length === 0 || outputLanguage === 'none'
          ? 'visual-only'
          : prev.copy_analysis?.mode === 'user-brief'
            ? 'user-brief'
            : requirements.trim().length > 0
              ? 'user-brief'
              : 'product-inferred',
        source_brief: prev.copy_analysis?.source_brief ?? requirements.trim(),
        brief_summary: prev.copy_analysis?.brief_summary ?? genesisAnalysis?.product_summary ?? requirements.trim(),
        product_summary: prev.copy_analysis?.product_summary ?? genesisAnalysis?.product_summary ?? '',
        resolved_output_language: outputLanguage,
        shared_copy: outputLanguage === 'none' ? '' : nextValue,
        can_clear_to_visual_only: true,
        per_plan_adaptations: prev.images.map((_, index) => {
          const existing = prev.copy_analysis?.per_plan_adaptations?.[index]
          const hasCopy = outputLanguage !== 'none' && nextValue.trim().length > 0
          return {
            plan_index: index,
            plan_type: existing?.plan_type ?? (index === 0 ? 'hero' : index === 1 ? 'angle' : 'feature'),
            copy_role: hasCopy ? (existing?.copy_role ?? defaultGenesisCopyRole(index, true)) : 'none',
            adaptation_summary: hasCopy
              ? (existing?.adaptation_summary ?? defaultGenesisCopyAdaptation(index, true, isZh))
              : defaultGenesisCopyAdaptation(index, false, isZh),
          }
        }),
      },
    } : prev)
  }, [genesisAnalysis, isZh, outputLanguage, requirements])

  // ─── Render ────────────────────────────────────────────────────────────────

  // Determine button state
  const renderLeftButton = () => {
    if (phase === 'input') {
      return (
        <Button
          size="lg"
          onClick={handleAnalyze}
          disabled={productImages.length === 0}
          className="h-14 w-full rounded-2xl bg-primary text-base font-semibold text-white hover:opacity-90 disabled:bg-primary disabled:text-white"
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
          className="h-14 w-full rounded-2xl bg-primary text-base font-semibold text-white"
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
              className="h-14 w-full rounded-3xl bg-primary text-[17px] font-semibold text-white hover:opacity-90 disabled:bg-muted"
            >
              <ArrowRight className="mr-2 h-5 w-5" />
              {isZh
                ? `确认生成 ${imageCount} 张主图`
                : `Generate ${imageCount} ${imageCount > 1 ? 'hero images' : 'hero image'}`}
            </Button>
          )}

          <p className="text-center text-[14px] text-muted-foreground">
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
            className="h-14 w-full rounded-3xl border-border bg-secondary text-[17px] font-semibold text-foreground hover:bg-muted"
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
            className="h-14 w-full rounded-3xl bg-primary text-[17px] font-semibold text-white"
          >
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('steps.generate')}
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
      )
    }

    // complete
    return (
      <div className="space-y-3">
        <Button
          size="lg"
          onClick={handleNewGeneration}
          className="h-14 w-full rounded-3xl bg-primary text-[17px] font-semibold text-white hover:bg-primary"
        >
          {t('newGeneration')}
        </Button>
        {genesisAnalysis && (
          <Button
            variant="outline"
            size="lg"
            onClick={handleBackToPreview}
            className="h-14 w-full rounded-3xl border-border bg-secondary text-[17px] font-semibold text-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('backToEdit')}
          </Button>
        )}
      </div>
    )
  }

  const persistedHistoryGallery = results.length > 0 ? (
    <ResultGallery
      images={results}
      activeBatchId={activeBatchId}
      aspectRatio={aspectRatio}
      onClear={clearResults}
      editorSessionKey="studio-genesis-v2"
      originModule="studio-genesis"
    />
  ) : null

  // Right panel content
  const renderRightPanel = () => {
    if (phase === 'input') {
      if (persistedHistoryGallery) return <div className="space-y-6">{persistedHistoryGallery}</div>
      return (
        <div className="flex min-h-[520px] flex-col items-center justify-center px-4 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Sparkles className="h-8 w-8" />
          </div>
          <p className="max-w-[320px] text-base leading-7 text-muted-foreground">{t('emptyState')}</p>
        </div>
      )
    }

    if (phase === 'analyzing') {
      return (
        <div className="space-y-6">
          <CoreProcessingStatus
            title={isZh ? '分析中...' : 'Analyzing...'}
            subtitle={isZh ? '正在分析产品并生成设计规范' : 'Analyzing product and generating design specs'}
            progress={progress}
            statusLine={analyzingMessages[analyzingMessageIndex] ?? ''}
            showHeader={false}
            statusPlacement="below"
          />
          {persistedHistoryGallery}
        </div>
      )
    }

    if (phase === 'preview') {
      return (
        <div className="space-y-6">
          {genesisAnalysis?.style_directions.length ? (
            <div className="rounded-[28px] border border-border bg-white p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">{isZh ? '风格微调' : 'Style Refinements'}</h3>
                  <p className="text-[13px] text-muted-foreground">{isZh ? `蓝图已经包含主风格，这里只做可选微调。自定义标签最多 ${TEXT_LIMITS.customTag} 字。` : `The blueprint already contains the primary creative direction. These are optional refinements only. Custom tags are limited to ${TEXT_LIMITS.customTag} characters.`}</p>
                </div>
              </div>

              <div className="space-y-4">
                {genesisAnalysis.style_directions.map((group) => {
                  const selectedValue = styleSelections[group.key]
                  const customTag = customStyleTags[group.key]
                  const isAdding = activeCustomInputKey === group.key
                  return (
                    <div key={group.key}>
                      <p className="mb-2 text-[13px] font-medium text-muted-foreground">
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
                                ? 'rounded-full bg-primary px-3 py-1.5 text-[13px] font-medium text-white transition-colors'
                                : 'rounded-full border border-border bg-secondary px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground'}
                            >
                              {option}
                            </button>
                          )
                        })}
                        {customTag && (
                          <span className={selectedValue === customTag
                            ? 'inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[13px] font-medium text-white'
                            : 'inline-flex items-center gap-1 rounded-full border border-foreground bg-background px-3 py-1.5 text-[13px] font-medium text-foreground'}>
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
                            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:border-foreground"
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
                            onChange={(e) => setCustomTagInputs((prev) => ({
                              ...prev,
                              [group.key]: clampText(e.target.value, TEXT_LIMITS.customTag),
                            }))}
                            maxLength={TEXT_LIMITS.customTag}
                            placeholder={isZh ? '输入自定义标签' : 'Enter a custom tag'}
                            className="h-10 flex-1 rounded-2xl border border-border bg-secondary px-3 text-[13px] text-foreground outline-none"
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
          ) : null}

          <div className="rounded-[28px] border border-border bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">{isZh ? '共享主文案' : 'Shared Master Copy'}</h3>
                <p className="text-[13px] text-muted-foreground">
                  {outputLanguage === 'none'
                    ? (isZh ? '当前为纯视觉模式，本批主图不新增文字，建议保持为空。' : 'Visual-only mode is selected. This batch will not add new typography, so leave this empty.')
                    : (isZh ? '这里是整组图片共用的短句式主文案源。清空后，本批主图按纯视觉生成。' : 'This is the short shared master-copy source used across the full hero-image set. Clear it to generate a visual-only batch.')}
                </p>
              </div>
            </div>
            <Textarea
              value={copyPlan}
              onChange={(e) => handleCopyPlanChange(e.target.value)}
              disabled={outputLanguage === 'none'}
              rows={6}
              maxLength={TEXT_LIMITS.sharedCopy}
              className="min-h-[180px] resize-none rounded-2xl border-border bg-secondary text-[14px] leading-6"
              placeholder={isZh ? '输入短句式共享主文案；留空则按纯视觉主图处理。' : 'Enter compact shared master copy. Leave empty for visual-only hero images.'}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {formatTextCounter(copyPlan, TEXT_LIMITS.sharedCopy, isZh)}
            </p>
          </div>

          {genesisBlueprint ? (
            <DesignBlueprint
              designSpecs={genesisBlueprint.design_specs}
              onDesignSpecsChange={(value) => setGenesisBlueprint((prev) => prev ? { ...prev, design_specs: value } : prev)}
              imagePlans={genesisBlueprint.images}
              onImagePlanChange={(index, plan) => {
                setGenesisBlueprint((prev) => prev ? {
                  ...prev,
                  images: prev.images.map((item, currentIndex) => (currentIndex === index ? plan : item)),
                } : prev)
              }}
            />
          ) : null}

          {persistedHistoryGallery}
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

          {persistedHistoryGallery}
        </div>
      )
    }

    // complete
    return (
      <div className="space-y-6">
        {persistedHistoryGallery}

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
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5 text-xs font-medium text-foreground">
            <Sparkles className="h-4 w-4" />
            <span>{isZh ? 'AI 主图生成' : 'AI Hero Image Generator'}</span>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('title')}</h1>
          <p className="mx-auto mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground sm:text-base">{t('description')}</p>
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[15px] font-semibold text-foreground">{tc('productImage')}</h3>
                    <p className="text-[13px] text-muted-foreground">{isZh ? '上传清晰的产品图片' : tc('uploadSublabel')}</p>
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
                  label={isZh ? '多图上传建议仅上传必要的视角或sku图，图片不是越多越好' : tc('uploadLabel')}
                  hideDefaultFooter={isZh}
                  footerText={`${productImages.length}/6 images · max 10 MB each`}
                  dropzoneClassName="min-h-[186px] rounded-2xl border-border bg-secondary px-6 py-8 hover:border-muted-foreground hover:bg-muted"
                  labelClassName={isZh ? 'max-w-[260px] text-sm leading-6 text-foreground' : undefined}
                  footerClassName="text-xs text-muted-foreground"
                />
              </div>
            </fieldset>

            <div className={leftCardClass}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">{isZh ? '主图要求' : 'Hero Image Brief'}</h3>
                  <p className="text-[13px] text-muted-foreground">{isZh ? '默认文案可直接修改或删除，用户要求优先于产品图分析。' : 'Edit or remove the default brief. The user brief takes priority over image inference.'}</p>
                </div>
              </div>

              <Textarea
                id="sg-req"
                value={requirements}
                onChange={(e) => setRequirements(clampText(e.target.value, TEXT_LIMITS.brief))}
                rows={5}
                disabled={leftPanelDisabled}
                maxLength={TEXT_LIMITS.brief}
                className="min-h-[128px] resize-none rounded-2xl border-border bg-secondary text-[14px] leading-6 text-foreground"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {formatTextCounter(requirements, TEXT_LIMITS.brief, isZh)}
              </p>

              <div className="mt-4 space-y-1.5">
                <Label className="text-[13px] font-medium text-muted-foreground">{t('outputLanguage')}</Label>
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
                  <Label className="text-[13px] font-medium text-muted-foreground">{tc('model')}</Label>
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
                  <ModelTextHint />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-muted-foreground">{tc('aspectRatio')}</Label>
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
                  <Label className="text-[13px] font-medium text-muted-foreground">{tc('imageCount')}</Label>
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

          <div className="flex min-h-[760px] flex-col rounded-[30px] border border-border bg-white p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">{rightPanelTitle}</h3>
                <p className="text-[13px] text-muted-foreground">{rightPanelSubtitle}</p>
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
