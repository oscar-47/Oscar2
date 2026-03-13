'use client'

import { useRef, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { X, Sparkles, Plus, Loader2 } from 'lucide-react'
import { useEditorStore } from '@/lib/stores/editor-store'
import { generateImage } from '@/lib/api/edge-functions'
import { uploadFile } from '@/lib/api/upload'
import { useWaitForJob } from '@/lib/hooks/useWaitForJob'
import { clampText, formatTextCounter, TEXT_LIMITS } from '@/lib/input-guard'
import {
  getAvailableModels,
  getGenerationCreditCost,
  normalizeGenerationModel,
  sanitizeImageSizeForModel,
} from '@/types'
import { useUserEmail } from '@/lib/hooks/useUserEmail'
import { useAdminImageModels } from '@/lib/hooks/useAdminImageModels'
import type { GenerationModel, AspectRatio } from '@/types'

const RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
]

export function QuickEditPanel() {
  const t = useTranslations('studio.editor')
  const locale = useLocale()
  const userEmail = useUserEmail()
  useAdminImageModels(userEmail)
  const quickEdit = useEditorStore((s) => s.quickEdit)
  const closeQuickEdit = useEditorStore((s) => s.closeQuickEdit)
  const setQuickEditField = useEditorStore((s) => s.setQuickEditField)
  const applyTextEditResult = useEditorStore((s) => s.applyTextEditResult)
  const objects = useEditorStore((s) => s.objects)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { startWaiting } = useWaitForJob({
    onSuccess: (job) => {
      setQuickEditField('isProcessing', false)
      setQuickEditField('jobId', null)
      // Extract result URL
      const resultData = job.result_data as Record<string, unknown> | null
      const resultUrl = job.result_url
        ?? (resultData?.outputs as Array<{ url: string }> | undefined)?.[0]?.url
      if (resultUrl && quickEdit.objectId) {
        applyTextEditResult(quickEdit.objectId, resultUrl)
      }
      closeQuickEdit()
    },
    onError: () => {
      setQuickEditField('isProcessing', false)
      setQuickEditField('jobId', null)
    },
  })

  const computeCost = useCallback(() => {
    return getGenerationCreditCost(quickEdit.model, quickEdit.imageSize)
  }, [quickEdit.imageSize, quickEdit.model])

  const handleRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setQuickEditField('referencePreview', URL.createObjectURL(file))
      const result = await uploadFile(file)
      setQuickEditField('referenceImage', result.publicUrl)
    } catch {
      setQuickEditField('referencePreview', null)
    }
    e.target.value = ''
  }

  const handleRun = async () => {
    if (!quickEdit.objectId || !quickEdit.prompt.trim()) return
    const obj = objects.find((o) => o.id === quickEdit.objectId)
    if (!obj) return

    setQuickEditField('isProcessing', true)
    try {
      const referenceImages = quickEdit.referenceImage ? [quickEdit.referenceImage] : undefined
      const res = await generateImage({
        productImage: obj.url,
        prompt: quickEdit.prompt,
        model: quickEdit.model,
        aspectRatio: quickEdit.aspectRatio,
        imageSize: quickEdit.imageSize,
        editMode: true,
        editType: 'quick',
        originalImage: obj.url,
        referenceImages,
        client_job_id: crypto.randomUUID(),
        fe_attempt: 1,
        trace_id: crypto.randomUUID(),
      })
      setQuickEditField('jobId', res.job_id)
      void startWaiting(res.job_id)
    } catch {
      setQuickEditField('isProcessing', false)
    }
  }

  if (!quickEdit.open) return null

  const cost = computeCost()

  return (
    <div className="absolute right-4 top-16 z-[10000] w-[340px] rounded-2xl border border-border bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{t('quickEdit')}</h3>
        <button
          type="button"
          onClick={closeQuickEdit}
          className="rounded-md p-1 text-text-tertiary hover:text-muted-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {/* Prompt textarea */}
        <textarea
          value={quickEdit.prompt}
          onChange={(e) => setQuickEditField('prompt', e.target.value)}
          placeholder={t('quickEditPrompt')}
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />

        {/* Reference image upload */}
        <div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-border text-text-tertiary hover:border-primary hover:text-primary transition-colors overflow-hidden"
          >
            {quickEdit.referencePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={quickEdit.referencePreview}
                alt="Reference"
                className="h-full w-full object-cover rounded-full"
              />
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => void handleRefUpload(e)}
            className="hidden"
          />
        </div>

        {/* Model */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t('quickEditModel')}
          </label>
          <select
            value={quickEdit.model}
            onChange={(e) => {
              const nextModel = normalizeGenerationModel(e.target.value) as GenerationModel
              setQuickEditField('model', nextModel)
              setQuickEditField('imageSize', sanitizeImageSizeForModel(nextModel, quickEdit.imageSize))
            }}
            className="w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            {getAvailableModels(userEmail).map((opt) => (
              <option key={opt.value} value={opt.value}>{locale.startsWith('zh') ? opt.tierLabel.zh : opt.tierLabel.en}</option>
            ))}
          </select>
        </div>

        {/* Aspect Ratio */}
        <div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('quickEditRatio')}
            </label>
            <select
              value={quickEdit.aspectRatio}
              onChange={(e) => setQuickEditField('aspectRatio', e.target.value as AspectRatio)}
              className="w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {RATIO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={closeQuickEdit}
            className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            {t('quickEditCancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={!quickEdit.prompt.trim() || quickEdit.isProcessing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-sm font-medium text-accent-foreground hover:shadow-md disabled:opacity-50 transition-all"
          >
            {quickEdit.isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {t('quickEditRun')}
            <span className="opacity-80">{cost}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
