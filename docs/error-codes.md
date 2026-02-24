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
