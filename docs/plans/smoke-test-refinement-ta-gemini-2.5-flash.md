# Smoke Test Skeleton: Refinement Mode with TA Gemini 2.5 Flash

**Generated**: 2026-03-07
**Mode**: `refinement`
**Model**: `ta-gemini-2.5-flash`
**Scope**: Frontend submit path, `analyze-single` validation, worker routing, progress snapshots, and one admin-only happy path

---

## Generation Report

```json
{
  "status": "completed",
  "artifact": "docs/plans/smoke-test-refinement-ta-gemini-2.5-flash.md",
  "mode": "refinement",
  "model": "ta-gemini-2.5-flash",
  "recommendedFrameworks": {
    "integration": "Vitest or Jest with targeted module mocks",
    "e2e": "Playwright"
  },
  "frameworkNote": "No test framework is currently installed in the project. The cases below are written as framework-agnostic pseudocode and smoke procedures.",
  "coverageFocus": [
    "Admin-only model access",
    "1K-only size support",
    "Refinement request validation",
    "ToAPIs routing for ta-gemini-2.5-flash",
    "Refinement progress snapshots and per-unit completion"
  ]
}
```

---

## Behavior Anchors

These smoke cases are anchored to current production code:

- `components/studio/RefinementStudioForm.tsx`: frontend submit path calls `analyzeSingle({ mode: 'refinement', ... })`
- `components/studio/GenerationParametersCard.tsx`: TA models are only shown for admin emails
- `types/index.ts`: `ta-gemini-2.5-flash` supports `1K` only and costs `3` credits per success unit
- `supabase/functions/analyze-single/index.ts`: server-side admin gate, refinement payload validation, and image-size validation
- `supabase/functions/process-generation-job/index.ts`: `ta-gemini-2.5-flash` routes to ToAPIs model `gemini-2.5-flash-image-preview`
- `docs/state-machine.md`: refinement mode writes incremental `result_data` snapshots before final success or failure

---

## Smoke Matrix

