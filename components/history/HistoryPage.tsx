'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { AlertCircle, Download, ExternalLink, Image as ImageIcon, Loader2, Pencil, CheckSquare, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createEditorSession } from '@/lib/utils/editor-session'
import { useResultAssetSession } from '@/lib/hooks/useResultAssetSession'
import { createResultAsset, extractResultAssetMetadata } from '@/lib/utils/result-assets'
import type { GenerationJob, JobStatus, JobType, ResultAsset, ResultAssetSection } from '@/types'

const PAGE_SIZE = 12

type HistoryJobRow = Pick<
  GenerationJob,
  'id' | 'type' | 'status' | 'payload' | 'result_data' | 'result_url' | 'error_message' | 'created_at'
>

interface HistoryAsset {
  id: string
  jobId: string
  type: JobType
  status: JobStatus
  url: string | null
  prompt: string | null
  createdAt: string | number
  errorMessage: string | null
  section: ResultAssetSection
  sourceAssetId?: string
  requestedSize?: string
  providerSize?: string
  actualSize?: string
  deliveredSize?: string
  sizeStatus?: ResultAsset['sizeStatus']
  normalizedByServer?: boolean
  retentionExpired?: boolean
  retentionDays?: number
}

interface HistoryPolicy {
  isPaidUser: boolean
  freeRetentionDays: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toDataUrlIfNeeded(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:')) return trimmed
  return `data:image/png;base64,${trimmed}`
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

function extractPrompt(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const prompt = payload.prompt
  if (typeof prompt !== 'string') return null
  const trimmed = prompt.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractResultUrls(row: HistoryJobRow): string[] {
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

function mapJobToAssets(row: HistoryJobRow): HistoryAsset[] {
  const urls = extractResultUrls(row)
  const prompt = extractPrompt(row.payload)
  const metadata = extractResultAssetMetadata(row.result_data)
  const retentionExpired = isRecord(row.result_data) && typeof row.result_data.retention_deleted_at === 'string'
  const retentionDays = isRecord(row.result_data) && typeof row.result_data.retention_days === 'number'
    ? row.result_data.retention_days
    : undefined
  if (urls.length > 0) {
    return urls.map((url, index) => ({
      id: `${row.id}_${index}`,
      jobId: row.id,
      type: row.type,
      status: row.status,
      url,
      prompt,
      createdAt: row.created_at,
      errorMessage: row.error_message,
      section: 'original',
      retentionExpired,
      retentionDays,
      ...metadata,
    }))
  }

  return [{
    id: `${row.id}_empty`,
    jobId: row.id,
    type: row.type,
    status: row.status,
    url: null,
    prompt,
    createdAt: row.created_at,
    errorMessage: row.error_message,
    section: 'original',
    retentionExpired,
    retentionDays,
    ...metadata,
  }]
}

function mapResultAssetToHistoryAsset(asset: ResultAsset): HistoryAsset {
  return {
    id: asset.id,
    jobId: asset.sourceAssetId ?? asset.id,
    type: 'IMAGE_GEN',
    status: 'success',
    url: asset.url,
    prompt: null,
    createdAt: asset.createdAt,
    errorMessage: null,
    section: asset.section,
    sourceAssetId: asset.sourceAssetId,
    requestedSize: asset.requestedSize,
    providerSize: asset.providerSize,
    actualSize: asset.actualSize,
    deliveredSize: asset.deliveredSize,
    sizeStatus: asset.sizeStatus,
    normalizedByServer: asset.normalizedByServer,
  }
}

function mapHistoryAssetToResultAsset(asset: HistoryAsset): ResultAsset | null {
  if (!asset.url) return null
  return createResultAsset({
    id: asset.id,
    url: asset.url,
    section: asset.section,
    sourceAssetId: asset.sourceAssetId,
    createdAt: typeof asset.createdAt === 'number' ? asset.createdAt : new Date(asset.createdAt).getTime(),
    originModule: 'history',
    requestedSize: asset.requestedSize,
    providerSize: asset.providerSize,
    actualSize: asset.actualSize,
    deliveredSize: asset.deliveredSize,
    sizeStatus: asset.sizeStatus,
    normalizedByServer: asset.normalizedByServer,
  })
}

export function HistoryPage() {
  const t = useTranslations('history')
  const tEditor = useTranslations('studio.editor')
  const locale = useLocale()
  const router = useRouter()
  const { assets: localAssets, clearAssets: clearLocalAssets } = useResultAssetSession('history')
  const [items, setItems] = useState<HistoryAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [policy, setPolicy] = useState<HistoryPolicy | null>(null)

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }), [locale])
  const displayItems = useMemo(() => {
    const merged = [...items]
    const existingIds = new Set(merged.map((item) => item.id))
    for (const asset of localAssets.map(mapResultAssetToHistoryAsset)) {
      if (existingIds.has(asset.id)) continue
      existingIds.add(asset.id)
      merged.push(asset)
    }
    return merged
  }, [items, localAssets])
  const originalItems = useMemo(
    () => displayItems.filter((item) => item.section !== 'edited'),
    [displayItems],
  )
  const editedItems = useMemo(
    () => [...displayItems.filter((item) => item.section === 'edited')]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [displayItems],
  )

  const fetchPage = useCallback(async (nextPage: number, append: boolean) => {
    const res = await fetch(`/api/history?page=${nextPage}&pageSize=${PAGE_SIZE}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-store',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `HISTORY_FETCH_FAILED_${res.status}`)
    }
    const payload = (await res.json()) as { rows?: HistoryJobRow[]; hasMore?: boolean; policy?: HistoryPolicy }
    const rows = payload.rows ?? []
    const mapped = rows.flatMap(mapJobToAssets)

    setPolicy(payload.policy ?? null)
    setItems((prev) => append ? [...prev, ...mapped] : mapped)
    setHasMore(Boolean(payload.hasMore))
    setPage(nextPage)
  }, [])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await fetchPage(0, false)
    } catch (e) {
      setError((e as Error).message ?? t('loadError'))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [fetchPage, t])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setError(null)
    try {
      await fetchPage(page + 1, true)
    } catch (e) {
      setError((e as Error).message ?? t('loadError'))
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage, hasMore, loadingMore, page, t])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  const handleDownload = useCallback(async (item: HistoryAsset) => {
    if (!item.url) return
    try {
      setDownloadingId(item.id)
      const res = await fetch(item.url)
      if (!res.ok) throw new Error(`DOWNLOAD_FAILED_${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `shopix-history-${item.jobId}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      setError((e as Error).message ?? t('loadError'))
    } finally {
      setDownloadingId(null)
    }
  }, [t])

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openSelectedInEditor = () => {
    const assets = displayItems
      .filter((item) => selectedIds.has(item.id))
      .map(mapHistoryAssetToResultAsset)
      .filter((item): item is ResultAsset => item !== null)
    if (assets.length === 0) return
    const sid = createEditorSession({
      assets,
      returnSessionKey: 'history',
      originModule: 'history',
    })
    router.push(`/${locale}/image-editor?sid=${sid}`)
  }

  const openSingleInEditor = (item: HistoryAsset) => {
    const asset = mapHistoryAssetToResultAsset(item)
    if (!asset) return
    const sid = createEditorSession({
      assets: [asset],
      returnSessionKey: 'history',
      originModule: 'history',
    })
    router.push(`/${locale}/image-editor?sid=${sid}`)
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const statusLabel = (status: JobStatus) => t(`status.${status}` as Parameters<typeof t>[0])
  const typeLabel = (type: JobType) => t(`type.${type}` as Parameters<typeof t>[0])
  const renderItems = (sectionItems: HistoryAsset[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {sectionItems.map((item) => (
        <div
          key={item.id}
          className="group overflow-hidden rounded-2xl border border-border bg-background"
          onClick={() => selectionMode && item.url && toggleSelection(item.id)}
        >
          <div className="relative aspect-[3/4] overflow-hidden bg-muted">
            {item.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt={t('imageAlt')}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <ImageIcon className="h-7 w-7" />
                <p className="mt-2 px-3 text-center text-xs">
                  {item.retentionExpired
                    ? t('expiredImage', { days: item.retentionDays ?? policy?.freeRetentionDays ?? 3 })
                    : t('noImage')}
                </p>
              </div>
            )}

            {selectionMode && item.url && (
              <div className="absolute left-2 top-2">
                {selectedIds.has(item.id) ? (
                  <CheckSquare className="h-6 w-6 text-accent drop-shadow" />
                ) : (
                  <Square className="h-6 w-6 text-white drop-shadow" />
                )}
              </div>
            )}

            {!selectionMode && item.url && (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); openSingleInEditor(item) }}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/60"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-2 p-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-md bg-secondary px-2 py-1 text-muted-foreground">{typeLabel(item.type)}</span>
              <span className="rounded-md bg-secondary px-2 py-1 text-muted-foreground">{statusLabel(item.status)}</span>
            </div>

            <p className="text-xs text-muted-foreground">{formatter.format(new Date(item.createdAt))}</p>

            {item.prompt && (
              <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{item.prompt}</p>
            )}

            {item.errorMessage && (
              <p className="line-clamp-2 text-xs leading-5 text-destructive">{item.errorMessage}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              {item.url && !selectionMode && (
                <>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('open')}
                    </Button>
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={(event) => { event.stopPropagation(); openSingleInEditor(item) }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={(event) => { event.stopPropagation(); void handleDownload(item) }}
                disabled={!item.url || downloadingId === item.id}
              >
                {downloadingId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {t('download')}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        {displayItems.length > 0 && !loading && (
          <Button
            variant={selectionMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
            className="gap-1.5"
          >
            {selectionMode ? (
              <>
                <X className="h-3.5 w-3.5" />
                {tEditor('quickEditCancel')}
              </>
            ) : (
              <>
                <CheckSquare className="h-3.5 w-3.5" />
                {t('select')}
              </>
            )}
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('loading')}</span>
        </div>
      )}

      {!loading && policy && !policy.isPaidUser && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{t('freeRetentionTitle', { days: policy.freeRetentionDays })}</p>
              <p className="text-amber-900/80">{t('freeRetentionBody', { days: policy.freeRetentionDays })}</p>
            </div>
          </div>
        </div>
      )}

      {!loading && displayItems.length === 0 && (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={loadInitial}>
            {t('retry')}
          </Button>
        </div>
      )}

      {displayItems.length > 0 && (
        <div className="space-y-6">
          {originalItems.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-muted-foreground">{tEditor('originalSection')}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              {renderItems(originalItems)}
            </section>
          )}
          {editedItems.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-muted-foreground">{tEditor('editedSection')}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              {renderItems(editedItems)}
            </section>
          )}
          {editedItems.length > 0 && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={clearLocalAssets}>
                {locale === 'zh' ? '清除修改图' : 'Clear Edited'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Selection bar */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-border bg-background px-5 py-3 shadow-2xl">
          <span className="text-sm font-medium text-foreground">
            {t('selectedCount', { count: selectedIds.size })}
          </span>
          <Button size="sm" onClick={openSelectedInEditor} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            {t('openInEditor')}
          </Button>
          <Button variant="outline" size="sm" onClick={exitSelectionMode}>
            {tEditor('quickEditCancel')}
          </Button>
        </div>
      )}

      {hasMore && originalItems.length > 0 && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
