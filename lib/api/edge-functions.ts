/**
 * Frontend wrappers for Supabase Edge Functions.
 * All function names match the HAR-confirmed endpoint names exactly.
 */
import { createClient } from '@/lib/supabase/client'
import type {
  JobResponse,
  CheckoutResponse,
  OssStsCredentials,
  PublicConfig,
  GenerationModel,
  AspectRatio,
  ImageSize,
  PromptProfile,
  StyleConstraintPayload,
  StyleAnalysisResult,
  EcomDetailModuleDefinition,
} from '@/types'

type FunctionInvokeError = Error & {
  code?: string | null
  status?: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function supabase() {
  return createClient()
}

function functionUrl(name: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim()
  return `${supabaseUrl}/functions/v1/${name}`
}

async function getFreshAccessToken(): Promise<string> {
  const client = supabase()

  // First try the cached session
  const { data: { session } } = await client.auth.getSession()

  if (session?.access_token) {
    // Check if the JWT is already expired (with 30s buffer)
    try {
      const parts = session.access_token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        const isExpired = typeof payload.exp === 'number' && payload.exp < Date.now() / 1000 + 30
        if (!isExpired) return session.access_token
      } else {
        // Not a standard JWT (e.g. new opaque format) — just use it
        return session.access_token
      }
    } catch {
      return session.access_token
    }
  }

  // Token is expired or missing — try to refresh
  const { data: refreshData, error } = await client.auth.refreshSession()
  if (refreshData?.session?.access_token) return refreshData.session.access_token
  throw new Error(error?.message ?? 'Session expired. Please sign in again.')
}

async function getAuthHeaders(contentType = true): Promise<Record<string, string>> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim()
  const accessToken = await getFreshAccessToken()

  return {
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
  }
}

async function invokeFunction<T>(
  name: string,
  body?: unknown,
  method: 'GET' | 'POST' = 'POST',
  _isRetry = false
): Promise<T> {
  const response = await fetch(functionUrl(name), {
    method,
    headers: await getAuthHeaders(method !== 'GET'),
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  })

  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    // ignore parse errors; handled below
  }

  if (!response.ok) {
    // On first 401, force-refresh the session and retry once
    if (response.status === 401 && !_isRetry) {
      const { data } = await supabase().auth.refreshSession()
      if (data.session?.access_token) {
        return invokeFunction(name, body, method, true)
      }
    }

    const apiMessage =
      payload?.error?.message ??
      payload?.message ??
      `${name} failed: ${response.status}`
    const error = new Error(apiMessage) as FunctionInvokeError
    error.code = payload?.error?.code ?? payload?.code ?? null
    error.status = response.status
    throw error
  }

  return payload as T
}

async function buildFunctionError(
  name: string,
  response: Response
): Promise<FunctionInvokeError> {
  let payload: any = null
  let rawText = ''

  try {
    rawText = await response.text()
  } catch {
    rawText = ''
  }

  if (rawText) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      payload = null
    }
  }

  const apiMessage =
    payload?.error?.message ??
    payload?.message ??
    (rawText.trim() || `${name} failed: ${response.status}`)
  const error = new Error(apiMessage) as FunctionInvokeError
  error.code = payload?.error?.code ?? payload?.code ?? null
  error.status = response.status
  return error
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function notifyCreditsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('credits:refetch'))
  }
}

function isInsufficientCreditsError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'INSUFFICIENT_CREDITS'
    || (error instanceof Error && /insufficient_credits|not enough credits/i.test(error.message))
}

function isImageQueueBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('too_many_active_jobs')
    || message.includes('too many image generation jobs')
    || message.includes('too many image jobs')
}

const IMAGE_QUEUE_RETRY_ATTEMPTS = 30
const IMAGE_QUEUE_RETRY_DELAY_MS = 4000

// ── Upload ────────────────────────────────────────────────────────────────────

export interface GetOssStsParams {
  prefix?: string
  key?: string
  bucket?: string
  expiresIn?: number
}

export async function getOssSts(
  params: GetOssStsParams = {}
): Promise<OssStsCredentials> {
  return invokeFunction<OssStsCredentials>('get-oss-sts', {
    prefix: 'temp/uploads',
    ...params,
  })
}

// ── Studio Genesis (5-step pipeline) ─────────────────────────────────────────

