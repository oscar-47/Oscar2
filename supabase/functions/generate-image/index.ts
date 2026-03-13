import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser, isAdminEmail, isToApisModel } from "../_shared/auth.ts";
import { assertUserCanQueueJob } from "../_shared/generation-queue.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  normalizeRequestedModel,
} from "../_shared/generation-config.ts";
import {
  resolvePromptProfile,
  TA_PRO_PROMPT_PROFILE_FLAG,
} from "../_shared/prompt-profile.ts";
import { getBooleanSystemConfig } from "../_shared/system-config.ts";
import {
  getAdminImageModelConfigs,
  getEffectiveCreditCostForModel,
  getEffectiveDefaultImageSizeForModel,
  isAdminOnlyDynamicModel,
  isEffectiveImageSizeSupportedForModel,
} from "../_shared/admin-model-config.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.model !== "string" || typeof body.prompt !== "string") {
    return err("BAD_REQUEST", "model and prompt are required");
  }

  const normalizedModel = normalizeRequestedModel(String(body.model));
  const adminModelConfigs = await getAdminImageModelConfigs();
  if ((isToApisModel(normalizedModel) || isAdminOnlyDynamicModel(adminModelConfigs, normalizedModel)) && !isAdminEmail(authResult.user.email)) {
    return err("MODEL_RESTRICTED", "This model is only available to admin users", 403);
  }
  const taProPromptProfileEnabled = await getBooleanSystemConfig(TA_PRO_PROMPT_PROFILE_FLAG, false);
  const promptProfile = resolvePromptProfile({
    requestedProfile: body.promptProfile ?? body.prompt_profile,
    model: normalizedModel,
    enabled: taProPromptProfileEnabled,
  });
  const imageSize = body.imageSize == null
    ? getEffectiveDefaultImageSizeForModel(adminModelConfigs, normalizedModel)
    : String(body.imageSize);
  if (!isEffectiveImageSizeSupportedForModel(adminModelConfigs, normalizedModel, imageSize, { includeInternal: true })) {
    return err("IMAGE_SIZE_UNSATISFIED", `imageSize ${imageSize} is not supported for model ${normalizedModel}`, 400);
  }
  const cost = getEffectiveCreditCostForModel(adminModelConfigs, normalizedModel, imageSize);
  const workflowMode = String(body.workflowMode ?? "product");

  if (workflowMode === "model" && typeof body.modelImage !== "string") {
    return err("BAD_REQUEST", "modelImage is required when workflowMode is model");
  }

  // Quick Edit / Text Edit fields (optional)
  const editMode = Boolean(body.editMode ?? false);
  const editType = typeof body.editType === "string" ? body.editType : null;
  const originalImage = typeof body.originalImage === "string" ? body.originalImage : null;
  const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages.filter((x: unknown) => typeof x === "string") : [];
  const textEdits = typeof body.textEdits === "object" && body.textEdits !== null ? body.textEdits as Record<string, string> : null;

  const payload = {
    ...body,
    model: normalizedModel,
    imageSize,
    promptProfile,
    prompt_profile: promptProfile,
    workflowMode,
    editMode,
    editType,
    originalImage,
    referenceImages,
    ...(textEdits ? { textEdits } : {}),
    modelImage: workflowMode === "model" && typeof body.modelImage === "string"
      ? body.modelImage
      : body.modelImage ?? null,
    metadata: {
      ...(typeof body.metadata === "object" && body.metadata ? body.metadata as Record<string, unknown> : {}),
      prompt_profile: promptProfile,
      ...(editMode ? { is_edit: true, edit_type: editType } : {}),
      ...(textEdits ? { text_edits: textEdits } : {}),
      ...(originalImage ? { original_image_url: originalImage } : {}),
    },
  };

  // Rate limit: per-minute across all job types
  const rateCheck = await checkRateLimit(authResult.user.id);
  if (!rateCheck.ok) {
    return err("RATE_LIMIT_EXCEEDED", "Too many requests. Please slow down.", 429, {
      count: rateCheck.count,
      limit: rateCheck.limit,
    });
  }

  const supabase = createServiceClient();
  const queueGate = await assertUserCanQueueJob(authResult.user.id, "IMAGE_GEN");
  if (!queueGate.ok) {
    return err("TOO_MANY_ACTIVE_JOBS", "Too many image generation jobs are already processing. Please wait for one to finish.", 429, {
      active: queueGate.activeCount,
      limit: queueGate.limit,
      type: "IMAGE_GEN",
    });
  }
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: authResult.user.id,
      type: "IMAGE_GEN",
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
    return err("IMAGE_JOB_CREATE_FAILED", "failed to create image generation job", 500, error);
  }

  const { error: taskError } = await supabase
    .from("generation_job_tasks")
    .insert({
      job_id: data.id,
      task_type: "IMAGE_GEN",
      status: "queued",
      payload,
    });

  if (taskError) {
    await supabase.from("generation_jobs").update({
      status: "failed",
      error_code: "IMAGE_JOB_CREATE_FAILED",
      error_message: `Failed to enqueue image task: ${taskError.message}`,
    }).eq("id", data.id);
    return err("IMAGE_JOB_CREATE_FAILED", "failed to enqueue image task", 500, taskError);
  }

  // Queue-only endpoint: return immediately; processing runs via process-generation-job worker.
  return ok({ job_id: data.id, status: "processing" });
});
