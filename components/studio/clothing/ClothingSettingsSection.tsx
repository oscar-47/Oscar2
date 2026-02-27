'use client'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { GenerationModel, AspectRatio, ImageSize } from '@/types'

interface ClothingSettingsSectionProps {
  requirements: string
  onRequirementsChange: (value: string) => void
  language: string
  onLanguageChange: (value: string) => void
  model: GenerationModel
  onModelChange: (value: GenerationModel) => void
  aspectRatio: AspectRatio
  onAspectRatioChange: (value: AspectRatio) => void
  resolution: ImageSize
  onResolutionChange: (value: ImageSize) => void
  turboEnabled: boolean
  onTurboChange: (value: boolean) => void
  disabled?: boolean
}

export function ClothingSettingsSection({
  requirements,
  onRequirementsChange,
  language,
  onLanguageChange,
  model,
  onModelChange,
  aspectRatio,
  onAspectRatioChange,
  resolution,
  onResolutionChange,
  turboEnabled,
  onTurboChange,
  disabled = false,
}: ClothingSettingsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>需求描述</Label>
        <Textarea
          value={requirements}
          onChange={(e) => onRequirementsChange(e.target.value)}
          placeholder="描述您的需求..."
          disabled={disabled}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>语言</Label>
        <RadioGroup value={language} onValueChange={onLanguageChange} disabled={disabled}>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="zh" id="lang-zh" />
            <Label htmlFor="lang-zh" className="font-normal cursor-pointer">中文</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="en" id="lang-en" />
            <Label htmlFor="lang-en" className="font-normal cursor-pointer">English</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>模型</Label>
          <Select value={model} onValueChange={(v) => onModelChange(v as GenerationModel)} disabled={disabled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nano-banana">Nano Banana</SelectItem>
              <SelectItem value="nano-banana-pro">Nano Banana Pro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>宽高比</Label>
          <Select value={aspectRatio} onValueChange={(v) => onAspectRatioChange(v as AspectRatio)} disabled={disabled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1:1">1:1</SelectItem>
              <SelectItem value="16:9">16:9</SelectItem>
              <SelectItem value="9:16">9:16</SelectItem>
              <SelectItem value="4:3">4:3</SelectItem>
              <SelectItem value="3:4">3:4</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>分辨率</Label>
          <Select value={resolution} onValueChange={(v) => onResolutionChange(v as ImageSize)} disabled={disabled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1K">1K</SelectItem>
              <SelectItem value="2K">2K</SelectItem>
              <SelectItem value="4K">4K</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch id="turbo" checked={turboEnabled} onCheckedChange={onTurboChange} disabled={disabled} />
        <Label htmlFor="turbo" className="cursor-pointer">Turbo加速</Label>
      </div>
    </div>
  )
}
