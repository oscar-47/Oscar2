import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import AdminModelConfigCard from '@/components/admin/AdminModelConfigCard'
import MaintenanceModeCard from '@/components/admin/MaintenanceModeCard'
import { getAdminImageModelConfigs } from '@/lib/admin-model-config'
import AdminFeedbackPanel from '@/components/admin/AdminFeedbackPanel'
import AdminCreatorReviewPanel from '@/components/admin/AdminCreatorReviewPanel'
import { getMaintenanceConfig } from '@/lib/maintenance'
import { isAdminUser } from '@/types'

type UserRow = {
  id: string
  email: string | null
  created_at: string
  subscription_plan: string | null
  subscription_status: string | null
  subscription_credits: number
  purchased_credits: number
  invite_code: string | null
  invited_by_user_id: string | null
  topup_purchase_count?: number
  topup_credits_total?: number
  latest_topup_plan?: string | null
}

type TransactionRow = {
  user_id: string
  plan: string | null
  status: string
  credits: number
  created_at: string
}

type SearchParamValue = string | string[] | undefined

type UsersSearchParams = {
  tab?: SearchParamValue
  page?: SearchParamValue
  createdFrom?: SearchParamValue
  createdTo?: SearchParamValue
  email?: SearchParamValue
  creditsMin?: SearchParamValue
  creditsMax?: SearchParamValue
  plan?: SearchParamValue
  status?: SearchParamValue
  inviteBound?: SearchParamValue
  inviteCode?: SearchParamValue
}

type UsersFilterState = {
  createdFrom: string
  createdTo: string
  email: string
  creditsMin: string
  creditsMax: string
  plan: string
  status: string
  inviteBound: string
  inviteCode: string
}

function startOfWindow(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

const ADMIN_DISPLAY_TIME_ZONE = 'Asia/Hong_Kong'
const ADMIN_DISPLAY_UTC_OFFSET_HOURS = 8
const USERS_PER_PAGE = 50
const FREE_PLAN_FILTER = '__free__'
const TOPUP_PLAN_FILTER = '__topup__'

function readSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value
}

