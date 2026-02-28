'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import type { BlueprintImagePlan } from '@/types'
import { cn } from '@/lib/utils'

interface ImagePlanCardProps {
  index: number
  plan: BlueprintImagePlan
  onChange: (next: BlueprintImagePlan) => void
  disabled?: boolean
}

export function ImagePlanCard({ index, plan, onChange, disabled = false }: ImagePlanCardProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-[24px] border border-[#d0d4dc] bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2]">
            <span className="text-[14px] font-semibold text-[#1a1d24]">{index + 1}</span>
          </div>
          {!open && (
            <div className="min-w-0 flex-1 space-y-0.5">
              <h4 className="truncate text-[15px] font-semibold text-[#1a1d24]">{plan.title}</h4>
              <p className="line-clamp-2 text-[13px] leading-5 text-[#7d818d]">{plan.description}</p>
            </div>
          )}
          {open && (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-[#7d818d]">
                {plan.title || `Image ${index + 1}`}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md p-2 text-[#7a7f8b] hover:bg-[#eceff4] hover:text-[#31343c]"
          disabled={disabled}
        >
          <ChevronDown className={cn('h-5 w-5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="mt-4 border-t border-[#e1e4ea] pt-4">
          <div className="space-y-3">
            <Textarea
              value={plan.design_content}
              onChange={(e) => onChange({ ...plan, design_content: e.target.value })}
              disabled={disabled}
              rows={12}
              className="resize-none rounded-2xl border-[#d0d4dc] bg-[#f5f6f8] text-[14px] leading-7 text-[#262a32]"
            />
          </div>
        </div>
      )}
    </div>
  )
}