export interface AnalyzeProductParams {
  productImage: string
  productImages?: string[]
  promptProfile?: PromptProfile
  platformStyle?: string
  studioType?: string
  requirements?: string
  imageCount?: number
  uiLanguage?: string
  targetLanguage?: string
  outputLanguage?: string
  trace_id: string
  // Clothing Studio / Refinement Studio specific
  clothingMode?: 'product_analysis' | 'refinement_analysis' | 'model_strategy'
  modelImage?: string
  whiteBackground?: boolean
  whiteBgFront?: boolean
  whiteBgBack?: boolean
  whiteBgRetouched?: { front: boolean; back: boolean }
  detailCount?: number
  detailCloseupCount?: number
  detailCloseup?: { count: number }
  sellingPointCount?: number
  sellingPoint?: { count: number }
  refinedViews?: string[]
  threeDEnabled?: boolean
  threeDEffect?: { enabled: boolean; whiteBackground: boolean }
  threeDWhiteBackground?: boolean
  mannequinEnabled?: boolean
  mannequin?: { enabled: boolean; whiteBackground: boolean }
  mannequinWhiteBackground?: boolean
  ecomDetailModules?: EcomDetailModuleDefinition[]
}

export async function analyzeProductV2(
  params: AnalyzeProductParams
): Promise<JobResponse> {
  const res = await invokeFunction<JobResponse>('analyze-product-v2', params)
  void processGenerationJob(res.job_id)
  return res
}

/** Ecommerce Studio analysis — reuses analyze-product-v2 with studioType='ecommerce' */
export async function analyzeEcommerceProduct(params: {
  productImage: string
  userDescription?: string
  detailCount: number
  trace_id: string
  uiLanguage?: string
  outputLanguage?: string
}): Promise<JobResponse> {
  const uiLanguage = (params.uiLanguage ?? 'en').startsWith('zh') ? 'zh' : 'en'
  const requirements = params.userDescription?.trim() || undefined
  const imageCount = Math.max(1, Math.min(15, Number(params.detailCount ?? 0) + 1))

  const res = await invokeFunction<JobResponse>('analyze-product-v2', {
    productImage: params.productImage,
    productImages: [params.productImage],
    requirements,
    imageCount,
    uiLanguage,
    outputLanguage: params.outputLanguage ?? uiLanguage,
    studioType: 'ecommerce',
    trace_id: params.trace_id,
    clothingMode: undefined,
  })
  void processGenerationJob(res.job_id)
  return res
}

export interface GeneratePromptsParams {
  analysisJson?: unknown
  design_specs?: unknown
  promptProfile?: PromptProfile
  imageCount?: number
  targetLanguage?: string
  outputLanguage?: string
  stream?: boolean
  trace_id: string
  clothingMode?: 'prompt_generation' | 'model_prompt_generation'
  styleConstraint?: StyleConstraintPayload
  module?: 'genesis' | 'default' | 'clothing' | 'ecom-detail'
}

/**
 * Calls generate-prompts-v2 and returns a ReadableStream (SSE).
 * The caller is responsible for consuming the stream.
 */
export async function generatePromptsV2Stream(
  params: GeneratePromptsParams,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  async function doRequest() {
    return fetch(functionUrl('generate-prompts-v2'), {
      method: 'POST',
      headers: await getAuthHeaders(true),
      body: JSON.stringify({ ...params, stream: true }),
      signal,
    })
  }

  let response = await doRequest()

  // Retry once after a forced session refresh on 401
  if (response.status === 401) {
    const { data } = await supabase().auth.refreshSession()
    if (data.session?.access_token) {
      response = await doRequest()
    }
  }

  if (!response.ok) {
    throw await buildFunctionError('generate-prompts-v2', response)
  }

  return response.body!
}

export interface GenerateImageParams {
  productImage: string
  productImages?: string[]
  prompt: string
  negativePrompt?: string
  promptProfile?: PromptProfile
  model: GenerationModel
  aspectRatio: AspectRatio
  imageSize: ImageSize
  turboEnabled?: boolean
  imageCount?: number
  count?: number
  client_job_id: string
  fe_attempt: number
  metadata?: Record<string, unknown>
  trace_id: string
  workflowMode?: 'product' | 'model'
  modelImage?: string
  // Quick Edit / Text Edit fields
  editMode?: boolean
  editType?: 'quick' | 'text'
  originalImage?: string
  referenceImages?: string[]
  textEdits?: Record<string, string>
  styleConstraint?: StyleConstraintPayload
}

export async function generateImage(
  params: GenerateImageParams
): Promise<JobResponse> {
  for (let attempt = 0; attempt < IMAGE_QUEUE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const res = await invokeFunction<JobResponse>('generate-image', params)
      notifyCreditsChanged()
      void processGenerationJob(res.job_id)
      return res
    } catch (error) {
      if (isInsufficientCreditsError(error)) {
        notifyCreditsChanged()
      }
      const shouldRetry = isImageQueueBusyError(error) && attempt < IMAGE_QUEUE_RETRY_ATTEMPTS - 1
      if (!shouldRetry) throw error
      await sleep(IMAGE_QUEUE_RETRY_DELAY_MS)
    }
  }

  throw new Error('Image generation queue remained busy after retries')
}

