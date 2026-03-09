'use client'

import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EcomDetailModuleId } from '@/types'
import {
  ECOM_DETAIL_MODULES,
  localizeEcomDetailModule,
} from '@/lib/studio/ecom-detail-modules'

interface EcomDetailModuleSelectorProps {
  selectedIds: EcomDetailModuleId[]
  onToggle: (id: EcomDetailModuleId) => void
  disabled?: boolean
  isZh: boolean
}

export function EcomDetailModuleSelector({
  selectedIds,
  onToggle,
  disabled = false,
  isZh,
}: EcomDetailModuleSelectorProps) {
  const selectedSet = new Set(selectedIds)

  return (
    <div className="rounded-2xl border border-border bg-background p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-foreground">
              {isZh ? '详情页模块（多选）' : 'Detail Page Modules'}
            </h3>
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {isZh
              ? '至少选择 1 个模块。每个模块都会生成独立规划内容，并最终对应 1 张图片。'
              : 'Select at least one module. Each module becomes one plan and one final image.'}
          </p>
        </div>
        <span className="text-[13px] text-muted-foreground">
          {selectedIds.length}/{ECOM_DETAIL_MODULES.length}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {ECOM_DETAIL_MODULES.map((module) => {
          const localized = localizeEcomDetailModule(module, isZh)
          const active = selectedSet.has(module.id)

          return (
            <button
              key={module.id}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(module.id)}
              className={cn(
                'rounded-2xl border-2 px-5 py-5 text-left transition-colors',
                active
                  ? 'border-accent bg-background shadow-sm'
                  : 'border-border bg-secondary hover:border-muted-foreground hover:bg-background',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <p className="text-[17px] font-semibold text-foreground">{localized.title}</p>
              <p className="mt-2 text-[14px] text-muted-foreground">{localized.subtitle}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
