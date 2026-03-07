import type { ResultAsset, ResultAssetOrigin, ResultAssetSection } from '@/types'

const RESULT_ASSET_PREFIX = 'shopix:result-assets:'
const RESULT_ASSET_EVENT = 'shopix:result-assets:changed'
const LEGACY_RESULT_BATCH_KEY = '__legacy__'

export interface ResultAssetSessionState {
  assets: ResultAsset[]
  activeBatchId?: string
  activeBatchTimestamp?: number
}

export interface ResultAssetBatchGroup {
  key: string
  batchId?: string
  batchTimestamp?: number
  images: ResultAsset[]
  isLegacy: boolean
}

function emitResultAssetChange(key: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(RESULT_ASSET_EVENT, { detail: { key } }))
}

export function getResultAssetStorageKey(key: string): string {
  return `${RESULT_ASSET_PREFIX}${key}`
}

export function readResultAssetSession(key: string): ResultAssetSessionState {
  if (typeof window === 'undefined') return { assets: [] }
  try {
    const raw = sessionStorage.getItem(getResultAssetStorageKey(key))
    if (!raw) return { assets: [] }
    const parsed = JSON.parse(raw)

    if (Array.isArray(parsed)) {
      return { assets: dedupeResultAssets(parsed.filter(isResultAsset)) }
    }

    if (!isRecord(parsed)) return { assets: [] }

    return normalizeResultAssetSession({
      assets: Array.isArray(parsed.assets)
        ? dedupeResultAssets(parsed.assets.filter(isResultAsset))
        : [],
      activeBatchId: typeof parsed.activeBatchId === 'string' && parsed.activeBatchId.trim().length > 0
        ? parsed.activeBatchId
        : undefined,
      activeBatchTimestamp: typeof parsed.activeBatchTimestamp === 'number'
        ? parsed.activeBatchTimestamp
        : undefined,
    })
  } catch {
    return { assets: [] }
  }
}

export function readResultAssets(key: string): ResultAsset[] {
  return readResultAssetSession(key).assets
}

export function writeResultAssetSession(key: string, session: ResultAssetSessionState): void {
  if (typeof window === 'undefined') return
  try {
    const storageKey = getResultAssetStorageKey(key)
    const normalized = normalizeResultAssetSession(session)
    const nextValue = JSON.stringify(normalized)
    const previousValue = sessionStorage.getItem(storageKey)
    if (previousValue === nextValue) return
    sessionStorage.setItem(storageKey, nextValue)
    emitResultAssetChange(key)
  } catch {}
}

export function writeResultAssets(key: string, assets: ResultAsset[]): void {
  const previous = readResultAssetSession(key)
  writeResultAssetSession(key, {
    assets,
    activeBatchId: previous.activeBatchId,
    activeBatchTimestamp: previous.activeBatchTimestamp,
  })
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
    merged[existingIndex] = mergeResultAsset(merged[existingIndex], asset)
  }

  return dedupeResultAssets(merged)
}

export function upsertResultAssets(key: string, incoming: ResultAsset[]): ResultAsset[] {
  const previous = readResultAssetSession(key)
  const next = mergeResultAssets(previous.assets, incoming)
  writeResultAssetSession(key, {
    assets: next,
    activeBatchId: previous.activeBatchId,
    activeBatchTimestamp: previous.activeBatchTimestamp,
  })
  return next
}

export function clearResultAssets(key: string): void {
  if (typeof window === 'undefined') return
  try {
    const storageKey = getResultAssetStorageKey(key)
    if (sessionStorage.getItem(storageKey) === null) return
    sessionStorage.removeItem(storageKey)
    emitResultAssetChange(key)
  } catch {}
}

export function subscribeToResultAssetChanges(
  key: string,
  onChange: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string }>).detail
    if (!detail?.key || detail.key === key) onChange()
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === getResultAssetStorageKey(key)) onChange()
  }

  window.addEventListener(RESULT_ASSET_EVENT, handleCustomEvent as EventListener)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(RESULT_ASSET_EVENT, handleCustomEvent as EventListener)
    window.removeEventListener('storage', handleStorage)
  }
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

