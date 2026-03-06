import type { ResultAsset, ResultAssetOrigin, ResultAssetSection } from '@/types'

const RESULT_ASSET_PREFIX = 'shopix:result-assets:'

export function getResultAssetStorageKey(key: string): string {
  return `${RESULT_ASSET_PREFIX}${key}`
}

export function readResultAssets(key: string): ResultAsset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(getResultAssetStorageKey(key))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return dedupeResultAssets(parsed.filter(isResultAsset))
  } catch {
    return []
  }
}

export function writeResultAssets(key: string, assets: ResultAsset[]): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      getResultAssetStorageKey(key),
      JSON.stringify(dedupeResultAssets(assets))
    )
  } catch {}
}

export function mergeResultAssets(current: ResultAsset[], incoming: ResultAsset[]): ResultAsset[] {
  const merged = [...current]
  const indexById = new Map(current.map((asset, index) => [asset.id, index]))

  for (const asset of incoming) {
    const existingIndex = indexById.get(asset.id)
    if (existingIndex === undefined) {
      indexById.set(asset.id, merged.length)
      merged.push(asset)
      continue
    }
    merged[existingIndex] = asset
  }

  return dedupeResultAssets(merged)
}

export function upsertResultAssets(key: string, incoming: ResultAsset[]): ResultAsset[] {
  const next = mergeResultAssets(readResultAssets(key), incoming)
  writeResultAssets(key, next)
  return next
}

export function clearResultAssets(key: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(getResultAssetStorageKey(key))
  } catch {}
}

export function createResultAsset(input: {
  url: string
  label?: string
  section?: ResultAssetSection
  sourceAssetId?: string
  batchId?: string
  batchTimestamp?: number
  requestedSize?: string
  providerSize?: string
  actualSize?: string
  deliveredSize?: string
  sizeStatus?: ResultAsset['sizeStatus']
  normalizedByServer?: boolean
  createdAt?: number
  id?: string
  originModule: ResultAssetOrigin
}): ResultAsset {
  return {
    id: input.id ?? crypto.randomUUID(),
    url: input.url,
    label: input.label,
    section: input.section ?? 'original',
    sourceAssetId: input.sourceAssetId,
    batchId: input.batchId,
    batchTimestamp: input.batchTimestamp,
    requestedSize: input.requestedSize,
    providerSize: input.providerSize,
    actualSize: input.actualSize,
    deliveredSize: input.deliveredSize,
    sizeStatus: input.sizeStatus,
    normalizedByServer: input.normalizedByServer,
    createdAt: input.createdAt ?? Date.now(),
    originModule: input.originModule,
  }
}

export function dedupeResultAssets(assets: ResultAsset[]): ResultAsset[] {
  const deduped: ResultAsset[] = []
  const seen = new Set<string>()

  for (const asset of assets) {
    if (!isResultAsset(asset) || seen.has(asset.id)) continue
    seen.add(asset.id)
    deduped.push(asset)
  }

  return deduped
}

function isResultAsset(value: unknown): value is ResultAsset {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.url === 'string' &&
    typeof record.section === 'string' &&
    typeof record.createdAt === 'number' &&
    typeof record.originModule === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatSizeValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (!isRecord(value)) return undefined

  const w = typeof value.w === 'number' ? value.w : Number(value.w)
  const h = typeof value.h === 'number' ? value.h : Number(value.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined
  return `${Math.round(w)}x${Math.round(h)}`
}

export function extractResultAssetMetadata(resultData: unknown): Pick<
  ResultAsset,
  'requestedSize' | 'providerSize' | 'actualSize' | 'deliveredSize' | 'sizeStatus' | 'normalizedByServer'
> {
  if (!isRecord(resultData)) return {}

  const rawStatus = resultData.size_status
  const sizeStatus = rawStatus === 'exact'
    || rawStatus === 'normalized_down'
    || rawStatus === 'too_small'
    || rawStatus === 'unknown'
    ? rawStatus
    : undefined

  return {
    requestedSize: formatSizeValue(resultData.requested_size ?? resultData.image_size),
    providerSize: formatSizeValue(resultData.provider_size),
    actualSize: formatSizeValue(resultData.actual_size),
    deliveredSize: formatSizeValue(resultData.delivered_size),
    sizeStatus,
    normalizedByServer: typeof resultData.normalized_by_server === 'boolean'
      ? resultData.normalized_by_server
      : undefined,
  }
}
