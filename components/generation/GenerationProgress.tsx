'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import type { JobStatus } from '@/types'

export interface ProgressStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
  /** For SSE steps: streamed text content */
  streamedText?: string
}

interface GenerationProgressProps {
  steps: ProgressStep[]
  /** overall 0-100 */
  overallProgress: number
  jobStatus?: JobStatus | null
  errorMessage?: string | null
  className?: string
}

const stepIcon = (status: ProgressStep['status']) => {
  switch (status) {
    case 'active':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />
    case 'done':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

export function GenerationProgress({
  steps,
  overallProgress,
  jobStatus,
  errorMessage,
  className,
}: GenerationProgressProps) {
  return (
    <div className={className}>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium">
            {jobStatus === 'success'
              ? 'Complete'
              : jobStatus === 'failed'
              ? 'Failed'
              : 'Generating…'}
          </span>
          <span className="text-sm text-muted-foreground">{overallProgress}%</span>
        </div>
        <Progress value={overallProgress} className="h-2" />
      </div>

      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3">
            <span className="mt-0.5 flex-shrink-0">{stepIcon(step.status)}</span>
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  'text-sm',
                  step.status === 'pending' && 'text-muted-foreground',
                  step.status === 'active' && 'text-foreground font-medium',
                  step.status === 'done' && 'text-muted-foreground line-through',
                  step.status === 'error' && 'text-destructive'
                )}
              >
                {step.label}
              </p>

              {/* SSE streamed text */}
              <AnimatePresence>
                {step.streamedText && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-1.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed overflow-hidden"
                  >
                    {step.streamedText}
                    {step.status === 'active' && (
                      <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-primary" />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </li>
        ))}
      </ol>

      {/* Error message */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// inline cn to avoid extra import cycle
function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ')
}