export interface GenerateModelImageParams {
  model?: GenerationModel
  gender: 'female' | 'male'
  ageRange?: string
  ethnicity?: 'asian' | 'white' | 'black' | 'latino'
  otherRequirements?: string
  productImage?: string
  productImages?: string[]
  count?: number
  turboEnabled?: boolean
  // Compatibility fields
  age?: string
  skin?: string
  prompt?: string
  imageCount?: number
  uiLanguage?: string
  targetLanguage?: string
  trace_id: string
  client_job_id: string
  fe_attempt: number
}

export async function generateModelImage(
  params: GenerateModelImageParams
): Promise<JobResponse> {
  const payload = {
    ...params,
    ageRange: params.ageRange ?? params.age,
    ethnicity: params.ethnicity ?? (params.skin as GenerateModelImageParams['ethnicity'] | undefined),
    otherRequirements: params.otherRequirements ?? params.prompt,
    imageCount: params.imageCount ?? params.count ?? 1,
  }
  const res = await invokeFunction<JobResponse>('generate-model-image', payload)
  notifyCreditsChanged()
  void processGenerationJob(res.job_id)
  return res
}

// ── Worker nudge ─────────────────────────────────────────────────────────────

/**
 * Nudge the backend worker to process a queued generation job.
 * Called after creating an ANALYSIS or IMAGE_GEN job.
 */
export async function processGenerationJob(jobId: string): Promise<void> {
  try {
    await invokeFunction('process-generation-job', { job_id: jobId })
  } catch {
    // Nudge failures are non-fatal — polling will retry
  }
}

// ── Aesthetic Mirror (single endpoint) ───────────────────────────────────────

export interface AnalyzeSingleParams {
  mode?: 'single' | 'batch' | 'refinement'
  referenceImage?: string
  productImages?: string[]
  referenceImages?: string[]
  productImage?: string
  promptProfile?: PromptProfile
  groupCount?: number
  backgroundMode?: 'white' | 'original'
  userPrompt?: string
  imageCount?: number
  model: GenerationModel
  aspectRatio: AspectRatio
  imageSize: ImageSize
  turboEnabled?: boolean
  trace_id: string
  client_job_id: string
  fe_attempt: number
  metadata?: Record<string, unknown>
  styleConstraint?: StyleConstraintPayload
}

export async function analyzeSingle(
  params: AnalyzeSingleParams
): Promise<JobResponse> {
  const res = await invokeFunction<JobResponse>('analyze-single', params)
  notifyCreditsChanged()
  void processGenerationJob(res.job_id)
  return res
}

// ── Style Dimensions Analysis ────────────────────────────────────────────────

export interface AnalyzeStyleDimensionsParams {
  contextText?: string
  analysisJson?: unknown
  module: 'genesis' | 'aesthetic' | 'clothing-basic' | 'clothing-model'
  uiLanguage?: string
}

export async function analyzeStyleDimensions(
  params: AnalyzeStyleDimensionsParams
): Promise<StyleAnalysisResult> {
  return invokeFunction<StyleAnalysisResult>('analyze-style-dimensions', params)
}

// ── Payment ───────────────────────────────────────────────────────────────────

export async function createCreditCheckout(
  packageId: string,
  returnTo: string,
  currency?: string
): Promise<CheckoutResponse> {
  return invokeFunction<CheckoutResponse>('create-credit-checkout', {
    packageId,
    returnTo,
    currency,
  })
}

export async function createOnetimeCheckout(
  packageId: string,
  returnTo: string,
  currency?: string
): Promise<CheckoutResponse> {
  return invokeFunction<CheckoutResponse>('create-onetime-checkout', {
    packageId,
    returnTo,
    currency,
  })
}

// ── Billing Portal ────────────────────────────────────────────────────────

export async function createPortalSession(returnTo?: string): Promise<{ url: string }> {
  return invokeFunction<{ url: string }>('create-portal-session', { returnTo })
}

// ── Text Detection ────────────────────────────────────────────────────────────

export interface TextDetectionJobResult {
  status: string
  job_id: string
}

export interface OcrTextItem {
  text: string
  box_2d: number[] // [y1, x1, y2, x2] normalized 0-1000
}

export async function detectImageText(image: string): Promise<TextDetectionJobResult> {
  const res = await invokeFunction<TextDetectionJobResult>('detect-image-text', { image })
  void processGenerationJob(res.job_id)
  return res
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function getPublicConfig(): Promise<PublicConfig> {
  return invokeFunction<PublicConfig>('get-public-config', undefined, 'GET')
}
