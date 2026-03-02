'use client'

import { useEffect, useRef } from 'react'
import { useEditorStore, type CanvasObject as CanvasObjectType } from '@/lib/stores/editor-store'
import { SelectionHandles } from './SelectionHandles'

interface CanvasObjectProps {
  obj: CanvasObjectType
  isSelected: boolean
}

export function CanvasObject({ obj, isSelected }: CanvasObjectProps) {
  const selectObject = useEditorStore((s) => s.selectObject)
  const updateObjectDimensions = useEditorStore((s) => s.updateObjectDimensions)
  const imgRef = useRef<HTMLImageElement>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (obj.naturalWidth > 0 || loadedRef.current) return
    const img = new globalThis.Image()
    img.onload = () => {
      loadedRef.current = true
      updateObjectDimensions(obj.id, img.naturalWidth, img.naturalHeight)
    }
    img.src = obj.url
  }, [obj.id, obj.url, obj.naturalWidth, updateObjectDimensions])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    selectObject(obj.id)
  }

  return (
    <div
      className="absolute"
      style={{
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        zIndex: obj.zIndex,
        cursor: 'move',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={obj.url}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full rounded-md object-contain"
      />
      {isSelected && (
        <SelectionHandles width={obj.width} height={obj.height} />
      )}
    </div>
  )
}
