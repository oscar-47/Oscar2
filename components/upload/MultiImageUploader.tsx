'use client'

import { useCallback, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { Plus, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface UploadedImage {
  file: File
  previewUrl: string
}

interface MultiImageUploaderProps {
  images: UploadedImage[]
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
  maxImages?: number
  maxSizeMB?: number
  label?: string
  footerText?: string
  hideDefaultFooter?: boolean
  compactAfterUpload?: boolean
  thumbnailGridCols?: 2 | 3 | 4
  showIndexBadge?: boolean
  disabled?: boolean
  className?: string
  dropzoneClassName?: string
  labelClassName?: string
  footerClassName?: string
}

export function MultiImageUploader({
  images,
  onAdd,
  onRemove,
  maxImages = 5,
  maxSizeMB = 10,
  label = 'Drop images here or click to select',
  footerText,
  hideDefaultFooter = false,
  compactAfterUpload = false,
  thumbnailGridCols = 4,
  showIndexBadge = false,
  disabled = false,
  className,
  dropzoneClassName,
  labelClassName,
  footerClassName,
}: MultiImageUploaderProps) {
  const [error, setError] = useState<string | null>(null)
  const remaining = maxImages - images.length

  const onDrop = useCallback(
    (accepted: File[], rejected: readonly FileRejection[]) => {
      setError(null)
      if (rejected.length > 0) {
        setError(rejected[0].errors[0]?.message ?? 'Invalid file')
        return
      }
      const toAdd = accepted.slice(0, remaining)
      if (toAdd.length > 0) onAdd(toAdd)
    },
    [onAdd, remaining]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] },
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: true,
    disabled: disabled || remaining <= 0,
  })

  if (compactAfterUpload && images.length > 0) {
    return (
      <div className={className}>
        <div
          className={cn(
            'grid gap-2',
            thumbnailGridCols === 2 && 'grid-cols-2',
            thumbnailGridCols === 3 && 'grid-cols-3',
            thumbnailGridCols === 4 && 'grid-cols-4'
          )}
        >
          {images.map((img, i) => (
            <div
              key={i}
              className="relative aspect-square overflow-hidden rounded-xl border border-[#cfd4dc] bg-white group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewUrl}
                alt={`Image ${i + 1}`}
                className="h-full w-full object-cover"
              />

              {showIndexBadge && (
                <div className="absolute bottom-1 left-1 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {i + 1}
                </div>
              )}

              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          {remaining > 0 && (
            <div
              {...getRootProps()}
              className={cn(
                'flex aspect-square cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[#d0d4dc] bg-[#f1f3f6] text-[#6d7280] transition-colors hover:border-[#aeb5c2] hover:bg-[#eceff4]',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              <input {...getInputProps()} />
              <Plus className="h-8 w-8" />
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Thumbnail grid */}
      {images.length > 0 && (
        <div className="mb-3 max-h-64 overflow-y-auto pr-1">
          <div className="grid grid-cols-4 gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt={`Image ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drop zone — only shown if capacity remains */}
      {remaining > 0 && (
        <div
          {...getRootProps()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-colors',
            isDragActive
              ? 'border-[#8d94a2] bg-[#e9edf2]'
              : 'border-[#d0d4dc] bg-[#f1f3f6] hover:border-[#8e96a4] hover:bg-[#eceff4]',
            (disabled || remaining <= 0) && 'opacity-50 cursor-not-allowed pointer-events-none',
            dropzoneClassName
          )}
        >
          <input {...getInputProps()} />
          <Upload className="h-5 w-5 text-[#707884]" />
          <p className={cn('text-center text-sm text-[#5f6672]', labelClassName)}>
            {isDragActive ? 'Drop to upload' : label}
          </p>
          {!hideDefaultFooter && (
            <p className={cn('text-xs text-[#7e8592]', footerClassName)}>
              {footerText ?? `${images.length}/${maxImages} images · max ${maxSizeMB} MB each`}
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
