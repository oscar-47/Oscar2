'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { ChevronDown, Trash2, Check, Copy, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { BlueprintImagePlan, GeneratedPrompt } from '@/types'
import { cn } from '@/lib/utils'
import { clampText, formatTextCounter, TEXT_LIMITS } from '@/lib/input-guard'

const PROMPT_MIN_LENGTH = 50

interface ImagePlanCardProps {
  index: number
  plan: BlueprintImagePlan
  onChange: (next: BlueprintImagePlan) => void
  disabled?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  generatedPrompt?: GeneratedPrompt
  onPromptChange?: (prompt: string) => void
}

export function ImagePlanCard({ index, plan, onChange, disabled = false, selected, onToggleSelect, onDelete, onDuplicate, generatedPrompt, onPromptChange }: ImagePlanCardProps) {
  const locale = useLocale()
  const isZh = locale.startsWith('zh')
  const [open, setOpen] = useState(false)

  return (
    <div className={cn(
      'rounded-[24px] border bg-white p-5 transition-opacity',
      onToggleSelect && selected === false ? 'border-border opacity-60' : 'border-border',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {onToggleSelect ? (
            <button
              type="button"
              onClick={onToggleSelect}
              className={cn(
                'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                selected
                  ? 'border-foreground bg-primary text-white'
                  : 'border-border bg-white text-transparent hover:border-muted-foreground',
              )}
            >
              <Check className="h-4 w-4" />
            </button>
          ) : (
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <span className="text-[14px] font-semibold text-foreground">{index + 1}</span>
            </div>
          )}
          {!open && (
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <h4 className="truncate text-[15px] font-semibold text-foreground">{plan.title}</h4>
                {generatedPrompt && generatedPrompt.prompt.length < PROMPT_MIN_LENGTH && (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
              </div>
              <p className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">{plan.description}</p>
            </div>
          )}
          {open && (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-muted-foreground">
                {plan.title || `Image ${index + 1}`}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              disabled={disabled}
            >
              <Copy className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-red-500"
              disabled={disabled}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            disabled={disabled}
          >
            <ChevronDown className={cn('h-5 w-5 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="space-y-3">
            <Input
              value={plan.title}
              onChange={(e) => onChange({ ...plan, title: clampText(e.target.value, TEXT_LIMITS.planTitle) })}
              disabled={disabled}
              maxLength={TEXT_LIMITS.planTitle}
              placeholder={`图片 ${index + 1} 标题`}
              className="h-11 rounded-2xl border-border bg-secondary text-[14px] text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              {formatTextCounter(plan.title, TEXT_LIMITS.planTitle, isZh)}
            </p>
            <Textarea
              value={plan.description}
              onChange={(e) => onChange({ ...plan, description: clampText(e.target.value, TEXT_LIMITS.planDescription) })}
              disabled={disabled}
              rows={3}
              maxLength={TEXT_LIMITS.planDescription}
              placeholder="补充该图片的描述"
              className="resize-none rounded-2xl border-border bg-secondary text-[14px] leading-6 text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              {formatTextCounter(plan.description, TEXT_LIMITS.planDescription, isZh)}
            </p>
            <Textarea
              value={plan.design_content}
              onChange={(e) => onChange({ ...plan, design_content: clampText(e.target.value, TEXT_LIMITS.planContent) })}
              disabled={disabled}
              rows={12}
              maxLength={TEXT_LIMITS.planContent}
              placeholder="补充该图片的设计内容"
              className="resize-none rounded-2xl border-border bg-secondary text-[14px] leading-7 text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              {formatTextCounter(plan.design_content, TEXT_LIMITS.planContent, isZh)}
            </p>
            {generatedPrompt && (
              <div className="mt-1">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[12px] font-medium text-muted-foreground">Prompt</span>
                  {generatedPrompt.prompt.length < PROMPT_MIN_LENGTH ? (
                    <span className="flex items-center gap-1 text-[11px] text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      Short
                    </span>
                  ) : (
                    <span className="text-[11px] text-emerald-500">OK</span>
                  )}
                </div>
                <Textarea
                  value={generatedPrompt.prompt}
                  onChange={(e) => onPromptChange?.(clampText(e.target.value, TEXT_LIMITS.generatedPrompt))}
                  disabled={disabled || !onPromptChange}
                  rows={4}
                  maxLength={TEXT_LIMITS.generatedPrompt}
                  className="resize-none rounded-2xl border-border bg-accent/10 text-[13px] leading-6 text-foreground"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatTextCounter(generatedPrompt.prompt, TEXT_LIMITS.generatedPrompt, isZh)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
