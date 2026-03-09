import { expect, type Page, type Request as PlaywrightRequest, type TestInfo } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

type JsonRecord = Record<string, unknown>

export type TaProFlowId =
  | 'genesis'
  | 'aesthetic-single'
  | 'aesthetic-batch'
  | 'clothing-basic'
  | 'clothing-try-on'
  | 'ecom-detail'
  | 'refinement'

export type TaProSampleKind = 'pure-visual' | 'exact-copy-zh' | 'identity-stress'
export type ManualReviewStatus = 'pass' | 'fail' | 'pending'

export interface TaProSampleManifest {
  id: string
  kind: TaProSampleKind
  productImages: string[]
  referenceImages?: string[]
  subjectImage?: string
  requirements?: string
  userPrompt?: string
  outputLanguage?: string
  modules?: string[]
  generationType?: string
  groupCount?: number
  backgroundMode?: 'white' | 'original'
  ocr:
    | { mode: 'exact-match'; expectedText: string }
    | { mode: 'empty-or-allowed'; allowedTexts?: string[] }
  manualReview: {
    status: ManualReviewStatus
    notes?: string
  }
}

export interface TaProFlowManifest {
  id: TaProFlowId
  route?: string
  samples: TaProSampleManifest[]
}

export interface TaProManifest {
  locale?: 'zh' | 'en'
  reportPath?: string
  flows: TaProFlowManifest[]
}

export interface CapturedFunctionCall {
  name: string
  body: JsonRecord
}

export interface GenerationJobRecord {
  id: string
  type: string
  status: string
  payload: JsonRecord | null
  result_data: JsonRecord | null
  result_url: string | null
  error_message: string | null
  trace_id: string | null
}

export interface SampleRunResult {
  flowId: TaProFlowId
  sampleId: string
  kind: TaProSampleKind
  promptProfile: string
  jobIds: string[]
  screenshotPath: string
  ocrResult: string
  manualReview: ManualReviewStatus
  manualReviewNotes: string
  finalStatus: 'pass' | 'fail'
  failureReason: string
}

const REQUIRED_FLOW_IDS: TaProFlowId[] = [
  'genesis',
  'aesthetic-single',
  'aesthetic-batch',
  'clothing-basic',
  'clothing-try-on',
  'ecom-detail',
  'refinement',
]

const REQUIRED_SAMPLE_KINDS: TaProSampleKind[] = ['pure-visual', 'exact-copy-zh', 'identity-stress']

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function getTaProEnv() {
  const manifestPath = resolve(
    process.cwd(),
    process.env.TA_PRO_E2E_MANIFEST?.trim() || 'e2e/fixtures/ta-pro.manifest.example.json',
  )
  const reportPath = resolve(
    process.cwd(),
    process.env.TA_PRO_E2E_REPORT_PATH?.trim() || 'test-results/ta-pro-production-report.md',
  )

  return {
    adminEmail: requireEnv('TA_PRO_E2E_ADMIN_EMAIL'),
    adminPassword: requireEnv('TA_PRO_E2E_ADMIN_PASSWORD'),
    baseUrl: process.env.TA_PRO_E2E_BASE_URL?.trim() || 'http://127.0.0.1:3000',
    locale: (process.env.TA_PRO_E2E_LOCALE?.trim() || 'zh') as 'zh' | 'en',
    manifestPath,
    manifestDir: dirname(manifestPath),
    reportPath,
    supabaseAnonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    supabaseUrl: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  }
}

