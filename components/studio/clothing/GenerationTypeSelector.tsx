'use client'

import { LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionIcon } from '@/components/shared/SectionIcon'
import type { BasicPhotoTypeState } from './types'

interface GenerationTypeSelectorProps {
  typeState: BasicPhotoTypeState
  onTypeStateChange: (state: BasicPhotoTypeState) => void
  disabled?: boolean
}

export function countSelectedTypes(state: BasicPhotoTypeState): number {
  let count = 0
  if (state.whiteBgRetouched.front) count++
  if (state.whiteBgRetouched.back) count++
  if (state.threeDEffect.enabled) count++
  if (state.mannequin.enabled) count++
  count += state.detailCloseup.count
  count += state.sellingPoint.count
  return count
}

function ChipToggle({
  active,
  label,
  onClick,
  disabled,
}: {
  active: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-[#13151b] bg-[#13151b] text-white'
          : 'border-[#d6d9e0] bg-[#f0f1f4] text-[#6b707d]',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {label}
    </button>
  )
}

function CountStepper({
  value,
  onDecrease,
  onIncrease,
  disabled,
}: {
  value: number
  onDecrease: () => void
  onIncrease: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onDecrease}
        disabled={disabled || value <= 0}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d8dbe1] bg-[#f1f2f4] text-sm text-[#676c79] disabled:cursor-not-allowed disabled:opacity-40"
      >
        -
      </button>
      <span className="w-6 text-center text-sm font-semibold text-[#21242c]">{value}</span>
      <button
        type="button"
        onClick={onIncrease}
        disabled={disabled || value >= 5}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d8dbe1] bg-[#f1f2f4] text-sm text-[#676c79] disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}

function RowIcon({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
        active ? 'bg-[#11131a] text-white' : 'bg-[#eceef2] text-[#5b606c]'
      )}
    >
      {children}
    </div>
  )
}

