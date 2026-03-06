import type { ResultAsset, ResultAssetOrigin } from '@/types'

const PREFIX = 'editor-session-'

export interface EditorSessionPayload {
  assets: ResultAsset[]
  returnSessionKey?: string
  originModule: ResultAssetOrigin
}

export function createEditorSession(payload: EditorSessionPayload): string {
  const sid = crypto.randomUUID()
  sessionStorage.setItem(`${PREFIX}${sid}`, JSON.stringify(payload))
  return sid
}

export function loadEditorSession(sid: string): EditorSessionPayload | null {
  const data = sessionStorage.getItem(`${PREFIX}${sid}`)
  if (!data) return null

  try {
    const parsed = JSON.parse(data) as EditorSessionPayload
    if (!parsed || !Array.isArray(parsed.assets)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearEditorSession(sid: string): void {
  sessionStorage.removeItem(`${PREFIX}${sid}`)
}
