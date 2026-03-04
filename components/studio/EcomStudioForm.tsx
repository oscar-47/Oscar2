'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useSessionPersistence } from '@/lib/hooks/useSessionPersistence'
import { useTranslations, useLocale } from 'next-intl'
import {
  ShoppingBag,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  AlertTriangle,
  X,
  RotateCcw,
  Globe,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { CoreProcessingStatus } from '@/components/generation/CoreProcessingStatus'
import { ResultGallery, type ResultImage } from '@/components/generation/ResultGallery'
import { CreditCostBadge } from '@/components/generation/CreditCostBadge'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { GenerationParametersCard } from '@/components/studio/GenerationParametersCard'
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
  isValidModel,
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


const TURBO_SURCHARGE: Record<string, number> = { '1K': 3, '2K': 7, '4K': 12 }

type TranslateLang = 'en' | 'zh' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | ''

const TRANSLATE_LANGUAGES: { value: TranslateLang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
]

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

  // Generation state — grouped by product image
  type ImageGroup = {
    sourceIndex: number
    sourcePreview: string
    images: ResultImage[]
    failed: boolean
    error?: string
  }
  const [imageGroups, setImageGroups] = useState<ImageGroup[]>([])
  const [generatedImages, setGeneratedImages] = useState<ResultImage[]>([])
  const [genProgress, setGenProgress] = useState(0)
  const [genStatus, setGenStatus] = useState('')
  const [complianceStatus, setComplianceStatus] = useState<string | null>(null)
  const [complianceWarnings, setComplianceWarnings] = useState<Record<string, string[]>>({})

  // Error
  const [error, setError] = useState<string | null>(null)

  // Prompt visibility
  const [showMainPrompt, setShowMainPrompt] = useState(false)
  const [showDetailPrompts, setShowDetailPrompts] = useState(false)

  // Tag editing state (Task #3)
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null)
  const [newTagValue, setNewTagValue] = useState('')

  // Task #16: Translate dropdown
  const [translateLang, setTranslateLang] = useState<TranslateLang>('')
  const [showTranslateDropdown, setShowTranslateDropdown] = useState(false)

  // Task #17: Preview lightbox
  const [previewImage, setPreviewImage] = useState<{ url: string; index: number; groupIndex?: number } | null>(null)

  useSessionPersistence(
    'ecom-studio',
    () => ({
      description, platformStyle, model, aspectRatio, imageSize, turboEnabled,
    }),
    (s) => {
      if (typeof s.description === 'string') setDescription(s.description)
      if (typeof s.platformStyle === 'string') setPlatformStyle(s.platformStyle as EcommercePlatformStyle)
      if (typeof s.model === 'string' && isValidModel(s.model)) setModel(s.model as GenerationModel)
      if (typeof s.aspectRatio === 'string') setAspectRatio(s.aspectRatio as AspectRatio)
      if (typeof s.imageSize === 'string') setImageSize(s.imageSize as ImageSize)
      if (typeof s.turboEnabled === 'boolean') setTurboEnabled(s.turboEnabled)
    }
  )

  // Abort
  const abortRef = useRef<AbortController | null>(null)

  const traceId = useRef(uid()).current

  const defaultDetailCount = platformStyle === 'domestic' ? 6 : 4
  const promptsPerProduct = analysisResult
    ? 1 + analysisResult.detail_prompts.length
    : 1 + defaultDetailCount
  const productCount = Math.max(productImages.length, 1)
  const totalImageCount = promptsPerProduct * productCount
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

  const generateForSingleProduct = useCallback(async (
    productFile: File,
    productIndex: number,
    productPreview: string,
    analysis: EcommerceAnalysisResult,
    ac: AbortController,
    onProgress: (completed: number, total: number, group: ImageGroup) => void,
  ): Promise<ImageGroup> => {
    const uploaded = await uploadFile(productFile)
    if (ac.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })

    const allPrompts = [analysis.main_image_prompt, ...analysis.detail_prompts]
    const totalCount = allPrompts.length
    const images: ResultImage[] = new Array(totalCount).fill(null).map(() => ({ url: '', label: '' }))
    let completed = 0

    const group: ImageGroup = {
      sourceIndex: productIndex,
      sourcePreview: productPreview,
      images,
      failed: false,
    }

    const jobs: Promise<void>[] = allPrompts.map(async (prompt, i) => {
      if (ac.signal.aborted) return

      const isMain = i === 0
      const imgLabel = productImages.length > 1
        ? (isMain
          ? (isZh ? `产品${productIndex + 1} 主图` : `Product ${productIndex + 1} Main`)
          : (isZh ? `产品${productIndex + 1} 详情${i}` : `Product ${productIndex + 1} Detail ${i}`))
        : (isMain
          ? (isZh ? '主图' : 'Main Image')
          : (isZh ? `详情图 ${i}` : `Detail ${i}`))

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
            ecommerce_platform: analysis.platform_style,
            ecommerce_image_type: isMain ? 'main' : 'detail',
            detail_index: isMain ? undefined : i - 1,
            product_index: productIndex,
          },
        })

        setTimeout(() => { void processGenerationJob(res.job_id) }, 3000 * (i + 1))

        if (isMain && analysis.platform_style === 'international') {
          setComplianceStatus(
            isZh
              ? `产品${productIndex + 1} 主图生成完成，正在执行合规检测...`
              : `Product ${productIndex + 1} main image generated. Running compliance check...`
          )
        }

        const job = await waitForJob(res.job_id, ac.signal)
        if (ac.signal.aborted) return

        const resultData = job.result_data as Record<string, unknown> | null
        if (resultData?.compliance_warning) {
          if (isMain && analysis.platform_style === 'international') {
            setComplianceStatus(
              isZh
                ? `产品${productIndex + 1} 合规检测完成：存在潜在违规项`
                : `Product ${productIndex + 1} compliance check: potential violations found`
            )
          }
          setComplianceWarnings((prev) => ({
            ...prev,
            [`${productIndex}_${i}`]: (resultData.compliance_violations as string[]) ?? [],
          }))
        } else if (isMain && analysis.platform_style === 'international') {
          setComplianceStatus(
            isZh
              ? `产品${productIndex + 1} 主图合规检测通过`
              : `Product ${productIndex + 1} main image passed compliance check`
          )
        }

        images[i] = { url: job.result_url ?? '', label: imgLabel }
      } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') return
        images[i] = { url: '', label: `${imgLabel} (${isZh ? '失败' : 'failed'})` }
      }

      completed++
      group.images = [...images]
      onProgress(completed, totalCount, group)
    })

    await Promise.all(jobs)
    group.images = images
    return group
  }, [productImages.length, model, aspectRatio, imageSize, turboEnabled, traceId, isZh])

  const handleGenerate = useCallback(async () => {
    if (!analysisResult || !productImages.length) return
    setPhase('generating')
    setError(null)
    setGeneratedImages([])
    setImageGroups([])
    setComplianceWarnings({})
    setComplianceStatus(null)

    const ac = new AbortController()
    abortRef.current = ac

    const allPrompts = [analysisResult.main_image_prompt, ...analysisResult.detail_prompts]
    const promptCount = allPrompts.length
    const totalCount = promptCount * productImages.length
    let globalCompleted = 0

    setGenProgress(5)
    setGenStatus(
      isZh
        ? `生成中 0/${totalCount}...`
        : `Generating 0/${totalCount}...`
    )

    const groups: ImageGroup[] = productImages.map((_, idx) => ({
      sourceIndex: idx,
      sourcePreview: productImages[idx].previewUrl,
      images: [],
      failed: false,
    }))
    setImageGroups([...groups])

    const results = await Promise.allSettled(
      productImages.map((img, pIdx) =>
        generateForSingleProduct(
          img.file,
          pIdx,
          img.previewUrl,
          analysisResult,
          ac,
          (completed, _total, group) => {
            groups[pIdx] = group
            globalCompleted = groups.reduce(
              (sum, g) => sum + g.images.filter((ri) => ri.url).length,
              0
            )
            setGenProgress(Math.round((globalCompleted / totalCount) * 100))
            setGenStatus(
              isZh
                ? `生成中 ${globalCompleted}/${totalCount}...`
                : `Generating ${globalCompleted}/${totalCount}...`
            )
            setImageGroups([...groups])
            setGeneratedImages(groups.flatMap((g) => g.images.filter((ri) => ri.url)))
          },
        )
      )
    )
    if (ac.signal.aborted) return

    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        groups[idx] = res.value
      } else {
        groups[idx].failed = true
        groups[idx].error = (res.reason as Error)?.message || 'Generation failed'
      }
    })

    setImageGroups([...groups])
    const allImages = groups.flatMap((g) => g.images.filter((img) => img.url))
    setGeneratedImages(allImages)
    refreshCredits()
    setPhase('complete')
  }, [analysisResult, productImages, generateForSingleProduct, isZh])

  // ── Editing helpers ─────────────────────────────────────────────────────────

  const updateSellingPoint = (index: number, value: string) => {
    if (!analysisResult) return
    const sp = [...analysisResult.selling_points]
    sp[index] = value
    setAnalysisResult({ ...analysisResult, selling_points: sp })
  }

  const addSellingPoint = (value?: string) => {
    if (!analysisResult || analysisResult.selling_points.length >= 5) return
    const v = value?.trim()
    if (value !== undefined && !v) return
    setAnalysisResult({
      ...analysisResult,
      selling_points: [...analysisResult.selling_points, v ?? ''],
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

  // Task #16: Apply translation instruction to description
  const handleTranslate = (lang: TranslateLang) => {
    if (!description.trim() || !lang) return
    const langName = TRANSLATE_LANGUAGES.find((l) => l.value === lang)?.label ?? lang
    // Strip any existing translation instruction prefix
    const cleaned = description.replace(/^\[翻译为[^\]]*\]\n/, '')
    setDescription(`[翻译为${langName}]\n${cleaned}`)
    setTranslateLang(lang)
    setShowTranslateDropdown(false)
  }

  // Task #16: Close translate dropdown on outside click
  useEffect(() => {
    if (!showTranslateDropdown) return
    const handler = () => setShowTranslateDropdown(false)
    // Delay to avoid the same click that opened it from closing it
    const id = setTimeout(() => {
      window.addEventListener('click', handler, { once: true })
    }, 0)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handler)
    }
  }, [showTranslateDropdown])

  // Task #17: Escape key closes lightbox
  useEffect(() => {
    if (!previewImage) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewImage(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewImage])

  // Task #17: Download helper
  const handleDownload = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.click()
  }

  const handleReset = () => {
    abortRef.current?.abort()
    setPhase('input')
    setAnalysisResult(null)
    setGeneratedImages([])
    setImageGroups([])
    setComplianceWarnings({})
    setComplianceStatus(null)
    setError(null)
    setProductImages([])
    setDescription('')
    setEditingTagIndex(null)
    setNewTagValue('')
    setTranslateLang('')
    setShowTranslateDropdown(false)
    setPreviewImage(null)
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
              maxImages={10}
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
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-[14px] font-semibold text-[#1a1d24]">
                {t('descriptionLabel')}
              </h3>
              {/* Task #16: Translate button + dropdown */}
              <div className="relative">
                <button
                  type="button"
                  disabled={!description.trim() || isLocked}
                  onClick={() => setShowTranslateDropdown((v) => !v)}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] transition-colors',
                    description.trim() && !isLocked
                      ? 'text-[#7d818d] hover:text-[#17191f] hover:bg-[#f1f3f6]'
                      : 'text-[#d0d2da] cursor-not-allowed'
                  )}
                  title={isZh ? '翻译描述' : 'Translate description'}
                >
                  <Globe className="h-3.5 w-3.5" />
                  {translateLang && (
                    <span className="text-[11px]">
                      {TRANSLATE_LANGUAGES.find((l) => l.value === translateLang)?.label}
                    </span>
                  )}
                </button>
                {showTranslateDropdown && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-[130px] rounded-xl border border-[#e0e2e8] bg-white py-1 shadow-lg">
                    {TRANSLATE_LANGUAGES.map((lang) => (
                      <button
                        key={lang.value}
                        type="button"
                        onClick={() => handleTranslate(lang.value)}
                        className={cn(
                          'flex w-full items-center px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[#f1f3f6]',
                          translateLang === lang.value
                            ? 'text-[#17191f] font-medium'
                            : 'text-[#555a67]'
                        )}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
            <GenerationParametersCard
              model={model}
              onModelChange={setModel}
              aspectRatio={aspectRatio}
              onAspectRatioChange={setAspectRatio}
              imageSize={imageSize}
              onImageSizeChange={setImageSize}
              disabled={isLocked}
              turboEnabled={turboEnabled}
              onTurboChange={setTurboEnabled}
            />
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

              {/* Selling Points — Tag chips */}
              <div>
                <h3 className="mb-2 text-[14px] font-semibold text-[#1a1d24]">
                  {t('sellingPoints')} ({analysisResult.selling_points.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {analysisResult.selling_points.map((sp, i) => (
                    <div key={i} className="group flex items-center rounded-full bg-[#f1f3f6] border border-[#d0d4dc] px-3 py-1.5">
                      {editingTagIndex === i ? (
                        <input
                          type="text"
                          autoFocus
                          value={sp}
                          onChange={(e) => updateSellingPoint(i, e.target.value)}
                          onBlur={() => {
                            if (!sp.trim()) removeSellingPoint(i)
                            setEditingTagIndex(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (!sp.trim()) removeSellingPoint(i)
                              setEditingTagIndex(null)
                            }
                            if (e.key === 'Escape') setEditingTagIndex(null)
                          }}
                          className="min-w-[60px] max-w-[200px] bg-transparent text-[13px] text-[#1a1d24] outline-none"
                        />
                      ) : (
                        <span
                          className="cursor-text text-[13px] text-[#1a1d24]"
                          onClick={() => setEditingTagIndex(i)}
                        >
                          {sp || (isZh ? '(空)' : '(empty)')}
                        </span>
                      )}
                      {analysisResult.selling_points.length > 3 && (
                        <button
                          type="button"
                          onClick={() => removeSellingPoint(i)}
                          className="ml-1.5 text-[#7d818d] hover:text-red-500 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {analysisResult.selling_points.length < 5 && (
                    <div className="flex items-center rounded-full border border-dashed border-[#d0d4dc] px-3 py-1.5">
                      <input
                        type="text"
                        value={newTagValue}
                        onChange={(e) => setNewTagValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newTagValue.trim()) {
                            addSellingPoint(newTagValue.trim())
                            setNewTagValue('')
                          }
                        }}
                        placeholder={isZh ? '回车添加...' : 'Enter to add...'}
                        className="min-w-[80px] max-w-[160px] bg-transparent text-[13px] text-[#1a1d24] placeholder:text-[#b0b3bc] outline-none"
                      />
                      <Plus className="ml-1 h-3.5 w-3.5 text-[#7d818d]" />
                    </div>
                  )}
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
                  productImages.length > 1
                    ? (isZh
                        ? `正在为 ${productImages.length} 张产品图生成共 ${totalImageCount} 张电商图片`
                        : `Generating ${totalImageCount} images for ${productImages.length} products`)
                    : (isZh
                        ? `正在生成 ${promptsPerProduct} 张电商图片`
                        : `Generating ${promptsPerProduct} e-commerce images`)
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
              {/* Per-product progress during generation */}
              {productImages.length > 1 && imageGroups.length > 0 && (
                <div className="space-y-4">
                  {imageGroups.map((group, gIdx) => {
                    const groupDone = group.images.filter((img) => img.url).length
                    const groupTotal = promptsPerProduct
                    return (
                      <div key={gIdx} className="rounded-xl border border-[#e0e2e8] bg-[#f8f9fb] p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-[#e0e2e8]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={group.sourcePreview} alt="" className="h-full w-full object-cover" />
                          </div>
                          <span className="text-[12px] font-medium text-[#1a1d24]">
                            {isZh ? `产品 ${gIdx + 1}` : `Product ${gIdx + 1}`}
                          </span>
                          <span className="text-[11px] text-[#7d818d]">
                            {groupDone}/{groupTotal}
                          </span>
                        </div>
                        {group.images.some((img) => img.url) && (
                          <ResultGallery
                            images={group.images.filter((img) => img.url)}
                            isLoading
                            loadingCount={groupTotal - groupDone}
                            aspectRatio={aspectRatio}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {/* Single product — show flat gallery */}
              {productImages.length <= 1 && generatedImages.some((img) => img.url) && (
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
              {/* Grouped results for multi-product */}
              {imageGroups.length > 1 ? (
                <div className="space-y-6">
                  {imageGroups.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-[#e0e2e8]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={group.sourcePreview} alt="" className="h-full w-full object-cover" />
                        </div>
                        <div>
                          <h4 className="text-[13px] font-semibold text-[#1a1d24]">
                            {isZh ? `产品 ${gIdx + 1}` : `Product ${gIdx + 1}`}
                          </h4>
                          <p className="text-[11px] text-[#7d818d]">
                            {group.images.filter((img) => img.url).length} {isZh ? '张图片' : 'images'}
                            {group.failed && (
                              <span className="ml-2 text-red-500">
                                {isZh ? '部分失败' : 'Partial failure'}
                              </span>
                            )}
                          </p>
                        </div>
                        {group.failed && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              // Retry is handled by starting a new generation
                              void handleGenerate()
                            }}
                            className="ml-auto flex items-center gap-1 text-[12px]"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {isZh ? '重试' : 'Retry'}
                          </Button>
                        )}
                      </div>
                      {group.images.filter((img) => img.url).length > 0 ? (
                        <ResultGallery
                          images={group.images.filter((img) => img.url)}
                          aspectRatio={aspectRatio}
                          onImageClick={(img, i) =>
                            setPreviewImage({ url: img.url, index: i, groupIndex: gIdx })
                          }
                        />
                      ) : (
                        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-600">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {group.error || (isZh ? '该产品图片生成失败' : 'Generation failed for this product')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <ResultGallery
                  images={generatedImages}
                  aspectRatio={aspectRatio}
                  onImageClick={(img, i) =>
                    setPreviewImage({ url: img.url, index: i })
                  }
                />
              )}
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

      {/* Task #17: Lightbox preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>

          <div
            className="flex max-h-[90vh] max-w-4xl flex-col items-center gap-3 px-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage.url}
              alt={`Preview ${previewImage.index + 1}`}
              className="max-h-[80vh] max-w-full rounded-xl object-contain"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownload(previewImage.url)}
                className="flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-[13px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
              >
                <Download className="h-4 w-4" />
                {isZh ? '下载' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </CorePageShell>
  )
}
