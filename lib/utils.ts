import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Map raw backend error messages to user-friendly text.
 * Prevents exposing internal errors (AbortError, TypeError, etc.) directly to users.
 */
export function friendlyError(raw: string, isZh: boolean): string {
  const lower = raw.toLowerCase()
  if (lower.includes('too_many_active_jobs') || lower.includes('too many image generation jobs')) {
    return isZh ? '当前生成队列繁忙，系统正在排队处理，请稍后重试。' : 'The image queue is busy right now. Please try again shortly.'
  }
  if (lower.includes('aborterror') || lower.includes('signal has been aborted') || lower.includes('timed out')) {
    return isZh ? '服务响应超时，请稍后重试。' : 'Service timed out. Please try again.'
  }
  if (lower.includes('insufficient_credits') || lower.includes('not enough credits')) {
    return isZh ? '积分不足，请充值后重试。' : 'Not enough credits. Please top up and try again.'
  }
  if (lower.includes('invalid url') || lower.includes('fetch_failed') || lower.includes('source_image_fetch_failed')) {
    return isZh ? '图片加载失败，请重新上传。' : 'Image loading failed. Please re-upload.'
  }
  if (lower.includes('unsupported_task_type')) {
    return isZh ? '任务类型异常，请重试。' : 'Unexpected task type. Please try again.'
  }
  if (lower.includes('analysis_input_image_missing') || lower.includes('image_input_source_missing')) {
    return isZh ? '产品图片缺失，请上传图片。' : 'Product image missing. Please upload an image.'
  }
  if (lower.includes('image_input_prompt_missing')) {
    return isZh ? '生成提示词缺失，请重新分析。' : 'Generation prompt missing. Please re-analyze.'
  }
  if (lower.includes('image_size_unsatisfied')) {
    return isZh ? '当前模型未按所选分辨率返回结果，请切换模型或降低分辨率。' : 'The selected model did not satisfy the requested resolution. Try a different model or lower resolution.'
  }
  if (lower.includes('model_unavailable')) {
    return isZh ? '当前模型暂不可用，请切换模型后重试。' : 'This model is currently unavailable. Please try another model.'
  }
  // If already user-friendly (contains Chinese), pass through
  if (/[\u4e00-\u9fff]/.test(raw) && !lower.includes('error') && !lower.includes('typeerror')) {
    return raw
  }
  // Generic fallback — don't expose raw tech errors
  if (lower.includes('error') || lower.includes('failed') || lower.startsWith('typeerror') || lower.startsWith('referenceerror')) {
    return isZh ? '操作失败，请稍后重试。' : 'Operation failed. Please try again.'
  }
  return raw
}
