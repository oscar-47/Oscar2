'use client'

import { useTranslations } from 'next-intl'
import { Textarea } from '@/components/ui/textarea'
import { SlidersHorizontal } from 'lucide-react'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { GenerationParametersCard } from '@/components/studio/GenerationParametersCard'
import type { GenerationModel, AspectRatio, ImageSize, OutputLanguage } from '@/types'

interface ClothingSettingsSectionProps {
  requirements: string
  onRequirementsChange: (value: string) => void
  language: string
  onLanguageChange: (value: string) => void
  model: GenerationModel
  onModelChange: (value: GenerationModel) => void
  aspectRatio: AspectRatio
  onAspectRatioChange: (value: AspectRatio) => void
  resolution: ImageSize
  onResolutionChange: (value: ImageSize) => void
  disabled?: boolean
}

export function ClothingSettingsSection({
  requirements,
  onRequirementsChange,
  language,
  onLanguageChange,
  model,
  onModelChange,
  aspectRatio,
  onAspectRatioChange,
  resolution,
  onResolutionChange,
  disabled = false,
}: ClothingSettingsSectionProps) {
  const t = useTranslations('studio.clothingStudio')

  return (
    <div className="space-y-4">
      {/* Requirements textarea — kept separate from the shared card */}
      <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <SectionIcon icon={SlidersHorizontal} />
          <div>
            <h3 className="text-[15px] font-semibold text-[#1a1d24]">
              {t('requirementsTitle')}
            </h3>
            <p className="text-[13px] text-[#7d818d]">
              {t('requirementsDesc')}
            </p>
          </div>
        </div>

        <Textarea
          value={requirements}
          onChange={(e) => onRequirementsChange(e.target.value)}
          placeholder={t('requirementsPlaceholder')}
          disabled={disabled}
          rows={5}
          className="min-h-[132px] resize-none rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] leading-6 text-[#2b2f38]"
        />
        <p className="mt-3 text-[12px] leading-5 text-[#7d818d]">
          {t('requirementsHint')}
        </p>
      </div>

      {/* Shared generation parameters card */}
      <GenerationParametersCard
        model={model}
        onModelChange={onModelChange}
        aspectRatio={aspectRatio}
        onAspectRatioChange={onAspectRatioChange}
        imageSize={resolution}
        onImageSizeChange={onResolutionChange}
        disabled={disabled}
        outputLanguage={language as OutputLanguage}
        onOutputLanguageChange={(v) => onLanguageChange(v)}
        aspectRatioOptions={['1:1', '3:4', '4:3', '9:16', '16:9']}
      />
    </div>
  )
}
