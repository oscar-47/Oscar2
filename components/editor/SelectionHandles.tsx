'use client'

interface SelectionHandlesProps {
  width: number
  height: number
}

const HANDLE_SIZE = 8

export function SelectionHandles({ width, height }: SelectionHandlesProps) {
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ]

  return (
    <>
      {/* Selection border */}
      <div
        className="pointer-events-none absolute inset-0 border-2 border-[#3b82f6] rounded-sm"
        style={{ width, height }}
      />
      {/* Corner handles */}
      {corners.map((pos, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-[#3b82f6] border-2 border-white shadow-sm"
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            left: pos.x - HANDLE_SIZE / 2,
            top: pos.y - HANDLE_SIZE / 2,
          }}
        />
      ))}
    </>
  )
}
