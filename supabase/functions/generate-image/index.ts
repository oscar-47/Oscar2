import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

function computeCost(_model: string, turboEnabled: boolean, imageSize: string): number {
  if (!turboEnabled) return 5;
  if (imageSize === "1K") return 8;
  if (imageSize === "2K") return 12;
  return 17;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.model !== "string" || typeof body.prompt !== "string") {
    return err("BAD_REQUEST", "model and prompt are required");
  }

  const imageSize = String(body.imageSize ?? "2K");
  const turboEnabled = Boolean(body.turboEnabled ?? false);
  const cost = computeCost(String(body.model), turboEnabled, imageSize);
  const workflowMode = String(body.workflowMode ?? "product");

  if (workflowMode === "model" && typeof body.modelImage !== "string") {
    return err("BAD_REQUEST", "modelImage is required when workflowMode is model");
  }

  const payload = {
    ...body,
    workflowMode,
    modelImage: workflowMode === "model" && typeof body.modelImage === "string"
      ? body.modelImage
      : body.modelImage ?? null,
    metadata: {
      ...(typeof body.metadata === "object" && body.metadata ? body.metadata as Record<string, unknown> : {}),
    },
  };

  const supabase = createServiceClient();
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