export function GenerationTypeSelector({
  typeState,
  onTypeStateChange,
  disabled = false,
}: GenerationTypeSelectorProps) {
  const totalSelected = countSelectedTypes(typeState)
  const isWhiteBgSelected = typeState.whiteBgRetouched.front || typeState.whiteBgRetouched.back
  const is3DSelected = typeState.threeDEffect.enabled
  const isMannequinSelected = typeState.mannequin.enabled
  const isDetailSelected = typeState.detailCloseup.count > 0
  const isSellingPointSelected = typeState.sellingPoint.count > 0

  const rowClass = (active: boolean) =>
    cn(
      'rounded-2xl border px-4 py-3 transition-colors',
      active ? 'border-[#11131a] bg-white' : 'border-[#d8dbe2] bg-[#f1f3f6]',
      disabled && 'opacity-70'
    )

  return (
    <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <SectionIcon icon={LayoutGrid} />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[#1f2228]">选择生成类型</h3>
          <p className="text-xs text-[#7d818d]">选择需要生成的图片类型</p>
        </div>
        <span className="text-sm font-medium text-[#676c79]">已选 {totalSelected} 项</span>
      </div>

      <div className="space-y-2.5">
        <div
          className={rowClass(isWhiteBgSelected)}
          onClick={() => {
            if (disabled) return
            if (isWhiteBgSelected) {
              onTypeStateChange({ ...typeState, whiteBgRetouched: { front: false, back: false } })
            } else {
              onTypeStateChange({ ...typeState, whiteBgRetouched: { front: true, back: false } })
            }
          }}
        >
          <div className="flex items-center gap-3">
            <RowIcon active={isWhiteBgSelected}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </RowIcon>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[#1f2228]">白底精修图</h4>
              <p className="text-xs text-[#787d89]">纯白背景的产品精修展示图</p>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <ChipToggle
                active={typeState.whiteBgRetouched.front}
                label="正面"
                disabled={disabled}
                onClick={() =>
                  onTypeStateChange({
                    ...typeState,
                    whiteBgRetouched: { ...typeState.whiteBgRetouched, front: !typeState.whiteBgRetouched.front },
                  })
                }
              />
              <ChipToggle
                active={typeState.whiteBgRetouched.back}
                label="背面"
                disabled={disabled}
                onClick={() =>
                  onTypeStateChange({
                    ...typeState,
                    whiteBgRetouched: { ...typeState.whiteBgRetouched, back: !typeState.whiteBgRetouched.back },
                  })
                }
              />
            </div>
          </div>
        </div>

        <div
          className={rowClass(is3DSelected)}
          onClick={() => {
            if (disabled) return
            onTypeStateChange({ ...typeState, threeDEffect: { ...typeState.threeDEffect, enabled: !is3DSelected } })
          }}
        >
          <div className="flex items-center gap-3">
            <RowIcon active={is3DSelected}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
              </svg>
            </RowIcon>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[#1f2228]">3D立体效果图</h4>
              <p className="text-xs text-[#787d89]">具有立体感和层次感的产品展示</p>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <ChipToggle
                active={typeState.threeDEffect.whiteBackground}
                label="白底图"
                disabled={disabled || !is3DSelected}
                onClick={() =>
                  onTypeStateChange({
                    ...typeState,
                    threeDEffect: {
                      ...typeState.threeDEffect,
                      whiteBackground: !typeState.threeDEffect.whiteBackground,
                    },
                  })
                }
              />
            </div>
          </div>
        </div>

        <div
          className={rowClass(isMannequinSelected)}
          onClick={() => {
            if (disabled) return
            onTypeStateChange({ ...typeState, mannequin: { ...typeState.mannequin, enabled: !isMannequinSelected } })
          }}
        >
          <div className="flex items-center gap-3">
            <RowIcon active={isMannequinSelected}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </RowIcon>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[#1f2228]">人台图</h4>
              <p className="text-xs text-[#787d89]">使用人台展示服装的专业效果图</p>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <ChipToggle
                active={typeState.mannequin.whiteBackground}
                label="白底图"
                disabled={disabled || !isMannequinSelected}
                onClick={() =>
                  onTypeStateChange({
                    ...typeState,
                    mannequin: {
                      ...typeState.mannequin,
                      whiteBackground: !typeState.mannequin.whiteBackground,
                    },
                  })
                }
              />
            </div>
          </div>
        </div>

        <div className={rowClass(isDetailSelected)}>
          <div className="flex items-center gap-3">
            <RowIcon active={isDetailSelected}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </RowIcon>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[#1f2228]">细节特写图</h4>
              <p className="text-xs text-[#787d89]">展示产品细节和材质的特写图</p>
            </div>
            <CountStepper
              value={typeState.detailCloseup.count}
              disabled={disabled}
              onDecrease={() =>
                onTypeStateChange({
                  ...typeState,
                  detailCloseup: { count: Math.max(0, typeState.detailCloseup.count - 1) },
                })
              }
              onIncrease={() =>
                onTypeStateChange({
                  ...typeState,
                  detailCloseup: { count: Math.min(5, typeState.detailCloseup.count + 1) },
                })
              }
            />
          </div>
        </div>

        <div className={rowClass(isSellingPointSelected)}>
          <div className="flex items-center gap-3">
            <RowIcon active={isSellingPointSelected}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </RowIcon>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[#1f2228]">卖点图</h4>
              <p className="text-xs text-[#787d89]">突出产品核心卖点的专属展示图</p>
            </div>
            <CountStepper
              value={typeState.sellingPoint.count}
              disabled={disabled}
              onDecrease={() =>
                onTypeStateChange({
                  ...typeState,
                  sellingPoint: { count: Math.max(0, typeState.sellingPoint.count - 1) },
                })
              }
              onIncrease={() =>
                onTypeStateChange({
                  ...typeState,
                  sellingPoint: { count: Math.min(5, typeState.sellingPoint.count + 1) },
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
