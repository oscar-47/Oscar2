// ============================================================
// Shared types — aligned with Codex OpenAPI contract
// ============================================================

// --- Job types (from HAR generation_jobs) ---

export type JobType = 'ANALYSIS' | 'IMAGE_GEN' | 'STYLE_REPLICATE'

export type JobStatus = 'processing' | 'success' | 'failed'

export interface GenerationJob {
  id: string
  user_id: string
  type: JobType
  status: JobStatus
  payload: Record<string, unknown>
  result_data: unknown | null
  result_url: string | null
  cost_amount: number
  is_refunded: boolean
  trace_id: string | null
  client_job_id: string | null
  fe_attempt: number
  be_retry: number
  duration_ms: number | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

// --- User profile ---

export type SubscriptionPlan = 'starter' | 'professional' | 'enterprise'
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  subscription_credits: number
  purchased_credits: number
  has_first_subscription: boolean
  subscription_plan: SubscriptionPlan | null
  subscription_status: SubscriptionStatus | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  invite_code?: string | null
  invited_by_user_id?: string | null
  invite_bound_at?: string | null
  locale: 'en' | 'zh'
  created_at: string
  updated_at: string
}

// Computed helper
export function totalCredits(profile: Profile): number {
  return profile.subscription_credits + profile.purchased_credits
}

// --- Packages (pricing) ---

export type PackageType = 'subscription' | 'one_time'

export interface Package {
  id: string
  name: string
  type: PackageType
  price_usd: number
  credits: number
  first_sub_bonus: number
  stripe_price_id: string
  is_popular: boolean
  sort_order: number
}

export interface ReferralBinding {
  id: string
  inviter_user_id: string
  invitee_user_id: string
  invite_code_snapshot: string
  rewarded_at: string | null
  reward_credits: number
  reward_txn_id: string | null
  created_at: string
}

export interface RedeemCodeClaim {
  id: string
  redeem_code_id: string
  user_id: string
  code_snapshot: string
  credited_amount: number
  created_at: string
}

// --- AI generation models ---

export type GenerationModel =
  | 'azure-flux'
  | 'gpt-image'
  | 'qiniu-gemini-pro'
  | 'qiniu-gemini-flash'
  | 'volc-seedream-4.5'
  | 'volc-seedream-5.0-lite'
  // Legacy aliases kept for compatibility with existing data.
  | 'flux-kontext-pro'
  | 'gemini-pro-image'
  | 'gemini-flash-image'
  // OpenRouter models
  | 'or-gemini-2.5-flash'
  | 'or-gemini-3.1-flash'
  | 'or-gemini-3-pro'
  // ToAPIs models
  | 'ta-gemini-2.5-flash'
  | 'ta-gemini-3.1-flash'
  | 'ta-gemini-3-pro'
  // New models (routing stubs — not in AVAILABLE_MODELS until API keys are configured)
  | 'midjourney'
  | 'sd-3.5-ultra'
  | 'dall-e-4'
  | 'ideogram-3'

export type ModelTier = 'high' | 'balanced' | 'fast'

export interface AvailableModel {
  value: GenerationModel
  label: string
  tier: ModelTier
  tierLabel: { en: string; zh: string }
}

export const AVAILABLE_MODELS: ReadonlyArray<AvailableModel> = [
  { value: 'or-gemini-3.1-flash', label: 'Gemini 3.1 Flash', tier: 'high', tierLabel: { en: 'High Quality', zh: '高画质' } },
  { value: 'or-gemini-3-pro', label: 'Gemini 3 Pro', tier: 'balanced', tierLabel: { en: 'Balanced', zh: '均衡' } },
  { value: 'ta-gemini-3.1-flash', label: 'TA Gemini 3.1 Flash', tier: 'fast', tierLabel: { en: 'Fast', zh: '极速' } },
]

export const DEFAULT_MODEL: GenerationModel = 'or-gemini-3.1-flash'

export function isValidModel(m: string): boolean {
  return AVAILABLE_MODELS.some((x) => x.value === m)
}

export type AspectRatio =
  | '1:1' | '2:3' | '3:2' | '3:4' | '4:3'
  | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
export type ImageSize = '1K' | '2K' | '4K'

export const IMAGE_SIZE_LABELS: Record<ImageSize, { en: string; zh: string }> = {
  '1K': { en: '1K (1024px)', zh: '1K 标清 (1024px)' },
  '2K': { en: '2K (2048px)', zh: '2K 高清 (2048px)' },
  '4K': { en: '4K (4096px)', zh: '4K 超清 (4096px)' },
}
export type BackgroundMode = 'white' | 'original'

