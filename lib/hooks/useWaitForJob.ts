import { useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { GenerationJob } from '@/types'

function waitForJob(jobId: string, signal: AbortSignal): Promise<GenerationJob> {
  return new Promise((resolve, reject) => {
    const supabase = createClient()
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer)
      supabase.removeChannel(channel)
    }
    function done(job: GenerationJob) {
      if (settled) return
      settled = true
      cleanup()
      resolve(job)
    }
    function fail(err: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    async function checkOnce() {
      const { data } = await supabase.from('generation_jobs').select('*').eq('id', jobId).single()
      if (!data) return
      const job = data as GenerationJob
      if (job.status === 'success') done(job)
      else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
    }
    signal.addEventListener('abort', () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true })
    const channel = supabase.channel(`wait:${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` }, (p) => {
        const job = p.new as GenerationJob
        if (job.status === 'success') done(job)
        else if (job.status === 'failed') fail(new Error(job.error_message ?? 'Job failed'))
      }).subscribe()
    void checkOnce()
    pollTimer = setInterval(() => { void checkOnce() }, 2000)
  })
}

interface UseWaitForJobOptions {
  onSuccess?: (job: GenerationJob) => void
  onError?: (error: Error) => void
}

export function useWaitForJob(options?: UseWaitForJobOptions) {
  const abortRef = useRef<AbortController | null>(null)
  const isWaitingRef = useRef(false)

  const startWaiting = useCallback(async (jobId: string) => {
    const abort = new AbortController()
    abortRef.current = abort
    isWaitingRef.current = true

    try {
      const job = await waitForJob(jobId, abort.signal)
      isWaitingRef.current = false
      options?.onSuccess?.(job)
    } catch (err) {
      isWaitingRef.current = false
      if ((err as Error).name !== 'AbortError') {
        options?.onError?.(err as Error)
      }
    }
  }, [options])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    isWaitingRef.current = false
  }, [])

  const isWaiting = isWaitingRef.current

  return { startWaiting, isWaiting, cancel }
}
