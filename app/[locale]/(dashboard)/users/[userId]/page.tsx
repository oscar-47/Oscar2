import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSupportEmailCard } from '@/components/admin/AdminSupportEmailCard'
import { formatJobDisplaySemantics, getJobDisplaySemantics } from '@/lib/job-display'
import { isAdminUser } from '@/types'

type SearchParamValue = string | string[] | undefined

type UserHistorySearchParams = {
  page?: SearchParamValue
  type?: SearchParamValue
  status?: SearchParamValue
}

type UserProfileRow = {
  id: string
  email: string | null
  created_at: string
  subscription_plan: string | null
  subscription_status: string | null
  subscription_credits: number
  purchased_credits: number
}

type UserHistoryJobRow = {
  id: string
  type: 'ANALYSIS' | 'IMAGE_GEN' | 'STYLE_REPLICATE'
  status: 'processing' | 'success' | 'failed'
  payload: Record<string, unknown> | null
  result_data: unknown | null
  result_url: string | null
  error_message: string | null
  cost_amount: number
  created_at: string
}

type UserHistoryCard = {
  id: string
  type: UserHistoryJobRow['type']
  status: UserHistoryJobRow['status']
  businessModuleLabel: string
  detailLabel: string
  prompt: string | null
  resultUrls: string[]
  errorMessage: string | null
  costAmount: number
  createdAt: string
  inputImages: UserHistoryInputImage[]
}

type UserHistoryInputImage = {
  key: string
  url: string
  index?: number
}

const ADMIN_DISPLAY_TIME_ZONE = 'Asia/Hong_Kong'
const HISTORY_PAGE_SIZE = 12
const ADMIN_HISTORY_TYPES = ['ANALYSIS', 'IMAGE_GEN', 'STYLE_REPLICATE'] as const

function readSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value
}

function parsePageParam(page: string | undefined) {
  const parsed = Number(page)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function normalizeEnumParam<T extends string>(value: SearchParamValue, allowed: readonly T[]) {
  const text = readSearchParam(value)?.trim()
  return text && allowed.includes(text as T) ? (text as T) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function resolveAssetUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  if (!base) return trimmed

  if (trimmed.startsWith('/storage/v1/object/')) return `${base}${trimmed}`

  const normalized = trimmed.replace(/^\/+/, '')
  if (normalized.startsWith('generations/')) {
    return `${base}/storage/v1/object/public/${normalized}`
  }

  return trimmed
}

function toDataUrlIfNeeded(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:')) return trimmed
  return `data:image/png;base64,${trimmed}`
}

function normalizeStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractPrompt(payload: Record<string, unknown> | null): string | null {
  const prompt = payload?.prompt
  return normalizeStringValue(prompt)
}

function extractResultUrls(row: Pick<UserHistoryJobRow, 'result_url' | 'result_data'>): string[] {
  const urls = new Set<string>()

  const pushUrl = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    urls.add(resolveAssetUrl(trimmed))
  }

  const pushBase64 = (value: unknown) => {
    const dataUrl = toDataUrlIfNeeded(value)
    if (dataUrl) urls.add(dataUrl)
  }

  pushUrl(row.result_url)

  if (!isRecord(row.result_data)) return Array.from(urls)

  pushBase64(row.result_data.b64_json)

  const outputs = row.result_data.outputs
  if (Array.isArray(outputs)) {
    for (const output of outputs) {
      if (!isRecord(output)) continue
      pushUrl(output.url)
      pushBase64(output.b64_json)
    }
  }

  return Array.from(urls)
}

