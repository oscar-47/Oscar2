import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import MaintenanceModeCard from '@/components/admin/MaintenanceModeCard'
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
}

function startOfWindow(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const isZh = locale === 'zh'

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (!user) {
    redirect(`/${locale}/auth`)
  }

  if (!isAdminUser(user.email)) {
    redirect(`/${locale}/studio-genesis`)
  }

  const admin = createAdminClient()
  const last24hSince = startOfWindow(24)
  const last7dSince = startOfWindow(24 * 7)

  const [
    recentUsersResult,
    totalUsersResult,
    last24hUsersResult,
    last7dUsersResult,
    maintenanceConfig,
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('id, email, created_at, subscription_plan, subscription_status, subscription_credits, purchased_credits, invite_code, invited_by_user_id')
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true }),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', last24hSince),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', last7dSince),
    getMaintenanceConfig({ fresh: true }),
  ])

  if (recentUsersResult.error) {
    throw new Error(recentUsersResult.error.message)
  }

  if (totalUsersResult.error) {
    throw new Error(totalUsersResult.error.message)
  }

  if (last24hUsersResult.error) {
    throw new Error(last24hUsersResult.error.message)
  }

  if (last7dUsersResult.error) {
    throw new Error(last7dUsersResult.error.message)
  }

  const users = (recentUsersResult.data ?? []) as UserRow[]
  const totalUsers = totalUsersResult.count ?? 0
  const usersLast24h = last24hUsersResult.count ?? 0
  const usersLast7d = last7dUsersResult.count ?? 0

  const formatter = new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6">
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
              ? '展示最近 100 个注册账号，数据来自 public.profiles。'
              : 'Shows the latest 100 registered accounts from public.profiles.'}
          </p>
        </div>
        <Link
          href={`/${locale}/users`}
          className="inline-flex h-10 items-center justify-center rounded-2xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {isZh ? '刷新' : 'Refresh'}
        </Link>
      </div>

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

      <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-background">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{isZh ? '注册时间' : 'Created'}</th>
                <th className="px-4 py-3 font-medium">{isZh ? '邮箱' : 'Email'}</th>
                <th className="px-4 py-3 font-medium">{isZh ? '总积分' : 'Credits'}</th>
                <th className="px-4 py-3 font-medium">{isZh ? '套餐' : 'Plan'}</th>
                <th className="px-4 py-3 font-medium">{isZh ? '邀请绑定' : 'Invite Bound'}</th>
                <th className="px-4 py-3 font-medium">{isZh ? '邀请码' : 'Invite Code'}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    {isZh ? '还没有用户数据。' : 'No user records yet.'}
                  </td>
                </tr>
              ) : (
                users.map((row) => {
                  const totalCredits = (row.subscription_credits ?? 0) + (row.purchased_credits ?? 0)
                  const plan = row.subscription_plan
                    ? `${row.subscription_plan}${row.subscription_status ? ` / ${row.subscription_status}` : ''}`
                    : (isZh ? '免费' : 'Free')

                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="px-4 py-3 text-foreground">{formatter.format(new Date(row.created_at))}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{row.email ?? '—'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.id}</div>
                      </td>
                      <td className="px-4 py-3 text-foreground">{totalCredits}</td>
                      <td className="px-4 py-3 text-foreground">{plan}</td>
                      <td className="px-4 py-3 text-foreground">
                        {row.invited_by_user_id ? (isZh ? '已绑定' : 'Yes') : (isZh ? '未绑定' : 'No')}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {row.invite_code ?? '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
