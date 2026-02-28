'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Pencil, Palette, ImageIcon } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { motion, AnimatePresence } from 'framer-motion'
import { ImagePlanCard } from './ImagePlanCard'
import { SectionIcon } from '@/components/shared/SectionIcon'
import type { BlueprintImagePlan } from '@/types'

interface DesignBlueprintProps {
  designSpecs: string
  onDesignSpecsChange: (value: string) => void
  imagePlans: BlueprintImagePlan[]
  onImagePlanChange: (index: number, plan: BlueprintImagePlan) => void
  disabled?: boolean
}

export function DesignBlueprint({
  designSpecs,
  onDesignSpecsChange,
  imagePlans,
  onImagePlanChange,
  disabled,
}: DesignBlueprintProps) {
  const t = useTranslations('studio.genesis')
  const [specsExpanded, setSpecsExpanded] = useState(true)

  return (
    <div className="space-y-6">
      {/* Design Specifications — collapsible */}
      <div className="rounded-[28px] border border-[#d0d4dc] bg-white">
        <button
          type="button"
          onClick={() => setSpecsExpanded(!specsExpanded)}
          className="flex w-full items-center gap-3 rounded-[28px] p-5 text-left transition-colors hover:bg-[#f0f1f4]"
        >
          <SectionIcon icon={Palette} />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-[#1a1d24]">{t('designSpecs')}</p>
            <p className="text-[13px] text-[#7d818d]">{t('designSpecsDesc')}</p>
          </div>
          <Pencil className="h-4 w-4 shrink-0 text-[#7a7f8b]" />
          {specsExpanded ? (
            <ChevronUp className="h-4 w-4 text-[#7a7f8b]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#7a7f8b]" />
          )}
        </button>

        <AnimatePresence>
          {specsExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-5">
                <Textarea
                  value={designSpecs}
                  onChange={(e) => onDesignSpecsChange(e.target.value)}
                  disabled={disabled}
                  rows={18}
                  className="min-h-[520px] resize-none rounded-2xl border-[#d0d4dc] bg-[#f5f6f8] px-5 py-4 text-[14px] leading-8 text-[#262a32]"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Image Plan */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <SectionIcon icon={ImageIcon} />
          <div>
            <p className="text-[15px] font-semibold text-[#1a1d24]">{t('imagePlan')}</p>
            <p className="text-[13px] text-[#7d818d]">
              {t('imagePlanCount', { count: imagePlans.length })}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {imagePlans.map((plan, i) => (
            <ImagePlanCard
              key={i}
              index={i}
              plan={plan}
              onChange={(updated) => onImagePlanChange(i, updated)}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
