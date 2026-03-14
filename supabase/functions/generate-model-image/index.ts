import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
      "生成一张专业棚拍真人模特参考图，仅保留一位真人主体，只输出模特本人。",
      gender ? `性别特征：${gender}。` : "",
      ageRange ? `年龄段：${ageRange}。` : "",
      ethnicity ? `人群特征：${ethnicity}。` : "",
      "镜头为单人模特肖像，可半身或全身，自然站姿或轻微转身，构图干净，五官清晰，皮肤质感真实，比例自然。",
      "服装保持简洁中性的基础款纯色造型，避免夸张穿搭设计，重点是模特本人而不是服装搭配。",
      "纯净白色无缝背景，柔和影棚光，高级商业人像质感，无水印无文字，无海报排版。",
      "禁止出现任何商品、配饰展示、首饰盒、手提包、包装盒、桌面、陈列台、家具、布幔、花材、镜子、场景道具、额外人物或拼图分栏。",
      "不要让模特手持、接触、佩戴或靠近任何待售物件，画面中除了模特和基础服装之外不要出现其他主体。",
      extraPrompt ? `补充要求：${extraPrompt}` : "",
    ].filter(Boolean);
    return segments.join(" ");
  }

  const segments = [
    "Create a professional studio reference portrait with exactly one real human fashion model and nothing else as the subject.",
    gender ? `Gender presentation: ${gender}.` : "",
    ageRange ? `Age range: ${ageRange}.` : "",
    ethnicity ? `Ethnicity: ${ethnicity}.` : "",
    "Frame a single-model portrait or full-body studio shot with a natural standing pose or slight turn, realistic proportions, clear facial features, and natural skin texture.",
    "Keep wardrobe simple, neutral, and plain, like fitted basics, so the focus stays on the model reference rather than fashion styling.",
    "Use a pure white seamless studio background, soft diffused lighting, high-detail commercial portrait quality, no watermark, no text, no poster layout.",
    "Do not include any product, accessory display, jewelry case, handbag, packaging, table, pedestal, furniture, drapery, flowers, mirror, extra people, collage layout, or unrelated objects.",
    "Do not let the model hold, touch, wear, or stand beside any sale item or prop. The frame should contain only the model and the minimal neutral outfit.",
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
  const uiLanguage = normalizeText(body.uiLanguage || body.targetLanguage || "en").toLowerCase() === "zh"
    ? "zh"
    : "en";
  const requestedCount = clampInt(body.imageCount ?? body.count ?? 1, 1, 4, 1);
  const imageCount = 1;

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
    model: typeof body.model === "string" ? body.model : "or-gemini-3.1-flash",
    prompt: portraitPrompt,
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
      workflow_mode: "model_reference",
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
    const forwardedCode = typeof invokeJson?.code === "string" ? invokeJson.code : null;
    const forwardedMessage = typeof invokeJson?.message === "string"
      ? invokeJson.message
      : "failed to create model image generation job";
    return err(
      forwardedCode || "MODEL_IMAGE_GENERATE_FAILED",
      forwardedMessage,
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
