export type EcomPlatformStyle = 'domestic' | 'international'

export interface EcomAnalysisResultNormalized {
  optimized_description: string
  selling_points: string[]
  detail_focus_areas: string[]
  main_image_prompt: string
  detail_prompts: string[]
  platform_style: EcomPlatformStyle
}

type NormalizeFallback = {
  description: string
  platformStyle: EcomPlatformStyle
  isZh: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function detailLabel(index: number, isZh: boolean): string {
  return isZh ? `详情图 ${index + 1}` : `Detail ${index + 1}`
}

function normalizeLegacyEcomResult(
  raw: Record<string, unknown>,
  fallback: NormalizeFallback
): EcomAnalysisResultNormalized | null {
  const mainPrompt = asNonEmptyString(raw.main_image_prompt)
  if (!mainPrompt) return null

  const detailPrompts = asStringArray(raw.detail_prompts)
  const rawFocus = asStringArray(raw.detail_focus_areas)
  const detailFocusAreas = detailPrompts.map((_, i) => rawFocus[i] ?? detailLabel(i, fallback.isZh))

  const platformStyle = raw.platform_style === 'domestic' || raw.platform_style === 'international'
    ? raw.platform_style
    : fallback.platformStyle

  return {
    optimized_description: asNonEmptyString(raw.optimized_description) ?? fallback.description,
    selling_points: asStringArray(raw.selling_points).slice(0, 5),
    detail_focus_areas: detailFocusAreas,
    main_image_prompt: mainPrompt,
    detail_prompts: detailPrompts,
    platform_style: platformStyle,
  }
}

function normalizeBlueprintEcomResult(
  raw: Record<string, unknown>,
  fallback: NormalizeFallback
): EcomAnalysisResultNormalized | null {
  if (!Array.isArray(raw.images)) return null

  const plans = raw.images
    .map((item, index) => {
      const plan = asRecord(item)
      const title = asNonEmptyString(plan?.title)
      const description = asNonEmptyString(plan?.description)
      const designContent = asNonEmptyString(plan?.design_content)
      const prompt = designContent ?? [title, description].filter(Boolean).join('\n')
      return {
        prompt: prompt || null,
        focus: title ?? description ?? detailLabel(index, fallback.isZh),
      }
    })
    .filter((plan): plan is { prompt: string; focus: string } => Boolean(plan.prompt))

  if (plans.length === 0) return null

  const mainPrompt = plans[0].prompt
  const detailPlans = plans.slice(1)

  return {
    optimized_description: asNonEmptyString(raw.optimized_description) ?? fallback.description,
    selling_points: asStringArray(raw.selling_points).slice(0, 5),
    detail_focus_areas: detailPlans.map((plan, i) => plan.focus || detailLabel(i, fallback.isZh)),
    main_image_prompt: mainPrompt,
    detail_prompts: detailPlans.map((plan) => plan.prompt),
    platform_style: fallback.platformStyle,
  }
}

export function normalizeEcommerceAnalysisResult(
  input: unknown,
  fallback: NormalizeFallback
): EcomAnalysisResultNormalized | null {
  const raw = (() => {
    if (typeof input === 'string') {
      try {
        return asRecord(JSON.parse(input))
      } catch {
        return null
      }
    }
    return asRecord(input)
  })()

  if (!raw) return null

  const candidates: Record<string, unknown>[] = [raw]
  const nestedData = asRecord(raw.data)
  if (nestedData) candidates.push(nestedData)
  const nestedResult = asRecord(raw.result)
  if (nestedResult) candidates.push(nestedResult)
  const nestedAnalysis = asRecord(raw.analysis)
  if (nestedAnalysis) candidates.push(nestedAnalysis)

  for (const candidate of candidates) {
    const normalizedLegacy = normalizeLegacyEcomResult(candidate, fallback)
    if (normalizedLegacy) return normalizedLegacy

    const normalizedBlueprint = normalizeBlueprintEcomResult(candidate, fallback)
    if (normalizedBlueprint) return normalizedBlueprint
  }

  return null
}