function parsePageParam(page: string | undefined) {
  const parsed = Number(page)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function normalizeTextParam(value: SearchParamValue) {
  return readSearchParam(value)?.trim() ?? ''
}

function normalizeNumberParam(value: SearchParamValue) {
  const text = normalizeTextParam(value)
  if (!text) return ''
  const parsed = Number(text)
  return Number.isFinite(parsed) ? String(parsed) : ''
}

function getUsersFilterState(searchParams: UsersSearchParams): UsersFilterState {
  return {
    createdFrom: normalizeTextParam(searchParams.createdFrom),
    createdTo: normalizeTextParam(searchParams.createdTo),
    email: normalizeTextParam(searchParams.email),
    creditsMin: normalizeNumberParam(searchParams.creditsMin),
    creditsMax: normalizeNumberParam(searchParams.creditsMax),
    plan: normalizeTextParam(searchParams.plan),
    status: normalizeTextParam(searchParams.status),
    inviteBound: normalizeTextParam(searchParams.inviteBound),
    inviteCode: normalizeTextParam(searchParams.inviteCode),
  }
}

function buildUsersPageHref(locale: string, page: number, filters: UsersFilterState) {
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  if (filters.createdFrom) params.set('createdFrom', filters.createdFrom)
  if (filters.createdTo) params.set('createdTo', filters.createdTo)
  if (filters.email) params.set('email', filters.email)
  if (filters.creditsMin) params.set('creditsMin', filters.creditsMin)
  if (filters.creditsMax) params.set('creditsMax', filters.creditsMax)
  if (filters.plan) params.set('plan', filters.plan)
  if (filters.status) params.set('status', filters.status)
  if (filters.inviteBound) params.set('inviteBound', filters.inviteBound)
  if (filters.inviteCode) params.set('inviteCode', filters.inviteCode)

  const query = params.toString()
  return query ? `/${locale}/users?${query}` : `/${locale}/users`
}

function parseHongKongDateToUtcIso(dateText: string, endExclusive = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null

  const utcDate = new Date(
    Date.UTC(
      year,
      month - 1,
      endExclusive ? day + 1 : day,
      -ADMIN_DISPLAY_UTC_OFFSET_HOURS,
      0,
      0,
      0
    )
  )

  return Number.isNaN(utcDate.getTime()) ? null : utcDate.toISOString()
}

function getTotalCredits(row: UserRow) {
  return (row.subscription_credits ?? 0) + (row.purchased_credits ?? 0)
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

function formatTopupPlanName(plan: string | null, isZh: boolean) {
  if (!plan) return isZh ? '充值' : 'Top-up'

  if (plan.startsWith('topup_')) {
    const amount = plan.slice('topup_'.length)
    return isZh ? `充值包 $${amount}` : `Top-up $${amount}`
  }

  return plan
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

function formatPlanCellValue(row: UserRow, isZh: boolean) {
  if (!row.subscription_plan && (row.topup_purchase_count ?? 0) > 0) {
    const topupName = formatTopupPlanName(row.latest_topup_plan ?? null, isZh)
    return isZh
      ? `${topupName} / 已购 ${row.topup_purchase_count} 次`
      : `${topupName} / ${row.topup_purchase_count} purchase${row.topup_purchase_count === 1 ? '' : 's'}`
  }

  const planName = formatSubscriptionPlanName(row.subscription_plan, isZh)
  const statusName = formatSubscriptionStatusName(row.subscription_status, isZh)
  return statusName ? `${planName} / ${statusName}` : planName
}

function hasActiveFilters(filters: UsersFilterState) {
  return Object.values(filters).some(Boolean)
}

function sortPlanOptions(plans: string[]) {
  const priority = new Map<string, number>([
    [FREE_PLAN_FILTER, 0],
    ['monthly', 1],
    ['quarterly', 2],
    ['yearly', 3],
    [TOPUP_PLAN_FILTER, 4],
  ])

  return [...plans].sort((a, b) => {
    const left = priority.get(a) ?? 999
    const right = priority.get(b) ?? 999
    if (left !== right) return left - right
    return a.localeCompare(b)
  })
}

function sortStatusOptions(statuses: string[]) {
  const priority = new Map<string, number>([
    ['active', 0],
    ['trialing', 1],
    ['past_due', 2],
    ['canceled', 3],
    ['incomplete', 4],
    ['unpaid', 5],
  ])

  return [...statuses].sort((a, b) => {
    const left = priority.get(a) ?? 999
    const right = priority.get(b) ?? 999
    if (left !== right) return left - right
    return a.localeCompare(b)
  })
}

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<UsersSearchParams>
}) {
  const { locale } = await params
  const resolvedSearchParams = await searchParams
  const activeTab = readSearchParam(resolvedSearchParams.tab) || 'users'
  const page = readSearchParam(resolvedSearchParams.page)
  const isZh = locale === 'zh'
  const requestedPage = parsePageParam(page)
  const filters = getUsersFilterState(resolvedSearchParams)
  const createdFromIso = parseHongKongDateToUtcIso(filters.createdFrom)
  const createdToExclusiveIso = parseHongKongDateToUtcIso(filters.createdTo, true)
  const emailFilter = filters.email.toLowerCase()
  const inviteCodeFilter = filters.inviteCode.toLowerCase()
  const creditsMin = filters.creditsMin ? Number(filters.creditsMin) : null
  const creditsMax = filters.creditsMax ? Number(filters.creditsMax) : null
  const filtersActive = hasActiveFilters(filters)

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (!user) {
    redirect(`/${locale}/auth`)
  }

  if (!isAdminUser(user.email)) {
    redirect(`/${locale}/ecom-studio`)
  }

  const last24hSince = startOfWindow(24)
  const last7dSince = startOfWindow(24 * 7)

  let adminDataError: string | null = null
  let users: UserRow[] = []
  let allUsers: UserRow[] = []
  let totalUsers = 0
  let filteredUsersCount = 0
  let usersLast24h = 0
  let usersLast7d = 0
  let currentPage = 1
  let totalPages = 1
  let planOptions: string[] = []
  let statusOptions: string[] = []

  const [maintenanceConfig, adminModelConfigs] = await Promise.all([
    getMaintenanceConfig({ fresh: true }),
    getAdminImageModelConfigs(),
  ])

  try {
    const admin = createAdminClient()
    const [usersResult, transactionsResult] = await Promise.all([
      admin
        .from('profiles')
        .select('id, email, created_at, subscription_plan, subscription_status, subscription_credits, purchased_credits, invite_code, invited_by_user_id')
        .order('created_at', { ascending: false }),
      admin
        .from('transactions')
        .select('user_id, plan, status, credits, created_at')
        .eq('status', 'completed')
        .order('created_at', { ascending: false }),
    ])

    if (usersResult.error || transactionsResult.error) {
      adminDataError = usersResult.error?.message ?? transactionsResult.error?.message ?? null
    } else {
      const topupByUser = new Map<string, { count: number; credits: number; latestPlan: string | null }>()
      for (const row of ((transactionsResult.data ?? []) as TransactionRow[])) {
        if (!row.user_id || !row.plan?.startsWith('topup_')) continue
        const current = topupByUser.get(row.user_id)
        if (current) {
          current.count += 1
          current.credits += row.credits ?? 0
        } else {
          topupByUser.set(row.user_id, {
            count: 1,
            credits: row.credits ?? 0,
            latestPlan: row.plan,
          })
        }
      }

      allUsers = ((usersResult.data ?? []) as UserRow[]).map((row) => {
        const topup = topupByUser.get(row.id)
        return {
          ...row,
          topup_purchase_count: topup?.count ?? 0,
          topup_credits_total: topup?.credits ?? 0,
          latest_topup_plan: topup?.latestPlan ?? null,
        }
      })
      totalUsers = allUsers.length
      usersLast24h = allUsers.filter((row) => row.created_at >= last24hSince).length
      usersLast7d = allUsers.filter((row) => row.created_at >= last7dSince).length
      planOptions = sortPlanOptions(
        Array.from(
          new Set(allUsers.map((row) => {
            if (row.subscription_plan) return row.subscription_plan
            if ((row.topup_purchase_count ?? 0) > 0) return TOPUP_PLAN_FILTER
            return FREE_PLAN_FILTER
          }))
        )
      )
      statusOptions = sortStatusOptions(
        Array.from(
          new Set(allUsers.map((row) => row.subscription_status).filter((value): value is string => Boolean(value)))
        )
      )

      const filteredUsers = allUsers.filter((row) => {
        if (createdFromIso && row.created_at < createdFromIso) return false
        if (createdToExclusiveIso && row.created_at >= createdToExclusiveIso) return false
        if (emailFilter && !(row.email ?? '').toLowerCase().includes(emailFilter)) return false

        const totalCredits = getTotalCredits(row)
        if (creditsMin !== null && totalCredits < creditsMin) return false
        if (creditsMax !== null && totalCredits > creditsMax) return false

        if (filters.plan === FREE_PLAN_FILTER) {
          if (row.subscription_plan || (row.topup_purchase_count ?? 0) > 0) return false
        } else if (filters.plan === TOPUP_PLAN_FILTER) {
          if ((row.topup_purchase_count ?? 0) <= 0) return false
        } else if (filters.plan && row.subscription_plan !== filters.plan) {
          return false
        }

        if (filters.status && (row.subscription_status ?? '') !== filters.status) return false

        if (filters.inviteBound === 'bound' && !row.invited_by_user_id) return false
        if (filters.inviteBound === 'unbound' && row.invited_by_user_id) return false

        if (inviteCodeFilter && !(row.invite_code ?? '').toLowerCase().includes(inviteCodeFilter)) return false

        return true
      })

      filteredUsersCount = filteredUsers.length
      totalPages = Math.max(1, Math.ceil(filteredUsersCount / USERS_PER_PAGE))
      currentPage = Math.min(requestedPage, totalPages)

      const rangeFrom = (currentPage - 1) * USERS_PER_PAGE
      const rangeTo = rangeFrom + USERS_PER_PAGE
      users = filteredUsers.slice(rangeFrom, rangeTo)
    }
  } catch (error) {
    adminDataError = error instanceof Error ? error.message : 'Admin data unavailable'
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
  const visibleStart = users.length === 0 ? 0 : (currentPage - 1) * USERS_PER_PAGE + 1
  const visibleEnd = users.length === 0 ? 0 : visibleStart + users.length - 1

  return (
    <div className="mx-auto w-full max-w-[90rem] px-5 py-8 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {isZh ? '管理员视图' : 'Admin View'}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {isZh ? '新注册用户' : 'New Signups'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isZh
              ? '分页展示 public.profiles 中的全部注册账号，每页 50 条。'
              : 'Shows all registered accounts from public.profiles, 50 per page.'}
          </p>
          <p className="text-xs text-muted-foreground">
            {isZh ? '时间按香港时间（UTC+8）展示。' : 'Times are shown in Hong Kong time (UTC+8).'}
          </p>
        </div>
        <Link
          href={buildUsersPageHref(locale, currentPage, filters)}
          className="inline-flex h-10 items-center justify-center rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {isZh ? '刷新' : 'Refresh'}
        </Link>
      </div>

      <div className="mt-5 flex gap-1 rounded-2xl border border-border bg-muted/40 p-1">
        {[
          { key: 'users', label: isZh ? '用户列表' : 'Users' },
          { key: 'feedback', label: isZh ? '反馈管理' : 'Feedback' },
          { key: 'creator', label: isZh ? '推荐官审核' : 'Creator Review' },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={`/${locale}/users${tab.key === 'users' ? '' : `?tab=${tab.key}`}`}
            className={
              activeTab === tab.key
                ? 'flex-1 rounded-xl bg-background px-4 py-2 text-center text-sm font-semibold text-foreground shadow-sm'
                : 'flex-1 rounded-xl px-4 py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {activeTab === 'feedback' ? (
        <div className="mt-6">
          <AdminFeedbackPanel />
        </div>
      ) : activeTab === 'creator' ? (
        <div className="mt-6">
          <AdminCreatorReviewPanel />
        </div>
      ) : (
      <>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-border bg-background p-5">
          <p className="text-sm text-muted-foreground">{isZh ? '总用户数' : 'Total Users'}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">{totalUsers}</p>
        </div>
        <div className="rounded-3xl border border-border bg-background p-5">
          <p className="text-sm text-muted-foreground">{isZh ? '近 24 小时新增' : 'Last 24 Hours'}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">{usersLast24h}</p>
        </div>
        <div className="rounded-3xl border border-border bg-background p-5">
          <p className="text-sm text-muted-foreground">{isZh ? '近 7 天新增' : 'Last 7 Days'}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">{usersLast7d}</p>
        </div>
      </div>

      <MaintenanceModeCard
        locale={locale}
        initialEnabled={maintenanceConfig.enabled}
        initialUpdatedAt={maintenanceConfig.updatedAt}
        initialUpdatedBy={maintenanceConfig.updatedBy}
      />

      <AdminModelConfigCard
        locale={locale}
        initialConfigs={adminModelConfigs}
      />

      {adminDataError ? (
        <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {isZh
            ? `用户列表暂时不可用：${adminDataError}`
            : `User list is temporarily unavailable: ${adminDataError}`}
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-background">
        <form action={`/${locale}/users`} className="border-b border-border px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {isZh ? '筛选条件' : 'Filters'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh
                  ? '所有筛选都会写入 URL，翻页和刷新会自动保留。'
                  : 'Filters are stored in the URL and stay active across refresh and pagination.'}
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
                href={`/${locale}/users`}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {isZh ? '清空筛选' : 'Clear'}
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isZh ? '注册时间' : 'Created'}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  name="createdFrom"
                  defaultValue={filters.createdFrom}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
                />
                <input
                  type="date"
                  name="createdTo"
                  defaultValue={filters.createdTo}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
                />
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isZh ? '邮箱' : 'Email'}
              </span>
              <input
                type="text"
                name="email"
                defaultValue={filters.email}
                placeholder={isZh ? '输入邮箱关键词' : 'Search email'}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isZh ? '总积分' : 'Credits'}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  name="creditsMin"
                  min="0"
                  step="1"
                  defaultValue={filters.creditsMin}
                  placeholder={isZh ? '最小值' : 'Min'}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30"
                />
                <input
                  type="number"
                  name="creditsMax"
                  min="0"
                  step="1"
                  defaultValue={filters.creditsMax}
                  placeholder={isZh ? '最大值' : 'Max'}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30"
                />
              </div>
            </label>

            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isZh ? '套餐' : 'Plan'}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <select
                  name="plan"
                  defaultValue={filters.plan}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
                >
                  <option value="">{isZh ? '全部套餐' : 'All plans'}</option>
                  {planOptions.map((plan) => (
                    <option key={plan} value={plan}>
                      {plan === FREE_PLAN_FILTER
                        ? formatSubscriptionPlanName(null, isZh)
                        : plan === TOPUP_PLAN_FILTER
                        ? formatTopupPlanName(null, isZh)
                        : formatSubscriptionPlanName(plan, isZh)}
                    </option>
                  ))}
                </select>
                <select
                  name="status"
                  defaultValue={filters.status}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
                >
                  <option value="">{isZh ? '全部状态' : 'All statuses'}</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatSubscriptionStatusName(status, isZh)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isZh ? '邀请绑定' : 'Invite Bound'}
              </span>
              <select
                name="inviteBound"
                defaultValue={filters.inviteBound}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
              >
                <option value="">{isZh ? '全部' : 'All'}</option>
                <option value="bound">{isZh ? '已绑定' : 'Bound'}</option>
                <option value="unbound">{isZh ? '未绑定' : 'Unbound'}</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isZh ? '邀请码' : 'Invite Code'}
              </span>
              <input
                type="text"
                name="inviteCode"
                defaultValue={filters.inviteCode}
                placeholder={isZh ? '输入邀请码关键词' : 'Search invite code'}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {filtersActive
                ? (isZh
                    ? `筛选后 ${filteredUsersCount} / ${totalUsers} 条`
                    : `${filteredUsersCount} of ${totalUsers} users match the current filters`)
                : (isZh ? `共 ${totalUsers} 条记录` : `${totalUsers} total users`)}
            </span>
            {filters.plan ? (
              <span className="rounded-full border border-border px-2 py-1 text-[11px]">
                {isZh ? '套餐已筛选' : 'Plan filtered'}
              </span>
            ) : null}
          </div>
        </form>

        <div className="w-full overflow-x-auto">
          <table className="min-w-[1120px] w-full table-fixed text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-[170px] px-4 py-3 font-medium">{isZh ? '注册时间' : 'Created'}</th>
                <th className="w-[360px] px-4 py-3 font-medium">{isZh ? '邮箱' : 'Email'}</th>
                <th className="w-[120px] px-4 py-3 font-medium">{isZh ? '总积分' : 'Credits'}</th>
                <th className="w-[170px] px-4 py-3 font-medium">{isZh ? '套餐' : 'Plan'}</th>
                <th className="w-[130px] px-4 py-3 font-medium">{isZh ? '邀请绑定' : 'Invite Bound'}</th>
                <th className="w-[170px] px-4 py-3 font-medium">{isZh ? '邀请码' : 'Invite Code'}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    {filtersActive
                      ? (isZh ? '没有匹配当前筛选条件的用户。' : 'No users match the current filters.')
                      : (isZh ? '还没有用户数据。' : 'No user records yet.')}
                  </td>
                </tr>
              ) : (
                users.map((row) => {
                  const totalCredits = getTotalCredits(row)
                  const plan = formatPlanCellValue(row, isZh)

                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-foreground">
                        {formatter.format(new Date(row.created_at))}
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <div className="break-all font-medium text-foreground">{row.email ?? '—'}</div>
                          <div className="mt-1 break-all text-xs text-muted-foreground">{row.id}</div>
                          <Link
                            href={`/${locale}/users/${row.id}`}
                            className="mt-2 inline-flex items-center rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            {isZh ? '查看生图历史' : 'View History'}
                          </Link>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-foreground">{totalCredits}</td>
                      <td className="px-4 py-3 text-foreground break-words">{plan}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-foreground">
                        {row.invited_by_user_id ? (isZh ? '已绑定' : 'Yes') : (isZh ? '未绑定' : 'No')}
                      </td>
                      <td className="break-all px-4 py-3 font-mono text-xs text-muted-foreground">
                        {row.invite_code ?? '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {!adminDataError ? (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {filtersActive
                ? (isZh
                    ? `第 ${currentPage} / ${totalPages} 页，每页 ${USERS_PER_PAGE} 条，当前显示 ${visibleStart}-${visibleEnd} / ${filteredUsersCount}（总计 ${totalUsers}）`
                    : `Page ${currentPage} of ${totalPages}, ${USERS_PER_PAGE} per page, showing ${visibleStart}-${visibleEnd} of ${filteredUsersCount} filtered users (${totalUsers} total)`)
                : (isZh
                    ? `第 ${currentPage} / ${totalPages} 页，每页 ${USERS_PER_PAGE} 条，当前显示 ${visibleStart}-${visibleEnd} / ${totalUsers}`
                    : `Page ${currentPage} of ${totalPages}, ${USERS_PER_PAGE} per page, showing ${visibleStart}-${visibleEnd} of ${totalUsers}`)}
            </p>
            <div className="flex items-center gap-2">
              {currentPage > 1 ? (
                <Link
                  href={buildUsersPageHref(locale, currentPage - 1, filters)}
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
                  href={buildUsersPageHref(locale, currentPage + 1, filters)}
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
      </>
      )}
    </div>
  )
}
