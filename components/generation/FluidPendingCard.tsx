'use client'

interface FluidPendingCardProps {
  aspectRatio: string
  className?: string
}

export function FluidPendingCard({ aspectRatio, className }: FluidPendingCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-white dark:bg-zinc-950 ${className ?? ''}`}
      style={{ aspectRatio }}
    >
      <div
        className="absolute left-[-30%] top-[-30%] h-[130%] w-[130%] rounded-full bg-violet-400/40"
        style={{ filter: 'blur(48px)', animation: 'fluid-drift-1 10s ease-in-out infinite' }}
      />
      <div
        className="absolute bottom-[-30%] right-[-30%] h-[130%] w-[130%] rounded-full bg-pink-300/35"
        style={{ filter: 'blur(48px)', animation: 'fluid-drift-2 12s ease-in-out infinite 1s' }}
      />
      <div
        className="absolute bottom-[-20%] left-[-20%] h-[110%] w-[110%] rounded-full bg-amber-300/30"
        style={{ filter: 'blur(44px)', animation: 'fluid-drift-3 9s ease-in-out infinite 2s' }}
      />
      <div
        className="absolute right-[-20%] top-[-20%] h-[110%] w-[110%] rounded-full bg-sky-300/25"
        style={{ filter: 'blur(44px)', animation: 'fluid-drift-4 14s ease-in-out infinite 0.5s' }}
      />
    </div>
  )
}
