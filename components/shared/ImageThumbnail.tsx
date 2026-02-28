import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageThumbnailProps {
  src: string
  alt: string
  onRemove?: () => void
  disabled?: boolean
  /** sm = 48px fixed (compact rows), md = aspect-square (grid cells) */
  size?: 'sm' | 'md'
  className?: string
}

export function ImageThumbnail({
  src,
  alt,
  onRemove,
  disabled,
  size = 'md',
  className,
}: ImageThumbnailProps) {
  const isSmall = size === 'sm'

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-[#d0d4dc]',
        isSmall ? 'h-12 w-12' : 'aspect-square',
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-full w-full object-cover" />
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          className={cn(
            'absolute flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 group-focus-within:opacity-100',
            isSmall
              ? 'right-0.5 top-0.5 h-4 w-4'
              : 'right-1 top-1 h-5 w-5'
          )}
        >
          <X className={isSmall ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        </button>
      )}
    </div>
  )
}
