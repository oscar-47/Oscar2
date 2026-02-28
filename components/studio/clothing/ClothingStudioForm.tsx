'use client'

import { useState } from 'react'
import { TabsList, TabsTrigger, Tabs } from '@/components/ui/tabs'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { ModelTryOnTab } from './ModelTryOnTab'
import { BasicPhotoSetTab } from './BasicPhotoSetTab'
import type { ClothingTab, ClothingPhase } from './types'
import { Loader2, Shirt, GalleryVerticalEnd } from 'lucide-react'

const PHASE_STEPS: { phase: ClothingPhase; label: string; num: number }[] = [
  { phase: 'input', label: '上传图片', num: 1 },
  { phase: 'analyzing', label: 'AI 分析', num: 2 },
  { phase: 'preview', label: '预览方案', num: 3 },
  { phase: 'generating', label: '生成中', num: 4 },
  { phase: 'complete', label: '完成', num: 5 },
]

function StepIndicator({ currentPhase }: { currentPhase: ClothingPhase }) {
  const phaseOrder: ClothingPhase[] = ['input', 'analyzing', 'preview', 'generating', 'complete']
  const currentIdx = phaseOrder.indexOf(currentPhase)

  return (
    <div className="flex w-full items-center justify-center overflow-x-auto pb-1">
      {PHASE_STEPS.map((step, i) => {
        const isDone = i < currentIdx
        const isCurrent = i === currentIdx
        const isPastOrCurrent = isDone || isCurrent
        const spinning = isCurrent && (currentPhase === 'analyzing' || currentPhase === 'generating')

        return (
          <div key={step.phase} className="flex shrink-0 items-center">
            <div className="flex items-center gap-2">
              {isCurrent ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#191b22] text-xs font-semibold text-white">
                  {spinning ? <Loader2 className="h-4 w-4 animate-spin" /> : step.num}
                </span>
              ) : (
                <span className={`w-4 text-center text-sm ${isDone ? 'font-medium text-[#202227]' : 'text-[#6f7380]'}`}>
                  {step.num}
                </span>
              )}
              <span className={`text-sm ${isPastOrCurrent ? 'font-medium text-[#202227]' : 'text-[#6f7380]'}`}>
                {step.label}
              </span>
            </div>
            {i < PHASE_STEPS.length - 1 && (
              <div className="mx-3 h-px w-8 bg-[#d8dbe1] sm:mx-5 sm:w-12" />
            )}
          </div>
        )
      })}
    </div>
  )
}

function uid() {
  return crypto.randomUUID()
}

export function ClothingStudioForm() {
  const [activeTab, setActiveTab] = useState<ClothingTab>('basic-photo-set')
  const [traceId] = useState(() => uid())

  const tab1 = ModelTryOnTab({ traceId })
  const tab2 = BasicPhotoSetTab({ traceId })

  const current = activeTab === 'model-tryon' ? tab1 : tab2
  const previewCount = current.previewCount ?? 0
  const tabLocked = current.phase === 'analyzing' || current.phase === 'generating'
  const rightPanelTitle = current.phase === 'analyzing'
    ? '分析中...'
    : current.phase === 'generating'
      ? '生成中...'
      : current.phase === 'preview'
        ? '生成结果'
        : '生成结果'
  const rightPanelSubtitle = current.phase === 'analyzing'
    ? '正在分析产品并生成设计规范'
    : current.phase === 'generating'
      ? '正在根据规划生成图片'
      : current.phase === 'preview'
        ? `${previewCount} 张图片规划`
        : '上传产品图片点击分析开始'

  return (
    <CorePageShell maxWidthClass="max-w-[1360px]">
      <div className="mx-auto w-full">
        <div className="flex flex-col items-center justify-center pb-11 pt-1">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#d0d4dc] bg-[#f1f3f6] px-4 py-1.5 text-xs font-medium text-[#202227]">
            <svg
              className="h-4 w-4 text-[#202227]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v18M3 12h18M5 5l14 14M5 19L19 5" className="origin-center scale-[0.6] opacity-0" />
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            <span className="text-xs font-medium text-[#202227]">AI 服饰</span>
            <span className="rounded-full bg-[#3f424a] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              BETA
            </span>
          </div>

          <h1 className="mb-4 text-center text-3xl font-semibold tracking-tight text-[#17181d] sm:text-4xl">
            智能生成服装详情图组
          </h1>
          <p className="text-center text-sm leading-relaxed text-[#70727a] sm:text-base">
            上传服装产品图，AI 智能分析款式、面料与细节，自动生成白底精修、3D 立体展示
            <br />
            及细节特写等电商级图组
          </p>

          <div className="mt-12 w-full">
            <StepIndicator currentPhase={current.phase} />
          </div>
        </div>

        <div className="grid gap-7 xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="flex min-h-[760px] flex-col gap-5">
            <Tabs value={activeTab} onValueChange={(v) => !tabLocked && setActiveTab(v as ClothingTab)}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-full bg-transparent p-0">
                <TabsTrigger
                  value="model-tryon"
                  disabled={tabLocked}
                  className="h-11 rounded-full border border-transparent bg-transparent text-sm font-medium text-[#5a5f6b] shadow-none transition-none data-[state=active]:border-[#0f1118] data-[state=active]:bg-[#11131a] data-[state=active]:text-white"
                >
                  <Shirt className="mr-1.5 h-4 w-4" />
                  模特试穿
                </TabsTrigger>
                <TabsTrigger
                  value="basic-photo-set"
                  disabled={tabLocked}
                  className="h-11 rounded-full border border-transparent bg-transparent text-sm font-medium text-[#5a5f6b] shadow-none transition-none data-[state=active]:border-[#0f1118] data-[state=active]:bg-[#11131a] data-[state=active]:text-white"
                >
                  <GalleryVerticalEnd className="mr-1.5 h-4 w-4" />
                  基础图集
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex-1">
              {activeTab === 'model-tryon' ? tab1.leftPanel : tab2.leftPanel}
            </div>
          </div>

          <div className="flex min-h-[760px] flex-col rounded-[30px] border border-[#d0d4dc] bg-white p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#4c5059]">
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#1a1d24]">{rightPanelTitle}</h3>
                <p className="mt-0.5 text-[13px] text-[#7d818d]">{rightPanelSubtitle}</p>
              </div>
            </div>
            <div className="flex-1">
              {activeTab === 'model-tryon' ? tab1.rightPanel : tab2.rightPanel}
            </div>
          </div>
        </div>
      </div>
    </CorePageShell>
  )
}
