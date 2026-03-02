'use client'

import { useCallback, useRef } from 'react'
import { useEditorStore } from '@/lib/stores/editor-store'
import { CanvasObject } from './CanvasObject'
import { FloatingToolbar } from './FloatingToolbar'
import { QuickEditButton } from './QuickEditButton'
import { CropOverlay } from './CropOverlay'
import { ProcessingOverlay } from './ProcessingOverlay'

export function EditorCanvas() {
  const objects = useEditorStore((s) => s.objects)
  const selectedId = useEditorStore((s) => s.selectedId)
  const zoom = useEditorStore((s) => s.zoom)
  const panX = useEditorStore((s) => s.panX)
  const panY = useEditorStore((s) => s.panY)
  const activeTool = useEditorStore((s) => s.activeTool)
  const quickEdit = useEditorStore((s) => s.quickEdit)
  const crop = useEditorStore((s) => s.crop)
  const selectObject = useEditorStore((s) => s.selectObject)
  const moveObject = useEditorStore((s) => s.moveObject)
  const setZoom = useEditorStore((s) => s.setZoom)
  const setPan = useEditorStore((s) => s.setPan)
  const removeObject = useEditorStore((s) => s.removeObject)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    type: 'pan' | 'object'
    objectId?: string
    startX: number
    startY: number
    startPanX: number
    startPanY: number
  } | null>(null)

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.1, Math.min(5.0, zoom * factor))

      // Zoom centered on cursor
      const newPanX = mouseX - (mouseX - panX) * (newZoom / zoom)
      const newPanY = mouseY - (mouseY - panY) * (newZoom / zoom)

      setZoom(newZoom)
      setPan(newPanX, newPanY)
    },
    [zoom, panX, panY, setZoom, setPan]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || activeTool === 'pan') {
        // Pan mode
        dragRef.current = {
          type: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          startPanX: panX,
          startPanY: panY,
        }
      } else if (activeTool === 'select') {
        // Hit test objects from highest zIndex down
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return

        const canvasX = (e.clientX - rect.left - panX) / zoom
        const canvasY = (e.clientY - rect.top - panY) / zoom

        const sorted = [...objects].sort((a, b) => b.zIndex - a.zIndex)
        const hit = sorted.find(
          (obj) =>
            canvasX >= obj.x &&
            canvasX <= obj.x + obj.width &&
            canvasY >= obj.y &&
            canvasY <= obj.y + obj.height
        )

        if (hit) {
          selectObject(hit.id)
          dragRef.current = {
            type: 'object',
            objectId: hit.id,
            startX: e.clientX,
            startY: e.clientY,
            startPanX: panX,
            startPanY: panY,
          }
        } else {
          selectObject(null)
        }
      }

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return
        const dx = ev.clientX - dragRef.current.startX
        const dy = ev.clientY - dragRef.current.startY

        if (dragRef.current.type === 'pan') {
          setPan(dragRef.current.startPanX + dx, dragRef.current.startPanY + dy)
        } else if (dragRef.current.type === 'object' && dragRef.current.objectId) {
          moveObject(dragRef.current.objectId, dx / zoom, dy / zoom)
          dragRef.current.startX = ev.clientX
          dragRef.current.startY = ev.clientY
        }
      }

      const handleMouseUp = () => {
        dragRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [activeTool, objects, panX, panY, zoom, selectObject, moveObject, setPan]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !crop.active && !quickEdit.open) {
        removeObject(selectedId)
      }
    },
    [selectedId, crop.active, quickEdit.open, removeObject]
  )

  const selectedObj = selectedId ? objects.find((o) => o.id === selectedId) : null

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-[#f0f1f3] outline-none"
      style={{ cursor: activeTool === 'pan' ? 'grab' : 'default' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Canvas transform layer */}
      <div
        className="absolute origin-top-left"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
        }}
      >
        {objects.map((obj) => (
          <CanvasObject key={obj.id} obj={obj} isSelected={obj.id === selectedId} />
        ))}

        {/* Crop overlay (inside transform so it scales with canvas) */}
        {crop.active && <CropOverlay />}

        {/* Processing overlay on the quick edit target */}
        {quickEdit.isProcessing && quickEdit.objectId && (() => {
          const pObj = objects.find((o) => o.id === quickEdit.objectId)
          if (!pObj) return null
          return (
            <div className="absolute" style={{ left: pObj.x, top: pObj.y, zIndex: 9998 }}>
              <ProcessingOverlay width={pObj.width} height={pObj.height} />
            </div>
          )
        })()}
      </div>

      {/* Floating UI (outside transform, positioned manually) */}
      {selectedObj && !crop.active && (
        <>
          <FloatingToolbar
            objectId={selectedObj.id}
            x={selectedObj.x * zoom + panX}
            y={selectedObj.y * zoom + panY}
            width={selectedObj.width}
            zoom={zoom}
          />
          <QuickEditButton
            objectId={selectedObj.id}
            x={selectedObj.x * zoom + panX}
            y={selectedObj.y * zoom + panY}
            width={selectedObj.width}
            height={selectedObj.height}
            zoom={zoom}
          />
        </>
      )}
    </div>
  )
}
