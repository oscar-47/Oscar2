import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  callQnChatAPI,
  callQnImageAPI,
  extractGeneratedImageBase64,
  getQnChatConfig,
  aspectRatioToSize,
} from "../_shared/qn-image.ts";

type GenerationJobRow = {
  id: string;
  user_id: string;
  type: "ANALYSIS" | "IMAGE_GEN" | "STYLE_REPLICATE";
  status: "processing" | "success" | "failed";
  payload: Record<string, unknown>;
  cost_amount: number;
};

type TaskRow = {
  id: string;
  job_id: string;
  task_type: "ANALYSIS" | "IMAGE_GEN";
  status: "queued" | "running" | "success" | "failed";
  attempts: number;
  payload: Record<string, unknown>;
};

type BlueprintImagePlan = {
  title: string;
  description: string;
  design_content: string;
};

type AnalysisBlueprint = {
  images: BlueprintImagePlan[];
  design_specs: string;
  _ai_meta: Record<string, unknown>;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function guessMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  return "image/png";
}

function toPublicUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  const base = Deno.env.get("SOURCE_IMAGE_BASE_URL")
    ?? Deno.env.get("QINIU_CDN_HOST")
    ?? Deno.env.get("UPLOAD_PUBLIC_HOST")
    ?? "https://cdn.picsetai.com";
  return `${base.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`;
}

