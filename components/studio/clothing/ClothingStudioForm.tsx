'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { TabsList, TabsTrigger, Tabs } from '@/components/ui/tabs'
import { CorePageShell } from '@/components/studio/CorePageShell'
import { StudioPageHero } from '@/components/studio/StudioPageHero'
import { ModelTryOnTab } from './ModelTryOnTab'
import { BasicPhotoSetTab } from './BasicPhotoSetTab'
import type { ClothingTab, ClothingPhase } from './types'
import { Loader2, Shirt, GalleryVerticalEnd } from 'lucide-react'


function getPhaseSteps(t: (key: string) => string): { phase: ClothingPhase; label: string; num: number }[] {
  return [
    { phase: 'input', label: t('stepUpload'), num: 1 },
    { phase: 'analyzing', label: t('stepAnalyze'), num: 2 },
    { phase: 'preview', label: t('stepPreview'), num: 3 },
    { phase: 'generating', label: t('stepGenerating'), num: 4 },
    { phase: 'complete', label: t('stepComplete'), num: 5 },
  ]
}

function StepIndicator({ currentPhase, steps }: { currentPhase: ClothingPhase; steps: { phase: ClothingPhase; label: string; num: number }[] }) {
  const phaseOrder: ClothingPhase[] = ['input', 'analyzing', 'preview', 'generating', 'complete']
  const currentIdx = phaseOrder.indexOf(currentPhase)

  return (
    <div className="flex w-full items-center justify-center overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const isDone = i < currentIdx
        const isCurrent = i === currentIdx
        const isPastOrCurrent = isDone || isCurrent
        const spinning = isCurrent && (currentPhase === 'analyzing' || currentPhase === 'generating')

        return (
          <div key={step.phase} className="flex shrink-0 items-center">
            <div className="flex items-center gap-2">
              {isCurrent ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                  {spinning ? <Loader2 className="h-4 w-4 animate-spin" /> : step.num}
                </span>
              ) : (
                <span className={`w-4 text-center text-sm ${isDone ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                  {step.num}
                </span>
              )}
              <span className={`text-sm ${isPastOrCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="mx-3 h-px w-8 bg-border sm:mx-5 sm:w-12" />
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
  const t = useTranslations('studio.clothingStudio')
  const [activeTab, setActiveTab] = useState<ClothingTab>('basic-photo-set')
  const [traceId] = useState(() => uid())

  const tab1 = ModelTryOnTab({ traceId })
  const tab2 = BasicPhotoSetTab({ traceId })

  const current = activeTab === 'model-tryon' ? tab1 : tab2
  const previewCount = current.previewCount ?? 0
  const isModelTryOnTab = activeTab === 'model-tryon'
  const tabLocked = current.phase === 'analyzing' || current.phase === 'generating'
  const rightPanelTitle = current.phase === 'analyzing'
    ? t('analyzingTitle')
    : current.phase === 'generating'
      ? t('generatingTitle')
      : current.phase === 'preview'
        ? (isModelTryOnTab ? t('previewTitleTryOn') : t('previewTitleBasic'))
        : t('resultTitle')
  const rightPanelSubtitle = current.phase === 'analyzing'
    ? (isModelTryOnTab ? t('analyzingSubtitleTryOn') : t('analyzingSubtitleBasic'))
    : current.phase === 'generating'
      ? (isModelTryOnTab ? t('generatingSubtitleTryOn') : t('generatingSubtitleBasic'))
      : current.phase === 'preview'
        ? (isModelTryOnTab ? t('previewSubtitleTryOn', { count: previewCount }) : t('previewSubtitleBasic', { count: previewCount }))
        : t('inputSubtitle')

  const phaseSteps = getPhaseSteps(t)

  return (
    <CorePageShell maxWidthClass="max-w-[1360px]">
      <div className="mx-auto w-full">
        <div className="mb-7">
          <StudioPageHero
            icon={Shirt}
            badge={t('badge')}
            title={t('pageTitle')}
            description={
              <>
                <p>{t('pageDescriptionLine1')}</p>
                <p>{t('pageDescriptionLine2')}</p>
              </>
            }
            badgeClassName="border-emerald-200/80 bg-emerald-50/90 text-emerald-700"
          />

          <div className="mt-10 w-full">
            <StepIndicator currentPhase={current.phase} steps={phaseSteps} />
          </div>
        </div>

        <div className="grid gap-7 xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="flex min-h-[760px] flex-col gap-5">
            <Tabs value={activeTab} onValueChange={(v) => !tabLocked && setActiveTab(v as ClothingTab)}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-full bg-transparent p-0">
                <TabsTrigger
                  value="model-tryon"
                  disabled={tabLocked}
                  className="h-11 rounded-full border border-transparent bg-transparent text-sm font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <Shirt className="mr-1.5 h-4 w-4" />
                  {t('tabModelTryOn')}
                </TabsTrigger>
                <TabsTrigger
                  value="basic-photo-set"
                  disabled={tabLocked}
                  className="h-11 rounded-full border border-transparent bg-transparent text-sm font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  <GalleryVerticalEnd className="mr-1.5 h-4 w-4" />
                  {t('tabBasicPhotoSet')}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex-1">
              {activeTab === 'model-tryon' ? tab1.leftPanel : tab2.leftPanel}
            </div>
          </div>

          <div className="flex min-h-[760px] flex-col rounded-2xl border border-border bg-background p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
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
                <h3 className="text-[15px] font-semibold text-foreground">{rightPanelTitle}</h3>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{rightPanelSubtitle}</p>
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
