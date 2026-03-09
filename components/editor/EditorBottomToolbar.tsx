'use client'

import { useTranslations } from 'next-intl'
import { MousePointer2, Hand } from 'lucide-react'
import { useEditorStore, type EditorTool } from '@/lib/stores/editor-store'
import { cn } from '@/lib/utils'

export function EditorBottomToolbar() {
  const t = useTranslations('studio.editor')
  const activeTool = useEditorStore((s) => s.activeTool)
  const setTool = useEditorStore((s) => s.setTool)

  const tools: Array<{ key: EditorTool; icon: typeof MousePointer2; label: string }> = [
    { key: 'select', icon: MousePointer2, label: t('selectTool') },
    { key: 'pan', icon: Hand, label: t('panTool') },
  ]

  return (
    <div className="flex shrink-0 items-center justify-center gap-1 border-t border-border bg-background px-4 py-2">
      {tools.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTool(key)}
          title={label}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors',
            activeTool === key
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
          {label}
        </button>
      ))}
    </div>
  )
}
