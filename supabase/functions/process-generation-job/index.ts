import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  callQnChatAPI,
  callQnImageAPI,
  extractGeneratedImageBase64,
  extractGeneratedImageResult,
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
  task_type: "ANALYSIS" | "IMAGE_GEN" | "STYLE_REPLICATE";
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

function resolveStyleReplicateModel(modelFromRequest: string): string | undefined {
  if (modelFromRequest === "nano-banana" || modelFromRequest === "nano-banana-pro") return undefined;
  if (modelFromRequest === "doubao-seedream-4.5") {
    return Deno.env.get("DOUBAO_MODEL_45") ?? "doubao-seedream-4-5-251128";
  }
  if (modelFromRequest === "doubao-seedream-5.0-lite") {
    return Deno.env.get("DOUBAO_MODEL_50_LITE") ?? "doubao-seedream-5.0-lite";
  }
  return modelFromRequest;
}

function isDoubaoModel(modelFromRequest: string): boolean {
  return modelFromRequest === "doubao-seedream-4.5" || modelFromRequest === "doubao-seedream-5.0-lite";
}

function doubaoAspectPixels(ratio: string): string {
  switch (ratio) {
    case "1:1":
      return "2048x2048";
    case "3:4":
      return "1728x2304";
    case "4:3":
      return "2304x1728";
    case "16:9":
      return "2848x1600";
    case "9:16":
      return "1600x2848";
    case "3:2":
      return "2496x1664";
    case "2:3":
      return "1664x2496";
    case "21:9":
      return "3136x1344";
    default:
      return "2048x2048";
  }
}

function doubaoTargetSize(imageSize: string): "2K" | "4K" {
  return imageSize === "4K" ? "4K" : "2K";
}

