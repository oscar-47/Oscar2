'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
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

export function GenerationTypeSelector({
  typeState,
  onTypeStateChange,
  disabled = false,
}: GenerationTypeSelectorProps) {
  return (
    <div className="space-y-4 rounded-xl border p-4">
      <h3 className="font-semibold">选择生成类型</h3>
      <p className="text-sm text-muted-foreground">
        已选择 {countSelectedTypes(typeState)} 种类型
      </p>

      <Separator />

      {/* 白底精修图 */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">白底精修图</h4>
        <div className="flex items-center gap-3">
          <Checkbox
            id="white-front"
            checked={typeState.whiteBgRetouched.front}
            onCheckedChange={(checked: boolean) =>
              onTypeStateChange({
                ...typeState,
                whiteBgRetouched: { ...typeState.whiteBgRetouched, front: !!checked },
              })
            }
            disabled={disabled}
          />
          <Label htmlFor="white-front" className="cursor-pointer font-normal">
            正面视图
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox
            id="white-back"
            checked={typeState.whiteBgRetouched.back}
            onCheckedChange={(checked: boolean) =>
              onTypeStateChange({
                ...typeState,
                whiteBgRetouched: { ...typeState.whiteBgRetouched, back: !!checked },
              })
            }
            disabled={disabled}
          />
          <Label htmlFor="white-back" className="cursor-pointer font-normal">
            背面视图
          </Label>
        </div>
      </div>

      <Separator />

      {/* 3D立体效果图 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">3D立体效果图</h4>
          <Switch
            id="3d-effect"
            checked={typeState.threeDEffect.enabled}
            onCheckedChange={(checked) =>
              onTypeStateChange({
                ...typeState,
                threeDEffect: { ...typeState.threeDEffect, enabled: checked },
              })
            }
            disabled={disabled}
          />
        </div>
        {typeState.threeDEffect.enabled && (
          <div className="flex items-center gap-3">
            <Checkbox
              id="3d-white-bg"
              checked={typeState.threeDEffect.whiteBackground}
              onCheckedChange={(checked: boolean) =>
                onTypeStateChange({
                  ...typeState,
                  threeDEffect: { ...typeState.threeDEffect, whiteBackground: !!checked },
                })
              }
              disabled={disabled}
            />
            <Label htmlFor="3d-white-bg" className="cursor-pointer font-normal">
              白色背景
            </Label>
          </div>
        )}
      </div>

      <Separator />

      {/* 人台图 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">人台图</h4>
          <Switch
            id="mannequin"
            checked={typeState.mannequin.enabled}
            onCheckedChange={(checked) =>
              onTypeStateChange({
                ...typeState,
                mannequin: { ...typeState.mannequin, enabled: checked },
              })
            }
            disabled={disabled}
          />
        </div>
        {typeState.mannequin.enabled && (
          <div className="flex items-center gap-3">
            <Checkbox
              id="mannequin-white-bg"
              checked={typeState.mannequin.whiteBackground}
              onCheckedChange={(checked: boolean) =>
                onTypeStateChange({
                  ...typeState,
                  mannequin: { ...typeState.mannequin, whiteBackground: !!checked },
                })
              }
              disabled={disabled}
            />
            <Label htmlFor="mannequin-white-bg" className="cursor-pointer font-normal">
              白色背景
            </Label>
          </div>
        )}
      </div>

      <Separator />

      {/* 细节特写图 */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">细节特写图</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">数量</Label>
            <span className="text-sm text-muted-foreground">{typeState.detailCloseup.count}</span>
          </div>
          <Slider
            value={[typeState.detailCloseup.count]}
            onValueChange={([value]: number[]) =>
              onTypeStateChange({
                ...typeState,
                detailCloseup: { count: value },
              })
            }
            min={0}
            max={5}
            step={1}
            disabled={disabled}
          />
        </div>
      </div>

      <Separator />

      {/* 卖点图 */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">卖点图</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">数量</Label>
            <span className="text-sm text-muted-foreground">{typeState.sellingPoint.count}</span>
          </div>
          <Slider
            value={[typeState.sellingPoint.count]}
            onValueChange={([value]: number[]) =>
              onTypeStateChange({
                ...typeState,
                sellingPoint: { count: value },
              })
            }
            min={0}
            max={5}
            step={1}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}
