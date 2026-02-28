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
      <div className={cn('group relative overflow-hidden rounded-xl border border-[#d0d4dc] bg-white', className)}>
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
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <X className="h-3 w-3" />
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
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors',
          isDragActive
            ? 'border-[#8d94a2] bg-[#e9edf2]'
            : 'border-[#d0d4dc] bg-[#f1f3f6] hover:border-[#8e96a4] hover:bg-[#eceff4]',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8ebf0]">
          {isDragActive ? (
            <ImageIcon className="h-6 w-6 text-[#5e6674]" />
          ) : (
            <Upload className="h-6 w-6 text-[#707884]" />
          )}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-[#2f333b]">
            {isDragActive ? 'Drop to upload' : label}
          </p>
          <p className="mt-1 text-xs text-[#7e8592]">{sublabel}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
