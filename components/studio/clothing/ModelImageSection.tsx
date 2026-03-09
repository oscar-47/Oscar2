'use client'

import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { MultiImageUploader, type UploadedImage } from '@/components/upload/MultiImageUploader'
import { Sparkles } from 'lucide-react'

interface ModelImageSectionProps {
  modelImage: UploadedImage | null
  onModelImageChange: (image: UploadedImage | null) => void
  onGenerateAIModel: () => void
  disabled?: boolean
}

export function ModelImageSection({
  modelImage,
  onModelImageChange,
  onGenerateAIModel,
  disabled = false,
}: ModelImageSectionProps) {
  const t = useTranslations('studio.clothingStudio.modelImageSection')
  const images = modelImage ? [modelImage] : []

  return (
    <div className="space-y-2" data-testid="clothing-model-image-section">
      <div className="flex items-center justify-between">
        <Label>{t('label')}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGenerateAIModel}
          disabled={disabled}
          data-testid="clothing-generate-ai-model"
        >
          <Sparkles className="h-4 w-4 mr-1.5" />
          {t('generateButton')}
        </Button>
      </div>
      <MultiImageUploader
        images={images}
        onAdd={(files) => {
          if (files.length > 0) {
            onModelImageChange({
              file: files[0],
              previewUrl: URL.createObjectURL(files[0]),
            })
          }
        }}
        onRemove={() => onModelImageChange(null)}
        maxImages={1}
        disabled={disabled}
        label={t('uploadLabel')}
      />
    </div>
  )
}