function getManifestContext() {
  const manifestPath = resolve(
    process.cwd(),
    process.env.TA_PRO_E2E_MANIFEST?.trim() || 'e2e/fixtures/ta-pro.manifest.example.json',
  )
  return {
    manifestPath,
    manifestDir: dirname(manifestPath),
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

function resolveAssetPath(manifestDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(manifestDir, filePath)
}

function ensureArray<T>(value: T[] | undefined, label: string): T[] {
  if (!value || value.length === 0) throw new Error(`${label} is required`)
  return value
}

export function loadTaProManifest(): TaProManifest {
  const manifestContext = getManifestContext()
  const raw = JSON.parse(readFileSync(manifestContext.manifestPath, 'utf8')) as TaProManifest
  const flowIds = new Set(raw.flows.map((flow) => flow.id))
  for (const flowId of REQUIRED_FLOW_IDS) {
    if (!flowIds.has(flowId)) throw new Error(`Manifest is missing required flow: ${flowId}`)
  }

  const flows = raw.flows.map((flow) => {
    const kinds = new Set(flow.samples.map((sample) => sample.kind))
    for (const kind of REQUIRED_SAMPLE_KINDS) {
      if (!kinds.has(kind)) {
        throw new Error(`Flow ${flow.id} is missing required sample kind: ${kind}`)
      }
    }
    if (flow.samples.length !== 3) {
      throw new Error(`Flow ${flow.id} must contain exactly 3 samples`)
    }

    const samples = flow.samples.map((sample) => ({
      ...sample,
      productImages: ensureArray(sample.productImages, `${flow.id}.${sample.id}.productImages`).map((filePath) =>
        resolveAssetPath(manifestContext.manifestDir, filePath),
      ),
      referenceImages: sample.referenceImages?.map((filePath) =>
        resolveAssetPath(manifestContext.manifestDir, filePath),
      ),
      subjectImage: sample.subjectImage
        ? resolveAssetPath(manifestContext.manifestDir, sample.subjectImage)
        : undefined,
    }))

    return { ...flow, samples }
  })

  return {
    ...raw,
    flows,
  }
}

function buildHeaders(accessToken: string) {
  const env = getTaProEnv()
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

export class TaProApiClient {
  private constructor(
    private readonly accessToken: string,
    private readonly supabase: SupabaseClient,
  ) {}

  static async create(): Promise<TaProApiClient> {
    const env = getTaProEnv()
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const { data, error } = await supabase.auth.signInWithPassword({
      email: env.adminEmail,
      password: env.adminPassword,
    })

    if (error || !data.session?.access_token) {
      throw new Error(error?.message ?? 'Failed to authenticate test admin via Supabase')
    }

    return new TaProApiClient(data.session.access_token, supabase)
  }

  private async invokeFunction<T>(name: string, body: JsonRecord): Promise<T> {
    const env = getTaProEnv()
    const response = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: buildHeaders(this.accessToken),
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.message ?? payload?.error?.message ?? `${name} failed: ${response.status}`)
    }
    return payload as T
  }

  async processJob(jobId: string): Promise<void> {
    await this.invokeFunction('process-generation-job', { job_id: jobId }).catch(() => undefined)
  }

  async waitForJob(jobId: string, timeoutMs = 8 * 60 * 1000): Promise<GenerationJobRecord> {
    const startedAt = Date.now()
    let attempt = 0
    while (Date.now() - startedAt < timeoutMs) {
      const { data, error } = await this.supabase
        .from('generation_jobs')
        .select('id,type,status,payload,result_data,result_url,error_message,trace_id')
        .eq('id', jobId)
        .single()

      if (error) throw new Error(error.message)
      const job = data as GenerationJobRecord
      if (job.status !== 'processing') return job
      if (attempt % 2 === 0) await this.processJob(jobId)
      attempt += 1
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))
    }
    throw new Error(`Timed out waiting for job ${jobId}`)
  }

  async waitForTraceIds(traceIds: string[], timeoutMs = 12 * 60 * 1000): Promise<GenerationJobRecord[]> {
    const uniqueTraceIds = Array.from(new Set(traceIds.filter(Boolean)))
    if (uniqueTraceIds.length === 0) throw new Error('No trace IDs were captured for this sample')

    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const rows: GenerationJobRecord[] = []
      let allReady = true

      for (const traceId of uniqueTraceIds) {
        const { data, error } = await this.supabase
          .from('generation_jobs')
          .select('id,type,status,payload,result_data,result_url,error_message,trace_id')
          .eq('trace_id', traceId)
          .order('created_at', { ascending: true })

        if (error) throw new Error(error.message)
        const jobs = (data ?? []) as GenerationJobRecord[]
        if (jobs.length === 0 || jobs.some((job) => job.status === 'processing')) {
          allReady = false
        }
        rows.push(...jobs)
      }

      if (allReady && rows.length > 0) return rows
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
    }

    throw new Error(`Timed out waiting for trace IDs: ${uniqueTraceIds.join(', ')}`)
  }

  async runOcr(imageUrl: string): Promise<string[]> {
    const { job_id } = await this.invokeFunction<{ job_id: string }>('detect-image-text', { image: imageUrl })
    await this.processJob(job_id)
    const job = await this.waitForJob(job_id)
    const items = Array.isArray(job.result_data?.data) ? job.result_data.data : []
    return items
      .map((item) => (item && typeof item === 'object' ? String((item as JsonRecord).text ?? '').trim() : ''))
      .filter(Boolean)
  }
}

