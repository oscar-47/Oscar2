'use client'

import { useCallback, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { Upload, X } from 'lucide-react'
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
  disabled?: boolean
  className?: string
}

export function MultiImageUploader({
  images,
  onAdd,
  onRemove,
  maxImages = 5,
  maxSizeMB = 10,
  label = 'Drop images here or click to select',
  disabled = false,
  className,
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
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: true,
    disabled: disabled || remaining <= 0,
  })

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
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-5 h-5 text-white" />
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
            'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors',
            isDragActive
              ? 'border-primary bg-primary/5'
              : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50',
            (disabled || remaining <= 0) && 'opacity-50 cursor-not-allowed pointer-events-none'
          )}
        >
          <input {...getInputProps()} />
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-center text-muted-foreground">
            {isDragActive ? 'Drop to upload' : label}
          </p>
          <p className="text-xs text-muted-foreground">
            {images.length}/{maxImages} images · max {maxSizeMB} MB each
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
