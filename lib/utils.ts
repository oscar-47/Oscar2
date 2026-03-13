import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generationRetryRefundMessage(isZh: boolean): string {
  return isZh
    ? '由于系统繁忙，生成失败的积分会返回你的账户，请稍后再试。'
    : 'Due to high system demand, credits for failed generations will be returned to your account. Please try again shortly.'
}

export function isInsufficientCreditsError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const message = error instanceof Error ? error.message : String(error ?? '')
  return code === 'INSUFFICIENT_CREDITS'
    || /insufficient_credits|not enough credits/i.test(message)
}

/**
 * Map raw backend error messages to user-friendly text.
 * Prevents exposing internal errors (AbortError, TypeError, etc.) directly to users.
 */
export function friendlyError(raw: string, isZh: boolean): string {
  const lower = raw.toLowerCase()
  if (
    lower.includes('prompt_blocked_by_provider_policy') ||
    lower.includes('responsibleaipolicyviolation') ||
    lower.includes('"code":"content_filter"')
  ) {
    return isZh
      ? '当前请求触发了 Azure 内容安全策略，无法继续处理。请调整商品描述、文案或图片后重试。'
      : 'This request was blocked by Azure safety policy. Please revise the product description, copy, or images and try again.'
  }
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
  if (lower.includes('image_input_invalid_content_type')) {
    return isZh ? '上传内容不是有效图片，请重新上传。' : 'The uploaded input is not a valid image. Please re-upload.'
  }
  if (lower.includes('unsupported_task_type')) {
    return isZh ? '任务类型异常，请重试。' : 'Unexpected task type. Please try again.'
  }
  if (lower.includes('analysis_input_image_missing') || lower.includes('image_input_source_missing')) {
    return isZh ? '产品图片缺失，请上传图片。' : 'Product image missing. Please upload an image.'
  }
  if (lower.includes('image_input_too_large') || lower.includes('image is too large') || lower.includes('10 mb or smaller')) {
    return isZh ? '图片过大，请将单张图片控制在 10MB 以内后重试。' : 'Image is too large. Please keep each image within 10 MB and try again.'
  }
  if (lower.includes('task_stale_no_heartbeat') || lower.includes('stopped heartbeating')) {
    return isZh ? '任务处理中断，请重试；如果连续出现，请压缩图片后再试。' : 'Processing was interrupted before completion. Please retry; if it happens again, try a smaller image.'
  }
  if (lower.includes('max_attempts_exceeded')) {
    return isZh ? '任务多次重试后仍失败，请稍后重试；如果连续出现，请压缩图片后再试。' : 'The task failed after multiple retries. Please try again later; if it keeps happening, try a smaller image.'
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
