'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { GenerationJob, JobStatus } from '@/types'

interface UseRealtimeJobResult {
  status: JobStatus | null
  resultUrl: string | null
  errorMessage: string | null
  job: GenerationJob | null
  isLoading: boolean
}

export function useRealtimeJob(jobId: string | null): UseRealtimeJobResult {
  const [job, setJob] = useState<GenerationJob | null>(null)
  const [isLoading, setIsLoading] = useState(!!jobId)

  useEffect(() => {
    if (!jobId) {
      setIsLoading(false)
      return
    }

    const supabase = createClient()

    // Initial fetch
    async function fetchJob() {
      const { data } = await supabase
        .from('generation_jobs')
        .select('*')
        .eq('id', jobId)
        .single()

      if (data) setJob(data as GenerationJob)
      setIsLoading(false)
    }

    fetchJob()

    // Subscribe to updates
    const channel = supabase
      .channel(`job:${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'generation_jobs',
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          setJob(payload.new as GenerationJob)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [jobId])

  return {
    status: job?.status ?? null,
    resultUrl: job?.result_url ?? null,
    errorMessage: job?.error_message ?? null,
    job,
    isLoading,
  }
}
