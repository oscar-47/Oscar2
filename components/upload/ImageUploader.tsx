'use client'

import { useCallback, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { Upload, X, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageUploaderProps {
  onFileSelected: (file: File) => void
  onClear?: () => void
  accept?: Record<string, string[]>
  maxSizeMB?: number
  label?: string
  sublabel?: string
  previewUrl?: string | null
  disabled?: boolean
  className?: string
}

export function ImageUploader({
  onFileSelected,
  onClear,
  accept = { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
  maxSizeMB = 10,
  label = 'Drop image here',
  sublabel = 'JPG, PNG, WEBP up to 10 MB',
  previewUrl,
  disabled = false,
  className,
}: ImageUploaderProps) {
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(
    (accepted: File[], rejected: readonly FileRejection[]) => {
      setError(null)
      if (rejected.length > 0) {
        const msg = rejected[0].errors[0]?.message ?? 'Invalid file'
        setError(msg)
        return
      }
      if (accepted.length > 0) {
        onFileSelected(accepted[0])
      }
    },
    [onFileSelected]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: false,
    disabled,
  })

  if (previewUrl) {
    return (
      <div className={cn('relative rounded-xl overflow-hidden border border-border', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt="Uploaded preview"
          className="w-full h-full object-contain max-h-72"
        />
        {onClear && !disabled && (
          <button
            type="button"
            onClick={onClear}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors',
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          {isDragActive ? (
            <ImageIcon className="h-6 w-6 text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {isDragActive ? 'Drop to upload' : label}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
