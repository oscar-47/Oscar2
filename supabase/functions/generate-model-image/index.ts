import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildModelPortraitPrompt(params: {
  gender: string;
  age: string;
  skin: string;
  extraPrompt: string;
  uiLanguage: string;
}): string {
  const { gender, age, skin, extraPrompt, uiLanguage } = params;
  if (uiLanguage === "zh") {
    const segments = [
      "专业棚拍人像，时尚电商模特参考图。",
      gender ? `性别特征：${gender}。` : "",
      age ? `年龄段：${age}。` : "",
      skin ? `肤色：${skin}。` : "",
      "自然站姿，镜头正面或微侧，五官清晰，皮肤质感真实。",
      "纯净白色背景，柔和影棚光，高清细节，无水印无文字。",
      extraPrompt ? `补充要求：${extraPrompt}` : "",
    ].filter(Boolean);
    return segments.join(" ");
  }

  const segments = [
    "Professional studio portrait for a fashion e-commerce model reference.",
    gender ? `Gender presentation: ${gender}.` : "",
    age ? `Age range: ${age}.` : "",
    skin ? `Skin tone: ${skin}.` : "",
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
  const age = normalizeText(body.age);
  const skin = normalizeText(body.skin);
  const extraPrompt = normalizeText(body.prompt);
  const uiLanguage = normalizeText(body.uiLanguage || body.targetLanguage || "en").toLowerCase() === "zh"
    ? "zh"
    : "en";

  if (!gender && !age && !skin && !extraPrompt) {
    return err("BAD_REQUEST", "at least one of gender/age/skin/prompt is required");
  }

  const portraitPrompt = buildModelPortraitPrompt({
    gender,
    age,
    skin,
    extraPrompt,
    uiLanguage,
  });

  const supabase = createServiceClient();

  const generateImagePayload = {
    model: typeof body.model === "string" ? body.model : "nano-banana-pro",
    prompt: portraitPrompt,
    modelImage: typeof body.modelImage === "string" ? body.modelImage : null,
    workflowMode: "model",
    aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : "3:4",
    imageSize: typeof body.imageSize === "string" ? body.imageSize : "1K",
    turboEnabled: Boolean(body.turboEnabled ?? false),
    imageCount: Number(body.imageCount ?? 1),
    trace_id: body.trace_id ?? null,
    client_job_id: body.client_job_id ?? null,
    fe_attempt: Number(body.fe_attempt ?? 1),
    metadata: {
      ...(typeof body.metadata === "object" && body.metadata ? body.metadata as Record<string, unknown> : {}),
      workflow_mode: "model",
      model_profile: { gender, age, skin },
    },
  };

  const functionBaseUrl = `${Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "")}/functions/v1`;
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
      user_id: authResult.user.id,
      generation_job_id: invokeJson.job_id,
      gender: gender || null,
      age: age || null,
      skin: skin || null,
      prompt: portraitPrompt,
      metadata: {
        trace_id: body.trace_id ?? null,
        client_job_id: body.client_job_id ?? null,
      },
    });

  if (historyError) {
    return err("MODEL_IMAGE_HISTORY_WRITE_FAILED", "failed to write model generation history", 500, historyError);
  }

  return ok({
    job_id: invokeJson.job_id,
    status: invokeJson.status ?? "processing",
    prompt: portraitPrompt,
  });
});
