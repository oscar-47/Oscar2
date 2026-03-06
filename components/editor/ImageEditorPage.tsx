'use client'

import { useEffect, useState } from 'react'
import { clearEditorSession, loadEditorSession } from '@/lib/utils/editor-session'
import { useEditorStore } from '@/lib/stores/editor-store'
import { uploadFile } from '@/lib/api/upload'
import { upsertResultAssets } from '@/lib/utils/result-assets'
import type { ResultAsset } from '@/types'
import { EditorHeader } from './EditorHeader'
import { EditorSidebar } from './EditorSidebar'
import { EditorCanvas } from './EditorCanvas'
import { EditorBottomToolbar } from './EditorBottomToolbar'
import { QuickEditPanel } from './QuickEditPanel'
import { TextEditPanel } from './TextEditPanel'
import { CropToolbar } from './CropToolbar'

interface ImageEditorPageProps {
  sid?: string
}

function isOurStorageDomain(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return false
  try {
    return new URL(url).origin === new URL(supabaseUrl).origin
  } catch {
    return false
  }
}

async function reuploadIfCrossOrigin(asset: ResultAsset): Promise<ResultAsset> {
  if (isOurStorageDomain(asset.url) || asset.url.startsWith('data:')) return asset
  try {
    const res = await fetch(asset.url)
    if (!res.ok) return asset
    const blob = await res.blob()
    const ext = asset.url.match(/\.(png|jpg|jpeg|webp)/i)?.[1] ?? 'png'
    const file = new File([blob], `reupload-${Date.now()}.${ext}`, { type: blob.type })
    const result = await uploadFile(file)
    return { ...asset, url: result.publicUrl }
  } catch {
    return asset
  }
}

export function ImageEditorPage({ sid }: ImageEditorPageProps) {
  const initFromAssets = useEditorStore((s) => s.initFromAssets)
  const exportAssets = useEditorStore((s) => s.exportAssets)
  const [initialized, setInitialized] = useState(false)
  const [canWriteBack, setCanWriteBack] = useState(false)

  useEffect(() => {
    if (initialized) return

    async function init() {
      let sessionPayload = sid ? loadEditorSession(sid) : null

      if (sessionPayload?.assets.length) {
        // Re-upload cross-origin images for canvas safety
        const safeAssets = await Promise.all(sessionPayload.assets.map(reuploadIfCrossOrigin))
        initFromAssets(safeAssets)
        setCanWriteBack(Boolean(sessionPayload.returnSessionKey))
      } else {
        initFromAssets([])
      }

      setInitialized(true)
    }

    void init()
  }, [sid, initialized, initFromAssets])

  const handleBack = () => {
    if (sid) {
      const payload = loadEditorSession(sid)
      if (payload?.returnSessionKey && canWriteBack) {
        upsertResultAssets(payload.returnSessionKey, exportAssets())
      }
      clearEditorSession(sid)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <EditorHeader onBack={handleBack} />
      <div className="flex flex-1 overflow-hidden">
        <EditorSidebar />
        <EditorCanvas />
      </div>
      <CropToolbar />
      <QuickEditPanel />
      <TextEditPanel />
      <EditorBottomToolbar />
    </div>
  )
}