// Credit costs — loaded from get-public-config, fallback values here
export const DEFAULT_CREDIT_COSTS: Record<string, number> = {
  'azure-flux': 5,
  'gpt-image': 5,
  'qiniu-gemini-pro': 5,
  'qiniu-gemini-flash': 5,
  'volc-seedream-4.5': 5,
  'volc-seedream-5.0-lite': 5,
  'flux-kontext-pro': 5,
  'gemini-pro-image': 5,
  'gemini-flash-image': 5,
  'or-gemini-2.5-flash': 3,
  'or-gemini-3.1-flash': 5,
  'or-gemini-3-pro': 10,
  'ta-gemini-2.5-flash': 3,
  'ta-gemini-3.1-flash': 3,
  'ta-gemini-3-pro': 5,
  'midjourney': 15,
  'sd-3.5-ultra': 8,
  'dall-e-4': 12,
  'ideogram-3': 10,
  'turbo-1k': 8,
  'turbo-2k': 12,
  'turbo-4k': 17,
}

// --- Upload ---

export interface OssStsCredentials {
  provider: 'supabase_compat' | 'qiniu'
  uploadMethod: 'PUT' | 'POST'
  bucket: string
  endpoint: string
  pathPrefix: string
  objectKey: string
  region: string
  expire: number
  accessKeyId: string
  policy: string
  signature: string
  securityToken: string
  uploadUrl: string
  formFields: Record<string, string>
}

// --- Edge Function responses ---

export interface JobResponse {
  job_id: string
  status?: 'processing'
}

export interface CheckoutResponse {
  url: string
}

// --- Studio Genesis: Analysis Blueprint ---

export interface BlueprintImagePlan {
  id?: string
  title: string
  description: string
  design_content: string
  type?: 'refined' | '3d' | 'mannequin' | 'detail' | 'selling_point'
}

export interface AnalysisAiMeta {
  model: string
  usage: Record<string, unknown>
  provider: string
  image_count: number
  target_language: string
}

export interface AnalysisBlueprint {
  images: BlueprintImagePlan[]
  design_specs: string
  _ai_meta: AnalysisAiMeta
}

// --- Output Language ---

export type OutputLanguage =
  | 'none' | 'en' | 'zh' | 'ja' | 'ko'
  | 'es' | 'fr' | 'de' | 'pt' | 'ar' | 'ru'

// --- E-commerce Platform Rules ---

export type EcommercePlatform = 'none' | 'taobao' | 'tmall' | 'jd' | 'pdd' | 'amazon' | 'shopee' | 'ebay' | 'tiktok'

export interface PlatformRule {
  value: EcommercePlatform
  minImages: number
}

export const PLATFORM_RULES: readonly PlatformRule[] = [
  { value: 'none', minImages: 1 },
  { value: 'taobao', minImages: 5 },
  { value: 'tmall', minImages: 5 },
  { value: 'jd', minImages: 5 },
  { value: 'pdd', minImages: 5 },
  { value: 'amazon', minImages: 7 },
  { value: 'shopee', minImages: 8 },
  { value: 'ebay', minImages: 5 },
  { value: 'tiktok', minImages: 5 },
] as const

export function getPlatformMinImages(platform: EcommercePlatform): number {
  return PLATFORM_RULES.find(r => r.value === platform)?.minImages ?? 1
}

// --- SSE types ---

export interface PromptSseChunk {
  fullText: string
}

export interface GeneratedPrompt {
  prompt: string
  title: string           // default ""
  negative_prompt: string // default ""
  marketing_hook: string  // default ""
  priority: number        // default 0, clamped 0-10
}

// --- Studio Genesis phases ---

export type GenesisPhase = 'input' | 'analyzing' | 'preview' | 'generating' | 'complete'

// --- Clothing Studio phases ---

export type ClothingPhase = 'input' | 'analyzing' | 'preview' | 'generating' | 'complete'

// --- Ecommerce Studio ---

export type EcommercePhase = 'input' | 'analyzing' | 'preview' | 'generating' | 'complete'

export type EcommercePlatformStyle = 'domestic' | 'international'

export interface EcommerceAnalysisResult {
  optimized_description: string
  selling_points: string[]
  detail_focus_areas: string[]
  main_image_prompt: string
  detail_prompts: string[]
}