function parseSizeToRatio(size?: string): number | null {
  if (!size) return null;
  const m = size.match(/^(\d+)x(\d+)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

function ratioNumber(ratio: string): number {
  const parts = ratio.split(":");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return w / h;
}

function ratioMatches(actualSize?: string, expectedRatio?: string): boolean {
  if (!actualSize || !expectedRatio) return true;
  const actual = parseSizeToRatio(actualSize);
  if (actual === null) return true;
  const expected = ratioNumber(expectedRatio);
  return Math.abs(actual - expected) <= 0.01;
}

type StyleOutputItem = {
  url: string | null;
  b64_json: string | null;
  object_path: string | null;
  mime_type: string | null;
  provider_size: string | null;
  reference_index: number;
  group_index: number;
  product_index?: number;
  unit_status: "pending" | "success" | "failed";
  error_message?: string;
};

type StyleReplicateMode = "single" | "batch" | "refinement";

type StyleReplicateUnit = {
  mode: StyleReplicateMode;
  reference_index: number;
  group_index: number;
  product_index: number;
  reference_image?: string;
  product_image: string;
};

function styleReplicateErrorMessage(cause: unknown): string {
  const text = String(cause ?? "");
  if (text.includes("BATCH_INPUT_INVALID")) {
    return "Batch input is invalid.";
  }
  if (text.includes("BATCH_PRODUCT_IMAGE_REQUIRED")) {
    return "Batch replicate requires one product image.";
  }
  if (text.includes("BATCH_REFERENCE_IMAGES_REQUIRED")) {
    return "Batch replicate requires at least one reference image.";
  }
  if (text.includes("REFINEMENT_PRODUCT_IMAGES_REQUIRED")) {
    return "Refinement mode requires productImages with at least one image.";
  }
  if (text.includes("REFINEMENT_BACKGROUND_MODE_INVALID")) {
    return "Background mode must be white or original.";
  }
  if (text.includes("MODEL_RATIO_UNSUPPORTED")) {
    return "Selected ratio is not supported by current model output. Please try another ratio.";
  }
  if (text.includes("AbortError")) {
    return "Image generation timed out. Please retry; if it keeps failing, use a simpler prompt or smaller settings.";
  }
  if (
    text.includes("InvalidEndpointOrModel.NotFound") ||
    text.includes("does not exist or you do not have access to it")
  ) {
    return "Selected Doubao model is unavailable for current endpoint/account. Please use Doubao Seedream 4.5 or update DOUBAO_MODEL_* secrets.";
  }
  if (text.includes("MISSING_DOUBAO_IMAGE_API_KEY")) {
    return "Doubao API key is not configured. Please set DOUBAO_IMAGE_API_KEY.";
  }
  if (text.includes("SOURCE_IMAGE_FETCH_FAILED")) {
    return "Failed to load input images. Please re-upload and retry.";
  }
  if (text.includes("STYLE_REFERENCE_IMAGE_MISSING")) {
    return "Missing reference image.";
  }
  if (text.includes("STYLE_PRODUCT_IMAGE_MISSING")) {
    return "Missing product image.";
  }
  if (text.includes("INSUFFICIENT_CREDITS")) {
    return "Not enough credits.";
  }
  return "Style replication failed. Please retry.";
}

function styleReplicateErrorCode(error: unknown): string {
  const message = String(error ?? "");
  if (message.includes("BATCH_INPUT_INVALID")) return "BATCH_INPUT_INVALID";
  if (message.includes("BATCH_PRODUCT_IMAGE_REQUIRED")) return "BATCH_PRODUCT_IMAGE_REQUIRED";
  if (message.includes("BATCH_REFERENCE_IMAGES_REQUIRED")) return "BATCH_REFERENCE_IMAGES_REQUIRED";
  if (message.includes("REFINEMENT_PRODUCT_IMAGES_REQUIRED")) return "REFINEMENT_PRODUCT_IMAGES_REQUIRED";
  if (message.includes("REFINEMENT_BACKGROUND_MODE_INVALID")) return "REFINEMENT_BACKGROUND_MODE_INVALID";
  if (message.includes("MODEL_RATIO_UNSUPPORTED")) return "MODEL_RATIO_UNSUPPORTED";
  if (message.includes("AbortError")) return "UPSTREAM_TIMEOUT";
  if (message.includes("InvalidEndpointOrModel.NotFound")) return "MODEL_UNAVAILABLE";
  if (message.includes("STYLE_REFERENCE_IMAGE_MISSING")) return "STYLE_REFERENCE_IMAGE_MISSING";
  if (message.includes("STYLE_PRODUCT_IMAGE_MISSING")) return "STYLE_PRODUCT_IMAGE_MISSING";
  if (message.includes("SOURCE_IMAGE_FETCH_FAILED")) return "IMAGE_INPUT_SOURCE_MISSING";
  if (message.includes("MISSING_DOUBAO_IMAGE_API_KEY")) return "MISSING_DOUBAO_IMAGE_API_KEY";
  if (message.includes("INSUFFICIENT_CREDITS")) return "INSUFFICIENT_CREDITS";
  return "UPSTREAM_ERROR";
}

function isFatalStyleReplicateError(error: unknown): boolean {
  const code = styleReplicateErrorCode(error);
  return code === "MISSING_DOUBAO_IMAGE_API_KEY" ||
    code === "MODEL_UNAVAILABLE" ||
    code === "STYLE_PRODUCT_IMAGE_MISSING" ||
    code === "REFINEMENT_PRODUCT_IMAGES_REQUIRED" ||
    code === "REFINEMENT_BACKGROUND_MODE_INVALID" ||
    code === "INSUFFICIENT_CREDITS";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let pointer = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const current = pointer++;
      if (current >= items.length) break;
      await worker(items[current], current);
    }
  }));
}

function getSourceImageFromPayload(payload: Record<string, unknown>): string | null {
  const workflowMode = typeof payload.workflowMode === "string" ? payload.workflowMode : "product";
  if (workflowMode === "model" && typeof payload.modelImage === "string" && payload.modelImage) {
    return payload.modelImage;
  }
  if (typeof payload.productImage === "string" && payload.productImage) return payload.productImage;
  if (Array.isArray(payload.productImages) && payload.productImages.length > 0 && typeof payload.productImages[0] === "string") {
    return payload.productImages[0];
  }
  if (typeof payload.modelImage === "string" && payload.modelImage) return payload.modelImage;
  return null;
}

