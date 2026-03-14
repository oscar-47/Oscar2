'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { FluidPendingCard } from '@/components/generation/FluidPendingCard'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { generateModelImage, processGenerationJob } from '@/lib/api/edge-functions'
import { refreshCredits, useCredits } from '@/lib/hooks/useCredits'
import { createClient } from '@/lib/supabase/client'
import type { GenerationJob } from '@/types'
import type { GenerationModel } from '@/types'
import { getGenerationCreditCost } from '@/types'
import type { UploadedImage } from '@/components/upload/MultiImageUploader'
import type { AIModelHistoryItem } from './types'
import { friendlyError, generationRetryRefundMessage, isInsufficientCreditsError } from '@/lib/utils'
import { Loader2, Clock3, UserCircle2, Sparkles, ChevronLeft, ChevronRight, X } from 'lucide-react'

type Gender = 'female' | 'male'
type AgeRange = '18-25' | '26-35' | '36-45' | '46-60' | '60+'
type Ethnicity = 'asian' | 'white' | 'black' | 'latino'
type ModelMode = 'fast' | 'balanced' | 'quality'
type DialogState = 'idle' | 'generating' | 'ready' | 'error'

type PreviewItem = {
  id: string
  jobId: string
  resultUrl: string | null
  status: 'success' | 'failed'
  errorMessage: string | null
}

type ModelHistoryRow = {
  id: string
  job_id: string
  gender: string
  age_range: string
  skin_color: string
  status: 'processing' | 'success' | 'failed' | null
  result_url: string | null
  error_message: string | null
  created_at: string
}

const MODEL_OPTION_BUTTON_IDLE_CLASS =
  'border-[#d8d1c6] bg-[#fcfaf6] text-[#1f2937] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:border-[#cac1b4] hover:bg-white'

const MODEL_OPTION_BUTTON_ACTIVE_CLASS =
  'border-[#172033] bg-[#101827] text-[#f8f4ee] shadow-[0_2px_8px_rgba(16,24,39,0.08),0_14px_30px_-14px_rgba(16,24,39,0.38)]'

const AI_MODEL_MODE_CONFIG: Record<ModelMode, { model: GenerationModel }> = {
  fast: { model: 'or-gemini-2.5-flash' },
  balanced: { model: 'or-gemini-3.1-flash' },
  quality: { model: 'or-gemini-3-pro' },
}

function uid() {
  return crypto.randomUUID()
}

function genderLabel(value: Gender, t: (key: string) => string): string {
  return value === 'male' ? t('genderMale') : t('genderFemale')
}

function ageLabel(value: AgeRange, t: (key: string) => string): string {
  if (value === '18-25') return t('age18_25')
  if (value === '26-35') return t('age26_35')
  if (value === '36-45') return t('age36_45')
  if (value === '46-60') return t('age46_60')
  return t('age60plus')
}

function ethnicityLabel(value: Ethnicity, t: (key: string) => string): string {
  if (value === 'asian') return t('ethnicityAsian')
  if (value === 'white') return t('ethnicityWhite')
  if (value === 'black') return t('ethnicityBlack')
  return t('ethnicityLatino')
}

function normalizeGender(value: string): Gender {
  const v = value.trim().toLowerCase()
  if (v === 'male' || value.includes('男性')) return 'male'
  return 'female'
}

function normalizeAgeRange(value: string): AgeRange {
  const v = value.trim()
  if (v === '18-25') return '18-25'
  if (v === '26-35') return '26-35'
  if (v === '36-45') return '36-45'
  if (v === '46-60') return '46-60'
  if (v === '60+') return '60+'
  return '26-35'
}

function normalizeEthnicity(value: string): Ethnicity {
  const v = value.trim().toLowerCase()
  if (v === 'asian' || value.includes('亚洲')) return 'asian'
  if (v === 'white' || value.includes('白')) return 'white'
  if (v === 'black' || value.includes('黑')) return 'black'
  if (v === 'latino' || value.includes('拉丁')) return 'latino'
  return 'asian'
}

