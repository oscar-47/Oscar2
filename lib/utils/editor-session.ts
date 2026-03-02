const PREFIX = 'editor-session-'

export function createEditorSession(urls: string[]): string {
  const sid = crypto.randomUUID()
  sessionStorage.setItem(`${PREFIX}${sid}`, JSON.stringify(urls))
  return sid
}

export function loadEditorSession(sid: string): string[] | null {
  const data = sessionStorage.getItem(`${PREFIX}${sid}`)
  if (!data) return null
  sessionStorage.removeItem(`${PREFIX}${sid}`)
  return JSON.parse(data)
}
