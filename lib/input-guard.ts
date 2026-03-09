export const TEXT_LIMITS = {
  brief: 300,
  sharedCopy: 300,
  quickEdit: 220,
  textEdit: 80,
  planTitle: 80,
  planDescription: 180,
  planContent: 400,
  designSpecs: 600,
  generatedPrompt: 600,
  customTag: 24,
} as const

export type TextLimitKey = keyof typeof TEXT_LIMITS

export interface TextValidationOptions {
  allowEmpty?: boolean
  maxLength?: number
  skipRelevanceCheck?: boolean
}

export interface TextValidationResult {
  ok: boolean
  code?: 'INPUT_TOO_LONG' | 'INPUT_MODERATION_BLOCKED'
  reason?: 'too_long' | 'gibberish' | 'unrelated'
}

const KEYBOARD_MASH_PATTERNS = [
  'asdf',
  'qwer',
  'zxcv',
  'qazwsx',
  '123123',
  'lorem ipsum',
]

const RELATED_HINTS = [
  'product',
  'image',
  'photo',
  'scene',
  'background',
  'lighting',
  'shadow',
  'material',
  'texture',
  'color',
  'packaging',
  'poster',
  'detail',
  'ecommerce',
  'model',
  'clothing',
  'dress',
  'shirt',
  'shoe',
  'bag',
  'bottle',
  'retouch',
  'refine',
  'remove',
  'replace',
  'text',
  'logo',
  'composition',
  'banner',
  'garment',
  'jewelry',
  'cosmetic',
  '商品',
  '产品',
  '图片',
  '主图',
  '详情',
  '精修',
  '去字',
  '文案',
  '海报',
  '场景',
  '背景',
  '光线',
  '灯光',
  '材质',
  '纹理',
  '颜色',
  '包装',
  '模特',
  '服装',
  '裙',
  '鞋',
  '包',
  '瓶',
  '白底',
  '构图',
  '卖点',
  '电商',
  '广告',
  '护肤',
  '珠宝',
]

const UNRELATED_PATTERNS = [
  /(?:写|生成|帮我写).{0,6}(?:代码|程序|脚本|函数|sql|正则|论文|作业|文章)/i,
  /(?:code|debug|bug|script|program|python|javascript|typescript|sql|regex)/i,
  /(?:论文|作业|homework|essay|report|summary|总结|翻译|translate|小说|故事|poem|lyrics?|recipe|菜谱|星座|占卜|运势|股票|股价|crypto|币价|新闻|weather|天气|法律|医疗|诊断|处方|面试题)/i,
]

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function countCharacters(value: string): number {
  return Array.from(value).length
}

export function clampText(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('')
}

export function formatTextCounter(value: string, maxLength: number, isZh: boolean): string {
  const current = countCharacters(value)
  return isZh
    ? `最多 ${maxLength} 字，当前 ${current}/${maxLength}`
    : `Up to ${maxLength} characters, ${current}/${maxLength}`
}

export function getInputModerationMessage(isZh: boolean): string {
  return isZh
    ? '输入内容与商品出图无关或疑似乱码，系统已拦截。本次不会生成，继续违规可能导致账号封禁。'
    : 'The submitted text is unrelated to product-image generation or looks like gibberish. This request was blocked. Repeated violations may lead to account suspension.'
}

export function getInputTooLongMessage(isZh: boolean, maxLength: number): string {
  return isZh
    ? `输入内容过长，请控制在 ${maxLength} 字以内。`
    : `Your input is too long. Please keep it within ${maxLength} characters.`
}

function looksLikeGibberish(text: string): boolean {
  if (/(.)\1{6,}/.test(text)) return true
  if (/(.{2,10})\1{3,}/.test(text)) return true

  const lower = text.toLowerCase()
  if (KEYBOARD_MASH_PATTERNS.some((pattern) => lower.includes(pattern))) return true

  const compact = text.replace(/\s+/g, '')
  if (compact.length >= 12) {
    const asciiSymbols = compact.match(/[~`!@#$%^&*()+=[\]{}|\\:;"'<>,.?/_-]/g)?.length ?? 0
    if (asciiSymbols / compact.length > 0.4) return true
  }

  return false
}

function looksLikeUnrelatedRequest(text: string): boolean {
  const lower = text.toLowerCase()
  const hasRelatedHint = RELATED_HINTS.some((hint) => lower.includes(hint))
  return !hasRelatedHint && UNRELATED_PATTERNS.some((pattern) => pattern.test(text))
}

export function validateGenerationText(
  value: string | null | undefined,
  options: TextValidationOptions = {},
): TextValidationResult {
  const allowEmpty = options.allowEmpty ?? true
  const normalized = normalizeWhitespace(value ?? '')

  if (!normalized) {
    return allowEmpty ? { ok: true } : { ok: false, code: 'INPUT_MODERATION_BLOCKED', reason: 'gibberish' }
  }

  if (options.maxLength && countCharacters(normalized) > options.maxLength) {
    return { ok: false, code: 'INPUT_TOO_LONG', reason: 'too_long' }
  }

  if (looksLikeGibberish(normalized)) {
    return { ok: false, code: 'INPUT_MODERATION_BLOCKED', reason: 'gibberish' }
  }

  if (!options.skipRelevanceCheck && looksLikeUnrelatedRequest(normalized)) {
    return { ok: false, code: 'INPUT_MODERATION_BLOCKED', reason: 'unrelated' }
  }

  return { ok: true }
}

export function assertGenerationText(
  value: string | null | undefined,
  options: TextValidationOptions = {},
): void {
  const result = validateGenerationText(value, options)
  if (result.ok) return

  if (result.code === 'INPUT_TOO_LONG') {
    throw new Error(`INPUT_TOO_LONG:${options.maxLength ?? 0}`)
  }

  throw new Error('INPUT_MODERATION_BLOCKED')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pushIfString(target: string[], value: unknown): void {
  if (typeof value !== 'string') return
  const normalized = normalizeWhitespace(value)
  if (normalized) target.push(normalized)
}

export function collectUserFacingText(value: unknown, limit = 40): string[] {
  const out: string[] = []
  const queue: unknown[] = [value]

  while (queue.length > 0 && out.length < limit) {
    const current = queue.shift()
    if (!current) continue

    if (typeof current === 'string') {
      pushIfString(out, current)
      continue
    }

    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 20))
      continue
    }

    const record = asRecord(current)
    if (!record) continue

    pushIfString(out, record.design_specs)
    pushIfString(out, record.designSpecs)
    pushIfString(out, record.requirements)
    pushIfString(out, record.userPrompt)
    pushIfString(out, record.prompt)
    pushIfString(out, record.title)
    pushIfString(out, record.description)
    pushIfString(out, record.design_content)
    pushIfString(out, record.shared_copy)
    pushIfString(out, record.sharedCopy)
    pushIfString(out, record.source_brief)
    pushIfString(out, record.sourceBrief)

    if (Array.isArray(record.images)) queue.push(...record.images.slice(0, 20))
    if (Array.isArray(record.outputs)) queue.push(...record.outputs.slice(0, 20))
    if (Array.isArray(record.per_plan_adaptations)) queue.push(...record.per_plan_adaptations.slice(0, 20))
    if (Array.isArray(record.perPlanAdaptations)) queue.push(...record.perPlanAdaptations.slice(0, 20))
    if (record.copy_analysis) queue.push(record.copy_analysis)
    if (record.copyAnalysis) queue.push(record.copyAnalysis)
  }

  return out
}
