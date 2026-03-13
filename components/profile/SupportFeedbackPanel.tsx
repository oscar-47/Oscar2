'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, MessageSquareMore, Send, ShieldAlert } from 'lucide-react'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { uploadFiles } from '@/lib/api/upload'
import {
  SUPPORT_FEEDBACK_MAX_ATTACHMENTS,
  SUPPORT_FEEDBACK_MAX_MESSAGE_LENGTH,
  isUnreadSupportFeedbackReply,
} from '@/lib/support-feedback'
import { refreshSupportFeedbackUnreadCount } from '@/lib/hooks/useSupportFeedbackUnreadCount'
import type { SupportFeedback } from '@/types'

interface SupportFeedbackPanelProps {
  userId: string
}

type FeedbackResponse = {
  rows?: SupportFeedback[]
}

type CreateFeedbackResponse = {
  row?: SupportFeedback
}

function formatFeedbackTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
}

export function SupportFeedbackPanel({ userId }: SupportFeedbackPanelProps) {
  const t = useTranslations('profile.supportFeedback')
  const locale = useLocale()
  const [feedbacks, setFeedbacks] = useState<SupportFeedback[]>([])
  const [message, setMessage] = useState('')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isMarkingRead, setIsMarkingRead] = useState(false)
  const imagesRef = useRef<UploadedImage[]>([])
  imagesRef.current = images

  const unreadCount = useMemo(
    () => feedbacks.filter((item) => isUnreadSupportFeedbackReply(item)).length,
    [feedbacks]
  )

  const loadFeedbacks = useCallback(async () => {
    setLoadError(null)
    setIsLoading(true)
    try {
      const response = await fetch('/api/support-feedback', { cache: 'no-store' })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? 'LOAD_FAILED')
      }
      const payload = await response.json() as FeedbackResponse
      setFeedbacks(Array.isArray(payload.rows) ? payload.rows : [])
    } catch {
      setLoadError(t('loadError'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadFeedbacks()
  }, [loadFeedbacks])

  useEffect(() => {
    if (isLoading || unreadCount === 0 || isMarkingRead) return

    let cancelled = false

    async function markRead() {
      setIsMarkingRead(true)
      const response = await fetch('/api/support-feedback/mark-read', {
        method: 'POST',
      })

      if (!response.ok || cancelled) {
        if (!cancelled) setIsMarkingRead(false)
        return
      }

      setFeedbacks((current) => current.map((item) => (
        item.admin_replied_at
          ? { ...item, user_seen_reply_at: new Date().toISOString() }
          : item
      )))
      setIsMarkingRead(false)
      refreshSupportFeedbackUnreadCount()
    }

    void markRead()

    return () => {
      cancelled = true
    }
  }, [isLoading, isMarkingRead, unreadCount])

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  function handleAddImages(files: File[]) {
    setSubmitError(null)
    setImages((current) => [
      ...current,
      ...files.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ].slice(0, SUPPORT_FEEDBACK_MAX_ATTACHMENTS))
  }

  function handleRemoveImage(index: number) {
    setImages((current) => {
      const next = [...current]
      const removed = next.splice(index, 1)[0]
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl)
      }
      return next
    })
  }

  async function handleSubmit() {
    const trimmed = message.trim()
    if (!trimmed) {
      setSubmitError(t('messageRequired'))
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    setSuccessMessage(null)

    try {
      const uploads = await uploadFiles(images.map((item) => item.file))
      const response = await fetch('/api/support-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          attachments: uploads.map((upload, index) => ({
            ...upload,
            fileName: images[index]?.file.name ?? null,
            mimeType: images[index]?.file.type ?? null,
            size: images[index]?.file.size ?? null,
          })),
        }),
      })

      const payload = await response.json().catch(() => null) as CreateFeedbackResponse & { error?: string }
      if (!response.ok || !payload.row) {
        throw new Error(payload?.error ?? 'CREATE_FAILED')
      }

      setFeedbacks((current) => [payload.row!, ...current])
      setMessage('')
      images.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      setImages([])
      setSuccessMessage(t('submitSuccess'))
      refreshSupportFeedbackUnreadCount()
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'CREATE_FAILED'
      if (raw === 'MESSAGE_TOO_LONG') {
        setSubmitError(t('messageTooLong', { max: SUPPORT_FEEDBACK_MAX_MESSAGE_LENGTH }))
      } else if (raw === 'ATTACHMENTS_TOO_MANY') {
        setSubmitError(t('attachmentsTooMany', { max: SUPPORT_FEEDBACK_MAX_ATTACHMENTS }))
      } else {
        setSubmitError(t('submitError'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section id="support-feedback" className="scroll-mt-24 rounded-3xl border p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            <MessageSquareMore className="h-3.5 w-3.5" />
            {t('badge')}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {t('unreadReplies', { count: unreadCount })}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-4 rounded-3xl border border-border bg-muted/20 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">{t('formTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('formDescription')}</p>
          </div>

          <Textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value)
              setSubmitError(null)
              setSuccessMessage(null)
            }}
            maxLength={SUPPORT_FEEDBACK_MAX_MESSAGE_LENGTH}
            placeholder={t('messagePlaceholder')}
            className="min-h-[140px] bg-background"
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('uploadHint', { max: SUPPORT_FEEDBACK_MAX_ATTACHMENTS })}</span>
            <span>{message.trim().length}/{SUPPORT_FEEDBACK_MAX_MESSAGE_LENGTH}</span>
          </div>

          <MultiImageUploader
            images={images}
            onAdd={handleAddImages}
            onRemove={handleRemoveImage}
            maxImages={SUPPORT_FEEDBACK_MAX_ATTACHMENTS}
            compactAfterUpload
            thumbnailGridCols={3}
            label={t('uploadLabel')}
            footerText={t('uploadFooter', { max: SUPPORT_FEEDBACK_MAX_ATTACHMENTS })}
            className="space-y-3"
          />

          {submitError ? <p className="text-sm text-red-500">{submitError}</p> : null}
          {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !userId}
            className="w-full gap-2"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">{t('historyTitle')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('historyDescription')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadFeedbacks()} disabled={isLoading}>
              {t('refresh')}
            </Button>
          </div>

          {isLoading ? (
            <div className="rounded-3xl border border-border p-6 text-sm text-muted-foreground">
              {t('loading')}
            </div>
          ) : loadError ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {loadError}
            </div>
          ) : feedbacks.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              {t('empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {feedbacks.map((item) => {
                const hasUnreadReply = isUnreadSupportFeedbackReply(item)
                return (
                  <article key={item.id} className="rounded-3xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border border-border px-2 py-1">
                        {item.status === 'replied' ? t('statusReplied') : t('statusOpen')}
                      </span>
                      {hasUnreadReply ? (
                        <span className="rounded-full bg-rose-100 px-2 py-1 font-medium text-rose-700">
                          {t('newReply')}
                        </span>
                      ) : null}
                      <span>{formatFeedbackTime(item.created_at, locale)}</span>
                    </div>

                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{item.message}</p>

                    {item.attachments.length > 0 ? (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {item.attachments.map((attachment, index) => (
                          <a
                            key={`${item.id}_${index}`}
                            href={attachment.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-2xl border border-border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={attachment.publicUrl}
                              alt={attachment.fileName ?? `feedback-${index + 1}`}
                              className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}

                    {item.admin_reply ? (
                      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          {t('replyLabel')}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-950">{item.admin_reply}</p>
                        <p className="mt-2 text-xs text-emerald-700/80">
                          {t('replyMeta', {
                            by: item.admin_replied_by ?? t('supportTeam'),
                            time: item.admin_replied_at ? formatFeedbackTime(item.admin_replied_at, locale) : '--',
                          })}
                        </p>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
