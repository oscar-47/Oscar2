# Test Skeleton: Per-Reference-Image Prompts in Batch Mode

**Design Doc**: `docs/design/per-reference-prompts.md`
**Generated**: 2026-03-02
**Feature**: Per-reference-image prompts in AestheticMirror batch mode
**Budget Used**: 3/3 integration, 1/2 E2E

---

## Generation Report

```json
{
  "status": "completed",
  "feature": "per-reference-prompts",
  "designDoc": "docs/design/per-reference-prompts.md",
  "generatedFiles": {
    "integration": "This file (skeleton only -- no test framework installed)",
    "e2e": "This file (skeleton only -- no test framework installed)"
  },
  "budgetUsage": {
    "integration": "3/3",
    "e2e": "1/2"
  },
  "frameworkNote": "No test framework (Jest/Vitest/Playwright/Cypress) is currently installed in the project. Skeletons are written as framework-agnostic TypeScript pseudocode. When a framework is chosen, these skeletons can be converted directly.",
  "existingTestCoverage": "None -- no project-level test files exist outside node_modules."
}
```

---

## Phase 1: AC Validation (Behavior-First Filtering)

| AC | EARS Keyword | Observable? | System Context? | In Scope? | Decision | Reason |
|----|-------------|-------------|-----------------|-----------|----------|--------|
| AC1: Accordion panels appear for >1 refs | **When** (event-driven) | Yes (UI visible) | Partial (component render) | Yes | **Include** | Core UX behavior |
| AC2: Panel shows thumbnail and filename | (none) | Yes (UI visible) | Partial (component render) | No | **Skip** | [UNIT_LEVEL] -- Pure rendering detail, testable via component unit test |
| AC3: userPrompts[] in API payload | **When** (event-driven) | Yes (network request) | Yes (FE -> API) | Yes | **Include** | Data contract across boundary |
| AC4: Backend merges global + per-ref | **If-then** (branch coverage) | Yes (generated image prompt) | Yes (worker logic) | Yes | **Include** | Core business logic, 4 branches |
| AC5: Dynamic sync on add/remove | **When** (event-driven) | Yes (UI panels update) | Partial (component state) | Yes | **Include** | Data integrity, medium risk |
| AC6: Single ref -- no accordion | (none) | Yes (UI absence) | Partial (component render) | No | **Skip** | [UNIT_LEVEL] -- Simple conditional render, covered by AC1 boundary |
| AC7: i18n labels | (none) | Yes (text display) | Partial (i18n config) | Yes | **Include** | Verifiable via message file inspection |
| AC8: Backward compatibility | **If-then** (branch coverage) | Yes (system behavior) | Yes (API + worker) | Yes | **Include** | Critical regression guard |

**Filtered AC List**: AC1, AC3, AC4, AC5, AC7, AC8

---

## Phase 2: Candidate Enumeration

### Candidate Pool

| ID | AC | Test Name | Type | BV | UF | Legal | DDR | Notes |
|----|-----|-----------|------|-----|-----|-------|-----|-------|
| C1 | AC1+AC5+AC6 | Accordion visibility and state sync with ref add/remove | Integration | 7 | 8 | false | 7 | Combines AC1 (visibility), AC5 (sync), AC6 (boundary) into one component interaction test |
| C2 | AC3 | API payload includes userPrompts[] when non-empty, omits when all empty | Integration | 8 | 9 | false | 8 | Contract verification at FE->API boundary |
| C3 | AC4 | buildPrompt merges global + per-ref across all 4 combinations | Integration | 9 | 9 | false | 9 | Core prompt logic, 4 branches, high defect likelihood |
| C4 | AC4-error | buildPrompt handles undefined/out-of-bounds userPrompts[r] gracefully | Integration | 6 | 2 | false | 5 | Edge case: corrupted payload |
| C5 | AC8 | Backward compat: no userPrompts field = old behavior | Integration | 8 | 7 | false | 8 | Regression guard for existing clients |
| C6 | AC7 | i18n keys exist in both en.json and zh.json | Integration | 4 | 5 | false | 3 | Low defect risk, static config |
| C7 | AC3+AC4+AC8 | Full user journey: batch mode with per-ref prompts end-to-end | E2E | 9 | 8 | false | 9 | Complete flow from upload to prompt merge |

