'use client'

import { useEffect, useState } from 'react'
import { loadEditorSession } from '@/lib/utils/editor-session'
import { useEditorStore } from '@/lib/stores/editor-store'
import { uploadFile } from '@/lib/api/upload'
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

async function reuploadIfCrossOrigin(url: string): Promise<string> {
  if (isOurStorageDomain(url) || url.startsWith('data:')) return url
  try {
    const res = await fetch(url)
    if (!res.ok) return url
    const blob = await res.blob()
    const ext = url.match(/\.(png|jpg|jpeg|webp)/i)?.[1] ?? 'png'
    const file = new File([blob], `reupload-${Date.now()}.${ext}`, { type: blob.type })
    const result = await uploadFile(file)
    return result.publicUrl
  } catch {
    return url // fallback: use original URL
  }
}

export function ImageEditorPage({ sid }: ImageEditorPageProps) {
  const initFromUrls = useEditorStore((s) => s.initFromUrls)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (initialized) return

    async function init() {
      let urls: string[] = []

      if (sid) {
        const sessionUrls = loadEditorSession(sid)
        if (sessionUrls) urls = sessionUrls
      }

      if (urls.length > 0) {
        // Re-upload cross-origin images for canvas safety
        const safeUrls = await Promise.all(urls.map(reuploadIfCrossOrigin))
        initFromUrls(safeUrls)
      }

      setInitialized(true)
    }

    void init()
  }, [sid, initialized, initFromUrls])

  return (
    <div className="flex h-full flex-col">
      <EditorHeader />
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
