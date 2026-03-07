'use client'

import { useLocale } from 'next-intl'
import { Label } from '@/components/ui/label'
import { useUserEmail } from '@/lib/hooks/useUserEmail'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { SlidersHorizontal } from 'lucide-react'
import type { GenerationModel, AspectRatio, ImageSize, OutputLanguage } from '@/types'
import {
  getAvailableModels,
  getDefaultImageSize,
  getSupportedImageSizes,
  normalizeGenerationModel,
} from '@/types'

// ─── Props ──────────────────────────────────────────────────────────────────

interface GenerationParametersCardProps {
  // Required
  model: GenerationModel
  onModelChange: (v: GenerationModel) => void
  aspectRatio: AspectRatio
  onAspectRatioChange: (v: AspectRatio) => void
  imageSize: ImageSize
  onImageSizeChange: (v: ImageSize) => void
  disabled?: boolean

  // Optional fields (shown when provided)
  outputLanguage?: OutputLanguage
  onOutputLanguageChange?: (v: OutputLanguage) => void
  imageCount?: number
  onImageCountChange?: (v: number) => void
  showImageCount?: boolean
  imageCountOptions?: number[]

  // Aspect ratio options to show (different forms may want different options)
  aspectRatioOptions?: AspectRatio[]

  // Extra slots for form-specific fields
  extraFields?: React.ReactNode
}

// ─── Constants ──────────────────────────────────────────────────────────────

const IMAGE_COUNTS = [1, 2, 3, 4]

const ASPECT_RATIO_LABELS: Record<AspectRatio, { en: string; zh: string }> = {
  '1:1': { en: '1:1', zh: '1:1' },
  '2:3': { en: '2:3', zh: '2:3' },
  '3:2': { en: '3:2', zh: '3:2' },
  '3:4': { en: '3:4', zh: '3:4' },
  '4:3': { en: '4:3', zh: '4:3' },
  '4:5': { en: '4:5', zh: '4:5' },
  '5:4': { en: '5:4', zh: '5:4' },
  '9:16': { en: '9:16', zh: '9:16' },
  '16:9': { en: '16:9', zh: '16:9' },
  '21:9': { en: '21:9', zh: '21:9' },
}

const DEFAULT_ASPECT_RATIOS: AspectRatio[] = ['1:1', '3:4', '4:3', '4:5', '16:9']

interface OutputLangOption {
  value: OutputLanguage
  label: string
}

const OUTPUT_LANGUAGE_OPTIONS: OutputLangOption[] = [
  { value: 'none', label: '' }, // label set dynamically by locale
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

// ─── Component ──────────────────────────────────────────────────────────────

export function GenerationParametersCard({
  model,
  onModelChange,
  aspectRatio,
  onAspectRatioChange,
  imageSize,
  onImageSizeChange,
  disabled = false,
  outputLanguage,
  onOutputLanguageChange,
  imageCount,
  onImageCountChange,
  showImageCount = false,
  aspectRatioOptions,
  imageCountOptions,
  extraFields,
}: GenerationParametersCardProps) {
  const locale = useLocale()
  const isZh = locale === 'zh'
  const userEmail = useUserEmail()

  const ratios = aspectRatioOptions ?? DEFAULT_ASPECT_RATIOS

  const selectTriggerClass =
    'h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] text-[#1b1f26] shadow-none'

  const showOutputLanguage =
    outputLanguage !== undefined && onOutputLanguageChange !== undefined
  const showImageCountField =
    showImageCount && imageCount !== undefined && onImageCountChange !== undefined

  return (
    <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <SectionIcon icon={SlidersHorizontal} />
        <div>
          <h3 className="text-[15px] font-semibold text-[#1a1d24]">
            {isZh ? '生成参数' : 'Generation Parameters'}
          </h3>
          <p className="text-[13px] text-[#7d818d]">
            {isZh ? '配置模型、比例和输出选项' : 'Configure model, ratio and output options'}
          </p>
        </div>
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium text-[#5a5e6b]">
          {isZh ? '模型' : 'Model'}
        </Label>
        <Select
          value={model}
          onValueChange={(v) => {
            const nextModel = normalizeGenerationModel(v) as GenerationModel
            onModelChange(nextModel)
            const nextDefault = getDefaultImageSize(nextModel)
            if (!getSupportedImageSizes(nextModel).includes(imageSize)) {
              onImageSizeChange(nextDefault)
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {getAvailableModels(userEmail).map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {isZh ? m.tierLabel.zh : m.tierLabel.en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Aspect Ratio — button group */}
      <div className="mt-4 space-y-1.5">
        <Label className="text-[13px] font-medium text-[#5a5e6b]">
          {isZh ? '宽高比' : 'Aspect Ratio'}
        </Label>
        <div className="flex flex-wrap gap-2">
          {ratios.map((r) => {
            const active = aspectRatio === r
            return (
              <button
                key={r}
                type="button"
                disabled={disabled}
                onClick={() => onAspectRatioChange(r)}
                className={
                  active
                    ? 'rounded-full bg-[#191b22] px-3 py-1.5 text-[13px] font-medium text-white transition-colors'
                    : 'rounded-full border border-[#d0d4dc] bg-[#f1f3f6] px-3 py-1.5 text-[13px] font-medium text-[#5a5e6b] transition-colors hover:border-[#191b22] disabled:opacity-50'
                }
              >
                {ASPECT_RATIO_LABELS[r]?.[isZh ? 'zh' : 'en'] ?? r}
              </button>
            )
          })}
        </div>
      </div>

      {/* Output Language */}
      {showOutputLanguage && (
        <div className="mt-4 space-y-1.5">
          <Label className="text-[13px] font-medium text-[#5a5e6b]">
            {isZh ? '输出语言' : 'Output Language'}
          </Label>
          <Select
            value={outputLanguage}
            onValueChange={(v) => onOutputLanguageChange!(v as OutputLanguage)}
            disabled={disabled}
          >
            <SelectTrigger className={selectTriggerClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_LANGUAGE_OPTIONS.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.value === 'none'
                    ? isZh
                      ? '无文字(纯视觉)'
                      : 'No Text (Visual Only)'
                    : lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Image Count */}
      {showImageCountField && (
        <div className="mt-4 space-y-1.5">
          <Label className="text-[13px] font-medium text-[#5a5e6b]">
            {isZh ? '生成数量' : 'Image Count'}
          </Label>
          <Select
            value={String(imageCount)}
            onValueChange={(v) => onImageCountChange!(Number(v))}
            disabled={disabled}
          >
            <SelectTrigger className={selectTriggerClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(imageCountOptions ?? IMAGE_COUNTS).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} {isZh ? '张' : n === 1 ? 'Image' : 'Images'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Extra fields slot */}
      {extraFields}
    </div>
  )
}
