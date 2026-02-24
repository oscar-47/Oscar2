# Backend/Frontend Integration Milestones

Date baseline: 2026-02-23.

## M1 Auth

Backend done when:
- Supabase auth trigger creates `profiles`.
- `signup_bonus_credits` is read from `system_config` (default 20).

Frontend done when:
- OTP signup + password login flow returns session.
- Profile credits are fetched from `profiles`.

Acceptance:
- New user signs up and sees initial credits immediately.

## M2 Upload

Backend done when:
- `POST /supabase/functions/v1/get-oss-sts` returns compatibility payload.
- Supports `STORAGE_PROVIDER=qiniu` with `uploadMethod=POST` and `formFields.token/key`.

Frontend done when:
- Upload component uses returned payload/path and stores in `temp/{uid}/...`.

Acceptance:
- Uploaded object path can be consumed by analyze endpoints.

## M3 Generation Chain

Backend done when:
- `analyze-product-v2`, `generate-prompts-v2` (SSE), `generate-image`, `analyze-single` all respond with contract shape.
- Realtime updates are emitted from `generation_jobs` updates.

Frontend done when:
- Studio Genesis 5-step orchestrator wired.
- Aesthetic Mirror single-endpoint flow wired.
- Clothing Studio and Refinement Studio mapped to their parameters.

Acceptance:
- User can complete all 4 workflows and see terminal job state.

## M4 Payment

Backend done when:
- `create-credit-checkout` + `create-onetime-checkout` create Stripe sessions.
- `stripe-webhook` is idempotent by `stripe_event_id`.

Frontend done when:
- Pricing page calls correct endpoint by tab.
- Success/cancel query params are handled.

Acceptance:
- Payment success leads to credits balance update.
