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
} from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function supabase() {
  return createClient()
}

function functionUrl(name: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
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
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
    throw new Error(apiMessage)
  }

  return payload as T
}

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
  whiteBgRetouched?: { front: boolean; back: boolean }
  detailCount?: number
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
}

export async function analyzeProductV2(
  params: AnalyzeProductParams
): Promise<JobResponse> {
  const res = await invokeFunction<JobResponse>('analyze-product-v2', params)
  void processGenerationJob(res.job_id)
  return res
}

export interface GeneratePromptsParams {
  analysisJson?: unknown
  design_specs?: unknown
  imageCount?: number
  targetLanguage?: string
  outputLanguage?: string
  stream?: boolean
  trace_id: string
  clothingMode?: 'prompt_generation' | 'model_prompt_generation'
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
    throw new Error(`generate-prompts-v2 failed: ${response.status}`)
  }

  return response.body!
}

export interface GenerateImageParams {
  productImage: string
  productImages?: string[]
  prompt: string
  model: GenerationModel
  aspectRatio: AspectRatio
  imageSize: ImageSize
  turboEnabled: boolean
  imageCount?: number
  count?: number
  client_job_id: string
  fe_attempt: number
  metadata?: Record<string, unknown>
  trace_id: string
  workflowMode?: 'product' | 'model'
  modelImage?: string
}

export async function generateImage(
  params: GenerateImageParams
): Promise<JobResponse> {
  const res = await invokeFunction<JobResponse>('generate-image', params)
  void processGenerationJob(res.job_id)
  return res
}

export interface GenerateModelImageParams {
  gender: string
  ageRange: string
  skinColor: string
  otherRequirements?: string
  productImages?: string[]
  count: number
  turboEnabled: boolean
  trace_id: string
  client_job_id: string
  fe_attempt: number
}

export async function generateModelImage(
  params: GenerateModelImageParams
): Promise<JobResponse> {
  const res = await invokeFunction<JobResponse>('generate-model-image', params)
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
  referenceImage: string
  productImages: string[]
  userPrompt?: string
  model: GenerationModel
  aspectRatio: AspectRatio
  imageSize: ImageSize
  turboEnabled: boolean
  trace_id: string
  client_job_id: string
  fe_attempt: number
  metadata?: Record<string, unknown>
}

export async function analyzeSingle(
  params: AnalyzeSingleParams
): Promise<JobResponse> {
  return invokeFunction<JobResponse>('analyze-single', params)
}

// ── Payment ───────────────────────────────────────────────────────────────────

export async function createCreditCheckout(
  packageId: string,
  returnTo: string
): Promise<CheckoutResponse> {
  return invokeFunction<CheckoutResponse>('create-credit-checkout', {
    packageId,
    returnTo,
  })
}

export async function createOnetimeCheckout(
  packageId: string,
  returnTo: string
): Promise<CheckoutResponse> {
  return invokeFunction<CheckoutResponse>('create-onetime-checkout', {
    packageId,
    returnTo,
  })
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function getPublicConfig(): Promise<PublicConfig> {
  return invokeFunction<PublicConfig>('get-public-config', undefined, 'GET')
}
