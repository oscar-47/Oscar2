'use client'

import { useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { X, Sparkles, Loader2, Type, Zap } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'
import { detectImageText, generateImage } from '@/lib/api/edge-functions'
import { useWaitForJob } from '@/lib/hooks/useWaitForJob'
import { cn } from '@/lib/utils'
import type { OcrTextItem } from '@/lib/api/edge-functions'
import type { GenerationJob } from '@/types'

export function TextEditPanel() {
  const t = useTranslations('studio.editor')
  const textEdit = useEditorStore((s) => s.textEdit)
  const closeTextEdit = useEditorStore((s) => s.closeTextEdit)
  const setTextEditItems = useEditorStore((s) => s.setTextEditItems)
  const setEditedText = useEditorStore((s) => s.setEditedText)
  const setTextEditField = useEditorStore((s) => s.setTextEditField)
  const applyTextEditResult = useEditorStore((s) => s.applyTextEditResult)
  const openQuickEdit = useEditorStore((s) => s.openQuickEdit)
  const objects = useEditorStore((s) => s.objects)

  // Wait for apply (generate-image) job
  const { startWaiting: startApplyWaiting } = useWaitForJob({
    onSuccess: (job) => {
      setTextEditField('isProcessing', false)
      setTextEditField('jobId', null)
      const resultData = job.result_data as Record<string, unknown> | null
      const resultUrl = job.result_url
        ?? (resultData?.outputs as Array<{ url: string }> | undefined)?.[0]?.url
      if (resultUrl && textEdit.objectId) {
        applyTextEditResult(textEdit.objectId, resultUrl)
      }
      closeTextEdit()
    },
    onError: () => {
      setTextEditField('isProcessing', false)
      setTextEditField('jobId', null)
    },
  })

  // Wait for OCR job
  const { startWaiting: startOcrWaiting, cancel: cancelOcr } = useWaitForJob({
    onSuccess: (job: GenerationJob) => {
      const requestId = useEditorStore.getState().textEdit.requestId
      if (!requestId) return

      const resultData = job.result_data as { data?: OcrTextItem[] } | null
      const ocrItems = resultData?.data ?? []

      if (ocrItems.length > 0) {
        const items = ocrItems.map((tx, i) => ({
          id: `text_${i}`,
          original: tx.text,
          edited: tx.text,
          position: tx.box_2d ? `[${tx.box_2d.join(',')}]` : 'unknown',
        }))
        setTextEditItems(items, requestId)
      } else {
        setTextEditItems([], requestId)
      }
      setTextEditField('ocrJobId', null)
    },
    onError: () => {
      const requestId = useEditorStore.getState().textEdit.requestId
      if (requestId) setTextEditItems([], requestId)
      setTextEditField('ocrJobId', null)
    },
  })

  // Start OCR detection on mount / objectId change
  useEffect(() => {
    if (!textEdit.open || !textEdit.objectId || !textEdit.isDetecting) return

    const obj = objects.find((o) => o.id === textEdit.objectId)
    if (!obj) return

    const requestId = textEdit.requestId
    if (!requestId) return

    let cancelled = false

    detectImageText(obj.url)
      .then((result) => {
        if (cancelled) return
        setTextEditField('ocrJobId', result.job_id)
        void startOcrWaiting(result.job_id)
      })
      .catch(() => {
        if (cancelled) return
        setTextEditItems([], requestId)
      })

    return () => {
      cancelled = true
      cancelOcr()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEdit.open, textEdit.objectId, textEdit.requestId])

  const handleApply = useCallback(async () => {
    if (!textEdit.objectId) return
    const obj = objects.find((o) => o.id === textEdit.objectId)
    if (!obj) return

    // Build textEdits dict: { original: replacement } for ALL items
    // (items with same text map to identity, items with changes map to new text)
    const textEdits: Record<string, string> = {}
    for (const item of textEdit.items) {
      textEdits[item.original] = item.edited
    }

    // Build dummy prompt (backend will override with bilingual prompt from textEdits)
    const diffs = textEdit.items.filter((item) => item.edited !== item.original)
    const zhParts = diffs.map((d) => `文字${d.original}替换为${d.edited}`).join(',')
    const prompt = `${zhParts}，字体样式大小颜色保持不变，图中其他元素保持不变。`

    setTextEditField('isProcessing', true)
    try {
      const res = await generateImage({
        productImage: obj.url,
        prompt,
        model: 'gpt-image',
        aspectRatio: '1:1',
        imageSize: '2K',
        turboEnabled: textEdit.turboEnabled,
        editMode: true,
        editType: 'text',
        originalImage: obj.url,
        textEdits,
        client_job_id: crypto.randomUUID(),
        fe_attempt: 1,
        trace_id: crypto.randomUUID(),
      })
      setTextEditField('jobId', res.job_id)
      void startApplyWaiting(res.job_id)
    } catch {
      setTextEditField('isProcessing', false)
    }
  }, [textEdit, objects, setTextEditField, startApplyWaiting])

  const handleJumpToQuickEdit = useCallback(() => {
    if (textEdit.objectId) {
      const objectId = textEdit.objectId
      closeTextEdit()
      openQuickEdit(objectId)
    }
  }, [textEdit.objectId, closeTextEdit, openQuickEdit])

  if (!textEdit.open) return null

  const hasChanges = textEdit.items.some((item) => item.edited !== item.original)
  const cost = textEdit.turboEnabled ? 12 : 5

  return (
    <div className="absolute right-4 top-16 z-[10000] w-[340px] rounded-2xl border border-[#e5e7eb] bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#f3f4f6] px-4 py-3">
        <div className="flex items-center gap-2">
          <Type className="h-4 w-4 text-[#6366f1]" />
          <h3 className="text-sm font-semibold text-[#111827]">{t('textEditTitle')}</h3>
        </div>
        <button
          type="button"
          onClick={closeTextEdit}
          className="rounded-md p-1 text-[#9ca3af] hover:text-[#6b7280] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {/* Detecting state */}
        {textEdit.isDetecting && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#6b7280]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('textEditDetecting')}
          </div>
        )}

        {/* No text detected */}
        {!textEdit.isDetecting && textEdit.items.length === 0 && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-[#6b7280]">{t('textEditNoText')}</p>
            <button
              type="button"
              onClick={handleJumpToQuickEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#6366f1] px-3 py-1.5 text-sm font-medium text-[#6366f1] hover:bg-[#eef2ff] transition-colors"
            >
              {t('textEditOpenQuickEdit')}
            </button>
          </div>
        )}

        {/* Text edit fields */}
        {!textEdit.isDetecting && textEdit.items.length > 0 && (
          <>
            <div className="max-h-[240px] space-y-2 overflow-y-auto">
              {textEdit.items.map((item) => (
                <input
                  key={item.id}
                  type="text"
                  value={item.edited}
                  onChange={(e) => setEditedText(item.id, e.target.value)}
                  className={cn(
                    'w-full rounded-lg border bg-[#f9fafb] px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#6366f1] transition-colors',
                    item.edited !== item.original
                      ? 'border-[#6366f1] bg-[#eef2ff]'
                      : 'border-[#d1d5db]'
                  )}
                />
              ))}
            </div>

            {/* Turbo toggle */}
            <div className="flex items-center justify-between rounded-lg border border-[#e5e7eb] px-3 py-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#f59e0b]" />
                <div>
                  <p className="text-xs font-medium text-[#111827]">{t('textEditTurbo')}</p>
                  <p className="text-[10px] text-[#9ca3af]">{t('textEditTurboDesc')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTextEditField('turboEnabled', !textEdit.turboEnabled)}
                className={cn(
                  'relative h-5 w-9 rounded-full transition-colors',
                  textEdit.turboEnabled ? 'bg-[#6366f1]' : 'bg-[#d1d5db]'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                    textEdit.turboEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>

            {/* Apply button */}
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={!hasChanges || textEdit.isProcessing}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] py-2.5 text-sm font-medium text-white hover:shadow-md disabled:opacity-50 transition-all"
            >
              {textEdit.isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('textEditApplying')}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {t('textEditApply')}
                  <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{cost}</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
