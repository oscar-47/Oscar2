'use client'

import { useState } from 'react'
import { ChevronDown, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
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
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold">
            {index + 1}
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <div className="relative">
              <Input
                value={plan.title}
                onChange={(e) => onChange({ ...plan, title: e.target.value })}
                disabled={disabled}
                className="pr-10 text-lg font-semibold"
              />
              <Pencil className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
            <Input
              value={plan.description}
              onChange={(e) => onChange({ ...plan, description: e.target.value })}
              disabled={disabled}
              className="text-base text-muted-foreground"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          disabled={disabled}
        >
          <ChevronDown className={cn('h-5 w-5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="mt-4 border-t pt-4">
          <Textarea
            value={plan.design_content}
            onChange={(e) => onChange({ ...plan, design_content: e.target.value })}
            disabled={disabled}
            rows={14}
            className="font-mono text-sm leading-6"
          />
        </div>
      )}
    </div>
  )
}
