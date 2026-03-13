'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ImagePlus,
  Link2,
  Loader2,
  Rocket,
  Send,
  Sparkles,
} from 'lucide-react'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { uploadFiles } from '@/lib/api/upload'
import { formatRelativeDayLabel } from '@/lib/relative-day-label'
import { SUPPORT_FEEDBACK_MAX_ATTACHMENTS } from '@/lib/support-feedback'
import type { CreatorProgramRewardRow, SupportFeedback } from '@/types'

type CreatorProgramEntry = SupportFeedback & {
  rewards: CreatorProgramRewardRow[]
}

interface CreatorProgramPanelProps {
  userId: string
}

function formatDate(value: string, locale: string) {
  return new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
}

function buildPublishedAt(dateValue: string) {
  if (!dateValue) return ''
  const composed = new Date(`${dateValue}T12:00:00`)
  if (Number.isNaN(composed.getTime())) return ''
  return composed.toISOString()
}

function formatPublishedRelative(value: string, locale: string) {
  const relative = formatRelativeDayLabel(value, locale)
  return locale.startsWith('zh') ? `${relative}发布` : `Published ${relative}`
}

function getRelativeDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function CreatorProgramPanel({ userId }: CreatorProgramPanelProps) {
  const t = useTranslations('creatorProgram.panel')
  const tPromo = useTranslations('creatorProgram.promo')
  const tDetail = useTranslations('creatorProgram.detail')
  const locale = useLocale()
  const [rows, setRows] = useState<CreatorProgramEntry[]>([])
  const [schemaReady, setSchemaReady] = useState(true)
  const [contentUrl, setContentUrl] = useState('')
  const [platform, setPlatform] = useState('xiaohongshu')
  const [publishedPreset, setPublishedPreset] = useState<
    'today' | 'yesterday' | 'threeDaysAgo' | ''
  >('')
  const [coverImages, setCoverImages] = useState<UploadedImage[]>([])
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const coverImagesRef = useRef<UploadedImage[]>([])
  coverImagesRef.current = coverImages
  const publishedAt = buildPublishedAt(
    publishedPreset === 'today'
      ? getRelativeDate(0)
      : publishedPreset === 'yesterday'
        ? getRelativeDate(-1)
        : publishedPreset === 'threeDaysAgo'
          ? getRelativeDate(-3)
          : '',
  )

  const loadRows = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/creator-program', { cache: 'no-store' })
      const payload = (await response.json().catch(() => null)) as {
        rows?: CreatorProgramEntry[]
        error?: string
        schemaReady?: boolean
      } | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'LOAD_FAILED')
      }
      setSchemaReady(payload?.schemaReady !== false)
      setRows(Array.isArray(payload?.rows) ? payload.rows : [])
    } catch {
      setSchemaReady(true)
      setError(t('loadError'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    return () => {
      coverImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  function handleAddCover(files: File[]) {
    setError(null)
    setSuccess(null)
    setCoverImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return files.slice(0, 1).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }))
    })
  }

  function handleRemoveCover(index: number) {
    setCoverImages((current) => {
      const next = [...current]
      const removed = next.splice(index, 1)[0]
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl)
      }
      return next
    })
  }

  async function handleSubmit() {
    setError(null)
    setSuccess(null)
    setIsSubmitting(true)
    try {
      const uploadedCoverImages = coverImages.length > 0
        ? await uploadFiles(coverImages.map((item) => item.file))
        : []
      const response = await fetch('/api/creator-program', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentUrl,
          platform,
          publishedAt,
          message,
          attachments: uploadedCoverImages.map((upload, index) => ({
            ...upload,
            fileName: coverImages[index]?.file.name ?? null,
            mimeType: coverImages[index]?.file.type ?? null,
            size: coverImages[index]?.file.size ?? null,
          })),
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        row?: CreatorProgramEntry
        error?: string
      } | null
      if (!response.ok || !payload?.row) {
        throw new Error(payload?.error ?? 'SUBMIT_FAILED')
      }
      setRows((current) => [payload.row!, ...current])
      setContentUrl('')
      setPlatform('xiaohongshu')
      setPublishedPreset('')
      setMessage('')
      coverImages.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      setCoverImages([])
      setSuccess(t('submitSuccess'))
    } catch (submitError) {
      const code = submitError instanceof Error ? submitError.message : 'SUBMIT_FAILED'
      if (code === 'CONTENT_URL_INVALID') {
        setError(t('urlInvalid'))
      } else if (code === 'PUBLISHED_AT_REQUIRED') {
        setError(t('publishedAtRequired'))
      } else if (code === 'FEATURE_UNAVAILABLE') {
        setError(t('featureUnavailable'))
      } else {
        setError(t('submitError'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section
      id="creator-program-feedback"
      className="overflow-hidden rounded-[28px] border border-amber-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.2),_transparent_38%),linear-gradient(135deg,_rgba(255,251,235,0.98),_rgba(255,255,255,0.98))] p-6"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/90 px-3 py-1 text-xs font-semibold text-amber-700 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            {t('badge')}
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950 sm:text-[30px]">
              {t('title')}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-700">
              {t('description')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowRules((current) => !current)}
          className="inline-flex h-10 items-center justify-center rounded-full border border-amber-200 bg-white px-4 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50"
        >
          {showRules ? t('collapseRules') : t('openRules')}
          {showRules ? (
            <ChevronUp className="ml-1.5 h-4 w-4" />
          ) : (
            <ChevronDown className="ml-1.5 h-4 w-4" />
          )}
        </button>
      </div>

      <div className="mt-5 grid gap-4 rounded-[26px] border border-amber-200/80 bg-white/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] lg:grid-cols-[minmax(0,1.08fr)_minmax(260px,0.92fr)]">
        <div className="rounded-2xl border border-amber-100 bg-white/92 p-4">
          <p className="text-sm font-semibold text-slate-950">{tDetail('rules.title')}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(['3d', '7dLight', '7dMid', '7dHigh'] as const).map((key) => (
              <div
                key={key}
                className="rounded-2xl border border-amber-100 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(255,255,255,0.96))] p-4"
              >
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                  <BadgeCheck className="h-3 w-3" />
                  {tPromo(`tiers.${key}.label`)}
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">{tPromo(`tiers.${key}.title`)}</p>
                <p className="mt-1 text-sm text-slate-600">{tPromo(`tiers.${key}.reward`)}</p>
              </div>
            ))}
          </div>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
            <li>{tDetail('rules.metric')}</li>
            <li>{tDetail('rules.stack')}</li>
            <li>{tDetail('rules.nonRepeat')}</li>
            <li>{tDetail('rules.entryLimit')}</li>
          </ul>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-amber-100 bg-white/92 p-4">
            <p className="text-sm font-semibold text-slate-950">{tDetail('steps.title')}</p>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
              <li>1. {tDetail('steps.one')}</li>
              <li>2. {tDetail('steps.two')}</li>
              <li>3. {tDetail('steps.three')}</li>
              <li>4. {tDetail('steps.four')}</li>
            </ol>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <p className="text-sm font-semibold text-amber-950">{t('title')}</p>
            <p className="mt-2 text-sm leading-6 text-amber-900">{t('summary')}</p>
          </div>
        </div>
      </div>

      {showRules ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <CreatorProgramStepCard
              icon={Rocket}
              title={t('stepOneTitle')}
              description={t('stepOneDesc')}
            />
            <CreatorProgramStepCard
              icon={Link2}
              title={t('stepTwoTitle')}
              description={t('stepTwoDesc')}
            />
            <CreatorProgramStepCard
              icon={BadgeCheck}
              title={t('stepThreeTitle')}
              description={t('stepThreeDesc')}
            />
          </div>

          <p className="mt-4 text-center text-sm text-amber-800">
            {t('hashtagTip')}
          </p>
        </>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4 rounded-[26px] border border-amber-200/70 bg-white/88 p-5 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('formTitle')}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('formDescription')}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('contentUrlLabel')}
            </label>
            <input
              value={contentUrl}
              onChange={(event) => setContentUrl(event.target.value)}
              placeholder={t('contentUrlPlaceholder')}
              className="h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:border-foreground/20"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('platformLabel')}
              </label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    'xiaohongshu',
                    'douyin',
                    'kuaishou',
                    'bilibili',
                    'weibo',
                    'wechat_video',
                    'tiktok',
                    'instagram',
                    'youtube',
                    'other',
                  ].map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(`platforms.${item}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('publishedAtLabel')}
              </label>
              <div className="rounded-2xl border border-border bg-background p-3">
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'today', label: t('quickDates.today') },
                    { key: 'yesterday', label: t('quickDates.yesterday') },
                    { key: 'threeDaysAgo', label: t('quickDates.threeDaysAgo') },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        setPublishedPreset(
                          item.key as 'today' | 'yesterday' | 'threeDaysAgo',
                        )
                      }
                      className={
                        publishedPreset === item.key
                          ? 'rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800'
                          : 'rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted'
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <p className="mt-3 rounded-2xl bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  {t('publishedAtHint')}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('messageLabel')}</label>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t('messagePlaceholder')}
              className="min-h-[120px] bg-background"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/55 p-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-amber-700 shadow-sm">
                <ImagePlus className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900/80">
                  {t('coverImageLabel')}
                </label>
                <p className="mt-1 text-sm leading-6 text-amber-950">
                  {t('coverImageHint')}
                </p>
              </div>
            </div>

            <MultiImageUploader
              images={coverImages}
              onAdd={handleAddCover}
              onRemove={handleRemoveCover}
              maxImages={1}
              compactAfterUpload
              thumbnailGridCols={2}
              label={t('coverImageUploadLabel')}
              footerText={t('coverImageUploadFooter', {
                max: Math.min(SUPPORT_FEEDBACK_MAX_ATTACHMENTS, 1),
              })}
              className="space-y-3"
            />
          </div>

          {!schemaReady ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
              {t('featureUnavailableDescription')}
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !userId || !schemaReady}
            className="w-full gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('historyTitle')}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('historyDescription')}
            </p>
          </div>

          {isLoading ? (
            <div className="rounded-3xl border p-6 text-sm text-muted-foreground">
              {t('loading')}
            </div>
          ) : !schemaReady ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50/80 p-6 text-sm text-amber-900">
              {t('featureUnavailableDescription')}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-6 text-sm text-muted-foreground">
              {t('empty')}
            </div>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <article key={row.id} className="rounded-3xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border px-2 py-1">
                      {row.status === 'replied' ? t('statusSettled') : t('statusPending')}
                    </span>
                    <span>{formatDate(row.created_at, locale)}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {row.creator_content_url ? (
                      <a
                        href={row.creator_content_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline decoration-border underline-offset-4"
                      >
                        {t('openLink')}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {row.creator_platform ? (
                      <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">
                        {t(`platforms.${row.creator_platform}`)}
                      </span>
                    ) : null}
                  </div>

                  {row.creator_published_at ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('publishedAtValue', {
                        value: formatPublishedRelative(row.creator_published_at, locale),
                      })}
                    </p>
                  ) : null}

                  {row.attachments.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('coverImageHistoryLabel')}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {row.attachments.map((attachment, index) => (
                          <a
                            key={`${row.id}-attachment-${index}`}
                            href={attachment.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-2xl border border-border bg-muted/30"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={attachment.publicUrl}
                              alt={attachment.fileName ?? `creator-cover-${index + 1}`}
                              className="aspect-[4/3] h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {row.admin_reply ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                        {t('latestNotice')}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-950">
                        {row.admin_reply}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{t('recordTitle')}</p>
                    {row.rewards.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('recordEmpty')}</p>
                    ) : (
                      row.rewards.map((reward) => (
                        <div key={reward.id} className="rounded-2xl border border-border px-3 py-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-foreground">
                              {reward.stage === '3d' ? t('stage3d') : t('stage7d')}
                            </span>
                            <span className="font-semibold text-emerald-600">
                              +{reward.reward_credits}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('metricLine', {
                              metric:
                                reward.metric_type === 'like'
                                  ? t('metricLike')
                                  : t('metricFavorite'),
                              value: reward.metric_value,
                            })}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDate(reward.created_at, locale)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function CreatorProgramStepCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Rocket
  title: string
  description: string
}) {
  return (
    <div className="rounded-[22px] border border-white/70 bg-white/88 p-4 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs leading-6 text-slate-600">{description}</p>
    </div>
  )
}
