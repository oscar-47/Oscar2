'use client'

import { useLocale } from 'next-intl'
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
  const locale = useLocale()
  const isZh = locale === 'zh'

  return (
    <div className="space-y-4">
      {/* Requirements textarea — kept separate from the shared card */}
      <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <SectionIcon icon={SlidersHorizontal} />
          <div>
            <h3 className="text-[15px] font-semibold text-[#1a1d24]">
              {isZh ? '组图要求' : 'Requirements'}
            </h3>
            <p className="text-[13px] text-[#7d818d]">
              {isZh
                ? '描述您的产品信息和期望的图片风格'
                : 'Describe your product info and desired image style'}
            </p>
          </div>
        </div>

        <Textarea
          value={requirements}
          onChange={(e) => onRequirementsChange(e.target.value)}
          placeholder={
            isZh
              ? '建议输入：款式名称、面料材质、设计亮点、适合人群、风格调性等\n\n例如：这是一款法式复古连衣裙，采用重磅真丝面料，特色是精致的蕾丝拼接和珍珠扣设计，适合25-35岁都市女性通勤或约会穿'
              : 'Suggested: style name, fabric material, design highlights, target audience, style tone...'
          }
          disabled={disabled}
          rows={5}
          className="min-h-[132px] resize-none rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] leading-6 text-[#2b2f38]"
        />
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
