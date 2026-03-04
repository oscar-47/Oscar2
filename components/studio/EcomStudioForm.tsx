'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  ShoppingBag,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { uploadFile } from '@/lib/api/upload'
import {
  analyzeEcommerceProduct,
  generateImage,
  processGenerationJob,
} from '@/lib/api/edge-functions'
import { createClient } from '@/lib/supabase/client'
import { useCredits } from '@/lib/hooks/useCredits'
import { refreshCredits } from '@/lib/hooks/useCredits'
import { cn } from '@/lib/utils'
import {
  DEFAULT_CREDIT_COSTS,
  type EcommercePhase,
  type EcommercePlatformStyle,
  type EcommerceAnalysisResult,
  type GenerationModel,
  type AspectRatio,
  type ImageSize,
  type GenerationJob,
} from '@/types'

function uid() {
  return crypto.randomUUID()
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
      else if (job.status === 'failed')
        fail(new Error(job.error_message ?? 'Job failed'))
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
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'generation_jobs',
          filter: `id=eq.${jobId}`,
        },
        (p) => {
          const job = p.new as GenerationJob
          if (job.status === 'success') done(job)
          else if (job.status === 'failed')
            fail(new Error(job.error_message ?? 'Job failed'))
        }
      )
      .subscribe()
    void checkOnce()
    pollTimer = setInterval(() => {
      void checkOnce()
    }, 2000)
    // Keep nudging so queued retry tasks can be claimed after run_after windows.
    nudgeTimer = setInterval(() => {
      void processGenerationJob(jobId)
    }, 8000)
  })
}

const PLATFORM_OPTIONS: { value: EcommercePlatformStyle; zhLabel: string; enLabel: string; desc_zh: string; desc_en: string }[] = [
  {
    value: 'domestic',
    zhLabel: '国内电商',
    enLabel: 'Domestic',
    desc_zh: '淘宝 / 京东 / 拼多多',
    desc_en: 'Taobao / JD / Pinduoduo',
  },
  {
    value: 'international',
    zhLabel: '国际电商',
    enLabel: 'International',
    desc_zh: 'Amazon / eBay / Shopee',
    desc_en: 'Amazon / eBay / Shopee',
  },
]

