import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.productImage !== "string") {
    return err("BAD_REQUEST", "productImage is required");
  }

  const supabase = createServiceClient();
  const payload = {
    ...body,
    outputLanguage: String(body.outputLanguage ?? body.targetLanguage ?? body.uiLanguage ?? "en"),
    promptConfigKey: String(body.promptConfigKey ?? "batch_analysis_prompt_en"),
  };

  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: authResult.user.id,
      type: "ANALYSIS",
      status: "processing",
      payload,
      cost_amount: 0,
      trace_id: body.trace_id ?? null,
      client_job_id: body.client_job_id ?? null,
      fe_attempt: Number(body.fe_attempt ?? 1),
    })
    .select("id")
    .single();

  if (error || !data) {
    return err("ANALYSIS_CREATE_FAILED", "failed to create analysis job", 500, error);
  }

  const { error: taskError } = await supabase
    .from("generation_job_tasks")
    .insert({
      job_id: data.id,
      task_type: "ANALYSIS",
      status: "queued",
      payload,
    });

  if (taskError) {
    await supabase.from("generation_jobs").update({
      status: "failed",
      error_code: "ANALYSIS_CREATE_FAILED",
      error_message: `Failed to enqueue analysis task: ${taskError.message}`,
    }).eq("id", data.id);
    return err("ANALYSIS_CREATE_FAILED", "failed to enqueue analysis task", 500, taskError);
  }

  // Queue-only endpoint: return immediately; processing runs via process-generation-job worker.
  return ok({ job_id: data.id, status: "processing" });
});
