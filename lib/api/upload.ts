/**
 * Upload a file using the OssSts signed URL returned by the get-oss-sts Edge Function.
 * Supabase Storage is the actual backend; the "oss-sts" naming is kept for HAR compatibility.
 */
import { getOssSts } from './edge-functions'
import type { OssStsCredentials } from '@/types'

export interface UploadResult {
  /** Full public URL of the uploaded file */
  publicUrl: string
  /** Relative path stored in the bucket (e.g. temp/{uid}/{ts}_{name}.png) */
  path: string
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedPath = path.replace(/^\/+/, '')
  return `${normalizedBase}/${normalizedPath}`
}

/**
 * Upload a single File using the credentials returned by get-oss-sts.
 * Supports both:
 * - PUT upload (supabase_compat)
 * - POST form upload (qiniu)
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  const key = `temp/uploads/${Date.now()}_${sanitizeFileName(file.name)}`
  const creds: OssStsCredentials = await getOssSts({
    prefix: 'temp/uploads',
    key,
    bucket: 'temp',
  })

  let res: Response
  if (creds.uploadMethod === 'POST') {
    const formData = new FormData()
    Object.entries(creds.formFields ?? {}).forEach(([k, v]) => {
      formData.append(k, v)
    })
    formData.append('file', file)
    res = await fetch(creds.uploadUrl, {
      method: 'POST',
      body: formData,
    })
  } else {
    const headers: Record<string, string> = {
      'Content-Type': file.type || 'application/octet-stream',
    }
    // Keep compatibility if a provider expects bearer token on upload.
    if (creds.securityToken && creds.provider !== 'supabase_compat') {
      headers.Authorization = `Bearer ${creds.securityToken}`
    }
    res = await fetch(creds.uploadUrl, {
      method: 'PUT',
      headers,
      body: file,
    })
  }

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`)
  }

  return {
    publicUrl: joinUrl(creds.endpoint, creds.objectKey),
    path: creds.objectKey,
  }
}

/**
 * Upload multiple files concurrently.
 */
export async function uploadFiles(files: File[]): Promise<UploadResult[]> {
  return Promise.all(files.map(uploadFile))
}
