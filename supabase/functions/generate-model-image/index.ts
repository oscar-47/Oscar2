import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(values: unknown): string {
  if (!Array.isArray(values)) return "";
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function buildModelPortraitPrompt(params: {
  gender: string;
  ageRange: string;
  ethnicity: string;
  extraPrompt: string;
  uiLanguage: string;
}): string {
  const { gender, ageRange, ethnicity, extraPrompt, uiLanguage } = params;
  if (uiLanguage === "zh") {
    const segments = [
      "专业棚拍人像，时尚电商模特参考图。",
      gender ? `性别特征：${gender}。` : "",
      ageRange ? `年龄段：${ageRange}。` : "",
      ethnicity ? `人群特征：${ethnicity}。` : "",
      "自然站姿，镜头正面或微侧，五官清晰，皮肤质感真实。",
      "纯净白色背景，柔和影棚光，高清细节，无水印无文字。",
      extraPrompt ? `补充要求：${extraPrompt}` : "",
    ].filter(Boolean);
    return segments.join(" ");
  }

  const segments = [
    "Professional studio portrait for a fashion e-commerce model reference.",
    gender ? `Gender presentation: ${gender}.` : "",
    ageRange ? `Age range: ${ageRange}.` : "",
    ethnicity ? `Ethnicity: ${ethnicity}.` : "",
    "Natural standing pose, frontal or slight angle, clear facial features, realistic skin texture.",
    "Pure white background, soft studio lighting, high-detail quality, no watermark, no text.",
    extraPrompt ? `Additional requirements: ${extraPrompt}` : "",
  ].filter(Boolean);
  return segments.join(" ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return err("BAD_REQUEST", "request body is required");

  const gender = normalizeText(body.gender);
  const ageRange = normalizeText(body.ageRange || body.age);
  const ethnicity = normalizeText(body.ethnicity || body.skinColor || body.skin);
  const extraPrompt = normalizeText(body.otherRequirements || body.prompt);
  const sourceImage = normalizeText(body.productImage)
    || firstString(body.productImages)
    || normalizeText(body.modelImage);
  const uiLanguage = normalizeText(body.uiLanguage || body.targetLanguage || "en").toLowerCase() === "zh"
    ? "zh"
    : "en";
  const requestedCount = clampInt(body.imageCount ?? body.count ?? 1, 1, 4, 1);
  const imageCount = 1;

  if (!sourceImage) {
    return err("BAD_REQUEST", "productImage is required");
  }

  if (!gender && !ageRange && !ethnicity && !extraPrompt) {
    return err("BAD_REQUEST", "at least one of gender/ageRange/ethnicity/otherRequirements is required");
  }

  const portraitPrompt = buildModelPortraitPrompt({
    gender,
    ageRange,
    ethnicity,
    extraPrompt,
    uiLanguage,
  });

  const supabase = createServiceClient();

  const generateImagePayload = {
    model: typeof body.model === "string" ? body.model : "flux-kontext-pro",
    prompt: portraitPrompt,
    productImage: sourceImage,
    workflowMode: "product",
    aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : "3:4",
    imageSize: typeof body.imageSize === "string" ? body.imageSize : "1K",
    turboEnabled: Boolean(body.turboEnabled ?? false),
    imageCount,
    trace_id: body.trace_id ?? null,
    client_job_id: body.client_job_id ?? null,
    fe_attempt: Number(body.fe_attempt ?? 1),
    metadata: {
      ...(typeof body.metadata === "object" && body.metadata ? body.metadata as Record<string, unknown> : {}),
      workflow_mode: "model",
      model_profile: { gender, age_range: ageRange, ethnicity },
      requested_count: requestedCount,
    },
  };

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!supabaseUrl) {
    return err("INTERNAL_ERROR", "SUPABASE_URL is required", 500);
  }
  const functionBaseUrl = `${supabaseUrl}/functions/v1`;
  const invokeResponse = await fetch(`${functionBaseUrl}/generate-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authResult.token}`,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify(generateImagePayload),
  });

  const invokeJson = await invokeResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!invokeResponse.ok || !invokeJson || typeof invokeJson.job_id !== "string") {
    return err(
      "MODEL_IMAGE_GENERATE_FAILED",
      "failed to create model image generation job",
      invokeResponse.status || 500,
      invokeJson,
    );
  }

  const { error: historyError } = await supabase
    .from("model_generation_history")
    .insert({
      job_id: invokeJson.job_id,
      user_id: authResult.user.id,
      gender: gender || "unspecified",
      age_range: ageRange || "unspecified",
      skin_color: ethnicity || "unspecified",
      other_requirements: extraPrompt || null,
      status: "processing",
      result_url: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    });

  if (historyError) {
    return err("MODEL_IMAGE_HISTORY_WRITE_FAILED", "failed to write model generation history", 500, historyError);
  }

  return ok({
    job_id: invokeJson.job_id,
    status: invokeJson.status ?? "processing",
    prompt: portraitPrompt,
    requested_count: requestedCount,
    image_count: imageCount,
  });
});