async function syncModelHistoryStatus(
  supabase: ReturnType<typeof createServiceClient>,
  jobId: string,
  userId: string,
  patch: {
    status: "processing" | "success" | "failed";
    result_url?: string | null;
    error_message?: string | null;
  },
): Promise<void> {
  const updates: Record<string, unknown> = {
    status: patch.status,
    updated_at: new Date().toISOString(),
  };
  if ("result_url" in patch) updates.result_url = patch.result_url ?? null;
  if ("error_message" in patch) updates.error_message = patch.error_message ?? null;

  // Best-effort sync for AI model generation history.
  await supabase
    .from("model_generation_history")
    .update(updates)
    .eq("job_id", jobId)
    .eq("user_id", userId);
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
  const clothingMode = sanitizeString(payload.clothingMode, "");
  const promptConfigKey = sanitizeString(payload.promptConfigKey, "batch_analysis_prompt_en");
  const mannequinEnabled = Boolean(payload.mannequinEnabled ?? false);
  const mannequinWhiteBackground = Boolean(payload.mannequinWhiteBackground ?? false);
  const threeDWhiteBackground = Boolean(payload.threeDWhiteBackground ?? false);
  const whiteBackground = Boolean(payload.whiteBackground ?? false);
  const threeDEnabled = Boolean(payload.threeDEnabled ?? false);
  const modelImage = typeof payload.modelImage === "string" && payload.modelImage.trim().length > 0
    ? payload.modelImage
    : null;

  const productImages = Array.isArray(payload.productImages)
    ? payload.productImages.filter((x): x is string => typeof x === "string")
    : [];
  if (productImages.length === 0 && typeof payload.productImage === "string") productImages.push(payload.productImage);
  if (productImages.length === 0) throw new Error("ANALYSIS_INPUT_IMAGE_MISSING");
  if (clothingMode === "model_strategy" && !modelImage) throw new Error("ANALYSIS_MODEL_IMAGE_MISSING");

  const imageDataUrls = await Promise.all(productImages.map((path) => toDataUrl(path)));
  const modelImageDataUrl = modelImage ? await toDataUrl(modelImage) : null;

  const textContentRule = outputLanguage === "none"
    ? "For Text Content fields, always output Main Title/SubTitle/Description as 'None'."
    : `For Text Content fields, write copy in ${outputLanguageLabel(outputLanguage)}.`;

  const clothingRules: string[] = [];
  if (clothingMode) clothingRules.push(`Clothing mode: ${clothingMode}.`);
  if (clothingMode === "model_strategy") {
    clothingRules.push("Build try-on strategy for a specific model while preserving product realism.");
  }
  if (mannequinEnabled) clothingRules.push("Include mannequin-centric layouts in at least one blueprint.");
  if (mannequinWhiteBackground) clothingRules.push("Use pure white mannequin background where mannequin appears.");
  if (threeDEnabled) clothingRules.push("Allow 3D-styled commercial composition as a valid direction.");
  if (threeDWhiteBackground) clothingRules.push("When creating 3D-style visuals, keep a pure white background.");
  if (whiteBackground) clothingRules.push("Prefer pure white seamless background across blueprints.");
  const clothingRuleBlock = clothingRules.length > 0
    ? clothingRules.map((line) => `- ${line}`).join("\n")
    : "- No extra clothing constraints.";

  const defaultSystemPrompt = uiLanguage === "zh"
    ? "你是顶级电商视觉总监。你的任务是根据产品图与需求输出可执行的商业图片蓝图。只输出 JSON，不要 markdown 代码块。"
    : "You are a world-class e-commerce visual director. Produce executable commercial image blueprints from product photos and brief. Return JSON only, no markdown fences.";

  const defaultUserPrompt = `
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
- Clothing-specific constraints:
${clothingRuleBlock}
User brief:
${requirements || "(no extra brief provided)"}
`;

  const { data: promptConfigRow } = await supabase
    .from("system_config")
    .select("config_value")
    .eq("config_key", promptConfigKey)
    .maybeSingle();

  const promptConfigValue = promptConfigRow?.config_value;
  const promptTemplate = typeof promptConfigValue === "object" && promptConfigValue
    ? promptConfigValue as Record<string, unknown>
    : null;

  const interpolate = (template: string): string => {
    const replacements: Record<string, string> = {
      IMAGE_COUNT: String(imageCount),
      OUTPUT_LANGUAGE: outputLanguage,
      OUTPUT_LANGUAGE_LABEL: outputLanguageLabel(outputLanguage),
      TEXT_CONTENT_RULE: textContentRule,
      USER_BRIEF: requirements || "(no extra brief provided)",
      CLOTHING_MODE: clothingMode || "none",
      CLOTHING_FLAGS: clothingRuleBlock,
    };

    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result
        .replace(new RegExp(`{{\\s*${escapedKey}\\s*}}`, "g"), value)
        .replace(new RegExp(`\\$\\{${escapedKey}\\}`, "g"), value);
    }
    return result;
  };

  const systemPrompt = interpolate(
    sanitizeString(
      promptTemplate?.system_prompt
        ?? promptTemplate?.systemPrompt
        ?? promptTemplate?.system
        ?? (typeof promptConfigValue === "string" ? "" : ""),
      defaultSystemPrompt,
    ),
  );

  const userPrompt = interpolate(
    sanitizeString(
      promptTemplate?.user_prompt
        ?? promptTemplate?.userPrompt
        ?? promptTemplate?.prompt
        ?? (typeof promptConfigValue === "string" ? promptConfigValue : ""),
      defaultUserPrompt,
    ),
  );

  const contentParts: Array<Record<string, unknown>> = [{ type: "text", text: userPrompt }];
  if (clothingMode === "model_strategy" && modelImageDataUrl) {
    contentParts.push({ type: "text", text: "Reference model image (identity/body/pose guidance):" });
    contentParts.push({ type: "image_url", image_url: { url: modelImageDataUrl } });
  }
  if (imageDataUrls.length > 0) {
    contentParts.push({ type: "text", text: "Product reference images:" });
    contentParts.push(...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })));
  }

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: contentParts,
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
    prompt_config_key: promptConfigKey,
    clothing_mode: clothingMode || null,
    mannequin_enabled: mannequinEnabled,
    mannequin_white_background: mannequinWhiteBackground,
    three_d_white_background: threeDWhiteBackground,
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
      await syncModelHistoryStatus(supabase, job.id, job.user_id, {
        status: "failed",
        result_url: null,
        error_message: "Not enough credits",
      });
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
    await syncModelHistoryStatus(supabase, job.id, job.user_id, {
      status: "success",
      result_url: resultUrl,
      error_message: null,
    });
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