function humanizeValue(value: string | null, fallback: string) {
  if (!value) return fallback
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function collectInputImages(payload: Record<string, unknown> | null): UserHistoryInputImage[] {
  if (!payload) return []

  const images: UserHistoryInputImage[] = []
  const seen = new Set<string>()

  const pushImage = (key: string, value: unknown, index?: number) => {
    const raw = normalizeStringValue(value) ?? toDataUrlIfNeeded(value)
    if (!raw) return
    const url = resolveAssetUrl(raw)
    if (seen.has(url)) return
    seen.add(url)
    images.push({ key, url, index })
  }

  pushImage('productImage', payload.productImage)
  pushImage('referenceImage', payload.referenceImage)
  pushImage('originalImage', payload.originalImage)
  pushImage('modelImage', payload.modelImage)

  if (Array.isArray(payload.productImages)) {
    payload.productImages.forEach((value, index) => pushImage('productImages', value, index + 1))
  }
  if (Array.isArray(payload.referenceImages)) {
    payload.referenceImages.forEach((value, index) => pushImage('referenceImages', value, index + 1))
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : null
  pushImage('metadataOriginalImage', metadata?.original_image_url)

  return images
}

function formatInputImageLabel(image: UserHistoryInputImage, isZh: boolean) {
  const suffix = image.index ? ` ${image.index}` : ''
  switch (image.key) {
    case 'productImage':
      return isZh ? '产品图' : 'Product Image'
    case 'productImages':
      return `${isZh ? '产品图' : 'Product Image'}${suffix}`
    case 'referenceImage':
      return isZh ? '参考图' : 'Reference Image'
    case 'referenceImages':
      return `${isZh ? '参考图' : 'Reference Image'}${suffix}`
    case 'originalImage':
      return isZh ? '原图' : 'Original Image'
    case 'modelImage':
      return isZh ? '模特图' : 'Model Image'
    case 'metadataOriginalImage':
      return isZh ? '元数据原图' : 'Metadata Original Image'
    default:
      return `${humanizeValue(image.key, image.key)}${suffix}`
  }
}

function formatSubscriptionPlanName(plan: string | null, isZh: boolean) {
  if (!plan) return isZh ? '免费' : 'Free'

  switch (plan) {
    case 'monthly':
      return isZh ? '月付' : 'Monthly'
    case 'quarterly':
      return isZh ? '季付' : 'Quarterly'
    case 'yearly':
      return isZh ? '年付' : 'Yearly'
    default:
      return plan
  }
}

function formatSubscriptionStatusName(status: string | null, isZh: boolean) {
  if (!status) return ''

  switch (status) {
    case 'active':
      return isZh ? '有效' : 'Active'
    case 'trialing':
      return isZh ? '试用中' : 'Trialing'
    case 'past_due':
      return isZh ? '已逾期' : 'Past Due'
    case 'canceled':
      return isZh ? '已取消' : 'Canceled'
    case 'incomplete':
      return isZh ? '未完成' : 'Incomplete'
    case 'unpaid':
      return isZh ? '未支付' : 'Unpaid'
    default:
      return status
  }
}

function formatPlanCellValue(profile: UserProfileRow, isZh: boolean) {
  const planName = formatSubscriptionPlanName(profile.subscription_plan, isZh)
  const statusName = formatSubscriptionStatusName(profile.subscription_status, isZh)
  return statusName ? `${planName} / ${statusName}` : planName
}

function getTotalCredits(profile: UserProfileRow) {
  return (profile.subscription_credits ?? 0) + (profile.purchased_credits ?? 0)
}

function buildUserHistoryHref(
  locale: string,
  userId: string,
  page: number,
  filters: { type: string; status: string }
) {
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  if (filters.type) params.set('type', filters.type)
  if (filters.status) params.set('status', filters.status)

  const query = params.toString()
  return query ? `/${locale}/users/${userId}?${query}` : `/${locale}/users/${userId}`
}

function applyHistoryFilters(query: any, filters: { type: string; status: string }) {
  let nextQuery = query
  if (filters.type) nextQuery = nextQuery.eq('type', filters.type)
  if (filters.status) nextQuery = nextQuery.eq('status', filters.status)
  return nextQuery
}

function mapJobToCard(
  row: UserHistoryJobRow,
  translate: (key: string) => string,
): UserHistoryCard {
  const payload = row.payload && isRecord(row.payload) ? row.payload : null
  const displaySemantics = getJobDisplaySemantics({
    type: row.type,
    payload: row.payload,
    resultData: row.result_data,
  })
  const semantics = formatJobDisplaySemantics(displaySemantics, translate)

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    businessModuleLabel: semantics.businessModuleLabel,
    detailLabel: semantics.detailLabel,
    prompt: extractPrompt(payload),
    resultUrls: extractResultUrls(row),
    errorMessage: row.error_message,
    costAmount: row.cost_amount,
    createdAt: row.created_at,
    inputImages: collectInputImages(payload),
  }
}

export default async function AdminUserHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; userId: string }>
  searchParams: Promise<UserHistorySearchParams>
}) {
  const { locale, userId } = await params
  const resolvedSearchParams = await searchParams
  const isZh = locale === 'zh'
  const tHistory = await getTranslations({ locale, namespace: 'history' })
  const requestedPage = parsePageParam(readSearchParam(resolvedSearchParams.page))
  const filters = {
    type: normalizeEnumParam(readSearchParam(resolvedSearchParams.type), ADMIN_HISTORY_TYPES),
    status: normalizeEnumParam(readSearchParam(resolvedSearchParams.status), ['processing', 'success', 'failed'] as const),
  }

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const viewer = session?.user ?? null

  if (!viewer) {
    redirect(`/${locale}/auth`)
  }

  if (!isAdminUser(viewer.email)) {
    redirect(`/${locale}/ecom-studio`)
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, email, created_at, subscription_plan, subscription_status, subscription_credits, purchased_credits')
    .eq('id', userId)
    .single()

  if (profileError) {
    notFound()
  }

  let totalJobs = 0
  let successJobs = 0
  let failedJobs = 0
  let processingJobs = 0
  let currentPage = 1
  let totalPages = 1
  let historyCards: UserHistoryCard[] = []
  let historyError: string | null = null

  try {
    const baseCountQuery = () =>
      admin
        .from('generation_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('type', [...ADMIN_HISTORY_TYPES])

    const [allCountResult, successCountResult, failedCountResult, processingCountResult] = await Promise.all([
      baseCountQuery(),
      baseCountQuery().eq('status', 'success'),
      baseCountQuery().eq('status', 'failed'),
      baseCountQuery().eq('status', 'processing'),
    ])

    const countError =
      allCountResult.error ??
      successCountResult.error ??
      failedCountResult.error ??
      processingCountResult.error

    if (countError) {
      historyError = countError.message
    } else {
      totalJobs = allCountResult.count ?? 0
      successJobs = successCountResult.count ?? 0
      failedJobs = failedCountResult.count ?? 0
      processingJobs = processingCountResult.count ?? 0

      let jobsQuery = admin
        .from('generation_jobs')
        .select('id, type, status, payload, result_data, result_url, error_message, cost_amount, created_at')
        .eq('user_id', userId)
        .in('type', [...ADMIN_HISTORY_TYPES])
        .order('created_at', { ascending: false })

      jobsQuery = applyHistoryFilters(jobsQuery, filters)

      const filteredCountResult = await applyHistoryFilters(
        admin
          .from('generation_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('type', [...ADMIN_HISTORY_TYPES]),
        filters
      )

      if (filteredCountResult.error) {
        historyError = filteredCountResult.error.message
      } else {
        let filteredTotalJobs = filteredCountResult.count ?? 0

        if (!historyError) {
          totalPages = Math.max(1, Math.ceil(filteredTotalJobs / HISTORY_PAGE_SIZE))
          currentPage = Math.min(requestedPage, totalPages)

          const from = (currentPage - 1) * HISTORY_PAGE_SIZE
          const to = from + HISTORY_PAGE_SIZE - 1

          const jobsResult = await jobsQuery.range(from, to)
          if (jobsResult.error) {
            historyError = jobsResult.error.message
          } else {
            historyCards = ((jobsResult.data ?? []) as UserHistoryJobRow[]).map((row) => mapJobToCard(row, tHistory))
          }
        }
      }
    }
  } catch (error) {
    historyError = error instanceof Error ? error.message : 'History unavailable'
  }

  const formatter = new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ADMIN_DISPLAY_TIME_ZONE,
  })

  const visibleStart = historyCards.length === 0 ? 0 : (currentPage - 1) * HISTORY_PAGE_SIZE + 1
  const visibleEnd = historyCards.length === 0 ? 0 : visibleStart + historyCards.length - 1
  const profileRow = profile as UserProfileRow

  return (
    <div className="mx-auto w-full max-w-[110rem] px-5 py-8 sm:px-6">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Link
            href={`/${locale}/users`}
            className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {isZh ? '返回用户列表' : 'Back to Users'}
          </Link>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {isZh ? '管理员用户历史' : 'Admin User History'}
          </p>
          <h1 className="break-all text-3xl font-bold tracking-tight text-foreground">
            {profileRow.email ?? profileRow.id}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isZh
              ? '查看这个用户的生图历史、prompt、模型和输出结果，用来快速判断生成质量。'
              : 'Review this user’s generation history, prompts, models, and outputs to assess result quality.'}
          </p>
        </div>
        <div className="grid gap-2 text-sm text-muted-foreground sm:text-right">
          <div>{isZh ? '用户 ID' : 'User ID'}: <span className="font-mono text-xs text-foreground">{profileRow.id}</span></div>
          <div>{isZh ? '注册时间' : 'Created'}: <span className="text-foreground">{formatter.format(new Date(profileRow.created_at))}</span></div>
          <div>{isZh ? '套餐' : 'Plan'}: <span className="text-foreground">{formatPlanCellValue(profileRow, isZh)}</span></div>
          <div>{isZh ? '总积分' : 'Credits'}: <span className="text-foreground">{getTotalCredits(profileRow)}</span></div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-3xl border border-border bg-background p-5">
          <p className="text-sm text-muted-foreground">{isZh ? '总任务数' : 'Total Jobs'}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">{totalJobs}</p>
        </div>
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-5">
          <p className="text-sm text-emerald-700">{isZh ? '成功' : 'Success'}</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-900">{successJobs}</p>
        </div>
        <div className="rounded-3xl border border-rose-200 bg-rose-50/60 p-5">
          <p className="text-sm text-rose-700">{isZh ? '失败' : 'Failed'}</p>
          <p className="mt-2 text-3xl font-semibold text-rose-900">{failedJobs}</p>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5">
          <p className="text-sm text-amber-700">{isZh ? '处理中' : 'Processing'}</p>
          <p className="mt-2 text-3xl font-semibold text-amber-900">{processingJobs}</p>
        </div>
      </div>

      {profileRow.email ? (
        <AdminSupportEmailCard
          isZh={isZh}
          to={profileRow.email}
        />
      ) : null}

      <form action={`/${locale}/users/${userId}`} className="mt-6 rounded-3xl border border-border bg-background px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {isZh ? '历史筛选' : 'History Filters'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isZh
                ? '优先看成功任务的输出图，失败任务则更适合排查 prompt 或模型问题。'
                : 'Successful jobs help assess output quality, while failed jobs help diagnose prompt or model issues.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              {isZh ? '应用筛选' : 'Apply'}
            </button>
            <Link
              href={`/${locale}/users/${userId}`}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {isZh ? '清空筛选' : 'Clear'}
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isZh ? '任务类型' : 'Job Type'}
            </span>
            <select
              name="type"
              defaultValue={filters.type}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
            >
              <option value="">{isZh ? '全部类型' : 'All types'}</option>
              <option value="ANALYSIS">{isZh ? '分析' : 'Analysis'}</option>
              <option value="IMAGE_GEN">Image Gen</option>
              <option value="STYLE_REPLICATE">Style Replicate</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isZh ? '任务状态' : 'Job Status'}
            </span>
            <select
              name="status"
              defaultValue={filters.status}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
            >
              <option value="">{isZh ? '全部状态' : 'All statuses'}</option>
              <option value="success">{isZh ? '成功' : 'Success'}</option>
              <option value="failed">{isZh ? '失败' : 'Failed'}</option>
              <option value="processing">{isZh ? '处理中' : 'Processing'}</option>
            </select>
          </label>
        </div>
      </form>

      {historyError ? (
        <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {isZh
            ? `用户历史暂时不可用：${historyError}`
            : `User history is temporarily unavailable: ${historyError}`}
        </div>
      ) : null}

      <div className="mt-6">
        {historyCards.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-background px-6 py-12 text-center text-sm text-muted-foreground">
            {isZh ? '这个用户暂时没有匹配的生图记录。' : 'No generation history matches the current filters for this user.'}
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {historyCards.map((card) => (
              <article key={card.id} className="overflow-hidden rounded-3xl border border-border bg-background">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border px-2 py-1 font-medium text-foreground">
                    {card.businessModuleLabel}
                  </span>
                  <span
                    className={[
                      'rounded-full px-2 py-1 font-medium',
                      card.status === 'success'
                        ? 'bg-emerald-100 text-emerald-800'
                        : card.status === 'failed'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800',
                    ].join(' ')}
                  >
                    {card.status === 'success'
                      ? (isZh ? '成功' : 'Success')
                      : card.status === 'failed'
                        ? (isZh ? '失败' : 'Failed')
                        : (isZh ? '处理中' : 'Processing')}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-1 font-medium text-foreground/80">
                    {card.detailLabel}
                  </span>
                  <span className="ml-auto">{formatter.format(new Date(card.createdAt))}</span>
                </div>

                <div className="grid gap-4 p-5">
                  {card.inputImages.length > 0 ? (
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {isZh ? `输入图片 (${card.inputImages.length})` : `Input Images (${card.inputImages.length})`}
                      </p>
                      <div className="flex gap-2 overflow-x-auto">
                        {card.inputImages.map((image, index) => (
                          <a
                            key={`${card.id}_input_${image.key}_${index}`}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group flex-shrink-0 overflow-hidden rounded-xl border border-border bg-muted/30"
                          >
                            <div className="h-20 w-20 overflow-hidden bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={image.url}
                                alt={`${card.id}-input-${index + 1}`}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
                              />
                            </div>
                            <p className="px-1.5 py-1 text-center text-[10px] text-muted-foreground">
                              {formatInputImageLabel(image, isZh)}
                            </p>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {card.prompt ? (
                    <div className="rounded-2xl border border-border bg-background px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Prompt</p>
                      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                        {card.prompt}
                      </p>
                    </div>
                  ) : null}

                  {card.errorMessage ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                      <p className="font-medium">{isZh ? '错误信息' : 'Error Message'}</p>
                      <p className="mt-1 break-words">{card.errorMessage}</p>
                    </div>
                  ) : null}

                  {card.resultUrls.length > 0 ? (
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {isZh ? `输出结果 (${card.resultUrls.length})` : `Outputs (${card.resultUrls.length})`}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {card.resultUrls.map((url, index) => (
                          <a
                            key={`${card.id}_${index}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-2xl border border-border bg-muted/30"
                          >
                            <div className="aspect-[4/5] overflow-hidden bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt={`${card.id}-${index + 1}`}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                              />
                            </div>
                            <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                              <span>{isZh ? `结果 ${index + 1}` : `Output ${index + 1}`}</span>
                              <span className="font-medium text-foreground">{isZh ? '查看大图' : 'Open'}</span>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {!historyError ? (
        <div className="mt-6 flex flex-col gap-3 border-t border-border px-1 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {isZh
              ? `第 ${currentPage} / ${totalPages} 页，每页 ${HISTORY_PAGE_SIZE} 条，当前显示 ${visibleStart}-${visibleEnd}`
              : `Page ${currentPage} of ${totalPages}, ${HISTORY_PAGE_SIZE} per page, showing ${visibleStart}-${visibleEnd}`}
          </p>
          <div className="flex items-center gap-2">
            {currentPage > 1 ? (
              <Link
                href={buildUserHistoryHref(locale, userId, currentPage - 1, filters)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {isZh ? '上一页' : 'Previous'}
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-muted px-3 text-sm font-medium text-muted-foreground">
                {isZh ? '上一页' : 'Previous'}
              </span>
            )}
            {currentPage < totalPages ? (
              <Link
                href={buildUserHistoryHref(locale, userId, currentPage + 1, filters)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {isZh ? '下一页' : 'Next'}
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-muted px-3 text-sm font-medium text-muted-foreground">
                {isZh ? '下一页' : 'Next'}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
