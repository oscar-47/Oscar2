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

  const clothingMode = typeof body.clothingMode === "string"
    ? body.clothingMode
    : "";
  const uiLang = String(body.uiLanguage ?? body.targetLanguage ?? "en");
  const isZh = uiLang.startsWith("zh");
  const promptConfigKey = typeof body.promptConfigKey === "string" && body.promptConfigKey.trim().length > 0
    ? body.promptConfigKey
    : clothingMode === "model_strategy"
    ? "clothing_model_tryon_strategy_prompt_zh"
    : isZh
    ? "batch_analysis_prompt_zh"
    : "batch_analysis_prompt_en";

  const supabase = createServiceClient();
  const payload = {
    ...body,
    modelImage: typeof body.modelImage === "string" ? body.modelImage : null,
    // Read flat fields first, fall back to nested objects for backwards compatibility
    mannequinEnabled: Boolean(body.mannequinEnabled ?? (body.mannequin as Record<string, unknown>)?.enabled ?? false),
    mannequinWhiteBackground: Boolean(body.mannequinWhiteBackground ?? (body.mannequin as Record<string, unknown>)?.whiteBackground ?? false),
    threeDEnabled: Boolean(body.threeDEnabled ?? (body.threeDEffect as Record<string, unknown>)?.enabled ?? false),
    threeDWhiteBackground: Boolean(body.threeDWhiteBackground ?? (body.threeDEffect as Record<string, unknown>)?.whiteBackground ?? false),
    whiteBackground: Boolean(body.whiteBackground ?? (body.whiteBgRetouched as Record<string, unknown>)?.front ?? (body.whiteBgRetouched as Record<string, unknown>)?.back ?? false),
    // Pass through type breakdown for AI prompt
    whiteBgFront: Boolean(body.whiteBgFront ?? (body.whiteBgRetouched as Record<string, unknown>)?.front ?? false),
    whiteBgBack: Boolean(body.whiteBgBack ?? (body.whiteBgRetouched as Record<string, unknown>)?.back ?? false),
    detailCloseupCount: Number(body.detailCloseupCount ?? (body.detailCloseup as Record<string, unknown>)?.count ?? 0),
    sellingPointCount: Number(body.sellingPointCount ?? (body.sellingPoint as Record<string, unknown>)?.count ?? 0),
    outputLanguage: String(body.outputLanguage ?? body.targetLanguage ?? body.uiLanguage ?? "en"),
    promptConfigKey,
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