function formatRelativeTime(iso: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return t('timeJustNow')
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return t('timeJustNow')
  if (sec < 3600) return t('timeMinutesAgo', { minutes: Math.floor(sec / 60) })
  if (sec < 86400) return t('timeHoursAgo', { hours: Math.floor(sec / 3600) })
  return t('timeDaysAgo', { days: Math.floor(sec / 86400) })
}

function mapHistoryRow(row: ModelHistoryRow): AIModelHistoryItem {
  return {
    id: row.id,
    jobId: row.job_id,
    gender: normalizeGender(row.gender),
    ageRange: normalizeAgeRange(row.age_range),
    ethnicity: normalizeEthnicity(row.skin_color),
    resultUrl: row.result_url,
    status: row.status ?? 'processing',
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }
}

function getModeLabel(
  mode: ModelMode,
  tCommon: (key: string) => string
): string {
  if (mode === 'fast') return tCommon('fastLabel')
  if (mode === 'quality') return tCommon('qualityLabel')
  return tCommon('balancedLabel')
}

function getModeDescription(
  mode: ModelMode,
  t: (key: string) => string
): string {
  if (mode === 'fast') return t('modelModeFastDescription')
  if (mode === 'quality') return t('modelModeQualityDescription')
  return t('modelModeBalancedDescription')
}

function getCreditsLabel(
  cost: number,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  return t('creditsPerImage', { cost })
}

function normalizeHistoryErrorMessage(
  errorMessage: string | null,
  t: (key: string) => string
): string | null {
  if (!errorMessage) return null
  if (/aborterror|signal has been aborted/i.test(errorMessage)) return t('generationCancelled')
  return errorMessage
}

type LightboxItem = {
  id: string
  url: string
  label: string
}

function optionButtonClassName(selected: boolean): string {
  return `inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2.5 text-sm font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-zinc-900/15 disabled:cursor-not-allowed disabled:opacity-50 ${
    selected ? MODEL_OPTION_BUTTON_ACTIVE_CLASS : MODEL_OPTION_BUTTON_IDLE_CLASS
  }`
}

const selectTriggerClass =
  'h-11 rounded-2xl border-border bg-secondary text-[14px] text-foreground shadow-none'

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
      const { data } = await supabase.from('generation_jobs').select('*').eq('id', jobId).single()
      if (!data) return
      const job = data as GenerationJob
      if (job.status === 'success') done(job)
      else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      else void processGenerationJob(jobId).catch(() => {})
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
          const job = payload.new as GenerationJob
          if (job.status === 'success') done(job)
          else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
        }
      )
      .subscribe()

    void processGenerationJob(jobId).catch(() => {})
    void checkOnce()
    pollTimer = setInterval(() => {
      void checkOnce()
    }, 1500)
    nudgeTimer = setInterval(() => {
      void processGenerationJob(jobId).catch(() => {})
    }, 8000)
  })
}

interface AIModelGeneratorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (modelImages: UploadedImage[]) => void
}

