'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AlertCircle, Download, ExternalLink, Image as ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GenerationJob, JobStatus, JobType } from '@/types'

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
  createdAt: string
  errorMessage: string | null
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
  }]
}

export function HistoryPage() {
  const t = useTranslations('history')
  const locale = useLocale()
  const [items, setItems] = useState<HistoryAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }), [locale])

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
    const payload = (await res.json()) as { rows?: HistoryJobRow[]; hasMore?: boolean }
    const rows = payload.rows ?? []
    const mapped = rows.flatMap(mapJobToAssets)

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

  const statusLabel = (status: JobStatus) => t(`status.${status}` as Parameters<typeof t>[0])
  const typeLabel = (type: JobType) => t(`type.${type}` as Parameters<typeof t>[0])

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('loading')}</span>
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#f2c5cb] bg-[#fff2f4] px-4 py-3 text-sm text-[#8d2f39]">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={loadInitial}>
            {t('retry')}
          </Button>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="overflow-hidden rounded-2xl border border-[#d0d4dc] bg-white">
              <div className="relative aspect-[3/4] overflow-hidden bg-[#f1f3f6]">
                {item.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={t('imageAlt')}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-[#8b8f99]">
                    <ImageIcon className="h-7 w-7" />
                    <p className="mt-2 text-xs">{t('noImage')}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2 p-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-md bg-[#eef0f4] px-2 py-1 text-[#5c6271]">{typeLabel(item.type)}</span>
                  <span className="rounded-md bg-[#f3f4f7] px-2 py-1 text-[#6b7280]">{statusLabel(item.status)}</span>
                </div>

                <p className="text-xs text-[#7d818d]">{formatter.format(new Date(item.createdAt))}</p>

                {item.prompt && (
                  <p className="line-clamp-2 text-xs leading-5 text-[#5d6372]">{item.prompt}</p>
                )}

                {item.errorMessage && (
                  <p className="line-clamp-2 text-xs leading-5 text-[#ba4656]">{item.errorMessage}</p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t('open')}
                      </Button>
                    </a>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => void handleDownload(item)}
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
      )}

      {hasMore && items.length > 0 && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
