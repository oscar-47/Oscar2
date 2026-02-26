import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

function computeCost(model: string, turboEnabled: boolean, imageSize: string): number {
  if (!turboEnabled) return model === "nano-banana" ? 3 : 5;
  if (imageSize === "1K") return 8;
  if (imageSize === "2K") return 12;
  return 17;
}

function hasAllowedRefinementImageExtension(value: string): boolean {
  const lower = value.trim().toLowerCase();
  const normalized = lower.split("?")[0]?.split("#")[0] ?? lower;
  return normalized.endsWith(".jpg") || normalized.endsWith(".png");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return err("BAD_REQUEST", "invalid request body");

  const mode = body.mode === "batch"
    ? "batch"
    : body.mode === "refinement"
    ? "refinement"
    : "single";

  if (mode === "single") {
    if (typeof body.referenceImage !== "string" || !Array.isArray(body.productImages)) {
      return err("BAD_REQUEST", "referenceImage and productImages are required");
    }
    if (body.productImages.length < 1) {
      return err("BAD_REQUEST", "at least one product image is required");
    }
    if (body.productImages.some((x) => typeof x !== "string" || String(x).trim().length === 0)) {
      return err("BAD_REQUEST", "productImages must be non-empty strings");
    }
  } else if (mode === "batch") {
    if (!Array.isArray(body.referenceImages) || body.referenceImages.length < 1 || body.referenceImages.length > 12) {
      return err("BATCH_REFERENCE_IMAGES_REQUIRED", "referenceImages length must be within [1, 12]");
    }
    if (body.referenceImages.some((x) => typeof x !== "string" || String(x).trim().length === 0)) {
      return err("BATCH_INPUT_INVALID", "referenceImages must be non-empty strings");
    }
    if (typeof body.productImage !== "string" || body.productImage.trim().length === 0) {
      return err("BATCH_PRODUCT_IMAGE_REQUIRED", "productImage is required in batch mode");
    }
    const groupCount = Number(body.groupCount ?? 1);
    if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > 9) {
      return err("BATCH_INPUT_INVALID", "groupCount must be in [1, 9]");
    }
  } else {
    if (!Array.isArray(body.productImages)) {
      return err("REFINEMENT_PRODUCT_IMAGES_REQUIRED", "productImages are required in refinement mode");
    }
    if (body.productImages.length < 1 || body.productImages.length > 50) {
      return err("REFINEMENT_PRODUCT_IMAGES_REQUIRED", "productImages length must be within [1, 50]");
    }
    if (body.productImages.some((x) => typeof x !== "string" || String(x).trim().length === 0)) {
      return err("REFINEMENT_PRODUCT_IMAGES_REQUIRED", "productImages must be non-empty strings");
    }
    if (body.productImages.some((x) => typeof x === "string" && !hasAllowedRefinementImageExtension(x))) {
      return err("REFINEMENT_IMAGE_FORMAT_UNSUPPORTED", "refinement mode only supports .jpg and .png image URLs");
    }

    const backgroundMode = String(body.backgroundMode ?? "white");
    if (backgroundMode !== "white" && backgroundMode !== "original") {
      return err("REFINEMENT_BACKGROUND_MODE_INVALID", "backgroundMode must be white or original");
    }
    body.backgroundMode = backgroundMode;
  }

  const modelName = String(body.model ?? "doubao-seedream-4.5");
  const imageSize = String(body.imageSize ?? "2K");
  const imageCount = Math.max(1, Math.min(9, Number(body.imageCount ?? 1)));
  const groupCount = Math.max(1, Math.min(9, Number(body.groupCount ?? 1)));
  const productCount = mode === "single" || mode === "refinement"
    ? (Array.isArray(body.productImages) ? body.productImages.length : 0)
    : 1;
  const referenceCount = mode === "batch"
    ? (Array.isArray(body.referenceImages) ? body.referenceImages.length : 0)
    : 1;
  const requestedCount = mode === "batch"
    ? referenceCount * groupCount
    : mode === "refinement"
    ? productCount
    : productCount * imageCount;
  const turboEnabled = Boolean(body.turboEnabled ?? false);
  const unitCost = computeCost(modelName, turboEnabled, imageSize);
  const cost = unitCost * requestedCount;

  const payload = {
    ...body,
    mode,
    groupCount,
    metadata: {
      ...(typeof body.metadata === "object" && body.metadata ? body.metadata as Record<string, unknown> : {}),
    },
  };

  const supabase = createServiceClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("subscription_credits,purchased_credits")
    .eq("id", authResult.user.id)
    .single();

  if (profileError || !profile) {
    return err("PROFILE_NOT_FOUND", "failed to load profile for credit precheck", 500, profileError);
  }
  const totalCredits = Number(profile.subscription_credits ?? 0) + Number(profile.purchased_credits ?? 0);
  if (totalCredits < cost) {
    return err("INSUFFICIENT_CREDITS", "Not enough credits", 402, {
      required: cost,
      available: totalCredits,
    });
  }

  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: authResult.user.id,
      type: "STYLE_REPLICATE",
      status: "processing",
      payload,
      cost_amount: cost,
      trace_id: body.trace_id ?? null,
      client_job_id: body.client_job_id ?? null,
      fe_attempt: Number(body.fe_attempt ?? 1),
    })
    .select("id")
    .single();

  if (error || !data) {
    return err("STYLE_REPLICATE_JOB_CREATE_FAILED", "failed to create style replicate job", 500, error);
  }

  const { error: taskError } = await supabase
    .from("generation_job_tasks")
    .insert({
      job_id: data.id,
      task_type: "STYLE_REPLICATE",
      status: "queued",
      payload,
    });

  if (taskError) {
    await supabase.from("generation_jobs").update({
      status: "failed",
      error_code: "STYLE_REPLICATE_JOB_CREATE_FAILED",
      error_message: `Failed to enqueue style replicate task: ${taskError.message}`,
    }).eq("id", data.id);
    return err("STYLE_REPLICATE_JOB_CREATE_FAILED", "failed to enqueue style replicate task", 500, taskError);
  }

  return ok({ job_id: data.id, status: "processing" });
});
