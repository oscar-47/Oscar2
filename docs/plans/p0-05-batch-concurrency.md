# Feature Plan: P0-05 多图并发与部分失败隔离

## 现状分析
StudioGenesisForm **已有**:
- `Promise.all` for job submission (concurrent, but no concurrency limit)
- `Promise.allSettled` for job waiting (partial failure isolation works)
- `failedSlotIndices` tracking + "Retry Failed" UI (but goes back to preview, not true retry)
- Individual slot status updates in real-time

BasicPhotoSetTab (clothing): uses sequential `for` loop, no concurrency or partial failure.

## 需要改进的 3 点
1. **Concurrency limiting** — `Promise.all` fires all generateImage calls at once. Need pool with `batch_concurrency` limit.
2. **Submission failure isolation** — if one `generateImage` API call fails (not the job, the HTTP call), `Promise.all` rejects and all slots fail. Need `allSettled` for submission too.
3. **True retry** — "Retry Failed" button should retry ONLY failed slots without re-prompting, not go back to preview.

## 影响范围
- 修改文件:
  1. `components/studio/StudioGenesisForm.tsx` — concurrency pool, submission isolation, true retry
- 新增文件: 无
- 删除文件: 无
- i18n: no new keys needed (existing `retryFailed` key sufficient)

## 实现方案

### Step 1: StudioGenesisForm.tsx — Add concurrency pool utility
Add before component (module-level):
```typescript
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return []
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, tasks.length))
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(
    Array.from({ length: effectiveConcurrency }, () => worker())
  )
  return results
}
```
Guards: `concurrency <= 0` → clamp to 1; empty tasks → return `[]`.

### Step 2: StudioGenesisForm.tsx — Replace Promise.all submission with concurrency pool
Current code uses `Promise.all` which rejects on first failure. Replace with:
```typescript
const BATCH_CONCURRENCY = 4
const submissionResults = await runWithConcurrency(
  prompts.map((prompt, i) => () =>
    generateImage({
      productImage: uploadedUrls[0],
      productImages: uploadedUrls,
      prompt, model, aspectRatio, imageSize, turboEnabled,
      imageCount: 1,
      client_job_id: `${client_job_id}_${i}`,
      fe_attempt: 1, trace_id,
      metadata: { is_batch: true, batch_index: i, image_size: imageSize, product_images: uploadedUrls },
    }).then((r) => r.job_id)
  ),
  BATCH_CONCURRENCY,
)

// Extract job IDs + batch-update slots in ONE call
const imageJobIds: (string | null)[] = submissionResults.map((r) =>
  r.status === 'fulfilled' ? r.value : null
)
setImageSlots((prev) =>
  prev.map((s, i) => {
    if (imageJobIds[i]) return { ...s, jobId: imageJobIds[i]! }
    if (submissionResults[i].status === 'rejected') return { ...s, status: 'failed', error: 'Submission failed' }
    return s
  })
)
```

### Step 3: StudioGenesisForm.tsx — Update job waiting to skip null IDs
Replace current `Promise.allSettled` waiting block:
```typescript
const settledJobs = await Promise.allSettled(
  imageJobIds.map((id, i) => {
    if (!id) return Promise.reject(new Error('Submission failed'))
    return waitForJob(id, abort.signal).then((job) => {
      const result = extractResultFromJob(job, i)
      setImageSlots((prev) =>
        prev.map((s, idx) => idx === i ? { ...s, status: 'done', result: result ?? undefined } : s)
      )
      return { index: i, result }
    }).catch((err) => {
      setImageSlots((prev) =>
        prev.map((s, idx) => idx === i ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Failed' } : s)
      )
      throw err
    })
  })
)
```
Remove the separate `setImageSlots(imageJobIds.map(...))` call that assumed all succeeded.

### Step 4: StudioGenesisForm.tsx — True retry for failed slots

#### 4a: Retry context state
```typescript
interface RetryContext {
  prompts: string[]
  trace_id: string
}
const [retryContext, setRetryContext] = useState<RetryContext | null>(null)
```

At end of handleGenerate (before `setPhase('complete')`), save retry context:
```typescript
setRetryContext({ prompts, trace_id })
```

