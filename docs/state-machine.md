# Generation Job State Machine

## Enums

- `job_type`: `ANALYSIS | IMAGE_GEN | STYLE_REPLICATE`
- `job_status`: `processing | success | failed`
- `task_status`: `queued | running | success | failed`

## Allowed transitions

1. `processing -> success`
2. `processing -> failed`
3. `success` and `failed` are terminal.

## Queue Task Transitions

1. `queued -> running` via `claim_generation_task(job_id)`
2. `running -> success` after worker processing
3. `running -> queued` on retryable failure (`run_after` delay)
4. `running -> failed` after max attempts

## Typical workflows

## Studio Genesis

1. Create `ANALYSIS` job (`processing`) + enqueue `generation_job_tasks` row (`queued`)
2. Frontend nudges `process-generation-job` with `job_id`
3. Worker claims task and writes analysis blueprint to `result_data`
4. Create `IMAGE_GEN` jobs (`processing`) + queue tasks
5. Worker claims each IMAGE_GEN task, deducts credits, calls model, writes `result_url/result_data`
6. On failure after deduction, credits are refunded and job becomes `failed`

## Aesthetic Mirror

1. Create `STYLE_REPLICATE` job (`processing`)
2. Update `STYLE_REPLICATE` job to `success`/`failed`

## Clothing Studio

1. Create one `ANALYSIS` job
2. Create three `IMAGE_GEN` jobs for variants

## Refinement Studio

1. Create `ANALYSIS` job with `clothingMode=refinement_analysis`
2. Create one `IMAGE_GEN` job with `whiteBackground=true`

## Realtime

Frontend subscribes to `generation_jobs` update events filtered by `id=eq.<job_id>`.

## Nudge + Poll Strategy

1. Frontend nudges worker once after `analyze-product-v2` / `generate-image` ack.
2. `waitForJob` uses Realtime subscription + periodic polling.
3. If polling shows `processing` for consecutive checks, frontend sends another nudge.
