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
  charged_subscription_credits: number
  charged_purchased_credits: number
  refund_reason: string | null
  refunded_at: string | null
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

export type SubscriptionPlan = 'monthly' | 'quarterly' | 'yearly'
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
  stripe_price_id: string | null
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

export type PromptProfile = 'default' | 'ta-pro'

export type ModelTier = 'high' | 'balanced' | 'fast'
export type BillingTier = 'fast' | 'balanced' | 'quality'
export type ModelRolloutStage = 'public' | 'internal_only' | 'disabled'

export interface AvailableModel {
  value: GenerationModel
  label: string
  tier: ModelTier
  tierLabel: { en: string; zh: string }
}

export const AVAILABLE_MODELS: ReadonlyArray<AvailableModel> = [
  { value: 'or-gemini-3-pro', label: 'Nano Banana Pro', tier: 'high', tierLabel: { en: 'High Quality (Nano Banana Pro)', zh: '高质 (Nano Banana Pro)' } },
  { value: 'or-gemini-3.1-flash', label: 'Nano Banana 2', tier: 'balanced', tierLabel: { en: 'Balanced (Nano Banana 2)', zh: '均衡 (Nano Banana 2)' } },
  { value: 'or-gemini-2.5-flash', label: 'Nano Banana', tier: 'fast', tierLabel: { en: 'Fast (Nano Banana)', zh: '极速 (Nano Banana)' } },
]

const ADMIN_ONLY_MODELS: ReadonlyArray<AvailableModel> = [
  { value: 'ta-gemini-3.1-flash', label: 'TA 3.1 Flash', tier: 'balanced', tierLabel: { en: 'TA 3.1 Flash (Admin)', zh: 'TA 3.1 Flash (管理员)' } },
  { value: 'ta-gemini-2.5-flash', label: 'TA 2.5 Flash', tier: 'fast', tierLabel: { en: 'TA 2.5 Flash (Admin)', zh: 'TA 2.5 Flash (管理员)' } },
  { value: 'ta-gemini-3-pro', label: 'TA 3 Pro', tier: 'high', tierLabel: { en: 'TA 3 Pro (Admin)', zh: 'TA 3 Pro (管理员)' } },
]

const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  '951454612@qq.com',
  '1027588424@qq.com',
])

export function isAdminUser(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email)
}

export function getAvailableModels(email: string | null | undefined): ReadonlyArray<AvailableModel> {
  return isAdminUser(email) ? [...AVAILABLE_MODELS, ...ADMIN_ONLY_MODELS] : AVAILABLE_MODELS
}

export const DEFAULT_MODEL: GenerationModel = 'or-gemini-3.1-flash'

export const BILLING_TIER_ORDER: BillingTier[] = ['fast', 'balanced', 'quality']

export const BILLING_TIER_COSTS: Record<BillingTier, number> = {
  fast: 15,
  balanced: 30,
  quality: 50,
}

export const BILLING_TIER_LABELS: Record<BillingTier, { en: string; zh: string }> = {
  fast: { en: 'Fast', zh: '极速' },
  balanced: { en: 'Balanced', zh: '均衡' },
  quality: { en: 'High Quality', zh: '高质' },
}

export type AspectRatio =
  | '1:1' | '2:3' | '3:2' | '3:4' | '4:3'
  | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
export type ImageSize = '1K' | '2K' | '4K'

export interface ModelCapability {
  supportedSizes: ImageSize[]
  publicSizes: ImageSize[]
  defaultSize: ImageSize
  rolloutStage: ModelRolloutStage
  migrateTo?: GenerationModel
}

export const MODEL_CAPABILITIES: Partial<Record<GenerationModel, ModelCapability>> = {
  'or-gemini-2.5-flash': {
    supportedSizes: ['1K'],
    publicSizes: ['1K'],
    defaultSize: '1K',
    rolloutStage: 'public',
  },
  'or-gemini-3.1-flash': {
    supportedSizes: ['1K'],
    publicSizes: ['1K'],
    defaultSize: '1K',
    rolloutStage: 'public',
  },
  'or-gemini-3-pro': {
    supportedSizes: ['1K'],
    publicSizes: ['1K'],
    defaultSize: '1K',
    rolloutStage: 'public',
  },
  'ta-gemini-2.5-flash': {
    supportedSizes: ['1K'],
    publicSizes: ['1K'],
    defaultSize: '1K',
    rolloutStage: 'internal_only',
  },
  'ta-gemini-3.1-flash': {
    supportedSizes: ['1K'],
    publicSizes: ['1K'],
    defaultSize: '1K',
    rolloutStage: 'internal_only',
  },
  'ta-gemini-3-pro': {
    supportedSizes: ['1K'],
    publicSizes: ['1K'],
    defaultSize: '1K',
    rolloutStage: 'internal_only',
  },
}