async function processStyleReplicateJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
): Promise<void> {
  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const modelName = String(payload.model ?? "doubao-seedream-4.5");
  const imageSize = String(payload.imageSize ?? "2K");
  const aspectRatio = String(payload.aspectRatio ?? "1:1");
  const mode: StyleReplicateMode = payload.mode === "batch"
    ? "batch"
    : payload.mode === "refinement"
    ? "refinement"
    : "single";
  const imageCount = clampInt(payload.imageCount ?? 1, 1, 9, 1);
  const groupCount = clampInt(payload.groupCount ?? 1, 1, 9, 1);
  const turboEnabled = Boolean(payload.turboEnabled ?? false);
  const unitCost = computeCost(modelName, turboEnabled, imageSize);
  const backgroundMode = payload.backgroundMode === "original" ? "original" : "white";

  const productImages = Array.isArray(payload.productImages)
    ? payload.productImages.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const batchProductImage = typeof payload.productImage === "string" && payload.productImage.trim().length > 0
    ? payload.productImage.trim()
    : "";
  const singleProductImages = productImages;

  const singleReference = typeof payload.referenceImage === "string" ? payload.referenceImage.trim() : "";
  const batchReferences = Array.isArray(payload.referenceImages)
    ? payload.referenceImages.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];

  const units: StyleReplicateUnit[] = [];
  if (mode === "batch") {
    if (!batchProductImage) throw new Error("BATCH_PRODUCT_IMAGE_REQUIRED");
    if (batchReferences.length < 1 || batchReferences.length > 12) {
      throw new Error("BATCH_REFERENCE_IMAGES_REQUIRED");
    }
    for (let g = 0; g < groupCount; g++) {
      for (let r = 0; r < batchReferences.length; r++) {
        units.push({
          mode: "batch",
          reference_index: r,
          group_index: g,
          product_index: 0,
          reference_image: batchReferences[r],
          product_image: batchProductImage,
        });
      }
    }
  } else if (mode === "single") {
    if (singleProductImages.length < 1) throw new Error("STYLE_PRODUCT_IMAGE_MISSING");
    if (!singleReference) throw new Error("STYLE_REFERENCE_IMAGE_MISSING");
    for (let p = 0; p < singleProductImages.length; p++) {
      for (let i = 0; i < imageCount; i++) {
        units.push({
          mode: "single",
          reference_index: 0,
          group_index: i,
          product_index: p,
          reference_image: singleReference,
          product_image: singleProductImages[p],
        });
      }
    }
  } else {
    if (productImages.length < 1 || productImages.length > 50) {
      throw new Error("REFINEMENT_PRODUCT_IMAGES_REQUIRED");
    }
    if (backgroundMode !== "white" && backgroundMode !== "original") {
      throw new Error("REFINEMENT_BACKGROUND_MODE_INVALID");
    }
    for (let p = 0; p < productImages.length; p++) {
      units.push({
        mode: "refinement",
        reference_index: 0,
        group_index: 0,
        product_index: p,
        product_image: productImages[p],
      });
    }
  }

  const userPrompt = typeof payload.userPrompt === "string" ? payload.userPrompt.trim() : "";
  const referenceStyleSummary = "从参考图中提取风格元素：场景环境、构图逻辑、镜头视角、光线方向与质感、色彩与氛围。";
  const styleSystemPrompt =
    "你是专业电商视觉复刻模型。任务：在不改变产品本体的前提下，将参考图的视觉风格迁移到素材产品图。\n"
    + "硬性约束（必须满足）：\n"
    + "1) 产品本体保持不变：不得改变产品形状、结构、材质、纹理、logo/文字、颜色、比例与关键细节。\n"
    + "2) 仅迁移风格：可以迁移背景环境、构图方式、光线方向与强度、景深、色彩分级、氛围。\n"
    + "3) 不添加无关主体，不遮挡产品，不裁切导致产品缺失。\n"
    + "4) 输出应是可用于电商详情页的高真实感商业图片。";
  const refinementBasePrompt =
    "作为专业电商图片精修模型,在不改变产品本体的前提下，对单张产品图进行商业级精修。仅做精修优化,允许进行瑕疵清理、边缘优化、光影校正、色彩与清晰度增强。";
  const refinementWhiteBackgroundPrompt = "除产品主体外的背景与非主体元素统一为纯白背景干净无杂物。";
  const doubaoEndpoint = Deno.env.get("DOUBAO_IMAGE_API_ENDPOINT")
    ?? "https://ark.cn-beijing.volces.com/api/v3/images/generations";
  const doubaoApiKey = Deno.env.get("DOUBAO_IMAGE_API_KEY") ?? "";
  if (isDoubaoModel(modelName) && !doubaoApiKey) {
    throw new Error("MISSING_DOUBAO_IMAGE_API_KEY");
  }

  const requestSize = isDoubaoModel(modelName)
    ? doubaoTargetSize(imageSize)
    : aspectRatioToSize(aspectRatio);
  const styleTimeoutMs = Number(
    Deno.env.get("DOUBAO_IMAGE_REQUEST_TIMEOUT_MS")
      ?? Deno.env.get("STYLE_REPLICATE_IMAGE_TIMEOUT_MS")
      ?? "120000",
  );
  const outputBucket = Deno.env.get("GENERATIONS_BUCKET") ?? "generations";
  const maxRatioRetries = 3;
  const batchConcurrency = clampInt(
    mode === "refinement"
      ? Deno.env.get("REFINEMENT_BATCH_CONCURRENCY") ?? 8
      : Deno.env.get("STYLE_REPLICATE_BATCH_CONCURRENCY") ?? 2,
    1,
    mode === "refinement" ? 8 : 4,
    mode === "refinement" ? 8 : 2,
  );
  const progressBatchSize = mode === "refinement"
    ? clampInt(Deno.env.get("REFINEMENT_PROGRESS_BATCH_SIZE") ?? 8, 1, 8, 8)
    : units.length;

  const dataUrlCache = new Map<string, Promise<string>>();
  const getCachedDataUrl = (path: string): Promise<string> => {
    let pending = dataUrlCache.get(path);
    if (!pending) {
      pending = toDataUrl(path);
      dataUrlCache.set(path, pending);
    }
    return pending;
  };

  const outputs: StyleOutputItem[] = new Array(units.length);
  let fatalError: unknown = null;
  let completedCount = 0;
  let progressWriteChain = Promise.resolve();

  const pendingOutput = (unit: StyleReplicateUnit): StyleOutputItem => ({
    url: null,
    b64_json: null,
    object_path: null,
    mime_type: null,
    provider_size: null,
    reference_index: unit.reference_index,
    group_index: unit.group_index,
    product_index: unit.product_index,
    unit_status: "pending",
  });

  const buildResultSnapshot = (completed: number) => {
    const mergedOutputs = units.map((unit, idx) => outputs[idx] ?? pendingOutput(unit));
    const successOutputs = mergedOutputs.filter((x) => x.unit_status === "success" && x.url);
    const successCount = mergedOutputs.filter((x) => x.unit_status === "success").length;
    const failedCount = mergedOutputs.filter((x) => x.unit_status === "failed").length;
    const firstOutput = successOutputs[0] ?? null;
    return {
      firstOutput,
      successCount,
      failedCount,
      resultData: {
        provider: "qnaigc",
        model: modelName,
        image_size: imageSize,
        mime_type: firstOutput?.mime_type ?? null,
        object_path: firstOutput?.object_path ?? null,
        b64_json: firstOutput?.b64_json ?? null,
        outputs: mergedOutputs,
        summary: {
          requested_count: units.length,
          completed_count: Math.max(0, Math.min(completed, units.length)),
          success_count: successCount,
          failed_count: failedCount,
          mode,
        },
        metadata: {
          requested_aspect_ratio: aspectRatio,
          reference_style_summary: mode === "refinement" ? null : referenceStyleSummary,
          background_mode: mode === "refinement" ? backgroundMode : null,
          group_count: mode === "batch" ? groupCount : 1,
          single_product_count: mode === "single"
            ? singleProductImages.length
            : mode === "refinement"
            ? productImages.length
            : 1,
          single_repeat_count: mode === "single" ? imageCount : 1,
          unit_cost: unitCost,
          total_requested_cost: unitCost * units.length,
          batch_size: progressBatchSize,
        },
      },
    };
  };

  const enqueueProgressWrite = (completed: number) => {
    if (mode !== "refinement") return;
    const snapshotCompleted = completed;
    progressWriteChain = progressWriteChain
      .then(async () => {
        const snapshot = buildResultSnapshot(snapshotCompleted);
        await supabase
          .from("generation_jobs")
          .update({
            result_url: snapshot.firstOutput?.url ?? null,
            result_data: snapshot.resultData,
            error_code: null,
            error_message: null,
          })
          .eq("id", job.id)
          .eq("status", "processing");
      })
      .catch(() => {
        // Ignore transient progress write errors; final write remains authoritative.
      });
  };

  const buildPrompt = (unit: StyleReplicateUnit): string => {
    if (unit.mode === "refinement") {
      const promptParts = [refinementBasePrompt];
      if (backgroundMode === "white") {
        promptParts.push(refinementWhiteBackgroundPrompt);
      }
      if (isDoubaoModel(modelName)) {
        const normalizedRes = doubaoTargetSize(imageSize);
        const pixelHint = doubaoAspectPixels(aspectRatio);
        promptParts.push(`输出比例为 ${aspectRatio}，分辨率档位为 ${normalizedRes}，参考像素尺寸为 ${pixelHint}。`);
      }
      if (userPrompt) {
        promptParts.push(userPrompt);
      }
      return promptParts.join("\n");
    }

    const promptParts = [
      `[系统提示词]\n${styleSystemPrompt}`,
      "[输入角色定义]\n你将收到两张输入图：第1张是参考风格图（只用于提取风格）；第2张是产品素材图（必须保持产品本体不变）。",
      `[参考图部分]\n${referenceStyleSummary}`,
      "[素材产品图部分]\n产品素材图是唯一产品真值来源。禁止根据参考图替换产品形态或品牌细节；只能迁移场景与拍摄风格。",
      `[任务上下文]\n当前参考图索引: ${unit.reference_index + 1}/${mode === "batch" ? batchReferences.length : 1}。\n当前产品图索引: ${unit.product_index + 1}/${mode === "batch" ? 1 : singleProductImages.length}。\n当前重复序号: ${unit.group_index + 1}/${mode === "batch" ? groupCount : imageCount}。\n总目标张数: ${units.length}。`,
    ];
    if (isDoubaoModel(modelName)) {
      const normalizedRes = doubaoTargetSize(imageSize);
      const pixelHint = doubaoAspectPixels(aspectRatio);
      promptParts.push(
        `[输出规格]\n目标比例: ${aspectRatio}。\n目标分辨率档位: ${normalizedRes}。\n参考像素尺寸: ${pixelHint}。`,
      );
    }
    if (userPrompt) {
      promptParts.push(`[用户补充要求]\n${userPrompt}`);
    }
    return promptParts.join("\n\n");
  };

  await runWithConcurrency(units, batchConcurrency, async (unit, index) => {
    try {
      if (fatalError) {
        outputs[index] = {
          url: null,
          b64_json: null,
          object_path: null,
          mime_type: null,
          provider_size: null,
          reference_index: unit.reference_index,
          group_index: unit.group_index,
          product_index: unit.product_index,
          unit_status: "failed",
          error_message: "Skipped due to fatal failure in this batch.",
        };
        return;
      }

      const productDataUrl = await getCachedDataUrl(unit.product_image);
      const referenceDataUrl = unit.reference_image ? await getCachedDataUrl(unit.reference_image) : null;
      const prompt = buildPrompt(unit);
      let chosen: Omit<StyleOutputItem, "reference_index" | "group_index" | "unit_status" | "error_message"> | null = null;
      let lastProviderSize: string | null = null;

      for (let attempt = 0; attempt < maxRatioRetries; attempt++) {
        const apiResponse = await callQnImageAPI({
          imageDataUrl: productDataUrl,
          ...(referenceDataUrl ? { imageDataUrls: [referenceDataUrl, productDataUrl] } : {}),
          prompt,
          n: 1,
          model: resolveStyleReplicateModel(modelName),
          ...(requestSize ? { size: requestSize } : {}),
          timeoutMsOverride: styleTimeoutMs,
          ...(isDoubaoModel(modelName)
            ? { endpointOverride: doubaoEndpoint, apiKeyOverride: doubaoApiKey }
            : {}),
        });

        const providerEntry = Array.isArray(apiResponse.data) && apiResponse.data.length > 0
          ? apiResponse.data[0] as Record<string, unknown>
          : null;
        const providerSize = providerEntry && typeof providerEntry.size === "string"
          ? providerEntry.size
          : null;
        lastProviderSize = providerSize;
        if (isDoubaoModel(modelName) && !ratioMatches(providerSize ?? undefined, aspectRatio)) {
          continue;
        }

        const generated = extractGeneratedImageResult(apiResponse);
        const generatedBase64 = generated.b64 ?? null;
        let resultUrl = generated.url ?? null;
        let objectPath: string | null = null;

        if (!resultUrl && generatedBase64) {
          const imageBytes = base64ToBytes(generatedBase64);
          objectPath = `${job.user_id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
          const { error: uploadError } = await supabase.storage
            .from(outputBucket)
            .upload(objectPath, imageBytes, { contentType: "image/png", upsert: false });
          if (!uploadError) {
            const { data: publicData } = supabase.storage.from(outputBucket).getPublicUrl(objectPath);
            resultUrl = publicData.publicUrl;
          }
        }

        chosen = {
          url: resultUrl,
          b64_json: generatedBase64,
          object_path: objectPath ? `${outputBucket}/${objectPath}` : null,
          mime_type: generatedBase64 ? "image/png" : null,
          provider_size: providerSize,
        };
        break;
      }

      if (!chosen) {
        throw new Error(`MODEL_RATIO_UNSUPPORTED expected=${aspectRatio} got=${lastProviderSize ?? "unknown"}`);
      }

      const { error: deductError } = await supabase.rpc("deduct_credits", {
        p_user_id: job.user_id,
        p_amount: unitCost,
      });
      if (deductError) throw new Error("INSUFFICIENT_CREDITS");

      outputs[index] = {
        ...chosen,
        reference_index: unit.reference_index,
        group_index: unit.group_index,
        product_index: unit.product_index,
        unit_status: "success",
      };
    } catch (cause) {
      outputs[index] = {
        url: null,
        b64_json: null,
        object_path: null,
        mime_type: null,
        provider_size: null,
        reference_index: unit.reference_index,
        group_index: unit.group_index,
        product_index: unit.product_index,
        unit_status: "failed",
        error_message: styleReplicateErrorMessage(cause),
      };
      if (isFatalStyleReplicateError(cause)) {
        fatalError = cause;
      }
    } finally {
      completedCount += 1;
      if (completedCount % progressBatchSize === 0 || completedCount === units.length) {
        enqueueProgressWrite(completedCount);
      }
    }
  });

  await progressWriteChain;

  for (let i = 0; i < outputs.length; i++) {
    if (!outputs[i]) {
      const fallbackUnit = units[i];
      outputs[i] = {
        url: null,
        b64_json: null,
        object_path: null,
        mime_type: null,
        provider_size: null,
        reference_index: fallbackUnit.reference_index,
        group_index: fallbackUnit.group_index,
        product_index: fallbackUnit.product_index,
        unit_status: "failed",
        error_message: "Unit did not complete.",
      };
    }
  }

  const finalSnapshot = buildResultSnapshot(units.length);
  const firstOutput = finalSnapshot.firstOutput;
  const successCount = finalSnapshot.successCount;
  const failedCount = finalSnapshot.failedCount;
  const status: "success" | "failed" = successCount > 0 ? "success" : "failed";

  await supabase
    .from("generation_jobs")
    .update({
      status,
      result_url: firstOutput?.url ?? null,
      result_data: finalSnapshot.resultData,
      error_code: status === "failed"
        ? styleReplicateErrorCode(fatalError ?? "UPSTREAM_ERROR")
        : (failedCount > 0 ? "BATCH_PARTIAL_FAILED" : null),
      error_message: status === "failed"
        ? styleReplicateErrorMessage(fatalError ?? "UPSTREAM_ERROR")
        : (failedCount > 0 ? "Batch completed with partial failures." : null),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", job.id);
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
    } else if (task.task_type === "STYLE_REPLICATE") {
      await processStyleReplicateJob(supabase, job as GenerationJobRow);
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
      let errorCode = "UPSTREAM_ERROR";
      let errorMessage = String(e);
      if (task.task_type === "ANALYSIS") {
        errorCode = "ANALYSIS_FAILED";
      } else if (task.task_type === "IMAGE_GEN") {
        errorCode = imageGenErrorCodeFromError(e);
      } else if (task.task_type === "STYLE_REPLICATE") {
        errorCode = styleReplicateErrorCode(e);
        errorMessage = styleReplicateErrorMessage(e);
      }
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error_code: errorCode,
          error_message: errorMessage,
        })
        .eq("id", job.id)
        .eq("status", "processing");
      if (task.task_type === "IMAGE_GEN") {
        await syncModelHistoryStatus(supabase, job.id, job.user_id, {
          status: "failed",
          result_url: null,
          error_message: errorMessage,
        });
      }
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