---

## Phase 3: ROI-Based Selection

### ROI Calculations

| ID | Numerator (BV*UF + Legal*10 + DDR) | Denominator (Create+Exec+Maintain) | ROI | Selected? |
|----|-------------------------------------|--------------------------------------|-----|-----------|
| C1 | 7*8 + 0 + 7 = 63 | 11 | 5.7 | Yes (integration #1) |
| C2 | 8*9 + 0 + 8 = 80 | 11 | 7.3 | Yes (integration #2) |
| C3 | 9*9 + 0 + 9 = 90 | 11 | 8.2 | Yes (integration #3) -- highest ROI |
| C4 | 6*2 + 0 + 5 = 17 | 11 | 1.5 | No -- subsumed by C3+C5 |
| C5 | 8*7 + 0 + 8 = 64 | 11 | 5.8 | **Merged into C3** -- backward compat is "both empty" branch of C3 |
| C6 | 4*5 + 0 + 3 = 23 | 11 | 2.1 | No -- static config, low ROI |
| C7 | 9*8 + 0 + 9 = 81 | 38 | 2.1 | Yes (E2E #1) -- despite lower ROI ratio, covers critical full journey |

### Push-Down Analysis

- **C4** (out-of-bounds userPrompts[r]): Can be a unit test on `buildPrompt()` pure function. Removed from integration pool.
- **C5** (backward compat): The "both empty" branch in C3 already covers this. Merged.
- **C6** (i18n keys): Static verification -- can be a unit-level JSON key check. Removed from integration pool.

### Deduplication Check

No existing tests found in the project (confirmed via Glob search). No deduplication needed.

---

## Phase 4: Final Test Set

### Budget Enforcement

| Type | Budget | Used | Tests |
|------|--------|------|-------|
| Integration | MAX 3 | 3/3 | INT-1, INT-2, INT-3 |
| E2E | MAX 2 | 1/2 | E2E-1 |

---

## Integration Test Skeletons

**Recommended Framework**: Vitest + React Testing Library (for component tests) + direct function import (for backend logic tests). No framework is currently installed -- these are framework-agnostic skeletons.

**File**: `__tests__/per-reference-prompts.int.test.ts` (to be created when framework is installed)

```typescript
// Per-Reference-Image Prompts Integration Tests
// Design Doc: docs/design/per-reference-prompts.md
// Generated: 2026-03-02 | Budget Used: 3/3 integration, 1/2 E2E

// ============================================================================
// INT-1: Accordion visibility and per-ref prompt state sync
// ============================================================================
// AC1: "Given batch mode is active and 2+ reference images are uploaded,
//        When the user views the prompt section,
//        Then collapsible panels appear below the global prompt, one per reference image"
// AC5: "When the user adds a new reference image, Then a new empty accordion panel appears;
//        When the user removes reference image at index i, Then panel at index i is removed
//        and per-ref prompts for other indices are preserved in correct order"
// AC6: "Given batch mode with exactly 1 reference image, Then only the global prompt is shown"
//
// Behavior: User adds/removes batch references → batchUserPrompts[] array stays
//           synchronized in length and index alignment with batchRefs[]
// ROI: 63/11 = 5.7 | Business Value: 7 | Frequency: 8 (batch is primary workflow)
// @category: core-functionality
// @dependency: AestheticMirrorForm (component state management)
// @complexity: medium

describe('INT-1: Accordion visibility and per-ref prompt state sync', () => {

  // --- Setup ---
  // Arrange: Render AestheticMirrorForm in batch mode
  // Mock: useCredits (return sufficient credits), useTranslations (return key passthrough),
  //       uploadFile/analyzeSingle (not called in this test)
  // Note: Mock only external I/O boundaries (Supabase, API calls).
  //       Do NOT mock React state hooks or internal component logic.

  test('INT-1a: No accordion panels when batchRefs has 0 or 1 images', () => {
    // Arrange: Render component in batch mode with 0 reference images
    // Act: Query for per-ref prompt panel elements
    // Assert: No per-ref prompt panels exist in the DOM
    //
    // Arrange: Simulate adding exactly 1 reference image
    // Act: Query for per-ref prompt panels
    // Assert: Still no per-ref prompt panels (only global prompt textarea visible)
    //
    // Verification items:
    // - Accordion section container is not rendered when batchRefs.length <= 1
    // - Global prompt textarea remains visible and functional
    // Pass criteria: Zero accordion panel elements in DOM for 0 and 1 ref images
  })

  test('INT-1b: Accordion panels appear and sync when adding 3 refs, removing middle ref', () => {
    // Arrange: Render component in batch mode
    // Act (Step 1): Simulate adding 3 reference image files
    // Assert: 3 per-ref prompt panels are rendered
    // Assert: batchUserPrompts internal state has length 3, all empty strings
    //
    // Act (Step 2): Type "autumn tones" into panel #2 (index 1)
    // Assert: Panel #2 textarea contains "autumn tones"
    //
    // Act (Step 3): Remove reference image at index 1 (the middle one)
    // Assert: 2 per-ref prompt panels remain
    // Assert: Panel #1 retains its original value (empty)
    // Assert: Panel #2 (formerly #3) retains its original value (empty)
    // Assert: "autumn tones" text is gone (it was on the removed panel)
    //
    // Verification items:
    // - Panel count matches batchRefs.length after each mutation
    // - Prompt text is correctly index-aligned after removal
    // - Adding images appends empty strings, not undefined
    // Pass criteria: Array length always equals ref count; index alignment preserved after removal
  })
})

// ============================================================================
// INT-2: API payload contract -- userPrompts[] inclusion/omission
// ============================================================================
// AC3: "Given the user has entered text in one or more per-reference prompt panels,
//        When the user clicks Generate,
//        Then the API request includes userPrompts: string[] with length equal to
//        referenceImages.length"
//
// Behavior: User fills per-ref prompts and submits → analyzeSingle called with
//           userPrompts array; user leaves all per-ref prompts empty → userPrompts
//           is undefined in the request
// ROI: 80/11 = 7.3 | Business Value: 8 | Frequency: 9 (every batch submission)
// @category: integration
// @dependency: AestheticMirrorForm, analyzeSingle (edge-functions.ts), uploadFile
// @complexity: high

describe('INT-2: API payload includes/omits userPrompts correctly', () => {

  // --- Setup ---
  // Arrange: Render AestheticMirrorForm in batch mode
  // Mock: uploadFile → resolves with { publicUrl: 'https://mock-url/img-N.jpg' }
  //       analyzeSingle → spy that captures the params argument, resolves with { job_id: 'test-job' }
  //       processGenerationJob → resolves immediately
  //       useCredits → sufficient credits
  // Note: Only mock I/O boundaries. analyzeSingle spy captures the contract.

  test('INT-2a: userPrompts[] included when at least one per-ref prompt is non-empty', () => {
    // Arrange: Add 3 reference images, 1 product image
    //          Set per-ref prompt at index 1 to "warm autumn tones"
    //          Set global prompt to "Professional style"
    // Act: Click Generate button, wait for analyzeSingle to be called
    // Assert: analyzeSingle was called with params containing:
    //   - mode: 'batch'
    //   - userPrompt: 'Professional style'
    //   - userPrompts: ['', 'warm autumn tones', '']  (length 3, matching referenceImages)
    //   - referenceImages: [url1, url2, url3]  (length 3)
    //   - userPrompts.length === referenceImages.length
    //
    // Verification items:
    // - userPrompts field is present (not undefined)
    // - userPrompts is an array of strings
    // - userPrompts.length equals referenceImages.length exactly
    // - Empty per-ref prompts are empty strings, not omitted
    // - Trimming applied: leading/trailing whitespace removed
    // Pass criteria: analyzeSingle spy's captured argument satisfies all verification items
  })

  test('INT-2b: userPrompts omitted when all per-ref prompts are empty/whitespace', () => {
    // Arrange: Add 2 reference images, 1 product image
    //          Leave all per-ref prompts empty (default state)
    //          Set global prompt to "Some global text"
    // Act: Click Generate button, wait for analyzeSingle to be called
    // Assert: analyzeSingle was called with params where:
    //   - userPrompts is undefined (not present in the object)
    //   - userPrompt: 'Some global text'
    //   - mode: 'batch'
    //
    // Verification items:
    // - 'userPrompts' key does not exist in the params object (or is explicitly undefined)
    // - Global userPrompt is still sent normally
    // - This matches backward-compatible behavior for old clients
    // Pass criteria: analyzeSingle spy's captured argument has no userPrompts property
  })
})

// ============================================================================
// INT-3: Backend buildPrompt merges global + per-ref across all 4 combinations
// ============================================================================
// AC4: "Given the worker processes a batch unit with reference_index = r,
//        When buildPrompt() is called, Then:
//        - Both non-empty: 'Additional instructions: {global}. {perRef}'
//        - Global only:    'Additional instructions: {global}'
//        - PerRef only:    'Additional instructions: {perRef}'
//        - Both empty:     No 'Additional instructions' appended"
// AC8 (backward compat): "Given a client sends batch request without userPrompts,
//        When the backend processes the job, Then behavior is identical to current
//        implementation (global userPrompt only)"
//
// Behavior: buildPrompt() receives unit with reference_index → looks up
//           userPrompts[reference_index] → merges with global userPrompt →
//           appends as "Additional instructions" or omits entirely
// ROI: 90/11 = 8.2 | Business Value: 9 (prompt correctness = output quality) | Frequency: 9
// @category: core-functionality
// @dependency: buildPrompt function (process-generation-job/index.ts)
// @complexity: high
//
// Note: buildPrompt is currently defined as a closure inside the Deno.serve handler
// in process-generation-job/index.ts (line 1271). To test it directly, it must be
// extracted into an importable function. If extraction is not feasible, test via
// the full edge function with a mock Supabase client.
//
// Contract for buildPrompt (from design doc):
//   Input: unit (with reference_index), analysisPrompt?, refinementAnalysisPrompt?
//   Closure vars: userPrompt (string), userPrompts (string[]), aspectRatio, requestSize, backgroundMode
//   Output: string (the merged prompt)

describe('INT-3: buildPrompt merges global and per-ref prompts correctly', () => {

  // --- Setup ---
  // Option A (preferred): Extract buildPrompt to a testable pure function
  //   import { buildPrompt } from 'supabase/functions/process-generation-job/prompt-builder'
  //   Arrange: Provide userPrompt, userPrompts, aspectRatio, requestSize as parameters
  //
  // Option B (if extraction not feasible): Test via full edge function
  //   Mock: Supabase client (generation_jobs read), image generation API
  //   Arrange: Insert job with specific payload, invoke process-generation-job
  //   Capture: The prompt string passed to the image generation call

  test('INT-3a: Both global and per-ref non-empty → merged with period separator', () => {
    // Arrange:
    //   userPrompt = "Professional e-commerce style"
    //   userPrompts = ["", "warm autumn tones", ""]
    //   unit = { mode: 'batch', reference_index: 1, ... }
    //   analysisPrompt = "Detailed style analysis text..."
    // Act: Call buildPrompt(unit, analysisPrompt)
    // Assert: Result string contains exactly:
    //   'Additional instructions: Professional e-commerce style. warm autumn tones'
    //
    // Verification items:
    // - "Additional instructions:" prefix is present
    // - Global prompt appears first
    // - Period-space separator between global and per-ref
    // - Per-ref prompt appears second
    // - No double periods or trailing periods
    // Pass criteria: Exact substring match for the "Additional instructions" segment
  })

  test('INT-3b: Only global prompt → no per-ref appended', () => {
    // Arrange:
    //   userPrompt = "Professional e-commerce style"
    //   userPrompts = ["", "", ""]
    //   unit = { mode: 'batch', reference_index: 0, ... }
    //   analysisPrompt = "Detailed style analysis text..."
    // Act: Call buildPrompt(unit, analysisPrompt)
    // Assert: Result string contains:
    //   'Additional instructions: Professional e-commerce style'
    // Assert: Result string does NOT contain a trailing period after the global prompt
    //
    // Verification items:
    // - "Additional instructions:" present with global text only
    // - No stray separator artifacts (". " without following text)
    // Pass criteria: "Additional instructions: Professional e-commerce style" exact match
  })

  test('INT-3c: Only per-ref prompt → global omitted from merge', () => {
    // Arrange:
    //   userPrompt = ""  (empty global)
    //   userPrompts = ["", "warm autumn tones", ""]
    //   unit = { mode: 'batch', reference_index: 1, ... }
    //   analysisPrompt = "Detailed style analysis text..."
    // Act: Call buildPrompt(unit, analysisPrompt)
    // Assert: Result string contains:
    //   'Additional instructions: warm autumn tones'
    // Assert: No leading period or empty global artifact
    //
    // Verification items:
    // - "Additional instructions:" present with per-ref text only
    // - No ". warm autumn tones" (leading period from empty global)
    // Pass criteria: "Additional instructions: warm autumn tones" exact match
  })

  test('INT-3d: Both empty → no Additional instructions line (backward compat AC8)', () => {
    // Arrange:
    //   userPrompt = ""
    //   userPrompts = []  (empty array, simulating no userPrompts in payload)
    //   unit = { mode: 'batch', reference_index: 0, ... }
    //   analysisPrompt = "Detailed style analysis text..."
    // Act: Call buildPrompt(unit, analysisPrompt)
    // Assert: Result string does NOT contain "Additional instructions"
    //
    // Verification items:
    // - "Additional instructions" substring is absent from the result
    // - The rest of the prompt (analysisPrompt, image instructions, aspect ratio) is intact
    // - This matches the current behavior when no userPrompts field exists
    // Pass criteria: No "Additional instructions" in output; all other prompt parts present
  })

  test('INT-3e: Backward compat -- undefined userPrompts array treated as empty (AC8)', () => {
    // Arrange:
    //   userPrompt = "Global only text"
    //   userPrompts = []  (simulating payload.userPrompts being absent → defaults to [])
    //   unit = { mode: 'batch', reference_index: 0, ... }
    //   analysisPrompt = "Style analysis..."
    // Act: Call buildPrompt(unit, analysisPrompt)
    // Assert: Result contains 'Additional instructions: Global only text'
    // Assert: Behaves identically to pre-feature behavior
    //
    // Verification items:
    // - Empty userPrompts array produces same result as the array not existing at all
    // - Global prompt still works independently
    // Pass criteria: Output identical to INT-3b (global-only scenario)
  })
})
```

---

## E2E Test Skeleton

**Recommended Framework**: Playwright (recommended for Next.js 14 E2E testing).

**File**: `__tests__/per-reference-prompts.e2e.test.ts` (to be created when framework is installed)

**Implementation Timing**: After all feature implementations complete (Phase 4 of work plan)

```typescript
// Per-Reference-Image Prompts E2E Test
// Design Doc: docs/design/per-reference-prompts.md
// Generated: 2026-03-02 | Budget Used: 1/2 E2E
// Test Type: End-to-End Test
// Implementation Timing: After all feature implementations complete

// ============================================================================
// E2E-1: Complete batch mode flow with per-reference prompts
// ============================================================================
// User Journey: Navigate to Aesthetic Mirror → Switch to batch mode → Upload
//   3 reference images + 1 product image → Enter global prompt → Enter per-ref
//   prompt for ref #2 → Submit → Verify API request payload → Verify job created
//
// ROI: 81/38 = 2.1 | Business Value: 9 (core feature) | Frequency: 8 | Legal: false
// Covers: AC1, AC3, AC4, AC5, AC7, AC8 (full journey through all ACs)
// @category: e2e
// @dependency: full-system (Next.js app, Supabase Edge Functions, Supabase DB)
// @complexity: high

describe('E2E-1: Batch mode with per-reference prompts -- complete flow', () => {

  // --- Environment Setup ---
  // Preconditions:
  //   - Authenticated user session with sufficient credits (>= 15 credits for 3 refs)
  //   - Test image files available (3 reference images, 1 product image)
  //   - Edge functions deployed with per-reference prompt support
  //   - Supabase DB accessible
  //
  // Teardown:
  //   - Cancel any in-progress generation jobs
  //   - Clean up uploaded test images from storage

  test('E2E-1: Upload refs, enter per-ref prompts, submit, verify payload reaches backend', () => {
    // --- STEP 1: Navigate and switch to batch mode ---
    // Act: Navigate to /en/studio/aesthetic-mirror (or /zh/ for i18n variant)
    // Act: Switch to batch mode tab
    // Assert: Batch mode UI is active (product image upload area + multi-ref upload area visible)

    // --- STEP 2: Upload reference images ---
    // Act: Upload 3 reference image files to the batch reference upload area
    // Assert: 3 reference image thumbnails appear in the upload area
    // Assert: Accordion section appears below global prompt textarea (AC1: >1 refs)
    // Assert: 3 collapsible panels visible, each with a thumbnail and filename (AC2)
    // Assert: Section title displays "Per-Reference Prompts" (en) or "单图提示词" (zh) (AC7)

    // --- STEP 3: Upload product image ---
    // Act: Upload 1 product image to the product upload area
    // Assert: Product image thumbnail appears

    // --- STEP 4: Enter prompts ---
    // Act: Type "Professional e-commerce style" in the global prompt textarea
    // Act: Expand accordion panel #2 (click the header of the second panel)
    // Assert: Panel #2's textarea is now visible
    // Act: Type "warm autumn tones, golden hour lighting" in panel #2's textarea
    // Assert: Panel #2 textarea contains the typed text

    // --- STEP 5: Verify dynamic sync -- add a 4th ref (AC5) ---
    // Act: Upload 1 more reference image (total becomes 4)
    // Assert: 4 accordion panels now visible
    // Assert: Panel #2 still contains "warm autumn tones, golden hour lighting"
    // Assert: Panel #4 (new) has an empty textarea

    // --- STEP 6: Verify dynamic sync -- remove ref #3 (AC5) ---
    // Act: Remove reference image at index 2 (third image)
    // Assert: 3 accordion panels remain
    // Assert: Panel #1 is empty, Panel #2 still has "warm autumn tones...",
    //         Panel #3 (formerly #4) is empty
    // Assert: Prompts are correctly index-aligned after removal

    // --- STEP 7: Submit and verify API payload (AC3) ---
    // Setup: Intercept network request to analyze-single edge function
    // Act: Click Generate button
    // Assert (from intercepted request):
    //   - Request body contains mode: 'batch'
    //   - Request body contains userPrompt: 'Professional e-commerce style'
    //   - Request body contains userPrompts: ['', 'warm autumn tones, golden hour lighting', '']
    //   - userPrompts.length === referenceImages.length === 3
    //   - Request body contains referenceImages array of length 3
    //   - Request body contains productImage (non-empty string)

    // --- STEP 8: Verify backend acceptance ---
    // Assert: API response status is 200
    // Assert: Response body contains { job_id: <string>, status: 'processing' }
    // Assert: No BATCH_INPUT_INVALID error returned

    // --- STEP 9: Verify backward compat by absence (AC8) ---
    // (Implicit: If we had submitted with all per-ref prompts empty,
    //  userPrompts would be omitted from the request. This is covered
    //  by INT-2b at the integration level. E2E confirms the happy path.)

    // Verification items:
    // - Accordion UI appears for >1 refs, disappears for <=1
    // - Per-ref prompt state survives add/remove operations with correct index alignment
    // - API payload includes correctly structured userPrompts array
    // - Backend accepts the payload and creates a job
    // - i18n labels render in the selected locale
    // Pass criteria: All assertions pass; job enters 'processing' status
  })
})
```

---

## Supplementary: Backend Validation Test Candidates (Deferred to Unit Level)

These candidates were filtered out of the integration budget but are documented here for unit test implementation planning.

```typescript
// UNIT-CANDIDATE-1: analyze-single validation of userPrompts
// AC: AC3 (validation boundary) + AC8 (backward compat)
// @category: edge-case
// @dependency: analyze-single edge function
// @complexity: low
//
// Test cases (to be implemented as unit tests on the edge function):
//   - userPrompts length mismatch with referenceImages → 400 BATCH_INPUT_INVALID
//   - userPrompts is not an array (e.g., string) → 400 BATCH_INPUT_INVALID
//   - userPrompts contains non-string element (e.g., number) → 400 BATCH_INPUT_INVALID
//   - userPrompts is undefined/absent → 200 OK (backward compat)
//   - userPrompts with correct length and all strings → 200 OK

// UNIT-CANDIDATE-2: i18n key existence check
// AC: AC7
// @category: edge-case
// @dependency: messages/en.json, messages/zh.json
// @complexity: low
//
// Test cases:
//   - en.json contains studio.aestheticMirror.perRefPromptTitle
//   - en.json contains studio.aestheticMirror.perRefLabel
//   - en.json contains studio.aestheticMirror.perRefPlaceholder
//   - zh.json contains the same 3 keys
//   - All values are non-empty strings

// UNIT-CANDIDATE-3: buildPrompt with out-of-bounds reference_index
// AC: AC4 (error handling)
// @category: edge-case
// @dependency: buildPrompt function
// @complexity: low
//
// Test case:
//   - userPrompts = ["a", "b"], unit.reference_index = 5
//   - Expected: Falls back gracefully (no crash), treats as empty per-ref prompt
```

---

## Implementation Notes

### Framework Recommendation

Given the project has no test framework installed, the recommended setup is:

1. **Vitest** for integration tests (fast, native TypeScript/ESM, good Next.js compatibility)
2. **Playwright** for E2E tests (official Next.js recommendation, network interception support)
3. **React Testing Library** for component interaction tests (INT-1, INT-2)

### Test Extraction Requirement for INT-3

The `buildPrompt` function is currently defined as a closure inside `process-generation-job/index.ts` (line 1271). To enable direct testing (INT-3), it should be extracted into a separate importable module, e.g.:

```
supabase/functions/process-generation-job/prompt-builder.ts
```

This extraction has zero runtime impact (pure function, no side effects) and enables both unit and integration testing of the prompt merge logic without invoking the full edge function.

### Mock Boundaries (Contract Safety)

Per testing-principles skill requirements, mocks are restricted to external I/O boundaries:

| Mock Target | Justification |
|-------------|---------------|
| `analyzeSingle` (in INT-2) | Network call to Supabase Edge Function |
| `uploadFile` (in INT-2) | Network call to Supabase Storage |
| `useCredits` (in INT-1, INT-2) | Supabase DB query |
| `createClient` (in INT-1, INT-2) | Supabase client instantiation |
| Supabase DB client (in INT-3 Option B) | Database read/write |

**Not mocked** (real implementations used):
- React state management (`useState`, `useCallback`)
- Component rendering logic
- `buildPrompt` pure function logic
- Array manipulation (add/remove sync logic)
