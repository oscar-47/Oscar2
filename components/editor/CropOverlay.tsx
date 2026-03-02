'use client'

import { useCallback, useRef } from 'react'
import { useEditorStore } from '@/lib/stores/editor-store'

export function CropOverlay() {
  const crop = useEditorStore((s) => s.crop)
  const updateCropRegion = useEditorStore((s) => s.updateCropRegion)
  const objects = useEditorStore((s) => s.objects)
  const zoom = useEditorStore((s) => s.zoom)
  const panX = useEditorStore((s) => s.panX)
  const panY = useEditorStore((s) => s.panY)
  const dragRef = useRef<{
    type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'
    startX: number
    startY: number
    startCropX: number
    startCropY: number
    startCropW: number
    startCropH: number
  } | null>(null)

  const obj = objects.find((o) => o.id === crop.objectId)

  const handleMouseDown = useCallback(
    (type: NonNullable<typeof dragRef.current>['type'], e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        type,
        startX: e.clientX,
        startY: e.clientY,
        startCropX: crop.x,
        startCropY: crop.y,
        startCropW: crop.width,
        startCropH: crop.height,
      }

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current || !obj) return
        const dx = (ev.clientX - dragRef.current.startX) / zoom
        const dy = (ev.clientY - dragRef.current.startY) / zoom
        const { startCropX, startCropY, startCropW, startCropH } = dragRef.current
        const natW = obj.naturalWidth || obj.width
        const natH = obj.naturalHeight || obj.height

        let newX = crop.x
        let newY = crop.y
        let newW = crop.width
        let newH = crop.height

        const d = dragRef.current

        if (d.type === 'move') {
          newX = Math.max(0, Math.min(natW - startCropW, startCropX + dx))
          newY = Math.max(0, Math.min(natH - startCropH, startCropY + dy))
          newW = startCropW
          newH = startCropH
        } else {
          if (d.type.includes('w')) {
            newX = Math.max(0, Math.min(startCropX + startCropW - 20, startCropX + dx))
            newW = startCropW - (newX - startCropX)
          }
          if (d.type.includes('e')) {
            newW = Math.max(20, Math.min(natW - startCropX, startCropW + dx))
          }
          if (d.type.includes('n')) {
            newY = Math.max(0, Math.min(startCropY + startCropH - 20, startCropY + dy))
            newH = startCropH - (newY - startCropY)
          }
          if (d.type.includes('s')) {
            newH = Math.max(20, Math.min(natH - startCropY, startCropH + dy))
          }
        }

        if (crop.aspectRatioLock && crop.aspectRatioLock !== 'original') {
          const [rw, rh] = crop.aspectRatioLock.split(':').map(Number)
          const ratio = rw / rh
          if (d.type.includes('e') || d.type.includes('w')) {
            newH = newW / ratio
          } else {
            newW = newH * ratio
          }
        }

        updateCropRegion({ x: newX, y: newY, width: newW, height: newH })
      }

      const handleMouseUp = () => {
        dragRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [crop, obj, updateCropRegion, zoom]
  )

  if (!crop.active || !obj) return null

  // Scale factor: object display size vs natural size
  const scaleX = obj.width / (obj.naturalWidth || obj.width)
  const scaleY = obj.height / (obj.naturalHeight || obj.height)

  // Crop region in display coordinates (relative to object)
  const cx = crop.x * scaleX
  const cy = crop.y * scaleY
  const cw = crop.width * scaleX
  const ch = crop.height * scaleY

  return (
    <div
      className="absolute"
      style={{
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        zIndex: 9999,
      }}
    >
      {/* Dark overlay outside crop */}
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <mask id="crop-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={cx} y={cy} width={cw} height={ch} fill="black" />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.5)"
          mask="url(#crop-mask)"
        />
      </svg>

      {/* Crop region border */}
      <div
        className="absolute border-2 border-white"
        style={{ left: cx, top: cy, width: cw, height: ch }}
        onMouseDown={(e) => handleMouseDown('move', e)}
      >
        {/* Grid lines (rule of thirds) */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
          <div className="absolute top-1/3 left-0 w-full h-px bg-white/30" />
          <div className="absolute top-2/3 left-0 w-full h-px bg-white/30" />
        </div>

        {/* Corner handles */}
        {[
          { pos: 'nw', style: { left: -4, top: -4, cursor: 'nw-resize' } },
          { pos: 'ne', style: { right: -4, top: -4, cursor: 'ne-resize' } },
          { pos: 'sw', style: { left: -4, bottom: -4, cursor: 'sw-resize' } },
          { pos: 'se', style: { right: -4, bottom: -4, cursor: 'se-resize' } },
        ].map(({ pos, style }) => (
          <div
            key={pos}
            className="absolute h-3 w-3 rounded-sm bg-white shadow"
            style={style as React.CSSProperties}
            onMouseDown={(e) => handleMouseDown(pos as 'nw' | 'ne' | 'sw' | 'se', e)}
          />
        ))}

        {/* Edge handles */}
        {[
          { pos: 'n', style: { left: '50%', top: -3, transform: 'translateX(-50%)', cursor: 'n-resize' } },
          { pos: 's', style: { left: '50%', bottom: -3, transform: 'translateX(-50%)', cursor: 's-resize' } },
          { pos: 'w', style: { top: '50%', left: -3, transform: 'translateY(-50%)', cursor: 'w-resize' } },
          { pos: 'e', style: { top: '50%', right: -3, transform: 'translateY(-50%)', cursor: 'e-resize' } },
        ].map(({ pos, style }) => (
          <div
            key={pos}
            className="absolute h-2 w-6 rounded-sm bg-white/80 shadow"
            style={{
              ...style,
              ...(pos === 'w' || pos === 'e' ? { width: 8, height: 24 } : { width: 24, height: 8 }),
            } as React.CSSProperties}
            onMouseDown={(e) => handleMouseDown(pos as 'n' | 's' | 'w' | 'e', e)}
          />
        ))}
      </div>
    </div>
  )
}
