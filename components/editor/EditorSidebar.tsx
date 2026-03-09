'use client'

import { useEditorStore } from '@/lib/stores/editor-store'
import { cn } from '@/lib/utils'

export function EditorSidebar() {
  const objects = useEditorStore((s) => s.objects)
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectObject = useEditorStore((s) => s.selectObject)
  const setPan = useEditorStore((s) => s.setPan)
  const zoom = useEditorStore((s) => s.zoom)

  const handleClick = (objId: string, objX: number, objY: number) => {
    selectObject(objId)
    // Center viewport on the object
    const viewportW = window.innerWidth - 200 // sidebar width
    const viewportH = window.innerHeight - 48 - 56 // header + bottom toolbar
    setPan(viewportW / 2 - objX * zoom, viewportH / 2 - objY * zoom)
  }

  if (objects.length === 0) return null

  return (
    <aside className="flex w-[160px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-surface p-3">
      {objects.map((obj, i) => (
        <button
          key={obj.id}
          type="button"
          onClick={() => handleClick(obj.id, obj.x + obj.width / 2, obj.y + obj.height / 2)}
          className={cn(
            'relative overflow-hidden rounded-lg border-2 transition-colors',
            selectedId === obj.id
              ? 'border-accent ring-1 ring-accent/30'
              : 'border-transparent hover:border-border'
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={obj.url}
            alt={`Image ${i + 1}`}
            className="aspect-square w-full object-cover"
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
            {i + 1}
          </span>
        </button>
      ))}
    </aside>
  )
}
