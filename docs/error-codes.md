# Error Codes

All function errors follow:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable message",
    "details": { "optional": true }
  }
}
```

## Common

- `UNAUTHORIZED`: Missing or invalid JWT.
- `FORBIDDEN`: Authenticated but not allowed.
- `BAD_REQUEST`: Request validation failed.
- `NOT_FOUND`: Resource/package/job not found.
- `CONFLICT`: Duplicate webhook event or idempotency conflict.
- `INSUFFICIENT_CREDITS`: User credits not enough.
- `UPSTREAM_ERROR`: OpenRouter/Gemini/Stripe failure.
- `INTERNAL_ERROR`: Unexpected server error.

## Stripe-specific

- `STRIPE_SIGNATURE_INVALID`: Webhook signature verify failed.
- `STRIPE_PACKAGE_MISSING_PRICE`: Package missing Stripe price id.
- `STRIPE_CHECKOUT_CREATE_FAILED`: Stripe session creation failed.

## Generation-specific

- `ANALYSIS_CREATE_FAILED`: Failed to create analysis job.
- `ANALYSIS_FAILED`: Analysis worker execution failed.
- `PROMPT_STREAM_FAILED`: Failed during SSE generation.
- `IMAGE_JOB_CREATE_FAILED`: Failed to create image job.
- `IMAGE_INPUT_SOURCE_MISSING`: Missing uploaded source image.
- `IMAGE_INPUT_PROMPT_MISSING`: Missing prompt text.
- `TASK_CLAIM_FAILED`: Failed to claim queued task.
- `STYLE_REPLICATE_JOB_CREATE_FAILED`: Failed to create/enqueue style replicate job.
- `BATCH_INPUT_INVALID`: Invalid batch input payload.
- `BATCH_PRODUCT_IMAGE_REQUIRED`: Missing batch mode product image.
- `BATCH_REFERENCE_IMAGES_REQUIRED`: Missing or invalid batch mode references.
- `STYLE_REFERENCE_IMAGE_MISSING`: Missing single mode reference image.
- `STYLE_PRODUCT_IMAGE_MISSING`: Missing single mode product image.
- `REFINEMENT_PRODUCT_IMAGES_REQUIRED`: Missing or invalid refinement mode productImages.
- `REFINEMENT_BACKGROUND_MODE_INVALID`: Invalid refinement backgroundMode.
- `REFINEMENT_IMAGE_FORMAT_UNSUPPORTED`: Refinement mode image URLs must end with `.jpg` or `.png`.
- `MODEL_RATIO_UNSUPPORTED`: Requested ratio not satisfied by provider output.
- `MODEL_UNAVAILABLE`: Selected model is unavailable for the current endpoint/account.
- `MISSING_DOUBAO_IMAGE_API_KEY`: Doubao key not configured.
- `UPSTREAM_TIMEOUT`: Upstream generation request timed out.
- `BATCH_PARTIAL_FAILED`: Job succeeded with partial unit failures.
