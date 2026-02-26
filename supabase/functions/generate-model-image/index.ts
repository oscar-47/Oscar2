import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

function computeCost(turboEnabled: boolean, imageSize: string): number {
  if (!turboEnabled) return 5; // nano-banana-pro default
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
  if (!body || typeof body.gender !== "string" || typeof body.ageRange !== "string" || typeof body.skinColor !== "string") {
    return err("BAD_REQUEST", "gender, ageRange, and skinColor are required");
  }

  const gender = String(body.gender);
  const ageRange = String(body.ageRange);
  const skinColor = String(body.skinColor);
  const otherRequirements = String(body.otherRequirements ?? "");
  const productImages = Array.isArray(body.productImages) ? body.productImages : [];
  const count = Number(body.count ?? 1);
  const turboEnabled = Boolean(body.turboEnabled ?? false);
  const imageSize = "2K"; // Fixed for model generation

  // Construct model portrait prompt
  const prompt = `Generate a professional fashion model portrait:
- Gender: ${gender}
- Age range: ${ageRange}
- Skin tone: ${skinColor}
${otherRequirements ? `- Additional requirements: ${otherRequirements}` : ""}
- Style: Clean studio lighting, neutral background, facing camera
- Format: Full body or 3/4 length shot suitable for clothing try-on

Professional e-commerce model photography. High-end commercial catalog quality. Studio lighting with soft shadows. Clean, premium aesthetic. Model is the hero — sharp focus, realistic skin tones and features. Neutral or white background. 4K ultra-detailed rendering.`;

  const supabase = createServiceClient();

  // Create IMAGE_GEN job for model generation
  const cost = computeCost(turboEnabled, imageSize) * count;
  const payload = {
    productImage: productImages[0] ?? "", // Use first product image as reference if available
    productImages,
    prompt,
    model: "nano-banana-pro",
    aspectRatio: "9:16",
    imageSize,
    turboEnabled,
    imageCount: count,
    workflowMode: "product",
    trace_id: body.trace_id,
    client_job_id: body.client_job_id,
    fe_attempt: body.fe_attempt ?? 1,
    metadata: {
      modelGeneration: true,
      gender,
      ageRange,
      skinColor,
      otherRequirements,
    },
  };

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
    return err("MODEL_GEN_CREATE_FAILED", "failed to create model generation job", 500, error);
  }

  // Write to model_generation_history
  const { error: historyError } = await supabase
    .from("model_generation_history")
    .insert({
      job_id: data.id,
      user_id: authResult.user.id,
      gender,
      age_range: ageRange,
      skin_color: skinColor,
      other_requirements: otherRequirements || null,
    });

  if (historyError) {
    console.error("Failed to write model generation history:", historyError);
    // Non-fatal — continue with job creation
  }

  // Create task
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
      error_code: "MODEL_GEN_CREATE_FAILED",
      error_message: `Failed to enqueue model task: ${taskError.message}`,
    }).eq("id", data.id);
    return err("MODEL_GEN_CREATE_FAILED", "failed to enqueue model task", 500, taskError);
  }

  return ok({ job_id: data.id, status: "processing" });
});