function flowRoute(flowId: TaProFlowId): string {
  if (flowId === 'genesis') return '/studio-genesis'
  if (flowId === 'ecom-detail') return '/ecom-studio'
  if (flowId === 'aesthetic-single' || flowId === 'aesthetic-batch') return '/aesthetic-mirror'
  if (flowId === 'refinement') return '/refinement-studio'
  return '/clothing-studio'
}

function optionPatternForOutputLanguage(value: string, isZh: boolean): RegExp {
  if (value === 'none') return isZh ? /无文字.*纯视觉/ : /No Text.*Visual Only/i
  if (value === 'zh') return /中文/
  if (value === 'en') return /English/i
  return new RegExp(value, 'i')
}

async function openLabeledCombobox(page: Page, labelText: string) {
  const label = page.locator(`xpath=//label[normalize-space(.)='${labelText}']`).first()
  await expect(label).toBeVisible({ timeout: 30_000 })
  const trigger = label.locator('xpath=following::*[@role="combobox"][1]').first()
  await trigger.click()
  return trigger
}

async function maybeSelectLabeledOption(page: Page, labelText: string, optionName: RegExp) {
  const label = page.locator(`xpath=//label[normalize-space(.)='${labelText}']`).first()
  if (await label.count() === 0) return
  await openLabeledCombobox(page, labelText)
  await page.getByRole('option', { name: optionName }).click()
}

async function selectTaProModel(page: Page, isZh: boolean) {
  await openLabeledCombobox(page, isZh ? '模型' : 'Model')
  await expect(page.getByRole('option', { name: /TA 3 Pro/ })).toBeVisible()
  await page.getByRole('option', { name: /TA 3 Pro/ }).click()
}

async function setFileInputFiles(page: Page, index: number, filePaths: string[]) {
  await page.locator('input[type="file"]').nth(index).setInputFiles(filePaths)
}

async function countRemoteImages(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .map((node) => node.getAttribute('src') || '')
      .filter((src) => src.length > 0 && !src.startsWith('blob:'))
      .length,
  )
}

