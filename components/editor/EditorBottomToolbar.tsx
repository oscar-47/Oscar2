'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { MousePointer2, Hand, ImagePlus } from 'lucide-react'
import { useEditorStore, type EditorTool } from '@/lib/stores/editor-store'
import { uploadFile } from '@/lib/api/upload'
import { cn } from '@/lib/utils'

export function EditorBottomToolbar() {
  const t = useTranslations('studio.editor')
  const activeTool = useEditorStore((s) => s.activeTool)
  const setTool = useEditorStore((s) => s.setTool)
  const addImage = useEditorStore((s) => s.addImage)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tools: Array<{ key: EditorTool; icon: typeof MousePointer2; label: string }> = [
    { key: 'select', icon: MousePointer2, label: t('selectTool') },
    { key: 'pan', icon: Hand, label: t('panTool') },
  ]

  const handleAddImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    for (const file of Array.from(files)) {
      try {
        const result = await uploadFile(file)
        const img = new Image()
        img.onload = () => {
          addImage(result.publicUrl, img.naturalWidth, img.naturalHeight)
        }
        img.onerror = () => {
          addImage(result.publicUrl)
        }
        img.src = result.publicUrl
      } catch {
        // silently skip failed uploads
      }
    }
    e.target.value = ''
  }

  return (
    <div className="flex shrink-0 items-center justify-center gap-1 border-t border-[#e5e7eb] bg-white px-4 py-2">
      {tools.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTool(key)}
          title={label}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors',
            activeTool === key
              ? 'bg-[#111827] text-white'
              : 'text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]'
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
          {label}
        </button>
      ))}

      <div className="mx-2 h-5 w-px bg-[#e5e7eb]" />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        title={t('addImageTool')}
        className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827] transition-colors"
      >
        <ImagePlus className="h-4 w-4" strokeWidth={1.8} />
        {t('addImageTool')}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void handleAddImage(e)}
        className="hidden"
      />
    </div>
  )
}