// ─── Style Dimensions (5-dim radio) ─────────────────────────────────────────

export type StyleDimensionKey = 'sceneStyle' | 'lighting' | 'composition' | 'colorTone' | 'material'

export interface StyleDimensionOption {
  value: string
  labelKey: string  // i18n key suffix, e.g. 'minimal' → resolved as studio.genesis.style.sceneStyle.minimal
  promptTag: string // English tag for prompt injection, e.g. 'minimalist clean background'
}

export interface StyleDimension {
  key: StyleDimensionKey
  labelKey: string  // i18n key suffix
  options: StyleDimensionOption[]
}

export const STYLE_DIMENSIONS: StyleDimension[] = [
  {
    key: 'sceneStyle',
    labelKey: 'sceneStyle',
    options: [
      { value: 'minimal', labelKey: 'minimal', promptTag: 'minimalist clean background' },
      { value: 'natural', labelKey: 'natural', promptTag: 'natural outdoor setting with plants' },
      { value: 'urban', labelKey: 'urban', promptTag: 'modern urban city environment' },
      { value: 'luxury', labelKey: 'luxury', promptTag: 'luxurious premium elegant setting' },
      { value: 'industrial', labelKey: 'industrial', promptTag: 'raw industrial warehouse aesthetic' },
    ],
  },
  {
    key: 'lighting',
    labelKey: 'lighting',
    options: [
      { value: 'natural', labelKey: 'naturalLight', promptTag: 'natural daylight' },
      { value: 'warm', labelKey: 'warm', promptTag: 'warm golden hour lighting' },
      { value: 'cool', labelKey: 'cool', promptTag: 'cool blue-toned lighting' },
      { value: 'dramatic', labelKey: 'dramatic', promptTag: 'dramatic high-contrast lighting' },
      { value: 'soft', labelKey: 'soft', promptTag: 'soft diffused studio lighting' },
    ],
  },
  {
    key: 'composition',
    labelKey: 'composition',
    options: [
      { value: 'front', labelKey: 'front', promptTag: 'straight-on front view' },
      { value: 'overhead45', labelKey: 'overhead45', promptTag: '45-degree overhead angle' },
      { value: 'topDown', labelKey: 'topDown', promptTag: 'top-down flat lay' },
      { value: 'closeUp', labelKey: 'closeUp', promptTag: 'close-up macro detail shot' },
      { value: 'wide', labelKey: 'wide', promptTag: 'wide-angle environmental shot' },
    ],
  },
  {
    key: 'colorTone',
    labelKey: 'colorTone',
    options: [
      { value: 'original', labelKey: 'original', promptTag: 'true-to-life natural colors' },
      { value: 'warmTone', labelKey: 'warmTone', promptTag: 'warm color palette' },
      { value: 'coolTone', labelKey: 'coolTone', promptTag: 'cool color palette' },
      { value: 'monochrome', labelKey: 'monochrome', promptTag: 'black and white monochrome' },
      { value: 'vibrant', labelKey: 'vibrant', promptTag: 'vibrant high-saturation colors' },
    ],
  },
  {
    key: 'material',
    labelKey: 'material',
    options: [
      { value: 'default', labelKey: 'default', promptTag: 'neutral background surface' },
      { value: 'matte', labelKey: 'matte', promptTag: 'matte textured surface' },
      { value: 'glossy', labelKey: 'glossy', promptTag: 'glossy reflective surface' },
      { value: 'wood', labelKey: 'wood', promptTag: 'natural wood grain surface' },
      { value: 'marble', labelKey: 'marble', promptTag: 'marble stone surface' },
    ],
  },
]

export function buildStylePrefix(selections: Partial<Record<StyleDimensionKey, string>>): string {
  const parts: string[] = []
  for (const dim of STYLE_DIMENSIONS) {
    const selected = selections[dim.key]
    if (!selected) continue
    const opt = dim.options.find(o => o.value === selected)
    if (opt) parts.push(opt.promptTag)
  }
  return parts.length > 0 ? parts.join(', ') + '. ' : ''
}

// --- Public config ---

export interface PublicConfig {
  credit_costs: Record<string, number>
  signup_bonus_credits: number
  batch_concurrency: number
  release_notes?: {
    en: string
    zh: string
  }
  platform_rules?: {
    version: string
    rules: PlatformRule[]
  }
}
