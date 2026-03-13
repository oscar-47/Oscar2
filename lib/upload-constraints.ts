export const MAX_IMAGE_UPLOAD_MB = 10
export const MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024

const DEFAULT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] as const

export type ImageFileValidationCode =
  | 'IMAGE_FILE_MISSING'
  | 'IMAGE_FILE_INVALID_TYPE'
  | 'IMAGE_FILE_TOO_LARGE'

export type ImageFileValidationOptions = {
  maxBytes?: number
  allowedExtensions?: readonly string[]
}

export type ImageFileValidationResult =
  | { ok: true }
  | {
      ok: false
      code: ImageFileValidationCode
      maxBytes?: number
      allowedExtensions?: readonly string[]
    }

export function normalizeFileExtension(name: string): string {
  const trimmed = String(name ?? '').trim().toLowerCase()
  const dotIndex = trimmed.lastIndexOf('.')
  return dotIndex >= 0 ? trimmed.slice(dotIndex) : ''
}

export function formatUploadLimitLabel(maxBytes = MAX_IMAGE_UPLOAD_BYTES): string {
  return `${Math.round(maxBytes / (1024 * 1024))} MB`
}

export function validateImageFile(
  file: File | null | undefined,
  options: ImageFileValidationOptions = {}
): ImageFileValidationResult {
  if (!file) {
    return { ok: false, code: 'IMAGE_FILE_MISSING' }
  }

  const maxBytes = options.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES
  const allowedExtensions = options.allowedExtensions ?? DEFAULT_IMAGE_EXTENSIONS
  const extension = normalizeFileExtension(file.name)
  const mime = file.type.trim().toLowerCase()

  if (!mime.startsWith('image/') && !allowedExtensions.includes(extension)) {
    return { ok: false, code: 'IMAGE_FILE_INVALID_TYPE', allowedExtensions }
  }

  if (allowedExtensions.length > 0 && extension && !allowedExtensions.includes(extension)) {
    return { ok: false, code: 'IMAGE_FILE_INVALID_TYPE', allowedExtensions }
  }

  if (file.size > maxBytes) {
    return { ok: false, code: 'IMAGE_FILE_TOO_LARGE', maxBytes }
  }

  return { ok: true }
}

export function validateImageFiles(
  files: File[],
  options: ImageFileValidationOptions = {}
): { accepted: File[]; rejected: Array<{ file: File; reason: Exclude<ImageFileValidationResult, { ok: true }> }> } {
  const accepted: File[] = []
  const rejected: Array<{ file: File; reason: Exclude<ImageFileValidationResult, { ok: true }> }> = []

  for (const file of files) {
    const result = validateImageFile(file, options)
    if (result.ok) {
      accepted.push(file)
    } else {
      rejected.push({ file, reason: result })
    }
  }

  return { accepted, rejected }
}

export function imageFileValidationMessage(
  result: Exclude<ImageFileValidationResult, { ok: true }>,
  isZh: boolean
): string {
  if (result.code === 'IMAGE_FILE_TOO_LARGE') {
    return isZh
      ? `图片过大，单张不能超过 ${formatUploadLimitLabel(result.maxBytes)}。`
      : `Image is too large. Each file must be ${formatUploadLimitLabel(result.maxBytes)} or smaller.`
  }

  if (result.code === 'IMAGE_FILE_INVALID_TYPE') {
    const extensionLabel = (result.allowedExtensions ?? DEFAULT_IMAGE_EXTENSIONS).join(', ').replace(/\./g, '').toUpperCase()
    return isZh
      ? `仅支持 ${extensionLabel} 格式的图片。`
      : `Only ${extensionLabel} image files are supported.`
  }

  return isZh ? '请选择图片文件。' : 'Please select an image file.'
}
