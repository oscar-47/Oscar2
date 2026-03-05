'use client'

import { useTranslations, useLocale } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { SectionIcon } from '@/components/shared/SectionIcon'
import { STYLE_DIMENSIONS, type StyleDimensionKey } from '@/types'

interface StyleDimensionRadioProps {
  values: Partial<Record<StyleDimensionKey, string>>
  onChange: (key: StyleDimensionKey, value: string | null) => void
  disabled?: boolean
}

export function StyleDimensionRadio({ values, onChange, disabled }: StyleDimensionRadioProps) {
  const t = useTranslations('studio.genesis.style')
  const locale = useLocale()
  const isZh = locale.startsWith('zh')

  return (
    <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <SectionIcon icon={Sparkles} />
        <div>
          <h3 className="text-[15px] font-semibold text-[#1a1d24]">
            {isZh ? '风格方向' : 'Style Direction'}
          </h3>
          <p className="text-[13px] text-[#7d818d]">
            {isZh ? '选择维度快速调整生成风格' : 'Select dimensions to adjust generation style'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {STYLE_DIMENSIONS.map((dim) => {
          const currentValue = values[dim.key] ?? null
          return (
            <div key={dim.key}>
              <p className="mb-1.5 text-[13px] font-medium text-[#5a5e6b]">
                {t(`${dim.labelKey}.label`)}
              </p>
              <div className="flex flex-wrap gap-2">
                {dim.options.map((opt) => {
                  const isActive = currentValue === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(dim.key, isActive ? null : opt.value)}
                      className={
                        isActive
                          ? 'rounded-full bg-[#191b22] px-3 py-1.5 text-[13px] font-medium text-white transition-colors'
                          : 'rounded-full border border-[#d0d4dc] bg-[#f1f3f6] px-3 py-1.5 text-[13px] font-medium text-[#5a5e6b] transition-colors hover:border-[#191b22] disabled:opacity-50'
                      }
                    >
                      {t(`${dim.labelKey}.${opt.labelKey}`)}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