async function toDataUrl(pathOrUrl: string): Promise<string> {
  if (pathOrUrl.startsWith("data:image/")) return pathOrUrl;
  const url = toPublicUrl(pathOrUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SOURCE_IMAGE_FETCH_FAILED ${res.status}: ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || guessMime(url);
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function parseJsonFromContent(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (blockMatch?.[1]) {
      try {
        return JSON.parse(blockMatch[1]);
      } catch {
        // fall through
      }
    }
    const objMatch = trimmed.match(/\{[\s\S]*\}$/);
    if (objMatch?.[0]) {
      return JSON.parse(objMatch[0]);
    }
    throw new Error("ANALYSIS_JSON_PARSE_FAILED");
  }
}

function sanitizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function outputLanguageLabel(outputLanguage: string): string {
  switch (outputLanguage) {
    case "none":
      return "None Text(Visual Only)";
    case "zh":
      return "Chinese";
    case "ja":
      return "Japanese";
    case "ko":
      return "Korean";
    case "es":
      return "Spanish";
    case "fr":
      return "French";
    case "de":
      return "German";
    case "pt":
      return "Portuguese";
    case "ar":
      return "Arabic";
    case "ru":
      return "Russian";
    default:
      return "English";
  }
}

function normalizeBlueprint(
  parsed: Record<string, unknown>,
  imageCount: number,
  outputLanguage: string,
): AnalysisBlueprint {
  const fallbackTextBlock = outputLanguage === "none"
    ? "- Main Title: None\n- Subtitle: None\n- Description Text: None"
    : "- Main Title: [Fill based on product]\n- Subtitle: [Fill based on product]\n- Description Text: [Fill based on product]";

  let images = Array.isArray(parsed.images)
    ? parsed.images
      .filter((x) => x && typeof x === "object")
      .map((x, i) => {
        const item = x as Record<string, unknown>;
        return {
          title: sanitizeString(item.title, `Image Concept ${i + 1}`),
          description: sanitizeString(item.description, "Professional e-commerce visual concept."),
          design_content: sanitizeString(
            item.design_content,
            `## Image [${i + 1}]: Product Presentation\n\n**Design Goal**: Present product with premium commercial quality.\n\n**Product Appearance**: Yes\n\n**In-Graphic Elements**:\n- Product only\n\n**Composition Plan**:\n- Product Proportion: 70%\n- Layout Method: Center composition\n- Text Area: ${outputLanguage === "none" ? "No-text area" : "Top-left area"}\n\n**Content Elements**:\n- Focus of Display: Product details and materials\n- Key Selling Points: Craftsmanship and quality\n- Background Elements: Clean studio background\n- Decorative Elements: Subtle shadows\n\n**Text Content** (Using ${outputLanguageLabel(outputLanguage)}):\n${fallbackTextBlock}\n\n**Atmosphere Creation**:\n- Mood Keywords: Premium, Minimal, Clean\n- Light and Shadow Effects: Soft-box diffused lighting`,
          ),
        };
      })
    : [];

  if (images.length === 0) {
    images = [{
      title: "Hero Product Showcase",
      description: "A clean, high-conversion product visual concept.",
      design_content: `## Image [1]: Hero Product Showcase\n\n**Design Goal**: Build a premium hero product image.\n\n**Product Appearance**: Yes\n\n**In-Graphic Elements**:\n- Product only\n\n**Composition Plan**:\n- Product Proportion: 70%\n- Layout Method: Center alignment\n- Text Area: ${outputLanguage === "none" ? "No-text area" : "Top-left area"}\n\n**Content Elements**:\n- Focus of Display: Product texture and shape\n- Key Selling Points: Material quality and finish\n- Background Elements: Clean studio background\n- Decorative Elements: Subtle reflections\n\n**Text Content** (Using ${outputLanguageLabel(outputLanguage)}):\n${fallbackTextBlock}\n\n**Atmosphere Creation**:\n- Mood Keywords: Premium, Clean, Professional\n- Light and Shadow Effects: Soft directional lighting`,
    }];
  }

  const normalizedCount = Math.max(1, Math.min(15, Number(imageCount || 1)));
  if (images.length < normalizedCount) {
    const base = images[images.length - 1];
    for (let i = images.length; i < normalizedCount; i++) {
      images.push({
        title: `${base.title} ${i + 1}`,
        description: base.description,
        design_content: base.design_content.replace(/Image \[\d+\]/, `Image [${i + 1}]`),
      });
    }
  }
  if (images.length > normalizedCount) images = images.slice(0, normalizedCount);

  const designSpecs = sanitizeString(
    parsed.design_specs,
    "# Overall Design Specifications\n\n## Color System\n- Primary color: Product-led\n- Secondary color: Accent based on brand tone\n- Background color: Clean neutral\n\n## Font System\n- Heading Font: Sans-serif commercial display\n- Body Font: Sans-serif readability\n- Hierarchy: Heading:Subtitle:Body = 3:1.8:1\n\n## Visual Language\n- Decorative Elements: Minimal geometric accents\n- Icon Style: Thin-line icons when needed\n- Negative Space Principle: High whitespace utilization\n\n## Photography Style\n- Lighting: Soft-box diffused light with rim highlights\n- Depth of Field: Product-focused with soft background blur\n- Camera Parameter Reference: ISO 100, 85mm prime\n\n## Quality Requirements\n- Resolution: 4K/HD\n- Style: Professional e-commerce photography\n- Realism: Hyper-realistic",
  );

  return {
    images,
    design_specs: designSpecs,
    _ai_meta: {},
  };
}

function computeCost(model: string, turboEnabled: boolean, imageSize: string): number {
  if (!turboEnabled) return model === "nano-banana" ? 3 : 5;
  if (imageSize === "1K") return 8;
  if (imageSize === "2K") return 12;
  return 17;
}

function imageGenErrorCodeFromError(error: unknown): string {
  const message = String(error ?? "");
  if (message.includes("IMAGE_INPUT_SOURCE_MISSING")) return "IMAGE_INPUT_SOURCE_MISSING";
  if (message.includes("IMAGE_INPUT_PROMPT_MISSING")) return "IMAGE_INPUT_PROMPT_MISSING";
  if (message.includes("STORAGE_UPLOAD_FAILED")) return "STORAGE_UPLOAD_FAILED";
  if (message.includes("IMAGE_RESULT_MISSING")) return "IMAGE_RESULT_MISSING";
  if (message.includes("INSUFFICIENT_CREDITS")) return "INSUFFICIENT_CREDITS";
  return "UPSTREAM_ERROR";
}

function resolveQnModel(modelFromRequest: string): string | undefined {
  if (modelFromRequest === "nano-banana" || modelFromRequest === "nano-banana-pro") return undefined;
  return modelFromRequest;
}

function getSourceImageFromPayload(payload: Record<string, unknown>): string | null {
  if (typeof payload.productImage === "string" && payload.productImage) return payload.productImage;
  if (Array.isArray(payload.productImages) && payload.productImages.length > 0 && typeof payload.productImages[0] === "string") {
    return payload.productImages[0];
  }
  return null;
}

async function processAnalysisJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
): Promise<void> {
  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const uiLanguage = String(payload.uiLanguage ?? payload.targetLanguage ?? "en");
  const outputLanguage = String(payload.outputLanguage ?? payload.targetLanguage ?? uiLanguage ?? "en");
  const imageCount = Math.max(1, Math.min(15, Number(payload.imageCount ?? 1)));
  const requirements = sanitizeString(payload.requirements, "");

  const productImages = Array.isArray(payload.productImages)
    ? payload.productImages.filter((x): x is string => typeof x === "string")
    : [];
  if (productImages.length === 0 && typeof payload.productImage === "string") productImages.push(payload.productImage);
  if (productImages.length === 0) throw new Error("ANALYSIS_INPUT_IMAGE_MISSING");

  const imageDataUrls = await Promise.all(productImages.map((path) => toDataUrl(path)));

  const textContentRule = outputLanguage === "none"
    ? "For Text Content fields, always output Main Title/SubTitle/Description as 'None'."
    : `For Text Content fields, write copy in ${outputLanguageLabel(outputLanguage)}.`;

  const systemPrompt = uiLanguage === "zh"
    ? "你是顶级电商视觉总监。你的任务是根据产品图与需求输出可执行的商业图片蓝图。只输出 JSON，不要 markdown 代码块。"
    : "You are a world-class e-commerce visual director. Produce executable commercial image blueprints from product photos and brief. Return JSON only, no markdown fences.";

  const userPrompt = `
Create blueprint JSON with this exact shape:
{
  "images": [
    {
      "title": "4-12 words title",
      "description": "1-2 sentence positioning",
      "design_content": "## Image [N]: ...\\n\\n**Design Goal**: ...\\n\\n**Product Appearance**: ...\\n\\n**In-Graphic Elements**: ...\\n\\n**Composition Plan**: ...\\n\\n**Content Elements**: ...\\n\\n**Text Content** (Using ${outputLanguageLabel(outputLanguage)}): ...\\n\\n**Atmosphere Creation**: ..."
    }
  ],
  "design_specs": "# Overall Design Specifications\\n\\n## Color System\\n...\\n## Font System\\n...\\n## Visual Language\\n...\\n## Photography Style\\n...\\n## Quality Requirements\\n..."
}
Constraints:
- Return exactly ${imageCount} objects in images.
- Every image plan must be different (angle, layout, scene logic).
- ${textContentRule}
- If output language is visual-only, keep typography as None and emphasize pure visual composition.
- Keep high-conversion e-commerce style, realistic material/lighting details.
User brief:
${requirements || "(no extra brief provided)"}
`;

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    },
  ];

  const chatConfig = getQnChatConfig();
  let chatResponse: Record<string, unknown>;
  try {
    chatResponse = await callQnChatAPI({
      model: chatConfig.model,
      messages,
      maxTokens: 2048,
    });
  } catch (primaryErr) {
    const fallbackModel = Deno.env.get("QN_IMAGE_MODEL");
    if (!fallbackModel || fallbackModel === chatConfig.model) throw primaryErr;
    chatResponse = await callQnChatAPI({
      model: fallbackModel,
      messages,
      maxTokens: 2048,
    });
  }

  const content = String((chatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
  const parsed = parseJsonFromContent(content);
  const blueprint = normalizeBlueprint(parsed, imageCount, outputLanguage);

  blueprint._ai_meta = {
    model: String((chatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
    usage: ((chatResponse as Record<string, unknown>)?.usage as Record<string, unknown>) ?? {},
    provider: "qnaigc",
    image_count: imageCount,
    target_language: outputLanguage,
  };

  const aiRequest = {
    model: String((chatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
    messages,
    max_tokens: 4096,
  };

  await supabase
    .from("generation_jobs")
    .update({
      status: "success",
      payload: { ...payload, ai_request: aiRequest },
      result_data: blueprint,
      result_url: null,
      error_code: null,
      error_message: null,
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", job.id);
}

async function processImageGenJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
): Promise<void> {
  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const model = String(payload.model ?? "nano-banana-pro");
  const imageSize = String(payload.imageSize ?? "2K");
  const turboEnabled = Boolean(payload.turboEnabled ?? false);
  const aspectRatio = String(payload.aspectRatio ?? "1:1");
  const cost = Number(job.cost_amount ?? computeCost(model, turboEnabled, imageSize));

  const source = getSourceImageFromPayload(payload);
  if (!source) throw new Error("IMAGE_INPUT_SOURCE_MISSING");
  if (typeof payload.prompt !== "string" || payload.prompt.trim().length === 0) {
    throw new Error("IMAGE_INPUT_PROMPT_MISSING");
  }

  let creditDeducted = false;
  try {
    const { error: deductError } = await supabase.rpc("deduct_credits", {
      p_user_id: job.user_id,
      p_amount: cost,
    });
    if (deductError) {
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error_code: "INSUFFICIENT_CREDITS",
          error_message: "Not enough credits",
          duration_ms: Date.now() - startedAt,
        })
        .eq("id", job.id);
      return;
    }
    creditDeducted = true;

    const dataUrl = await toDataUrl(source);
    // Wrap user prompt with e-commerce photography system prefix
    const ecomPrefix = "Professional e-commerce product photography. High-end commercial catalog quality. " +
      "Studio lighting with soft shadows. Clean, premium aesthetic. Product is the hero — sharp focus, " +
      "realistic materials and textures. White or contextual lifestyle background. 4K ultra-detailed rendering. ";
    const finalPrompt = ecomPrefix + String(payload.prompt);
    const apiResponse = await callQnImageAPI({
      imageDataUrl: dataUrl,
      prompt: finalPrompt,
      n: Number(payload.imageCount ?? 1),
      model: resolveQnModel(model),
      size: aspectRatioToSize(aspectRatio),
    });
    const generatedBase64 = extractGeneratedImageBase64(apiResponse);
    const imageBytes = base64ToBytes(generatedBase64);

    const outputBucket = Deno.env.get("GENERATIONS_BUCKET") ?? "generations";
    const objectPath = `${job.user_id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
    let resultUrl: string | null = null;

    const { error: uploadError } = await supabase.storage
      .from(outputBucket)
      .upload(objectPath, imageBytes, { contentType: "image/png", upsert: false });
    if (uploadError) {
      throw new Error(`STORAGE_UPLOAD_FAILED: ${uploadError.message}`);
    }
    const { data: publicData } = supabase.storage.from(outputBucket).getPublicUrl(objectPath);
    resultUrl = publicData.publicUrl;

    const hasResultUrl = typeof resultUrl === "string" && resultUrl.length > 0;
    const hasValidB64 = typeof generatedBase64 === "string" && generatedBase64.trim().length > 0;
    if (!hasResultUrl && !hasValidB64) {
      throw new Error("IMAGE_RESULT_MISSING");
    }

    await supabase
      .from("generation_jobs")
      .update({
        status: "success",
        result_url: resultUrl,
        result_data: {
          provider: "qnaigc",
          model,
          image_size: imageSize,
          mime_type: "image/png",
          object_path: resultUrl ? `${outputBucket}/${objectPath}` : null,
          b64_json: generatedBase64,
          raw_response: apiResponse,
        },
        error_code: null,
        error_message: null,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", job.id);
  } catch (e) {
    if (creditDeducted) {
      await supabase.rpc("add_credits", {
        p_user_id: job.user_id,
        p_amount: cost,
        p_type: "purchased",
      });
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as { job_id?: string } | null;
  if (!body?.job_id) return err("BAD_REQUEST", "job_id is required");

  const supabase = createServiceClient();
  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .select("id,user_id,type,status,payload,cost_amount")
    .eq("id", body.job_id)
    .single();

  if (jobError || !job) return err("NOT_FOUND", "Job not found", 404);
  if (job.user_id !== authResult.user.id) return err("FORBIDDEN", "Forbidden", 403);
  if (job.status === "success" || job.status === "failed") {
    return ok({ ok: true, status: "already_terminal", job_id: job.id });
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_generation_task", {
    p_job_id: job.id,
  });
  if (claimError) return err("TASK_CLAIM_FAILED", "Failed to claim task", 500, claimError);
  if (!claimed) return ok({ ok: true, status: "no_available_task", job_id: job.id });

  const task = claimed as TaskRow;
  try {
    if (task.task_type === "ANALYSIS") {
      await processAnalysisJob(supabase, job as GenerationJobRow);
    } else if (task.task_type === "IMAGE_GEN") {
      await processImageGenJob(supabase, job as GenerationJobRow);
    } else {
      throw new Error(`UNSUPPORTED_TASK_TYPE ${task.task_type}`);
    }

    await supabase
      .from("generation_job_tasks")
      .update({
        status: "success",
        locked_at: null,
        last_error: null,
      })
      .eq("id", task.id);

    return ok({ ok: true, status: "processed", job_id: job.id, task_type: task.task_type });
  } catch (e) {
    const attempts = Number(task.attempts ?? 1);
    const retryable = attempts < 3;
    const runAfter = new Date(Date.now() + 10_000).toISOString();

    await supabase
      .from("generation_job_tasks")
      .update(retryable
        ? { status: "queued", locked_at: null, run_after: runAfter, last_error: String(e) }
        : { status: "failed", locked_at: null, last_error: String(e) })
      .eq("id", task.id);

    if (!retryable) {
      const errorCode = task.task_type === "ANALYSIS"
        ? "ANALYSIS_FAILED"
        : imageGenErrorCodeFromError(e);
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error_code: errorCode,
          error_message: String(e),
        })
        .eq("id", job.id)
        .eq("status", "processing");
    }

    return ok({
      ok: false,
      status: retryable ? "requeued" : "failed",
      job_id: job.id,
      task_type: task.task_type,
      error: String(e),
    });
  }
});