const MODEL_BILLING_TIERS: Partial<Record<GenerationModel, BillingTier>> = {
  'azure-flux': 'balanced',
  'gpt-image': 'quality',
  'qiniu-gemini-pro': 'quality',
  'qiniu-gemini-flash': 'balanced',
  'volc-seedream-4.5': 'quality',
  'volc-seedream-5.0-lite': 'fast',
  'flux-kontext-pro': 'quality',
  'gemini-pro-image': 'quality',
  'gemini-flash-image': 'balanced',
  'or-gemini-2.5-flash': 'fast',
  'or-gemini-3.1-flash': 'balanced',
  'or-gemini-3-pro': 'quality',
  'ta-gemini-2.5-flash': 'fast',
  'ta-gemini-3.1-flash': 'balanced',
  'ta-gemini-3-pro': 'quality',
  'midjourney': 'quality',
  'sd-3.5-ultra': 'quality',
  'dall-e-4': 'quality',
  'ideogram-3': 'quality',
}

export const MODEL_CREDIT_COSTS: Partial<Record<GenerationModel, Partial<Record<ImageSize, number>>>> = {
  'azure-flux': { '1K': 30, '2K': 30, '4K': 30 },
  'gpt-image': { '1K': 50, '2K': 50, '4K': 50 },
  'qiniu-gemini-pro': { '1K': 50, '2K': 50, '4K': 50 },
  'qiniu-gemini-flash': { '1K': 30, '2K': 30, '4K': 30 },
  'volc-seedream-4.5': { '1K': 50, '2K': 50, '4K': 50 },
  'volc-seedream-5.0-lite': { '1K': 15, '2K': 15, '4K': 15 },
  'flux-kontext-pro': { '1K': 50, '2K': 50, '4K': 50 },
  'gemini-pro-image': { '1K': 50, '2K': 50, '4K': 50 },
  'gemini-flash-image': { '1K': 30, '2K': 30, '4K': 30 },
  'or-gemini-2.5-flash': { '1K': 15, '2K': 15, '4K': 15 },
  'or-gemini-3.1-flash': { '1K': 30, '2K': 30, '4K': 30 },
  'or-gemini-3-pro': { '1K': 50, '2K': 50, '4K': 50 },
  'ta-gemini-2.5-flash': { '1K': 15, '2K': 15, '4K': 15 },
  'ta-gemini-3.1-flash': { '1K': 30, '2K': 30, '4K': 30 },
  'ta-gemini-3-pro': { '1K': 50, '2K': 50, '4K': 50 },
  'midjourney': { '1K': 50, '2K': 50, '4K': 50 },
  'sd-3.5-ultra': { '1K': 50, '2K': 50, '4K': 50 },
  'dall-e-4': { '1K': 50, '2K': 50, '4K': 50 },
  'ideogram-3': { '1K': 50, '2K': 50, '4K': 50 },
}

function knownModelValues(): GenerationModel[] {
  return [
    'azure-flux',
    'gpt-image',
    'qiniu-gemini-pro',
    'qiniu-gemini-flash',
    'volc-seedream-4.5',
    'volc-seedream-5.0-lite',
    'flux-kontext-pro',
    'gemini-pro-image',
    'gemini-flash-image',
    'or-gemini-2.5-flash',
    'or-gemini-3.1-flash',
    'or-gemini-3-pro',
    'ta-gemini-2.5-flash',
    'ta-gemini-3.1-flash',
    'ta-gemini-3-pro',
    'midjourney',
    'sd-3.5-ultra',
    'dall-e-4',
    'ideogram-3',
  ]
}

export function normalizeGenerationModel(model: string | null | undefined): GenerationModel {
  const raw = String(model ?? '').trim()
  if (!raw) return DEFAULT_MODEL

  const capability = MODEL_CAPABILITIES[raw as GenerationModel]
  if (capability?.migrateTo) return capability.migrateTo

  if (knownModelValues().includes(raw as GenerationModel)) {
    return raw as GenerationModel
  }

  return DEFAULT_MODEL
}

