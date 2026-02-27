'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ModelTryOnTab } from './ModelTryOnTab'
import { BasicPhotoSetTab } from './BasicPhotoSetTab'
import type { ClothingTab } from './types'

function uid() {
  return crypto.randomUUID()
}

export function ClothingStudioForm() {
  const [activeTab, setActiveTab] = useState<ClothingTab>('model-tryon')
  const [traceId] = useState(() => uid())

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">服装工作室</h1>
        <p className="text-muted-foreground">
          生成专业的服装电商图片，支持模特试穿与基础图集
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ClothingTab)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="model-tryon">模特试穿</TabsTrigger>
          <TabsTrigger value="basic-photo-set">基础图集</TabsTrigger>
        </TabsList>

        <TabsContent value="model-tryon" className="mt-6">
          <ModelTryOnTab traceId={traceId} />
        </TabsContent>

        <TabsContent value="basic-photo-set" className="mt-6">
          <BasicPhotoSetTab traceId={traceId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
