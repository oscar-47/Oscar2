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

// --- AI generation models ---

export type GenerationModel = 'nano-banana' | 'nano-banana-pro'
export type AspectRatio =
  | '1:1' | '2:3' | '3:2' | '3:4' | '4:3'
  | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
export type ImageSize = '1K' | '2K' | '4K'

// Credit costs — loaded from get-public-config, fallback values here
export const DEFAULT_CREDIT_COSTS: Record<string, number> = {
  'nano-banana': 3,
  'nano-banana-pro': 5,
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

// --- Studio Genesis: Analysis Blueprint (picset-compatible) ---

export interface BlueprintImagePlan {
  title: string
  description: string
  design_content: string
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

// --- SSE types ---

export interface PromptSseChunk {
  fullText: string
}

export interface GeneratedPrompt {
  prompt: string
}

// --- Studio Genesis phases ---

export type GenesisPhase = 'input' | 'analyzing' | 'preview' | 'generating' | 'complete'

// --- Public config ---

export interface PublicConfig {
  credit_costs: Record<string, number>
  signup_bonus_credits: number
  batch_concurrency: number
  release_notes?: {
    en: string
    zh: string
  }
}