function attachFunctionRecorder(page: Page) {
  const calls: CapturedFunctionCall[] = []
  const handler = (request: PlaywrightRequest) => {
    const match = request.url().match(/\/functions\/v1\/([^/?#]+)/)
    if (!match || request.method() !== 'POST') return
    let body: JsonRecord = {}
    try {
      body = request.postDataJSON() as JsonRecord
    } catch {
      body = {}
    }
    calls.push({ name: match[1], body })
  }

  page.on('request', handler)

  return {
    calls,
    dispose() {
      page.off('request', handler)
    },
  }
}

function extractTraceIds(calls: CapturedFunctionCall[]): string[] {
  return Array.from(new Set(calls.map((call) => String(call.body.trace_id ?? '')).filter(Boolean)))
}

function extractPromptProfile(job: GenerationJobRecord): string[] {
  const values = new Set<string>()
  const payload = job.payload ?? {}
  const resultData = job.result_data ?? {}
  const metadata = (resultData.metadata ?? {}) as JsonRecord
  const aiMeta = (resultData._ai_meta ?? {}) as JsonRecord

  for (const value of [
    payload.prompt_profile,
    payload.promptProfile,
    metadata.prompt_profile,
    aiMeta.prompt_profile,
  ]) {
    if (typeof value === 'string' && value.trim()) values.add(value)
  }

  return Array.from(values)
}

function extractResultUrls(jobs: GenerationJobRecord[]): string[] {
  const urls = new Set<string>()
  for (const job of jobs) {
    if (typeof job.result_url === 'string' && job.result_url) urls.add(job.result_url)
    const outputs = Array.isArray(job.result_data?.outputs) ? job.result_data.outputs : []
    for (const item of outputs) {
      const url = item && typeof item === 'object' ? String((item as JsonRecord).url ?? '') : ''
      if (url) urls.add(url)
    }
  }
  return Array.from(urls)
}

function assertFrontendPromptProfile(calls: CapturedFunctionCall[]) {
  const promptProfileCalls = calls.filter((call) =>
    ['analyze-product-v2', 'generate-prompts-v2', 'generate-image', 'analyze-single'].includes(call.name),
  )
  if (promptProfileCalls.length === 0) throw new Error('No prompt-profile-aware function calls were captured')

  for (const call of promptProfileCalls) {
    const model = String(call.body.model ?? '')
    if (model && model !== 'ta-gemini-3-pro') continue
    if (call.body.promptProfile !== 'ta-pro') {
      throw new Error(`Expected promptProfile=ta-pro for ${call.name}`)
    }
  }
}

function assertOneKilobyteImageSize(calls: CapturedFunctionCall[]) {
  const sizedCalls = calls.filter((call) =>
    (call.name === 'generate-image' || call.name === 'analyze-single') && typeof call.body.imageSize === 'string',
  )
  if (sizedCalls.length === 0) {
    throw new Error('No image-size-bearing requests were captured')
  }
  for (const call of sizedCalls) {
    if (String(call.body.imageSize) !== '1K') {
      throw new Error(`Expected imageSize=1K, got ${String(call.body.imageSize)} for ${call.name}`)
    }
  }
}

async function maybeSelectOutputLanguage(page: Page, sample: TaProSampleManifest, isZh: boolean) {
  if (!sample.outputLanguage) return
  await maybeSelectLabeledOption(page, isZh ? '输出语言' : 'Output Language', optionPatternForOutputLanguage(sample.outputLanguage, isZh))
}

async function prepareGenesis(page: Page, sample: TaProSampleManifest, isZh: boolean) {
  await setFileInputFiles(page, 0, sample.productImages)
  if (sample.requirements) await page.locator('textarea').first().fill(sample.requirements)
  await maybeSelectOutputLanguage(page, sample, isZh)
  await page.getByRole('button', { name: /分析产品|Analyze Product/i }).click()
  await expect(page.getByRole('button', { name: /确认生成|Generate/i }).first()).toBeVisible({ timeout: 3 * 60_000 })
}

async function prepareEcom(page: Page, sample: TaProSampleManifest, isZh: boolean) {
  await setFileInputFiles(page, 0, sample.productImages)
  if (sample.requirements) await page.locator('textarea').first().fill(sample.requirements)
  for (const moduleName of sample.modules ?? []) {
    await page.getByRole('button', { name: new RegExp(moduleName) }).click()
  }
  await maybeSelectOutputLanguage(page, sample, isZh)
  await page.getByRole('button', { name: /详情页规划方案|Detail Page Plan/i }).click()
  await expect(page.getByRole('button', { name: /确认生成|Generate/i }).first()).toBeVisible({ timeout: 3 * 60_000 })
}

async function prepareAesthetic(page: Page, flowId: TaProFlowId, sample: TaProSampleManifest) {
  if (flowId === 'aesthetic-batch') {
    const batchToggle = page
      .getByRole('tab', { name: /批量复刻|Batch Replicate/i })
      .or(page.getByRole('button', { name: /批量复刻|Batch Replicate/i }))
    await batchToggle.click()
    await setFileInputFiles(page, 0, ensureArray(sample.referenceImages, 'referenceImages'))
    await setFileInputFiles(page, 1, [sample.productImages[0]])
  } else {
    await setFileInputFiles(page, 0, [ensureArray(sample.referenceImages, 'referenceImages')[0]])
    await setFileInputFiles(page, 1, sample.productImages)
  }
  if (sample.userPrompt) await page.locator('textarea').first().fill(sample.userPrompt)
}

async function prepareRefinement(page: Page, sample: TaProSampleManifest, isZh: boolean) {
  await setFileInputFiles(page, 0, sample.productImages)
  if (sample.userPrompt) await page.locator('textarea').first().fill(sample.userPrompt)
  if (sample.backgroundMode) {
    await maybeSelectLabeledOption(
      page,
      isZh ? '背景设置' : 'Background Mode',
      sample.backgroundMode === 'white' ? /白底图|white/i : /原图背景|original/i,
    )
  }
}

async function prepareClothing(page: Page, flowId: TaProFlowId, sample: TaProSampleManifest, isZh: boolean) {
  if (flowId === 'clothing-try-on') {
    if (!sample.subjectImage) throw new Error('subjectImage is required for clothing-try-on')
    await page.getByRole('tab', { name: /模特试穿/i }).click()
    await setFileInputFiles(page, 0, sample.productImages)
    await setFileInputFiles(page, 1, [sample.subjectImage])
  } else {
    await setFileInputFiles(page, 0, sample.productImages)
  }
  await page.getByText(sample.generationType || '白底精修图', { exact: false }).first().click()
  if (sample.requirements) await page.locator('textarea').first().fill(sample.requirements)
  await maybeSelectOutputLanguage(page, sample, isZh)
}

async function clickGenerateForFlow(page: Page, flowId: TaProFlowId) {
  if (flowId === 'genesis' || flowId === 'ecom-detail') {
    await page.getByRole('button', { name: /确认生成|Generate/i }).first().click()
    return
  }
  if (flowId === 'aesthetic-single' || flowId === 'aesthetic-batch') {
    await page.getByRole('button', { name: /生成 .*详情图|Generate .*Detail Image|开始复刻风格/i }).first().click()
    return
  }
  if (flowId === 'refinement') {
    await page.getByRole('button', { name: /开始精修|Start Refinement/i }).first().click()
    return
  }
  if (flowId === 'clothing-basic' || flowId === 'clothing-try-on') {
    await page.getByRole('button', { name: /^生成图片$/ }).click()
  }
}

async function clickAnalyzeForClothing(page: Page) {
  await page.getByRole('button', { name: /分析产品/i }).click()
  await expect(page.getByRole('button', { name: /^生成图片$/ })).toBeVisible({ timeout: 3 * 60_000 })
}

async function prepareFlow(page: Page, flow: TaProFlowManifest, sample: TaProSampleManifest, isZh: boolean) {
  await selectTaProModel(page, isZh)
  if (flow.id === 'genesis') {
    await prepareGenesis(page, sample, isZh)
    return
  }
  if (flow.id === 'ecom-detail') {
    await prepareEcom(page, sample, isZh)
    return
  }
  if (flow.id === 'aesthetic-single' || flow.id === 'aesthetic-batch') {
    await prepareAesthetic(page, flow.id, sample)
    return
  }
  if (flow.id === 'refinement') {
    await prepareRefinement(page, sample, isZh)
    return
  }
  await prepareClothing(page, flow.id, sample, isZh)
  await clickAnalyzeForClothing(page)
}

function evaluateOcr(sample: TaProSampleManifest, textItems: string[]): string {
  const actualText = textItems.join('\n').trim()
  if (sample.ocr.mode === 'exact-match') {
    if (normalizeWhitespace(actualText) !== normalizeWhitespace(sample.ocr.expectedText)) {
      throw new Error(`OCR mismatch. Expected "${sample.ocr.expectedText}", got "${actualText}"`)
    }
    return actualText
  }

  const allowed = (sample.ocr.allowedTexts ?? []).map(normalizeWhitespace)
  const normalizedActual = normalizeWhitespace(actualText)
  const passes = normalizedActual.length === 0 || allowed.includes(normalizedActual)
  if (!passes) {
    throw new Error(`OCR should be empty or allowed text, got "${actualText}"`)
  }
  return actualText
}

function evaluateManualReview(sample: TaProSampleManifest) {
  if (sample.manualReview.status !== 'pass') {
    throw new Error(`Manual review status is ${sample.manualReview.status}`)
  }
}

export async function runFlowSample(
  page: Page,
  api: TaProApiClient,
  flow: TaProFlowManifest,
  sample: TaProSampleManifest,
  testInfo: TestInfo,
  manifestLocale: 'zh' | 'en',
): Promise<SampleRunResult> {
  const env = getTaProEnv()
  const isZh = manifestLocale === 'zh'
  const recorder = attachFunctionRecorder(page)
  const route = flow.route || flowRoute(flow.id)
  const screenshotPath = testInfo.outputPath(`${flow.id}-${sample.id}.png`)
  let ocrResult = ''

  try {
    await page.goto(`/${manifestLocale}${route}`, { waitUntil: 'networkidle' })
    const initialRemoteImageCount = await countRemoteImages(page)

    await prepareFlow(page, flow, sample, isZh)
    await clickGenerateForFlow(page, flow.id)

    const traceIds = extractTraceIds(recorder.calls)
    const jobs = await api.waitForTraceIds(traceIds)

    assertFrontendPromptProfile(recorder.calls)
    assertOneKilobyteImageSize(recorder.calls)

    const promptProfiles = Array.from(new Set(jobs.flatMap(extractPromptProfile)))
    if (promptProfiles.length !== 1 || promptProfiles[0] !== 'ta-pro') {
      throw new Error(`Expected persisted prompt_profile=ta-pro, got ${promptProfiles.join(', ') || 'none'}`)
    }

    const resultUrls = extractResultUrls(jobs)
    if (resultUrls.length === 0) throw new Error('No generated result URLs were found')

    const ocrTexts = await api.runOcr(resultUrls[0])
    ocrResult = evaluateOcr(sample, ocrTexts)
    evaluateManualReview(sample)

    await expect.poll(() => countRemoteImages(page), {
      timeout: 2 * 60_000,
      message: 'expected rendered result images to appear',
    }).toBeGreaterThan(initialRemoteImageCount)

    await page.screenshot({ path: screenshotPath, fullPage: true })

    return {
      flowId: flow.id,
      sampleId: sample.id,
      kind: sample.kind,
      promptProfile: 'ta-pro',
      jobIds: jobs.map((job) => job.id),
      screenshotPath,
      ocrResult,
      manualReview: sample.manualReview.status,
      manualReviewNotes: sample.manualReview.notes ?? '',
      finalStatus: 'pass',
      failureReason: '',
    }
  } catch (error) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
    return {
      flowId: flow.id,
      sampleId: sample.id,
      kind: sample.kind,
      promptProfile: 'ta-pro',
      jobIds: [],
      screenshotPath,
      ocrResult,
      manualReview: sample.manualReview.status,
      manualReviewNotes: sample.manualReview.notes ?? '',
      finalStatus: 'fail',
      failureReason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    recorder.dispose()
    mkdirSync(dirname(env.reportPath), { recursive: true })
  }
}

export class TaProReportCollector {
  private readonly entries: SampleRunResult[] = []

  add(entry: SampleRunResult) {
    this.entries.push(entry)
  }

  async writeReport(manifest: TaProManifest) {
    const env = getTaProEnv()
    mkdirSync(dirname(env.reportPath), { recursive: true })
    const allPassed = this.entries.length > 0 && this.entries.every((entry) => entry.finalStatus === 'pass')
    const lines = [
      '# TA Pro Production Test Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Overall: ${allPassed ? 'PASS' : 'FAIL'}`,
      `Prompt profile: ta-pro`,
      `Locale: ${manifest.locale ?? env.locale}`,
      '',
      '| Sample ID | Flow | Job IDs | Prompt Profile | Screenshot | OCR Result | Manual Review | Final |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...this.entries.map((entry) => {
        const jobIds = entry.jobIds.join(', ') || '-'
        const ocr = entry.ocrResult.replace(/\n/g, '<br/>') || '-'
        const review = entry.manualReviewNotes
          ? `${entry.manualReview} (${entry.manualReviewNotes})`
          : entry.manualReview
        const final = entry.finalStatus === 'pass'
          ? 'pass'
          : `fail: ${entry.failureReason.replace(/\|/g, '\\|')}`
        return `| ${entry.sampleId} | ${entry.flowId} | ${jobIds} | ${entry.promptProfile} | ${entry.screenshotPath} | ${ocr} | ${review} | ${final} |`
      }),
      '',
    ]

    writeFileSync(env.reportPath, lines.join('\n'), 'utf8')
  }
}