function mergeResultAsset(current: ResultAsset, incoming: ResultAsset): ResultAsset {
  return {
    ...current,
    ...incoming,
    label: incoming.label !== undefined ? incoming.label : current.label,
    sourceAssetId: incoming.sourceAssetId !== undefined ? incoming.sourceAssetId : current.sourceAssetId,
    batchId: incoming.batchId !== undefined ? incoming.batchId : current.batchId,
    batchTimestamp: incoming.batchTimestamp !== undefined ? incoming.batchTimestamp : current.batchTimestamp,
    requestedSize: incoming.requestedSize !== undefined ? incoming.requestedSize : current.requestedSize,
    providerSize: incoming.providerSize !== undefined ? incoming.providerSize : current.providerSize,
    actualSize: incoming.actualSize !== undefined ? incoming.actualSize : current.actualSize,
    deliveredSize: incoming.deliveredSize !== undefined ? incoming.deliveredSize : current.deliveredSize,
    sizeStatus: incoming.sizeStatus !== undefined ? incoming.sizeStatus : current.sizeStatus,
    normalizedByServer: incoming.normalizedByServer !== undefined
      ? incoming.normalizedByServer
      : current.normalizedByServer,
  }
}

export function groupResultAssetsByBatch(assets: ResultAsset[]): ResultAssetBatchGroup[] {
  const groups: ResultAssetBatchGroup[] = []
  const groupsByKey = new Map<string, ResultAssetBatchGroup>()

  for (const asset of assets) {
    if (!isResultAsset(asset)) continue
    const key = getResultAssetBatchKey(asset)
    const existing = groupsByKey.get(key)
    if (existing) {
      existing.images.push(asset)
      if (typeof asset.batchTimestamp === 'number') {
        existing.batchTimestamp = Math.max(existing.batchTimestamp ?? 0, asset.batchTimestamp)
      }
      continue
    }

    const group: ResultAssetBatchGroup = {
      key,
      batchId: asset.batchId,
      batchTimestamp: asset.batchTimestamp,
      images: [asset],
      isLegacy: !asset.batchId,
    }
    groupsByKey.set(key, group)
    groups.push(group)
  }

  return groups
}

export function splitResultAssetsByActiveBatch(
  assets: ResultAsset[],
  activeBatchId?: string,
): {
  activeAssets: ResultAsset[]
  historicalAssets: ResultAsset[]
  activeBatchId?: string
  activeBatchTimestamp?: number
} {
  const groups = groupResultAssetsByBatch(assets)
  if (groups.length === 0) {
    return {
      activeAssets: [],
      historicalAssets: [],
      activeBatchId: undefined,
      activeBatchTimestamp: undefined,
    }
  }

  const activeGroup = resolveActiveBatchGroup(groups, activeBatchId)
  if (!activeGroup) {
    return {
      activeAssets: assets,
      historicalAssets: [],
      activeBatchId: undefined,
      activeBatchTimestamp: undefined,
    }
  }

  return {
    activeAssets: activeGroup.images,
    historicalAssets: groups
      .filter((group) => group.key !== activeGroup.key)
      .flatMap((group) => group.images),
    activeBatchId: activeGroup.batchId,
    activeBatchTimestamp: activeGroup.batchTimestamp,
  }
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

function getResultAssetBatchKey(asset: ResultAsset): string {
  return asset.batchId ? `batch:${asset.batchId}` : LEGACY_RESULT_BATCH_KEY
}

function normalizeResultAssetSession(session: ResultAssetSessionState): ResultAssetSessionState {
  const assets = dedupeResultAssets(session.assets)
  const resolved = splitResultAssetsByActiveBatch(assets, session.activeBatchId)

  return {
    assets,
    activeBatchId: resolved.activeBatchId,
    activeBatchTimestamp: typeof resolved.activeBatchTimestamp === 'number'
      ? resolved.activeBatchTimestamp
      : session.activeBatchTimestamp,
  }
}

function resolveActiveBatchGroup(
  groups: ResultAssetBatchGroup[],
  activeBatchId?: string,
): ResultAssetBatchGroup | null {
  if (groups.length === 0) return null

  if (activeBatchId) {
    const matched = groups.find((group) => group.batchId === activeBatchId)
    if (matched) return matched
  }

  const nonLegacyGroups = groups.filter((group) => !group.isLegacy)
  if (nonLegacyGroups.length > 0) {
    return [...nonLegacyGroups].sort((left, right) => {
      const leftTime = left.batchTimestamp ?? 0
      const rightTime = right.batchTimestamp ?? 0
      if (leftTime !== rightTime) return rightTime - leftTime
      return groups.indexOf(right) - groups.indexOf(left)
    })[0] ?? null
  }

  return groups[groups.length - 1] ?? null
}