const MODEL_OPTIONS: { value: GenerationModel; label: string }[] = [
  { value: 'or-gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'or-gemini-3.1-flash', label: 'Gemini 3.1 Flash' },
  { value: 'or-gemini-3-pro', label: 'Gemini 3 Pro' },
  { value: 'ta-gemini-3.1-flash', label: 'TA Gemini 3.1 Flash' },
  { value: 'ta-gemini-2.5-flash', label: 'TA Gemini 2.5 Flash' },
  { value: 'ta-gemini-3-pro', label: 'TA Gemini 3 Pro' },
]

const TURBO_SURCHARGE: Record<string, number> = { '1K': 3, '2K': 7, '4K': 12 }

export function EcomStudioForm() {
  const t = useTranslations('studio.ecomStudio')
  const tc = useTranslations('studio.common')
  const locale = useLocale()
  const isZh = locale === 'zh'
  const { total: credits } = useCredits()

  // Phase
  const [phase, setPhase] = useState<EcommercePhase>('input')

  // Input state
  const [productImages, setProductImages] = useState<UploadedImage[]>([])
  const [platformStyle, setPlatformStyle] = useState<EcommercePlatformStyle>('domestic')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState<GenerationModel>('or-gemini-3.1-flash')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('2K')
  const [turboEnabled, setTurboEnabled] = useState(false)

  // Analysis result (editable in preview)
  const [analysisResult, setAnalysisResult] = useState<EcommerceAnalysisResult | null>(null)

  // Analysis progress
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisStatus, setAnalysisStatus] = useState('')

  // Generation state
  const [generatedImages, setGeneratedImages] = useState<ResultImage[]>([])
  const [genProgress, setGenProgress] = useState(0)
  const [genStatus, setGenStatus] = useState('')
  const [complianceStatus, setComplianceStatus] = useState<string | null>(null)
  const [complianceWarnings, setComplianceWarnings] = useState<Record<number, string[]>>({})

  // Error
  const [error, setError] = useState<string | null>(null)

  // Abort
  const abortRef = useRef<AbortController | null>(null)

  // Prompt visibility
  const [showMainPrompt, setShowMainPrompt] = useState(false)
  const [showDetailPrompts, setShowDetailPrompts] = useState(false)

  const traceId = useRef(uid()).current

  const defaultDetailCount = platformStyle === 'domestic' ? 6 : 4
  const totalImageCount = analysisResult
    ? 1 + analysisResult.detail_prompts.length
    : 1 + defaultDetailCount
  const baseCost = DEFAULT_CREDIT_COSTS[model] ?? 5
  const perImageCost = baseCost + (turboEnabled ? (TURBO_SURCHARGE[imageSize] ?? 12) : 0)
  const totalCost = perImageCost * totalImageCount

  // ── Analysis ────────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!productImages.length) return
    setPhase('analyzing')
    setError(null)
    setAnalysisProgress(10)
    setAnalysisStatus(isZh ? '上传图片中...' : 'Uploading image...')

    const ac = new AbortController()
    abortRef.current = ac

    try {
      // Upload
      const uploaded = await uploadFile(productImages[0].file)
      if (ac.signal.aborted) return
      setAnalysisProgress(30)
      setAnalysisStatus(isZh ? 'AI 分析产品中...' : 'AI analyzing product...')

      // Analyze
      const res = await analyzeEcommerceProduct({
        productImage: uploaded.publicUrl,
        userDescription: description,
        platformStyle,
        studioType: 'ecommerce',
        detailCount: defaultDetailCount,
        trace_id: traceId,
      })

      setAnalysisProgress(60)
      setAnalysisStatus(isZh ? '生成策略方案中...' : 'Generating strategy...')

      const job = await waitForJob(res.job_id, ac.signal)
      if (ac.signal.aborted) return

      const result = job.result_data as EcommerceAnalysisResult
      if (!result?.main_image_prompt) {
        throw new Error('Analysis returned invalid data')
      }
      setAnalysisResult(result)
      setAnalysisProgress(100)
      setPhase('preview')
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message || 'Analysis failed')
      setPhase('input')
    }
  }, [productImages, description, platformStyle, defaultDetailCount, traceId, isZh])

  // ── Generation ──────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!analysisResult || !productImages.length) return
    setPhase('generating')
    setError(null)
    setGeneratedImages([])
    setComplianceWarnings({})
    setComplianceStatus(null)

    const ac = new AbortController()
    abortRef.current = ac

    const uploaded = await uploadFile(productImages[0].file)
    if (ac.signal.aborted) return

    const allPrompts = [analysisResult.main_image_prompt, ...analysisResult.detail_prompts]
    const totalCount = allPrompts.length
    const images: ResultImage[] = new Array(totalCount).fill(null).map(() => ({ url: '', label: '' }))
    let completed = 0

    setGenProgress(5)
    setGenStatus(isZh ? `生成中 0/${totalCount}...` : `Generating 0/${totalCount}...`)

    const jobs: Promise<void>[] = allPrompts.map(async (prompt, i) => {
      if (ac.signal.aborted) return

      const isMain = i === 0
      const label = isMain
        ? (isZh ? '主图' : 'Main Image')
        : (isZh ? `详情图 ${i}` : `Detail ${i}`)

      try {
        const res = await generateImage({
          productImage: uploaded.publicUrl,
          prompt,
          model,
          aspectRatio,
          imageSize,
          turboEnabled,
          client_job_id: uid(),
          fe_attempt: 1,
          trace_id: traceId,
          metadata: {
            ecommerce_platform: analysisResult.platform_style,
            ecommerce_image_type: isMain ? 'main' : 'detail',
            detail_index: isMain ? undefined : i - 1,
          },
        })

        // Stagger follow-up nudges at 3s intervals (jobs are still created immediately).
        setTimeout(() => { void processGenerationJob(res.job_id) }, 3000 * (i + 1))

        if (isMain && analysisResult.platform_style === 'international') {
          setComplianceStatus(
            isZh
              ? '主图生成完成，正在执行 Amazon 合规检测...'
              : 'Main image generated. Running Amazon compliance check...'
          )
        }

        const job = await waitForJob(res.job_id, ac.signal)
        if (ac.signal.aborted) return

        // Check for compliance warning
        const resultData = job.result_data as Record<string, unknown> | null
        if (resultData?.compliance_warning) {
          if (isMain && analysisResult.platform_style === 'international') {
            setComplianceStatus(
              isZh
                ? '主图合规检测完成：存在潜在违规项'
                : 'Compliance check finished: potential violations found'
            )
          }
          setComplianceWarnings((prev) => ({
            ...prev,
            [i]: (resultData.compliance_violations as string[]) ?? [],
          }))
        } else if (isMain && analysisResult.platform_style === 'international') {
          setComplianceStatus(
            isZh
              ? '主图合规检测通过'
              : 'Main image passed compliance check'
          )
        }

        images[i] = { url: job.result_url ?? '', label }
      } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') return
        images[i] = { url: '', label: `${label} (${isZh ? '失败' : 'failed'})` }
      }

      completed++
      setGenProgress(Math.round((completed / totalCount) * 100))
      setGenStatus(
        isZh
          ? `生成中 ${completed}/${totalCount}...`
          : `Generating ${completed}/${totalCount}...`
      )
      setGeneratedImages([...images])
    })

    await Promise.all(jobs)
    if (ac.signal.aborted) return

    setGeneratedImages(images.filter((img) => img.url))
    refreshCredits()
    setPhase('complete')
  }, [analysisResult, productImages, model, aspectRatio, imageSize, turboEnabled, traceId, isZh])

  // ── Editing helpers ─────────────────────────────────────────────────────────

  const updateSellingPoint = (index: number, value: string) => {
    if (!analysisResult) return
    const sp = [...analysisResult.selling_points]
    sp[index] = value
    setAnalysisResult({ ...analysisResult, selling_points: sp })
  }

  const addSellingPoint = () => {
    if (!analysisResult || analysisResult.selling_points.length >= 5) return
    setAnalysisResult({
      ...analysisResult,
      selling_points: [...analysisResult.selling_points, ''],
    })
  }

  const removeSellingPoint = (index: number) => {
    if (!analysisResult || analysisResult.selling_points.length <= 3) return
    const sp = analysisResult.selling_points.filter((_, i) => i !== index)
    setAnalysisResult({ ...analysisResult, selling_points: sp })
  }

  const updateDetailFocus = (index: number, value: string) => {
    if (!analysisResult) return
    const df = [...analysisResult.detail_focus_areas]
    df[index] = value
    setAnalysisResult({ ...analysisResult, detail_focus_areas: df })
  }

  const addDetailFocus = () => {
    if (!analysisResult || analysisResult.detail_focus_areas.length >= 8) return
    const newPrompt = isZh
      ? '产品细节展示。8K resolution, commercial photography quality, ultra-sharp'
      : 'Product detail showcase. 8K resolution, commercial photography quality, ultra-sharp, no visual noise.'
    setAnalysisResult({
      ...analysisResult,
      detail_focus_areas: [...analysisResult.detail_focus_areas, ''],
      detail_prompts: [...analysisResult.detail_prompts, newPrompt],
    })
  }

  const removeDetailFocus = (index: number) => {
    if (!analysisResult || analysisResult.detail_focus_areas.length <= 4) return
    setAnalysisResult({
      ...analysisResult,
      detail_focus_areas: analysisResult.detail_focus_areas.filter((_, i) => i !== index),
      detail_prompts: analysisResult.detail_prompts.filter((_, i) => i !== index),
    })
  }

  const updateDetailPrompt = (index: number, value: string) => {
    if (!analysisResult) return
    const dp = [...analysisResult.detail_prompts]
    dp[index] = value
    setAnalysisResult({ ...analysisResult, detail_prompts: dp })
  }

  const handleReset = () => {
    abortRef.current?.abort()
    setPhase('input')
    setAnalysisResult(null)
    setGeneratedImages([])
    setComplianceWarnings({})
    setComplianceStatus(null)
    setError(null)
    setProductImages([])
    setDescription('')
  }

  const isLocked = phase !== 'input' && phase !== 'preview'
  const canAnalyze = productImages.length > 0 && phase === 'input'
  const canGenerate =
    phase === 'preview' &&
    analysisResult !== null &&
    (credits === null || credits >= totalCost)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <CorePageShell maxWidthClass="max-w-[1360px]">
      {/* Header */}
      <div className="mb-7 flex items-start gap-3">
        <SectionIcon icon={ShoppingBag} className="mt-1" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1a1d24]">{t('title')}</h1>
            <span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">
              {t('badge')}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[#7d818d]">{t('description')}</p>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="grid gap-7 xl:grid-cols-[440px_minmax(0,1fr)]">
        {/* ── Left Panel ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Product Image Upload */}
          <div className="rounded-[20px] border border-[#e0e2e8] bg-white p-5">
            <h3 className="mb-3 text-[14px] font-semibold text-[#1a1d24]">
              {t('productImage')}
            </h3>
            <MultiImageUploader
              images={productImages}
              onAdd={(files) =>
                setProductImages((prev) => [
                  ...prev,
                  ...files.map((f) => ({
                    file: f,
                    previewUrl: URL.createObjectURL(f),
                  })),
                ])
              }
              onRemove={(i) =>
                setProductImages((prev) => prev.filter((_, idx) => idx !== i))
              }
              maxImages={1}
              maxSizeMB={10}
              disabled={isLocked}
              compactAfterUpload
            />
          </div>

          {/* Platform Style */}
          <div className="rounded-[20px] border border-[#e0e2e8] bg-white p-5">
            <h3 className="mb-3 text-[14px] font-semibold text-[#1a1d24]">
              {t('platformStyle')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {PLATFORM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPlatformStyle(opt.value)}
                  className={cn(
                    'rounded-xl border-2 px-4 py-3 text-left transition-all',
                    platformStyle === opt.value
                      ? 'border-[#17191f] bg-[#17191f]/5'
                      : 'border-[#e0e2e8] hover:border-[#c0c2c8]',
                    isLocked && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <div className="text-[13px] font-semibold text-[#1a1d24]">
                    {isZh ? opt.zhLabel : opt.enLabel}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#7d818d]">
                    {isZh ? opt.desc_zh : opt.desc_en}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Product Description */}
          <div className="rounded-[20px] border border-[#e0e2e8] bg-white p-5">
            <h3 className="mb-3 text-[14px] font-semibold text-[#1a1d24]">
              {t('descriptionLabel')}
            </h3>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              disabled={isLocked}
              rows={3}
              className="w-full resize-none rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] px-4 py-3 text-[13px] text-[#1a1d24] placeholder:text-[#b0b3bc] focus:border-[#17191f] focus:outline-none disabled:opacity-60"
            />
          </div>

          {/* Generation Settings (visible in input & preview) */}
          {(phase === 'input' || phase === 'preview') && (
            <div className="rounded-[20px] border border-[#e0e2e8] bg-white p-5">
              <h3 className="mb-3 text-[14px] font-semibold text-[#1a1d24]">
                {t('settings')}
              </h3>
              <div className="space-y-3">
                {/* Model */}
                <div>
                  <label className="mb-1 block text-[12px] text-[#7d818d]">{tc('model')}</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value as GenerationModel)}
                    className="w-full rounded-lg border border-[#e0e2e8] bg-[#f8f9fb] px-3 py-2 text-[13px]"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Aspect Ratio */}
                <div>
                  <label className="mb-1 block text-[12px] text-[#7d818d]">{tc('aspectRatio')}</label>
                  <div className="flex flex-wrap gap-2">
                    {(['1:1', '3:4', '4:3', '4:5', '16:9'] as AspectRatio[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setAspectRatio(r)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-[12px] transition-colors',
                          aspectRatio === r
                            ? 'border-[#17191f] bg-[#17191f] text-white'
                            : 'border-[#e0e2e8] text-[#6d7280] hover:border-[#17191f]'
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Image Size */}
                <div>
                  <label className="mb-1 block text-[12px] text-[#7d818d]">{tc('imageSize')}</label>
                  <div className="flex gap-2">
                    {(['1K', '2K', '4K'] as ImageSize[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setImageSize(s)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-[12px] transition-colors',
                          imageSize === s
                            ? 'border-[#17191f] bg-[#17191f] text-white'
                            : 'border-[#e0e2e8] text-[#6d7280] hover:border-[#17191f]'
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Turbo */}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={turboEnabled}
                    onChange={(e) => setTurboEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-[#e0e2e8]"
                  />
                  <span className="text-[13px] text-[#1a1d24]">
                    {isZh ? '极速模式' : 'Turbo Boost'}
                  </span>
                  <span className="text-[11px] text-[#7d818d]">
                    {isZh ? '更快更稳定' : 'Faster & more stable'}
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Analyze Button */}
          {phase === 'input' && (
            <Button
              size="lg"
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className="h-12 w-full rounded-2xl bg-[#17191f] text-[15px] font-semibold text-white hover:bg-[#2a2d36]"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {t('analyzeButton')}
            </Button>
          )}

          {/* Generate Button */}
          {phase === 'preview' && (
            <div className="space-y-3">
              <Button
                size="lg"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="h-12 w-full rounded-2xl bg-[#17191f] text-[15px] font-semibold text-white hover:bg-[#2a2d36]"
              >
                {t('confirmGenerate', {
                  count: totalImageCount,
                  cost: totalCost,
                })}
              </Button>
              <CreditCostBadge cost={totalCost} className="mx-auto flex" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPhase('input')}
                className="w-full"
              >
                {isZh ? '返回上一步' : 'Back to Edit'}
              </Button>
            </div>
          )}

          {/* New Generation button */}
          {phase === 'complete' && (
            <Button
              size="lg"
              onClick={handleReset}
              className="h-12 w-full rounded-2xl"
            >
              {isZh ? '新建生成' : 'New Generation'}
            </Button>
          )}
        </div>

        {/* ── Right Panel ─────────────────────────────────────────────────── */}
        <div className="rounded-[30px] border border-[#e0e2e8] bg-white p-6 xl:p-8">
          {/* Analyzing phase */}
          {phase === 'analyzing' && (
            <CoreProcessingStatus
              title={isZh ? '分析中...' : 'Analyzing...'}
              subtitle={isZh ? 'AI 正在分析产品并生成策略' : 'AI is analyzing your product'}
              progress={analysisProgress}
              statusLine={analysisStatus}
              statusPlacement="center"
            />
          )}

          {/* Preview phase — editable analysis result */}
          {phase === 'preview' && analysisResult && (
            <div className="space-y-6">
              {/* Optimized Description */}
              <div>
                <h3 className="mb-2 text-[14px] font-semibold text-[#1a1d24]">
                  {t('optimizedDesc')}
                </h3>
                <textarea
                  value={analysisResult.optimized_description}
                  onChange={(e) =>
                    setAnalysisResult({
                      ...analysisResult,
                      optimized_description: e.target.value,
                    })
                  }
                  rows={3}
                  className="w-full resize-none rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] px-4 py-3 text-[13px] text-[#1a1d24] focus:border-[#17191f] focus:outline-none"
                />
              </div>

              {/* Selling Points */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold text-[#1a1d24]">
                    {t('sellingPoints')} ({analysisResult.selling_points.length})
                  </h3>
                  {analysisResult.selling_points.length < 5 && (
                    <button
                      type="button"
                      onClick={addSellingPoint}
                      className="flex items-center gap-1 text-[12px] text-[#17191f] hover:underline"
                    >
                      <Plus className="h-3 w-3" /> {isZh ? '添加' : 'Add'}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {analysisResult.selling_points.map((sp, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#17191f] text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={sp}
                        onChange={(e) => updateSellingPoint(i, e.target.value)}
                        className="flex-1 rounded-lg border border-[#e0e2e8] bg-[#f8f9fb] px-3 py-2 text-[13px] focus:border-[#17191f] focus:outline-none"
                      />
                      {analysisResult.selling_points.length > 3 && (
                        <button
                          type="button"
                          onClick={() => removeSellingPoint(i)}
                          className="text-[#b0b3bc] hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Detail Focus Areas */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold text-[#1a1d24]">
                    {t('detailFocusAreas')} ({analysisResult.detail_focus_areas.length})
                  </h3>
                  {analysisResult.detail_focus_areas.length < 8 && (
                    <button
                      type="button"
                      onClick={addDetailFocus}
                      className="flex items-center gap-1 text-[12px] text-[#17191f] hover:underline"
                    >
                      <Plus className="h-3 w-3" /> {isZh ? '添加' : 'Add'}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {analysisResult.detail_focus_areas.map((df, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={df}
                        onChange={(e) => updateDetailFocus(i, e.target.value)}
                        className="flex-1 rounded-lg border border-[#e0e2e8] bg-[#f8f9fb] px-3 py-2 text-[13px] focus:border-[#17191f] focus:outline-none"
                      />
                      {analysisResult.detail_focus_areas.length > 4 && (
                        <button
                          type="button"
                          onClick={() => removeDetailFocus(i)}
                          className="text-[#b0b3bc] hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Main Image Prompt (collapsible) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowMainPrompt(!showMainPrompt)}
                  className="flex w-full items-center justify-between rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] px-4 py-3 text-[13px] font-medium text-[#1a1d24]"
                >
                  <span>{t('mainImagePrompt')}</span>
                  {showMainPrompt ? (
                    <ChevronUp className="h-4 w-4 text-[#7d818d]" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-[#7d818d]" />
                  )}
                </button>
                {showMainPrompt && (
                  <textarea
                    value={analysisResult.main_image_prompt}
                    onChange={(e) =>
                      setAnalysisResult({
                        ...analysisResult,
                        main_image_prompt: e.target.value,
                      })
                    }
                    rows={5}
                    className="mt-2 w-full resize-none rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] px-4 py-3 text-[12px] font-mono text-[#1a1d24] focus:border-[#17191f] focus:outline-none"
                  />
                )}
              </div>

              {/* Detail Prompts (collapsible) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowDetailPrompts(!showDetailPrompts)}
                  className="flex w-full items-center justify-between rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] px-4 py-3 text-[13px] font-medium text-[#1a1d24]"
                >
                  <span>
                    {t('detailPrompts')} ({analysisResult.detail_prompts.length})
                  </span>
                  {showDetailPrompts ? (
                    <ChevronUp className="h-4 w-4 text-[#7d818d]" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-[#7d818d]" />
                  )}
                </button>
                {showDetailPrompts && (
                  <div className="mt-2 space-y-2">
                    {analysisResult.detail_prompts.map((dp, i) => (
                      <div key={i}>
                        <label className="mb-1 block text-[11px] text-[#7d818d]">
                          {isZh ? `详情图 ${i + 1}` : `Detail ${i + 1}`}:{' '}
                          {analysisResult.detail_focus_areas[i] ?? ''}
                        </label>
                        <textarea
                          value={dp}
                          onChange={(e) => updateDetailPrompt(i, e.target.value)}
                          rows={3}
                          className="w-full resize-none rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] px-4 py-2 text-[12px] font-mono text-[#1a1d24] focus:border-[#17191f] focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Generating phase */}
          {phase === 'generating' && (
            <div className="space-y-6">
              <CoreProcessingStatus
                title={isZh ? '生成中...' : 'Generating...'}
                subtitle={
                  isZh
                    ? `正在生成 ${totalImageCount} 张电商图片`
                    : `Generating ${totalImageCount} e-commerce images`
                }
                progress={genProgress}
                statusLine={genStatus}
                statusPlacement="below"
              />
              {analysisResult?.platform_style === 'international' && complianceStatus && (
                <div className="rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] px-4 py-3 text-[12px] text-[#555a67]">
                  {complianceStatus}
                </div>
              )}
              {generatedImages.some((img) => img.url) && (
                <ResultGallery
                  images={generatedImages.filter((img) => img.url)}
                  isLoading
                  loadingCount={totalImageCount - generatedImages.filter((img) => img.url).length}
                  aspectRatio={aspectRatio}
                />
              )}
            </div>
          )}

          {/* Complete phase */}
          {phase === 'complete' && (
            <div className="space-y-4">
              {/* Compliance warnings */}
              {Object.keys(complianceWarnings).length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="text-[13px] text-amber-800">
                    <p className="font-medium">{t('complianceWarning')}</p>
                    <ul className="mt-1 list-disc pl-4 text-[12px]">
                      {Object.entries(complianceWarnings).flatMap(([, violations]) =>
                        violations.map((v, vi) => <li key={vi}>{v}</li>)
                      )}
                    </ul>
                  </div>
                </div>
              )}
              <ResultGallery
                images={generatedImages}
                aspectRatio={aspectRatio}
              />
            </div>
          )}

          {/* Input phase — empty state */}
          {phase === 'input' && (
            <div className="flex min-h-[300px] items-center justify-center">
              <div className="text-center">
                <ShoppingBag className="mx-auto mb-3 h-12 w-12 text-[#d0d2da]" />
                <p className="text-[14px] text-[#7d818d]">{t('emptyState')}</p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </CorePageShell>
  )
}
