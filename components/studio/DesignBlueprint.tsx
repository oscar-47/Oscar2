'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Pencil, Palette, ImageIcon, Zap } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { motion, AnimatePresence } from 'framer-motion'
import { ImagePlanCard } from './ImagePlanCard'
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
  const [specsExpanded, setSpecsExpanded] = useState(false)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{t('planPreview')}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t('planPreviewDesc')}</p>
      </div>

      {/* Design Specifications — collapsible */}
      <div className="rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setSpecsExpanded(!specsExpanded)}
          className="flex items-center gap-3 w-full p-4 text-left hover:bg-muted/50 transition-colors rounded-xl"
        >
          <Palette className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{t('designSpecs')}</p>
            <p className="text-xs text-muted-foreground">{t('designSpecsDesc')}</p>
          </div>
          <Pencil className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          {specsExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
              <div className="px-4 pb-4">
                <Textarea
                  value={designSpecs}
                  onChange={(e) => onDesignSpecsChange(e.target.value)}
                  disabled={disabled}
                  rows={14}
                  className="text-xs leading-relaxed font-mono"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Image Plan */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-semibold text-sm">{t('imagePlan')}</p>
            <p className="text-xs text-muted-foreground">
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
