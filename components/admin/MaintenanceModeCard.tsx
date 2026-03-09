'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

type MaintenanceModeCardProps = {
  locale: string
  initialEnabled: boolean
  initialUpdatedAt: string | null
  initialUpdatedBy: string | null
}

type MaintenanceState = {
  enabled: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export default function MaintenanceModeCard({
  locale,
  initialEnabled,
  initialUpdatedAt,
  initialUpdatedBy,
}: MaintenanceModeCardProps) {
  const isZh = locale === 'zh'
  const router = useRouter()
  const [state, setState] = useState<MaintenanceState>({
    enabled: initialEnabled,
    updatedAt: initialUpdatedAt,
    updatedBy: initialUpdatedBy,
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [isZh],
  )

  const statusLabel = state.enabled
    ? (isZh ? '维护已开启' : 'Maintenance On')
    : (isZh ? '维护已关闭' : 'Maintenance Off')
  const buttonLabel = isSaving
    ? (isZh ? '处理中...' : 'Updating...')
    : state.enabled
      ? (isZh ? '一键恢复访问' : 'Resume Public Access')
      : (isZh ? '一键开启维护' : 'Enable Maintenance')

  async function toggleMaintenance() {
    setErrorMessage(null)
    const nextEnabled = !state.enabled

    setIsSaving(true)

    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: nextEnabled }),
      })

      if (!response.ok) {
        throw new Error(`REQUEST_FAILED_${response.status}`)
      }

      const nextState = await response.json() as MaintenanceState
      setState(nextState)
      router.refresh()
    } catch {
      setErrorMessage(
        isZh
          ? '维护状态更新失败，请刷新后重试。'
          : 'Failed to update maintenance mode. Refresh and try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-border bg-background p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-foreground">
              {isZh ? '站点维护开关' : 'Site Maintenance'}
            </h2>
            <span
              className={[
                'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold',
                state.enabled
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
              ].join(' ')}
            >
              {statusLabel}
            </span>
          </div>

          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {isZh
              ? '开启后，普通用户会统一看到维护提示页，管理员账号仍可正常进入后台和站点。'
              : 'When enabled, all public visitors are redirected to the maintenance page while admin accounts keep access to the site and dashboard.'}
          </p>

          <p className="text-xs text-muted-foreground">
            {state.updatedAt
              ? `${isZh ? '最近更新' : 'Last updated'}: ${formatter.format(new Date(state.updatedAt))}${state.updatedBy ? ` · ${state.updatedBy}` : ''}`
              : (isZh ? '还没有维护记录。' : 'No maintenance updates yet.')}
          </p>

          {errorMessage ? (
            <p className="text-sm font-medium text-destructive" role="status">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggleMaintenance}
          disabled={isSaving}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-2xl px-5 text-sm font-semibold transition-colors',
            state.enabled
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'bg-amber-500 text-slate-950 hover:bg-amber-400',
            isSaving ? 'cursor-not-allowed opacity-70' : '',
          ].join(' ')}
        >
          {buttonLabel}
        </button>
      </div>
    </section>
  )
}