export function getModelCapability(model: GenerationModel | string): ModelCapability | null {
  return MODEL_CAPABILITIES[normalizeGenerationModel(model)] ?? null
}

export function getSupportedImageSizes(
  model: GenerationModel | string,
  opts?: { includeInternal?: boolean }
): ImageSize[] {
  const capability = getModelCapability(model)
  if (!capability) return ['1K']
  return (opts?.includeInternal ? capability.supportedSizes : capability.publicSizes).slice()
}

export function getDefaultImageSize(model: GenerationModel | string): ImageSize {
  const capability = getModelCapability(model)
  return capability?.defaultSize ?? '1K'
}

export function isImageSizeSupportedForModel(
  model: GenerationModel | string,
  imageSize: ImageSize,
  opts?: { includeInternal?: boolean }
): boolean {
  return getSupportedImageSizes(model, opts).includes(imageSize)
}

export function sanitizeImageSizeForModel(
  model: GenerationModel | string,
  imageSize: ImageSize,
  opts?: { includeInternal?: boolean }
): ImageSize {
  return isImageSizeSupportedForModel(model, imageSize, opts)
    ? imageSize
    : getDefaultImageSize(model)
}

export function getGenerationCreditCost(
  model: GenerationModel | string,
  imageSize: ImageSize
): number {
  const normalizedModel = normalizeGenerationModel(model)
  const normalizedSize = sanitizeImageSizeForModel(normalizedModel, imageSize, { includeInternal: true })
  const costs = MODEL_CREDIT_COSTS[normalizedModel]
  return costs?.[normalizedSize] ?? BILLING_TIER_COSTS[getBillingTierForModel(normalizedModel)]
}

export function getBillingTierForModel(model: GenerationModel | string): BillingTier {
  const normalizedModel = normalizeGenerationModel(model)
  const tier = MODEL_BILLING_TIERS[normalizedModel]
  if (tier) return tier
  return MODEL_BILLING_TIERS[DEFAULT_MODEL] ?? 'balanced'
}

export function isValidModel(m: string): boolean {
  const raw = String(m ?? '').trim()
  if (!raw) return false
  if (MODEL_CAPABILITIES[raw as GenerationModel]?.migrateTo) return true
  return knownModelValues().includes(raw as GenerationModel)
}

export const IMAGE_SIZE_LABELS: Record<ImageSize, { en: string; zh: string }> = {
  '1K': { en: '1K (1024px)', zh: '1K 标清 (1024px)' },
  '2K': { en: '2K (2048px)', zh: '2K 高清 (2048px)' },
  '4K': { en: '4K (4096px)', zh: '4K 超清 (4096px)' },
}
export type BackgroundMode = 'white' | 'original'

// Credit costs — loaded from get-public-config, fallback values here
export const DEFAULT_CREDIT_COSTS: Record<string, number> = {
  'azure-flux': getGenerationCreditCost('azure-flux', '1K'),
  'gpt-image': getGenerationCreditCost('gpt-image', '1K'),
  'qiniu-gemini-pro': getGenerationCreditCost('qiniu-gemini-pro', '1K'),
  'qiniu-gemini-flash': getGenerationCreditCost('qiniu-gemini-flash', '1K'),
  'volc-seedream-4.5': getGenerationCreditCost('volc-seedream-4.5', '1K'),
  'volc-seedream-5.0-lite': getGenerationCreditCost('volc-seedream-5.0-lite', '1K'),
  'flux-kontext-pro': getGenerationCreditCost('flux-kontext-pro', '1K'),
  'gemini-pro-image': getGenerationCreditCost('gemini-pro-image', '1K'),
  'gemini-flash-image': getGenerationCreditCost('gemini-flash-image', '1K'),
  'or-gemini-2.5-flash': getGenerationCreditCost('or-gemini-2.5-flash', getDefaultImageSize('or-gemini-2.5-flash')),
  'or-gemini-3.1-flash': getGenerationCreditCost('or-gemini-3.1-flash', getDefaultImageSize('or-gemini-3.1-flash')),
  'or-gemini-3-pro': getGenerationCreditCost('or-gemini-3-pro', getDefaultImageSize('or-gemini-3-pro')),
  'ta-gemini-2.5-flash': getGenerationCreditCost('ta-gemini-2.5-flash', '1K'),
  'ta-gemini-3.1-flash': getGenerationCreditCost('ta-gemini-3.1-flash', '1K'),
  'ta-gemini-3-pro': getGenerationCreditCost('ta-gemini-3-pro', '1K'),
  'midjourney': getGenerationCreditCost('midjourney', '1K'),
  'sd-3.5-ultra': getGenerationCreditCost('sd-3.5-ultra', '1K'),
  'dall-e-4': getGenerationCreditCost('dall-e-4', '1K'),
  'ideogram-3': getGenerationCreditCost('ideogram-3', '1K'),
  'turbo-1k': BILLING_TIER_COSTS.fast,
  'turbo-2k': BILLING_TIER_COSTS.balanced,
  'turbo-4k': BILLING_TIER_COSTS.quality,
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
  scene_recipe?: GenesisSceneRecipe
}

