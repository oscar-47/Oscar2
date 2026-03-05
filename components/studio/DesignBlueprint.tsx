'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Pencil, Palette, ImageIcon, Plus } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { motion, AnimatePresence } from 'framer-motion'
import { ImagePlanCard } from './ImagePlanCard'
import { SectionIcon } from '@/components/shared/SectionIcon'
import type { BlueprintImagePlan, GeneratedPrompt } from '@/types'

interface DesignBlueprintProps {
  designSpecs: string
  onDesignSpecsChange: (value: string) => void
  imagePlans: BlueprintImagePlan[]
  onImagePlanChange: (index: number, plan: BlueprintImagePlan) => void
  disabled?: boolean
  aspectRatio?: string
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onDeletePlan?: (id: string) => void
  onAddPlan?: () => void
  onDuplicatePlan?: (id: string) => void
  onSelectAll?: () => void
  onDeselectAll?: () => void
  generatedPrompts?: GeneratedPrompt[]
  onPromptChange?: (index: number, prompt: string) => void
}

export function DesignBlueprint({
  designSpecs,
  onDesignSpecsChange,
  imagePlans,
  onImagePlanChange,
  disabled,
  selectedIds,
  onToggleSelect,
  onDeletePlan,
  onAddPlan,
  onDuplicatePlan,
  onSelectAll,
  onDeselectAll,
  generatedPrompts,
  onPromptChange,
}: DesignBlueprintProps) {
  const t = useTranslations('studio.genesis')
  const [specsExpanded, setSpecsExpanded] = useState(false)

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5">
        <div className="mb-4 flex items-center gap-3">
          <SectionIcon icon={ImageIcon} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[#1a1d24]">{t('imagePlan')}</p>
            {selectedIds ? (
              <p className="text-[13px] text-[#7d818d]">
                {t('selectedCount', { selected: selectedIds.size, total: imagePlans.length })}
              </p>
            ) : (
              <p className="text-[13px] text-[#7d818d]">
                {t('imagePlanCount', { count: imagePlans.length })}
              </p>
            )}
          </div>
          {selectedIds && onSelectAll && onDeselectAll && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSelectAll}
                className="text-[13px] font-medium text-[#191b22] hover:underline"
              >
                {t('selectAll')}
              </button>
              <span className="text-[13px] text-[#d0d4dc]">/</span>
              <button
                type="button"
                onClick={onDeselectAll}
                className="text-[13px] font-medium text-[#7d818d] hover:underline"
              >
                {t('deselectAll')}
              </button>
            </div>
          )}
        </div>
        <div className="space-y-3">
          {imagePlans.map((plan, i) => (
            <ImagePlanCard
              key={plan.id ?? i}
              index={i}
              plan={plan}
              onChange={(updated) => onImagePlanChange(i, updated)}
              disabled={disabled}
              selected={selectedIds && plan.id ? selectedIds.has(plan.id) : undefined}
              onToggleSelect={onToggleSelect && plan.id ? () => onToggleSelect(plan.id!) : undefined}
              onDelete={onDeletePlan && plan.id ? () => onDeletePlan(plan.id!) : undefined}
              onDuplicate={onDuplicatePlan && plan.id ? () => onDuplicatePlan(plan.id!) : undefined}
              generatedPrompt={generatedPrompts?.[i]}
              onPromptChange={onPromptChange ? (prompt) => onPromptChange(i, prompt) : undefined}
            />
          ))}
          {onAddPlan && !disabled && (
            <button
              type="button"
              onClick={onAddPlan}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#d0d4dc] bg-[#f9fafb] px-4 py-3 text-[13px] font-medium text-[#7d818d] hover:bg-[#f1f3f6] hover:text-[#5a5e6b] transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t('addPlan')}
            </button>
          )}
        </div>
      </div>

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
    </div>
  )
}