export function AIModelGeneratorDialog({
  open,
  onOpenChange,
  onGenerate,
}: AIModelGeneratorDialogProps) {
  const t = useTranslations('studio.clothingStudio')
  const tc = useTranslations('studio.common')
  const tp = useTranslations('pricing.usage')
  const locale = useLocale()
  const router = useRouter()
  const { total } = useCredits()
  const [gender, setGender] = useState<Gender>('female')
  const [ageRange, setAgeRange] = useState<AgeRange>('26-35')
  const [ethnicity, setEthnicity] = useState<Ethnicity>('asian')
  const [modelMode, setModelMode] = useState<ModelMode>('balanced')
  const [count, setCount] = useState<1 | 2 | 3 | 4>(2)
  const [otherRequirements, setOtherRequirements] = useState('')
  const [dialogState, setDialogState] = useState<DialogState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [historyItems, setHistoryItems] = useState<AIModelHistoryItem[]>([])
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: LightboxItem[]; index: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isGenerating = dialogState === 'generating'
  const selectedModel = AI_MODEL_MODE_CONFIG[modelMode].model
  const singleImageCost = getGenerationCreditCost(selectedModel, '1K')
  const totalCost = count * singleImageCost
  const insufficientCredits = total !== null && total < totalCost

  async function loadHistory(silent = true) {
    setIsHistoryLoading(true)
    const supabase = createClient()
    const { data, error: queryError } = await supabase
      .from('model_generation_history')
      .select('id,job_id,gender,age_range,skin_color,status,result_url,error_message,created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    setIsHistoryLoading(false)

    if (queryError) {
      if (!silent) setError(queryError.message ?? t('loadHistoryFailed'))
      return
    }

    const rows = (data ?? []) as ModelHistoryRow[]
    setHistoryItems(rows.map(mapHistoryRow))
  }

  useEffect(() => {
    if (!open) return
    setGender('female')
    setAgeRange('26-35')
    setEthnicity('asian')
    setModelMode('balanced')
    setCount(2)
    setOtherRequirements('')
    setDialogState('idle')
    setError(null)
    setPreviewItems([])
    setSelectedImageUrl(null)
    setSelectedHistoryId(null)
    setLightbox(null)
    void loadHistory(true)
    // loadHistory is intentionally invoked only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleGenerate = async () => {
    if (insufficientCredits) {
      setDialogState('error')
      setError(friendlyError('INSUFFICIENT_CREDITS', locale.startsWith('zh')))
      return
    }

    setDialogState('generating')
    setError(null)
    setPreviewItems([])
    setSelectedImageUrl(null)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const tasks = Array.from({ length: count }, async (_, index) => {
        const { job_id } = await generateModelImage({
          model: selectedModel,
          gender,
          ageRange,
          ethnicity,
          otherRequirements: otherRequirements.trim() || undefined,
          count: 1,
          imageCount: 1,
          trace_id: uid(),
          client_job_id: uid(),
          fe_attempt: index + 1,
        })
        const job = await waitForJob(job_id, abort.signal)
        return {
          id: uid(),
          jobId: job_id,
          resultUrl: job.result_url,
          status: job.status === 'success' ? 'success' : 'failed',
          errorMessage: job.error_message ?? null,
        } as PreviewItem
      })

      const settled = await Promise.allSettled(tasks)
      const results: PreviewItem[] = settled.map((item) => {
        if (item.status === 'fulfilled') return item.value
        return {
          id: uid(),
          jobId: uid(),
          resultUrl: null,
          status: 'failed',
          errorMessage: item.reason instanceof Error ? item.reason.message : t('modelGenerationFailed'),
        }
      })

      setPreviewItems(results)
      const firstSuccess = results.find((item) => item.status === 'success' && item.resultUrl)
      if (firstSuccess?.resultUrl) {
        setSelectedImageUrl(firstSuccess.resultUrl)
        setSelectedHistoryId(null)
        setDialogState('ready')
      } else {
        setDialogState('error')
        setError(t('allModelGenerationFailed'))
      }

      void loadHistory(true)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setDialogState('error')
      setError(
        isInsufficientCreditsError(err)
          ? friendlyError((err as Error).message ?? 'Not enough credits', locale.startsWith('zh'))
          : generationRetryRefundMessage(locale.startsWith('zh'))
      )
    } finally {
      refreshCredits()
    }
  }

  const handleUseSelected = async () => {
    if (!selectedImageUrl) return
    setIsApplying(true)
    setError(null)

    try {
      const response = await fetch(selectedImageUrl)
      if (!response.ok) throw new Error(t('cannotReadModelImage'))
      const blob = await response.blob()
      const file = new File([blob], `ai-model-${Date.now()}.png`, { type: blob.type || 'image/png' })
      onGenerate([{ file, previewUrl: selectedImageUrl }])
      onOpenChange(false)
    } catch (err) {
      setError(friendlyError((err as Error).message ?? t('useModelFailed'), true))
    } finally {
      setIsApplying(false)
    }
  }

  const handleDialogOpenChange = (next: boolean) => {
    if (!next) abortRef.current?.abort()
    onOpenChange(next)
  }

  const closeLightbox = () => setLightbox(null)
  const openLightbox = (images: LightboxItem[], index: number) => {
    if (images.length === 0 || !images[index]) return
    setLightbox({ images, index })
  }
  const prevLightbox = () => {
    setLightbox((current) => (
      current ? { ...current, index: Math.max(0, current.index - 1) } : current
    ))
  }
  const nextLightbox = () => {
    setLightbox((current) => (
      current ? { ...current, index: Math.min(current.images.length - 1, current.index + 1) } : current
    ))
  }

  const genderOptions: { value: Gender; label: string }[] = [
    { value: 'female', label: t('genderFemale') },
    { value: 'male', label: t('genderMale') },
  ]

  const ageOptions: { value: AgeRange; label: string }[] = [
    { value: '18-25', label: t('age18_25') },
    { value: '26-35', label: t('age26_35') },
    { value: '36-45', label: t('age36_45') },
    { value: '46-60', label: t('age46_60') },
    { value: '60+', label: t('age60plus') },
  ]

  const ethnicityOptions: { value: Ethnicity; label: string }[] = [
    { value: 'asian', label: t('ethnicityAsian') },
    { value: 'white', label: t('ethnicityWhite') },
    { value: 'black', label: t('ethnicityBlack') },
    { value: 'latino', label: t('ethnicityLatino') },
  ]

  const countOptions: { value: 1 | 2 | 3 | 4; label: string }[] = [
    { value: 1, label: t('countImage', { count: 1 }) },
    { value: 2, label: t('countImage', { count: 2 }) },
    { value: 3, label: t('countImage', { count: 3 }) },
    { value: 4, label: t('countImage', { count: 4 }) },
  ]

  const modelModeOptions: ModelMode[] = ['fast', 'balanced', 'quality']
  const previewLightboxItems: LightboxItem[] = previewItems
    .filter((item): item is PreviewItem & { resultUrl: string } => item.status === 'success' && typeof item.resultUrl === 'string')
    .map((item, index) => ({
      id: item.id,
      url: item.resultUrl,
      label: t('previewImageLabel', { index: index + 1 }),
    }))
  const historyLightboxItems: LightboxItem[] = historyItems
    .filter((item): item is AIModelHistoryItem & { resultUrl: string } => typeof item.resultUrl === 'string' && item.resultUrl.length > 0)
    .map((item) => ({
      id: item.id,
      url: item.resultUrl,
      label: `${genderLabel(item.gender, t)}, ${ageLabel(item.ageRange, t)}, ${ethnicityLabel(item.ethnicity, t)}`,
    }))

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="top-2 w-[calc(100vw-1rem)] max-w-6xl translate-y-0 gap-0 overflow-hidden rounded-[30px] border-[#e4dbcf] bg-[#fffdf9] p-0 shadow-[0_24px_80px_-32px_rgba(16,24,39,0.45)] sm:top-[50%] sm:w-[96vw] sm:-translate-y-1/2">
        <div className="shrink-0 border-b border-[#ebe3d7] px-5 py-4 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5" />
            {t('aiModelDialogTitle')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('aiModelDialogDescription')}
          </DialogDescription>
        </div>

        <div className="flex max-h-[calc(100dvh-7.25rem)] min-h-0 flex-col overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch] lg:max-h-[76vh] lg:min-h-[620px] lg:flex-row lg:overflow-hidden">
          <div className="flex w-full flex-col border-b border-[#ebe3d7] p-5 sm:p-6 lg:w-3/5 lg:min-h-0 lg:border-b-0 lg:border-r">
            <div className="space-y-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              <div className="space-y-2">
                <Label>{t('labelModelMode')}</Label>
                <Select value={modelMode} onValueChange={(value) => setModelMode(value as ModelMode)} disabled={isGenerating}>
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelModeOptions.map((option) => {
                      const optionModel = AI_MODEL_MODE_CONFIG[option].model
                      const optionCost = getGenerationCreditCost(optionModel, '1K')
                      return (
                        <SelectItem key={option} value={option}>
                          {`${getModeLabel(option, tp)} · ${getCreditsLabel(optionCost, t)}`}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {getModeDescription(modelMode, t)} · {getCreditsLabel(singleImageCost, t)}
                </p>
              </div>

              <div className="space-y-2.5">
                <Label>{t('labelGender')}</Label>
                <div className="flex flex-wrap gap-2.5">
                  {genderOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={gender === option.value}
                      onClick={() => setGender(option.value)}
                      disabled={isGenerating}
                      className={optionButtonClassName(gender === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <Label>{t('labelAge')}</Label>
                <div className="flex flex-wrap gap-2.5">
                  {ageOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={ageRange === option.value}
                      onClick={() => setAgeRange(option.value)}
                      disabled={isGenerating}
                      className={optionButtonClassName(ageRange === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <Label>{t('labelEthnicity')}</Label>
                <div className="flex flex-wrap gap-2.5">
                  {ethnicityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={ethnicity === option.value}
                      onClick={() => setEthnicity(option.value)}
                      disabled={isGenerating}
                      className={optionButtonClassName(ethnicity === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('labelOtherRequirements')}</Label>
                <Textarea
                  value={otherRequirements}
                  onChange={(e) => setOtherRequirements(e.target.value)}
                  placeholder={t('otherRequirementsPlaceholder')}
                  rows={3}
                  disabled={isGenerating}
                />
              </div>

              <div className="space-y-2.5">
                <Label>{t('labelGenerateCount')}</Label>
                <div className="flex flex-wrap gap-2.5">
                  {countOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={count === option.value}
                      onClick={() => setCount(option.value)}
                      disabled={isGenerating}
                      className={optionButtonClassName(count === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Button
                  className="h-12 w-full rounded-full border border-[#172033] bg-[#101827] text-base text-[#f8f4ee] shadow-[0_2px_8px_rgba(16,24,39,0.08),0_14px_30px_-14px_rgba(16,24,39,0.38)] hover:bg-[#162136]"
                  onClick={handleGenerate}
                  disabled={isGenerating || insufficientCredits}
                >
                  {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {isGenerating ? t('generatingModel') : t('generateNow')}
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {t('creditInfo', {
                    mode: getModeLabel(modelMode, tp),
                    cost: totalCost,
                    unitCost: singleImageCost,
                  })}
                </p>
                {insufficientCredits && (
                  <div className="mt-2 space-y-1 text-center">
                    <p className="text-xs text-destructive">{tc('insufficientCredits')}</p>
                    <button
                      type="button"
                      onClick={() => router.push(`/${locale}/pricing`)}
                      className="text-xs font-medium text-primary underline underline-offset-2"
                    >
                      {locale.startsWith('zh') ? '去充值' : 'Top up'}
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2 pt-2">
                <Label>{t('labelPreview')}</Label>
                {dialogState === 'idle' && (
                  <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed bg-muted/10">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <UserCircle2 className="h-12 w-12" />
                      <p className="text-sm">{t('noPreview')}</p>
                    </div>
                  </div>
                )}

                {dialogState === 'generating' && (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: count }).map((_, i) => (
                      <FluidPendingCard key={`sk-${i}`} aspectRatio="4/5" className="rounded-xl" />
                    ))}
                  </div>
                )}

                {(dialogState === 'ready' || dialogState === 'error') && (
                  <div className="grid grid-cols-2 gap-3">
                    {previewItems.map((item) => {
                      const previewIndex = previewLightboxItems.findIndex((image) => image.id === item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (item.resultUrl && item.status === 'success') {
                              setSelectedImageUrl(item.resultUrl)
                              setSelectedHistoryId(null)
                              if (previewIndex >= 0) openLightbox(previewLightboxItems, previewIndex)
                            }
                          }}
                          className={`relative overflow-hidden rounded-xl border text-left transition-transform hover:scale-[1.01] ${
                            item.resultUrl && selectedImageUrl === item.resultUrl && !selectedHistoryId
                              ? 'border-zinc-900 ring-2 ring-zinc-900/20'
                              : 'border-border'
                          }`}
                          disabled={!item.resultUrl || item.status !== 'success'}
                        >
                          {item.resultUrl && item.status === 'success' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.resultUrl} alt="model-preview" className="aspect-[4/5] w-full object-cover" />
                          ) : (
                            <div className="flex aspect-[4/5] items-center justify-center bg-destructive/5 px-3 text-xs text-destructive">
                              {item.errorMessage ?? t('modelGenerationFailed')}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col p-5 sm:p-6 lg:w-2/5 lg:min-h-0">
            <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Clock3 className="h-4 w-4" />
              {t('generationHistoryTitle')}
            </div>
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              {isHistoryLoading && (
                <p className="text-sm text-muted-foreground">{t('loadingHistory')}</p>
              )}

              {!isHistoryLoading && historyItems.length === 0 && (
                <div className="flex h-full min-h-[220px] items-center justify-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Clock3 className="h-8 w-8 opacity-40" />
                    <p className="text-sm">{t('noHistoryRecords')}</p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {historyItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!item.resultUrl}
                    onClick={() => {
                      if (!item.resultUrl) return
                      setSelectedImageUrl(item.resultUrl)
                      setSelectedHistoryId(item.id)
                      const historyIndex = historyLightboxItems.findIndex((image) => image.id === item.id)
                      if (historyIndex >= 0) openLightbox(historyLightboxItems, historyIndex)
                    }}
                    className={`flex w-full gap-3 rounded-xl border p-2 text-left transition-colors enabled:cursor-zoom-in ${
                      item.id === selectedHistoryId
                        ? 'border-zinc-900 bg-zinc-100'
                        : 'border-transparent hover:bg-muted/40'
                    }`}
                  >
                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                      {item.resultUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.resultUrl} alt="history-model" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          {item.status === 'failed' ? t('statusFailed') : t('statusProcessing')}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {genderLabel(item.gender, t)}, {ageLabel(item.ageRange, t)}, {ethnicityLabel(item.ethnicity, t)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(item.createdAt, t)}</p>
                      {item.status === 'failed' && (
                        <p className="mt-1 truncate text-xs text-destructive">
                          {normalizeHistoryErrorMessage(item.errorMessage, t) ?? t('modelGenerationFailed')}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[#ebe3d7] px-5 py-4 sm:px-6">
          <Button
            variant="ghost"
            onClick={() => handleDialogOpenChange(false)}
            disabled={isGenerating || isApplying}
            className="rounded-full"
          >
            {t('cancel')}
          </Button>
          <Button
            className="h-11 min-w-44 rounded-full border border-[#172033] bg-[#101827] text-[#f8f4ee] hover:bg-[#162136]"
            onClick={handleUseSelected}
            disabled={!selectedImageUrl || isGenerating || isApplying}
          >
            {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('useSelectedModel')}
          </Button>
        </div>

        {lightbox && lightbox.images[lightbox.index] && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
            onClick={closeLightbox}
          >
            <button
              type="button"
              onClick={closeLightbox}
              className="absolute right-4 top-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
            >
              <X className="h-5 w-5 text-white" />
            </button>

            {lightbox.index > 0 && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  prevLightbox()
                }}
                className="absolute left-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
              >
                <ChevronLeft className="h-6 w-6 text-white" />
              </button>
            )}

            {lightbox.index < lightbox.images.length - 1 && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  nextLightbox()
                }}
                className="absolute right-4 rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
              >
                <ChevronRight className="h-6 w-6 text-white" />
              </button>
            )}

            <div
              className="flex max-h-[90vh] max-w-3xl flex-col items-center gap-3"
              onClick={(event) => event.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.images[lightbox.index].url}
                alt={lightbox.images[lightbox.index].label}
                className="max-h-[82vh] max-w-full rounded-2xl object-contain"
              />
              <div className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/85">
                {lightbox.images[lightbox.index].label} · {lightbox.index + 1}/{lightbox.images.length}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