export interface AnalysisAiMeta {
  model: string
  usage: Record<string, unknown>
  provider: string
  image_count: number
  target_language: string
  prompt_profile?: PromptProfile
  prompt_config_key?: string
}

export interface SubjectProfile {
  subject_type?: 'human' | 'pet' | 'other' | 'unknown' | string
  identity_anchor?: string
  body_anchor?: string
  pose_anchor?: string
  species_notes?: string
  lock_rules?: string[]
  [key: string]: unknown
}

export interface GarmentProfile {
  category?: string
  color_anchor?: string
  material?: string
  key_features?: string[]
  [key: string]: unknown
}

export interface TryOnStrategy {
  selected_type_count?: number
  summary?: string
  wear_region?: string
  per_image_rules?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type BlueprintCopyMode = 'user-brief' | 'product-inferred' | 'visual-only'

export type BlueprintCopyRole = 'headline' | 'headline+support' | 'label' | 'none'

export interface BlueprintCopyPlanAdaptation {
  plan_index: number
  plan_type: string
  copy_role: BlueprintCopyRole
  adaptation_summary: string
}

export interface BlueprintCopyAnalysis {
  mode: BlueprintCopyMode
  source_brief: string
  brief_summary: string
  product_summary: string
  resolved_output_language: OutputLanguage
  shared_copy: string
  can_clear_to_visual_only: true
  per_plan_adaptations: BlueprintCopyPlanAdaptation[]
}

export interface AnalysisBlueprint {
  images: BlueprintImagePlan[]
  design_specs: string
  _ai_meta: AnalysisAiMeta
  subject_profile?: SubjectProfile
  garment_profile?: GarmentProfile
  tryon_strategy?: TryOnStrategy
  copy_analysis?: BlueprintCopyAnalysis
  product_summary?: string
  product_visual_identity?: ProductVisualIdentity
  style_directions?: GenesisStyleDirectionGroup[]
  commercial_intent?: GenesisCommercialIntent
}

export type EcomDetailModuleId =
  | 'hero-visual'
  | 'core-selling-point'
  | 'usage-scene'
  | 'multi-angle'
  | 'scene-atmosphere'
  | 'product-detail'
  | 'brand-story'
  | 'size-capacity-spec'
  | 'before-after'
  | 'spec-table'
  | 'craft-process'
  | 'accessories-gifts'
  | 'series-display'
  | 'ingredients'
  | 'after-sales'
  | 'usage-tips'

export interface EcomDetailModuleCopy {
  zh: string
  en: string
}

export interface EcomDetailModuleDefinition {
  id: EcomDetailModuleId
  sortOrder: number
  title: EcomDetailModuleCopy
  subtitle: EcomDetailModuleCopy
  defaultPromptSeed: EcomDetailModuleCopy
}

export type GenesisStyleDirectionKey = 'sceneStyle' | 'lighting' | 'composition'

export interface GenesisStyleDirectionGroup {
  key: GenesisStyleDirectionKey
  options: string[]
  recommended: string | null
}

export type GenesisProductArchetype =
  | 'apparel'
  | 'beauty-liquid'
  | 'beauty-bottle'
  | 'footwear'
  | 'electronics'
  | 'jewelry'
  | 'generic'

export interface GenesisCommercialIntent {
  archetype: GenesisProductArchetype
  brief_summary: string
  visual_tone: string
  mood_keywords: string[]
  composition_bias: string
  set_treatment: string
  lighting_bias: string
  copy_strategy: string
}

export interface GenesisSceneRecipe {
  shot_role: string
  hero_focus: string
  product_ratio: string
  layout_method: string
  subject_angle: string
  support_elements: string
  background_surface: string
  background_elements: string
  decorative_elements: string
  lighting_setup: string
  lens_hint: string
  text_zone: string
  mood_keywords: string
}

export interface ProductVisualIdentity {
  primary_color: string
  secondary_colors: string[]
  material: string
  key_features: string[]
}

export interface GenesisAnalysisResult {
  product_summary: string
  product_visual_identity?: ProductVisualIdentity
  style_directions: GenesisStyleDirectionGroup[]
  copy_plan: string
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

// --- Result assets ---

export type ResultAssetSection = 'original' | 'edited'

export type ResultAssetOrigin =
  | 'studio-genesis'
  | 'studio-genesis-2'
  | 'ecom-studio'
  | 'clothing-model-tryon'
  | 'clothing-basic-photo'
  | 'aesthetic-mirror'
  | 'refinement-studio'
  | 'history'
  | 'image-editor'
  | 'unknown'

export interface ResultAsset {
  id: string
  url: string
  label?: string
  section: ResultAssetSection
  sourceAssetId?: string
  batchId?: string
  batchTimestamp?: number
  requestedSize?: string
  providerSize?: string
  actualSize?: string
  deliveredSize?: string
  sizeStatus?: 'exact' | 'normalized_down' | 'too_small' | 'unknown'
  normalizedByServer?: boolean
  createdAt: number
  originModule: ResultAssetOrigin
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

export type StyleDimensionSelections = Partial<Record<StyleDimensionKey, string>>

export type StyleConstraintSource = 'user_selected' | 'ai_suggested' | 'mixed'

export interface StyleConstraintPayload {
  selections: StyleDimensionSelections
  prompt: string
  source: StyleConstraintSource
}

export interface StyleAnalysisResult {
  selections: StyleDimensionSelections
  confidence: number
  source: 'ai'
  model?: string
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

export function buildStylePrefix(selections: StyleDimensionSelections): string {
  const parts: string[] = []
  for (const dim of STYLE_DIMENSIONS) {
    const selected = selections[dim.key]
    if (!selected) continue
    const opt = dim.options.find(o => o.value === selected)
    if (opt) parts.push(opt.promptTag)
  }
  return parts.length > 0 ? parts.join(', ') + '. ' : ''
}

export function countSelectedStyleDimensions(selections: StyleDimensionSelections): number {
  return STYLE_DIMENSIONS.reduce((count, dim) => count + (selections[dim.key] ? 1 : 0), 0)
}

export function sanitizeStyleSelections(selections: StyleDimensionSelections): StyleDimensionSelections {
  const sanitized: StyleDimensionSelections = {}
  for (const dim of STYLE_DIMENSIONS) {
    const raw = selections[dim.key]
    if (!raw) continue
    if (dim.options.some((opt) => opt.value === raw)) {
      sanitized[dim.key] = raw
    }
  }
  return sanitized
}

export function buildStyleConstraintPrompt(selections: StyleDimensionSelections): string {
  const parts: string[] = []

  for (const dim of STYLE_DIMENSIONS) {
    const selected = selections[dim.key]
    if (!selected) continue
    const opt = dim.options.find((o) => o.value === selected)
    if (!opt) continue
    parts.push(`${dim.key}: ${opt.promptTag}`)
  }

  if (parts.length === 0) return ''

  return [
    '[STYLE CONSTRAINTS | HIGH PRIORITY]',
    'Apply the following selected style constraints as explicit visual targets:',
    ...parts.map((line) => `- ${line}`),
    'If any default style conflicts with these constraints, these constraints must take precedence.',
    '[/STYLE CONSTRAINTS]',
  ].join('\n')
}

export function buildStyleConstraintPayload(
  selections: StyleDimensionSelections,
  source: StyleConstraintSource = 'user_selected',
): StyleConstraintPayload | undefined {
  const normalized = sanitizeStyleSelections(selections)
  if (countSelectedStyleDimensions(normalized) === 0) return undefined
  return {
    selections: normalized,
    prompt: buildStyleConstraintPrompt(normalized),
    source,
  }
}

// --- Public config ---

export interface PublicConfig {
  credit_costs: Record<string, number | Record<string, number>>
  signup_bonus_credits: number
  batch_concurrency: number
  ta_pro_prompt_profile_enabled?: boolean
  release_notes?: {
    en: string
    zh: string
  }
  platform_rules?: {
    version: string
    rules: PlatformRule[]
  }
}
