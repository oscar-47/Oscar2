'use client'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SlidersHorizontal, Zap } from 'lucide-react'
import { SectionIcon } from '@/components/shared/SectionIcon'
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

const inputClass = 'h-11 rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] px-3 text-[14px] text-[#22252d]'

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
    <div className="rounded-[28px] border border-[#d0d4dc] bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <SectionIcon icon={SlidersHorizontal} />
        <div>
          <h3 className="text-[15px] font-semibold text-[#1a1d24]">组图要求</h3>
          <p className="text-[13px] text-[#7d818d]">描述您的产品信息和期望的图片风格</p>
        </div>
      </div>

      <Textarea
        value={requirements}
        onChange={(e) => onRequirementsChange(e.target.value)}
        placeholder="建议输入：款式名称、面料材质、设计亮点、适合人群、风格调性等&#10;&#10;例如：这是一款法式复古连衣裙，采用重磅真丝面料，特色是精致的蕾丝拼接和珍珠扣设计，适合25-35岁都市女性通勤或约会穿"
        disabled={disabled}
        rows={5}
        className="min-h-[132px] resize-none rounded-2xl border-[#d0d4dc] bg-[#f1f3f6] text-[14px] leading-6 text-[#2b2f38]"
      />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[13px] font-medium text-[#5a5e6b]">目标语言</Label>
          <Select value={language} onValueChange={onLanguageChange} disabled={disabled}>
            <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">无文字(纯视觉)</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] font-medium text-[#5a5e6b]">模型</Label>
          <Select value={model} onValueChange={(v) => onModelChange(v as GenerationModel)} disabled={disabled}>
            <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flux-kontext-pro">FLUX.1 Kontext Pro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] font-medium text-[#5a5e6b]">尺寸比例</Label>
          <Select value={aspectRatio} onValueChange={(v) => onAspectRatioChange(v as AspectRatio)} disabled={disabled}>
            <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1:1">1:1 方图</SelectItem>
              <SelectItem value="3:4">3:4 竖版</SelectItem>
              <SelectItem value="4:3">4:3 横版</SelectItem>
              <SelectItem value="9:16">9:16 长图</SelectItem>
              <SelectItem value="16:9">16:9 宽屏</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] font-medium text-[#5a5e6b]">清晰度</Label>
          <Select value={resolution} onValueChange={(v) => onResolutionChange(v as ImageSize)} disabled={disabled}>
            <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1K">1K 标清</SelectItem>
              <SelectItem value="2K">2K 高清 (仅Pro)</SelectItem>
              <SelectItem value="4K">4K 超清 (仅Pro)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-[#d0d4dc] bg-[#f1f3f6] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${turboEnabled ? 'bg-[#e7f8ee] text-[#22b968]' : 'bg-[#eceef2] text-[#6f737c]'}`}>
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-[#1a1d24]">Turbo 加速模式</p>
            <p className="text-[12px] text-[#7d818d]">更快、更稳定</p>
          </div>
        </div>
        <Switch
          checked={turboEnabled}
          onCheckedChange={onTurboChange}
          disabled={disabled}
          className="h-8 w-14 border-0 data-[state=checked]:bg-[#1a1d24] data-[state=unchecked]:bg-[#d8d9dd]"
        />
      </div>
    </div>
  )
}