| ID | Level | Scenario | Expected Result |
|----|-------|----------|-----------------|
| SMK-1 | Integration | Non-admin submits refinement with `ta-gemini-2.5-flash` | `MODEL_RESTRICTED` 403 |
| SMK-2 | Integration | Admin submits refinement with `ta-gemini-2.5-flash` and `imageSize=2K` | `IMAGE_SIZE_UNSATISFIED` 400 |
| SMK-3 | Integration | Valid refinement request with `.jpg/.png` product images and `backgroundMode=white|original` | Job is created and payload is normalized to `mode=refinement` |
| SMK-4 | Integration | Worker processes refinement job for `ta-gemini-2.5-flash` | Uses ToAPIs route, model `gemini-2.5-flash-image-preview`, writes progress snapshots |
| SMK-5 | E2E | Admin runs refinement in UI with 2 valid product images, `1K`, `ta-gemini-2.5-flash` | Cards progress from loading to success/failed, at least one result appears, downloads remain available |
| SMK-6 | E2E | Invalid refinement input in UI or direct API (`.webp`, `backgroundMode=foo`, 51 files`) | Request is blocked or server returns documented refinement errors |

---

## Integration Smoke Skeletons

**Recommended file**: `__tests__/refinement-ta-gemini-2.5-flash.smoke.test.ts`

```ts
// Smoke coverage for refinement mode with ta-gemini-2.5-flash
// Generated: 2026-03-07

describe('SMK-1 non-admin cannot use ta-gemini-2.5-flash for refinement', () => {
  test('analyze-single returns MODEL_RESTRICTED', async () => {
    // Arrange:
    // - Mock authenticated user with non-admin email
    // - Build refinement payload:
    //   {
    //     mode: 'refinement',
    //     productImages: ['https://cdn.example.com/a.jpg'],
    //     backgroundMode: 'white',
    //     model: 'ta-gemini-2.5-flash',
    //     aspectRatio: '1:1',
    //     imageSize: '1K'
    //   }
    //
    // Act:
    // - POST to analyze-single
    //
    // Assert:
    // - HTTP 403
    // - error.code === 'MODEL_RESTRICTED'
    // - No generation_jobs row is inserted
  })
})

describe('SMK-2 ta-gemini-2.5-flash only accepts 1K', () => {
  test('analyze-single rejects 2K refinement request for admin', async () => {
    // Arrange:
    // - Mock authenticated admin email
    // - Build valid refinement payload except imageSize: '2K'
    //
    // Act:
    // - POST to analyze-single
    //
    // Assert:
    // - HTTP 400
    // - error.code/message indicate IMAGE_SIZE_UNSATISFIED
    // - This matches types/index.ts model capability for ta-gemini-2.5-flash
  })
})

describe('SMK-3 valid refinement request is accepted and normalized', () => {
  test('analyze-single creates STYLE_REPLICATE job for valid admin request', async () => {
    // Arrange:
    // - Mock admin auth
    // - Use two product images with supported extensions:
    //   ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.png']
    // - backgroundMode: 'original'
    // - model: 'ta-gemini-2.5-flash'
    // - aspectRatio: '4:5'
    // - imageSize: '1K'
    //
    // Act:
    // - POST to analyze-single
    //
    // Assert:
    // - Response { job_id, status: 'processing' }
    // - generation_jobs row exists with:
    //   - type === 'STYLE_REPLICATE'
    //   - payload.mode === 'refinement'
    //   - payload.model === 'ta-gemini-2.5-flash'
    //   - payload.backgroundMode === 'original'
    //   - payload.imageSize === '1K'
    //   - cost_amount === 2 * 3
  })

  test('refinement validation rejects unsupported url extension or bad backgroundMode', async () => {
    // Arrange two invalid payloads:
    // 1) productImages: ['https://cdn.example.com/a.webp']
    // 2) backgroundMode: 'foo'
    //
    // Act + Assert:
    // - Case 1 returns REFINEMENT_IMAGE_FORMAT_UNSUPPORTED
    // - Case 2 returns REFINEMENT_BACKGROUND_MODE_INVALID
  })
})

describe('SMK-4 worker routes ta-gemini-2.5-flash to ToAPIs and writes progress', () => {
  test('process-generation-job uses gemini-2.5-flash-image-preview and incremental snapshots', async () => {
    // Arrange:
    // - Seed a queued STYLE_REPLICATE job with:
    //   - payload.mode = 'refinement'
    //   - payload.model = 'ta-gemini-2.5-flash'
    //   - payload.imageSize = '1K'
    //   - payload.productImages = [img1.jpg, img2.jpg]
    // - Stub image API so first unit succeeds, second unit fails or succeeds deterministically
    // - Observe outbound provider request and DB updates
    //
    // Act:
    // - Invoke process-generation-job with the seeded job_id
    //
    // Assert:
    // - Image route provider is ToAPIs
    // - Provider model is 'gemini-2.5-flash-image-preview'
    // - result_data.summary.requested_count === 2
    // - At least one intermediate generation_jobs update happens while status === 'processing'
    // - Final outputs[] entries include product_index alignment 0..1
    // - Final status is:
    //   - 'success' if any unit succeeded
    //   - 'failed' only if all units failed
  })

  test('refinement path uses vision-stage prompt generation with fallback', async () => {
    // Arrange:
    // - Seed a refinement job as above
    // - Spy on the chat/vision client used for analysis prompt generation
    //
    // Act:
    // - Run process-generation-job
    //
    // Assert:
    // - Refinement vision-analysis is attempted once per unique product image
    // - Successful analysis result is passed into the downstream refinement prompt
    // - If analysis throws, worker falls back to the generic refinement prompt and still reaches image generation
    // - result_data.metadata includes:
    //   - refinement_prompt_mode
    //   - refinement_analysis_attempted_count / succeeded_count / failed_count
    //   - worker_nudge_retry_count
  })
})
```

---

## E2E Smoke Skeletons

**Recommended file**: `e2e/refinement-ta-gemini-2.5-flash.smoke.spec.ts`

```ts
test('SMK-5 admin happy path in refinement studio', async ({ page }) => {
  // Preconditions:
  // - Authenticated admin user
  // - Sufficient credits
  // - Two local jpg/png product images available
  //
  // Steps:
  // 1. Open /refinement-studio
  // 2. Upload 2 product images
  // 3. Confirm model dropdown includes TA 2.5 Flash
  // 4. Select ta-gemini-2.5-flash
  // 5. Confirm only 1K resolution is selectable
  // 6. Choose aspect ratio 1:1 or 4:5
  // 7. Choose background mode white or original
  // 8. Submit generation
  //
  // Assertions:
  // - Progress area appears
  // - Two result cards are allocated immediately
  // - Cards transition from loading to success/failed
  // - At least one result image is rendered when backend returns partial success
  // - Download action is available for successful outputs
})

test('SMK-6 refinement rejects invalid inputs and preserves clear feedback', async ({ request, page }) => {
  // API-side checks:
  // - POST direct request with 51 productImages -> expect REFINEMENT_PRODUCT_IMAGES_REQUIRED
  // - POST direct request with .webp url -> expect REFINEMENT_IMAGE_FORMAT_UNSUPPORTED
  // - POST direct request with backgroundMode=foo -> expect REFINEMENT_BACKGROUND_MODE_INVALID
  //
  // Optional UI check:
  // - Upload invalid file type in RefinementStudioForm
  // - Expect upload error text and no generation attempt
})
```

---

## Manual Smoke Procedure

1. Sign in with an admin account listed in `types/index.ts`.
2. Open refinement studio and verify `TA 2.5 Flash` is visible in the model picker.
3. Verify resolution choices collapse to `1K` only after selecting that model.
4. Upload two valid `.jpg` or `.png` product images.
5. Run once with `backgroundMode=white`, then once with `backgroundMode=original`.
6. Confirm progress updates appear before final completion.
7. Confirm final result count matches successful units and failed units remain surfaced as failed cards.
8. Repeat the API request as a non-admin user and confirm `MODEL_RESTRICTED`.

---

## Exit Criteria

- Admin happy path succeeds with `ta-gemini-2.5-flash` in refinement mode.
- Non-admin path is denied server-side even if the UI is bypassed.
- `1K` is the only accepted image size for this model.
- Refinement-specific validation errors match the documented codes.
- Worker uses the ToAPIs route and writes per-unit progress snapshots for multi-image refinement jobs.