#### 4b: handleRetryFailed — abort-safe phase management
```typescript
const handleRetryFailed = useCallback(async () => {
  if (!retryContext || failedSlotIndices.length === 0) return

  // Capture indices BEFORE any state changes
  const indicesToRetry = [...failedSlotIndices]

  // Switch to generating phase — enables Stop button and blocks navigation
  setPhase('generating')
  const abort = new AbortController()
  abortRef.current = abort
  setErrorMessage(null)

  // Reset steps/progress for retry visibility
  setSteps([
    { id: 'retry', label: 'Retrying failed images...', status: 'active' },
  ])
  setProgress(0)

  const { prompts, trace_id } = retryContext
  const BATCH_CONCURRENCY = 4

  // Reset failed slots to pending
  setImageSlots((prev) =>
    prev.map((s, i) => indicesToRetry.includes(i) ? { ...s, status: 'pending', error: undefined } : s)
  )
  setFailedSlotIndices([])

  try {
    const retryTasks = indicesToRetry.map((slotIdx) => () =>
      generateImage({
        productImage: uploadedUrls[0],
        productImages: uploadedUrls,
        prompt: prompts[slotIdx],
        model, aspectRatio, imageSize, turboEnabled,
        imageCount: 1,
        client_job_id: `${uid()}_retry_${slotIdx}`,
        fe_attempt: 2, trace_id,
        metadata: { is_batch: true, batch_index: slotIdx, image_size: imageSize, product_images: uploadedUrls },
      }).then((r) => r.job_id)
    )

    const submissionResults = await runWithConcurrency(retryTasks, BATCH_CONCURRENCY)

    const retryJobMap = indicesToRetry.map((slotIdx, ri) => ({
      slotIdx,
      jobId: submissionResults[ri].status === 'fulfilled'
        ? (submissionResults[ri] as PromiseFulfilledResult<string>).value
        : null,
    }))

    // Batch-update slots
    setImageSlots((prev) =>
      prev.map((s, i) => {
        const entry = retryJobMap.find((e) => e.slotIdx === i)
        if (!entry) return s
        if (entry.jobId) return { ...s, jobId: entry.jobId }
        return { ...s, status: 'failed', error: 'Retry submission failed' }
      })
    )

    // Nudge workers
    retryJobMap.forEach(({ jobId }, ri) => {
      if (jobId) setTimeout(() => processGenerationJob(jobId).catch(() => {}), ri * 3000)
    })

    const retrySettled = await Promise.allSettled(
      retryJobMap.map(({ slotIdx, jobId }) => {
        if (!jobId) return Promise.reject(new Error('Submission failed'))
        return waitForJob(jobId, abort.signal).then((job) => {
          const result = extractResultFromJob(job, slotIdx)
          setImageSlots((prev) =>
            prev.map((s, i) => i === slotIdx ? { ...s, status: 'done', result: result ?? undefined } : s)
          )
          return { slotIdx, result }
        }).catch((err) => {
          setImageSlots((prev) =>
            prev.map((s, i) => i === slotIdx ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Failed' } : s)
          )
          throw err
        })
      })
    )

    // Rebuild results from ALL slots (not append — preserves ordering)
    // ResultImage is { url, label } — no index field. So rebuild from imageSlots.
    // Collect successful retry results and merge with existing results:
    const retryResults: ResultImage[] = []
    retrySettled.forEach((settled) => {
      if (settled.status === 'fulfilled' && settled.value?.result) {
        retryResults.push(settled.value.result)
      }
    })
    // Append new successes (failed slots had no entry in results before)
    setResults((prev) => [...prev, ...retryResults])

    const newFailedIndices = retryJobMap
      .filter((_, ri) => retrySettled[ri].status === 'rejected')
      .map((e) => e.slotIdx)
    setFailedSlotIndices(newFailedIndices)
    refreshCredits()

    // Only set complete if not aborted (handleStop sets 'input')
    if (!abort.signal.aborted) {
      setPhase('complete')
    }
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') return // handleStop already set phase='input'
    setErrorMessage(err instanceof Error ? err.message : 'Retry failed')
    if (!abort.signal.aborted) {
      setPhase('complete')
    }
  }
}, [retryContext, failedSlotIndices, uploadedUrls, model, aspectRatio, imageSize, turboEnabled, t])
```

**Key design decisions**:
1. **Abort-safe phase transition**: No `finally { setPhase('complete') }`. Instead, check `abort.signal.aborted` before setting phase. If user clicked Stop, `handleStop` already set `phase='input'` — we don't overwrite it.
2. **ResultImage has no index field** (`{ url, label }`). Failed slots had no entry in the `results` array, so retry successes are appended. This is correct because `results` only contains successful images for the gallery — order matches generation order.
3. **Steps/progress reset** for retry: sets a "Retrying" step so the generating UI doesn't show stale "done/100%".
4. **`indicesToRetry` captured before clearing** — avoids stale closure.
5. **Single batch `setImageSlots`** for jobId/failure — not per-slot.

### Step 5: StudioGenesisForm.tsx — Update retry button
Change "Retry Failed" button from `handleBackToPreview` to `handleRetryFailed`:
```tsx
<Button variant="outline" size="sm" onClick={handleRetryFailed}>
  <RefreshCw className="h-4 w-4 mr-1" />
  {t('retryFailed')}
</Button>
```
Also update the "all failed" retry button similarly.

### Step 6: StudioGenesisForm.tsx — Nudge worker with concurrency
Update the current nudge block to skip null IDs:
```typescript
imageJobIds.forEach((id, i) => {
  if (id) {
    setTimeout(() => processGenerationJob(id).catch(() => {}), i * 3000)
  }
})
```

### Step 7: Reset retryContext
Reset in handleBackToInput, handleNewGeneration:
```typescript
setRetryContext(null)
```

## 注意事项
- **BATCH_CONCURRENCY = 4** — hardcoded constant, conservative for frontend.
- **runWithConcurrency guards bad input** — `Math.max(1, ...)` for concurrency; empty tasks → `[]`.
- **Single image** (1 task) — works fine with pool, no special case.
- **Retry abort-safe** — checks `abort.signal.aborted` before phase transition; `handleStop` already sets `phase='input'` and aborts controller.
- **ResultImage = { url, label }** — no index/slot field. Failed slots have no entry in results array. Retry appends new successes.
- **Steps reset on retry** — shows "Retrying" step to avoid stale UI.
- **Batch state updates** — single `setImageSlots` per phase, not per-slot.
- **`indicesToRetry` local copy** — captures before clearing to avoid stale closure.
- **retryContext stores prompts** — retry re-generates without re-prompting.
- **No clothing studio changes** — StudioGenesis only.

## 验证方式
- [ ] tsc 通过
- [ ] Single image generation works as before
- [ ] Multi-image: all succeed → same as before
- [ ] Multi-image: one submission fails → other slots continue, failed slot shows error
- [ ] Multi-image: one job fails → other images shown, failed slot shown
- [ ] Retry button re-submits only failed slots, not all
- [ ] After retry success: results updated, gallery shows all images
- [ ] During retry: Stop button visible and functional (generating phase)
- [ ] Stop during retry: returns to input phase (not complete)
- [ ] Retry completes normally: returns to complete phase
- [ ] Concurrency limited (at most 4 simultaneous generateImage calls)
