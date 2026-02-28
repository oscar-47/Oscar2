import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  callQnChatAPI,
  callQnImageAPI,
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
  uiLanguage?: string,
): AnalysisBlueprint {
  const isZh = (uiLanguage ?? "en").startsWith("zh");

  const fallbackTextBlock = outputLanguage === "none"
    ? (isZh
      ? "- 主标题：无\n- 副标题：无\n- 描述文案：无"
      : "- Main Title: None\n- Subtitle: None\n- Description Text: None")
    : (isZh
      ? "- 主标题：[根据产品填写]\n- 副标题：[根据产品填写]\n- 描述文案：[根据产品填写]"
      : "- Main Title: [Fill based on product]\n- Subtitle: [Fill based on product]\n- Description Text: [Fill based on product]");

  const fallbackTitle = (i: number) => isZh ? `图片方案 ${i + 1}` : `Image Concept ${i + 1}`;
  const fallbackDesc = isZh ? "专业电商视觉概念。" : "Professional e-commerce visual concept.";
  const fallbackDesignContent = (i: number) => isZh
    ? `## 图片 [${i + 1}]：产品展示\n\n**设计目标**：以高端商业品质呈现产品。\n\n**产品外观**：是\n\n**画面元素**：\n- 仅产品\n\n**构图方案**：\n- 产品占比：70%\n- 布局方式：居中构图\n- 文字区域：${outputLanguage === "none" ? "无文字区域" : "左上方区域"}\n\n**内容元素**：\n- 展示重点：产品细节与材质\n- 核心卖点：工艺与品质\n- 背景元素：简洁影棚背景\n- 装饰元素：柔和阴影\n\n**文案内容**（使用 ${outputLanguageLabel(outputLanguage)}）：\n${fallbackTextBlock}\n\n**氛围营造**：\n- 情绪关键词：高端、极简、干净\n- 光影效果：柔光箱漫射照明`
    : `## Image [${i + 1}]: Product Presentation\n\n**Design Goal**: Present product with premium commercial quality.\n\n**Product Appearance**: Yes\n\n**In-Graphic Elements**:\n- Product only\n\n**Composition Plan**:\n- Product Proportion: 70%\n- Layout Method: Center composition\n- Text Area: ${outputLanguage === "none" ? "No-text area" : "Top-left area"}\n\n**Content Elements**:\n- Focus of Display: Product details and materials\n- Key Selling Points: Craftsmanship and quality\n- Background Elements: Clean studio background\n- Decorative Elements: Subtle shadows\n\n**Text Content** (Using ${outputLanguageLabel(outputLanguage)}):\n${fallbackTextBlock}\n\n**Atmosphere Creation**:\n- Mood Keywords: Premium, Minimal, Clean\n- Light and Shadow Effects: Soft-box diffused lighting`;

  let images = Array.isArray(parsed.images)
    ? parsed.images
      .filter((x) => x && typeof x === "object")
      .map((x, i) => {
        const item = x as Record<string, unknown>;
        return {
          title: sanitizeString(item.title, fallbackTitle(i)),
          description: sanitizeString(item.description, fallbackDesc),
          design_content: sanitizeString(item.design_content, fallbackDesignContent(i)),
        };
      })
    : [];

  if (images.length === 0) {
    images = [{
      title: isZh ? "产品主图展示" : "Hero Product Showcase",
      description: isZh ? "简洁高转化的产品视觉概念。" : "A clean, high-conversion product visual concept.",
      design_content: fallbackDesignContent(0),
    }];
  }

  const normalizedCount = Math.max(1, Math.min(15, Number(imageCount || 1)));
  if (images.length < normalizedCount) {
    const base = images[images.length - 1];
    const imagePattern = isZh ? /图片 \[\d+\]/ : /Image \[\d+\]/;
    for (let i = images.length; i < normalizedCount; i++) {
      images.push({
        title: `${base.title} ${i + 1}`,
        description: base.description,
        design_content: base.design_content.replace(imagePattern, isZh ? `图片 [${i + 1}]` : `Image [${i + 1}]`),
      });
    }
  }
  if (images.length > normalizedCount) images = images.slice(0, normalizedCount);

  const designSpecs = sanitizeString(
    parsed.design_specs,
    isZh
      ? "# 整体设计规范\n\n## 色彩体系\n- 主色调：以产品为主导\n- 辅助色：基于品牌调性的点缀色\n- 背景色：干净的中性色\n\n## 字体体系\n- 标题字体：无衬线商业展示字体\n- 正文字体：无衬线易读字体\n- 层级关系：标题:副标题:正文 = 3:1.8:1\n\n## 视觉语言\n- 装饰元素：极简几何点缀\n- 图标风格：细线图标\n- 留白原则：高留白率\n\n## 摄影风格\n- 照明：柔光箱漫射光配合轮廓光\n- 景深：产品聚焦、背景柔化\n- 相机参考参数：ISO 100, 85mm 定焦\n\n## 品质要求\n- 分辨率：4K/高清\n- 风格：专业电商摄影\n- 真实度：超写实"
      : "# Overall Design Specifications\n\n## Color System\n- Primary color: Product-led\n- Secondary color: Accent based on brand tone\n- Background color: Clean neutral\n\n## Font System\n- Heading Font: Sans-serif commercial display\n- Body Font: Sans-serif readability\n- Hierarchy: Heading:Subtitle:Body = 3:1.8:1\n\n## Visual Language\n- Decorative Elements: Minimal geometric accents\n- Icon Style: Thin-line icons when needed\n- Negative Space Principle: High whitespace utilization\n\n## Photography Style\n- Lighting: Soft-box diffused light with rim highlights\n- Depth of Field: Product-focused with soft background blur\n- Camera Parameter Reference: ISO 100, 85mm prime\n\n## Quality Requirements\n- Resolution: 4K/HD\n- Style: Professional e-commerce photography\n- Realism: Hyper-realistic",
  );

  return {
    images,
    design_specs: designSpecs,
    _ai_meta: {},
  };
}

function computeCost(_model: string, turboEnabled: boolean, imageSize: string): number {
  if (!turboEnabled) return 5;
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

function resolveModel(_modelFromRequest: string): string | undefined {
  // All image generation now uses the model configured via QN_IMAGE_MODEL env var.
  // Return undefined to let callQnImageAPI use the env default.
  return undefined;
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

function scaledRequestSize(aspectRatio: string, imageSize: string): string {
  const baseSize = aspectRatioToSize(aspectRatio);
  const match = baseSize.match(/^(\d+)x(\d+)$/i);
  if (!match) return baseSize;

  const baseWidth = Number(match[1]);
  const baseHeight = Number(match[2]);
  const scale = imageSize === "1K" ? 0.5 : imageSize === "4K" ? 2 : 1;
  if (scale === 1) return baseSize;

  const roundToSupported = (value: number) => {
    const rounded = Math.round(value / 64) * 64;
    return Math.max(512, rounded);
  };

  return `${roundToSupported(baseWidth * scale)}x${roundToSupported(baseHeight * scale)}`;
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
    return "Selected model is unavailable for current endpoint/account. Please check your API configuration.";
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
  // Include the actual error so it's visible in the DB for debugging
  const detail = text.length > 200 ? text.slice(0, 200) + "…" : text;
  return `Style replication failed: ${detail || "unknown error"}`;
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
  if (message.includes("INSUFFICIENT_CREDITS")) return "INSUFFICIENT_CREDITS";
  return "UPSTREAM_ERROR";
}

function isFatalStyleReplicateError(error: unknown): boolean {
  const code = styleReplicateErrorCode(error);
  return code === "MODEL_UNAVAILABLE" ||
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
  const mannequinEnabled = Boolean(payload.mannequinEnabled ?? (payload.mannequin as Record<string, unknown>)?.enabled ?? false);
  const mannequinWhiteBackground = Boolean(payload.mannequinWhiteBackground ?? (payload.mannequin as Record<string, unknown>)?.whiteBackground ?? false);
  const threeDEnabled = Boolean(payload.threeDEnabled ?? (payload.threeDEffect as Record<string, unknown>)?.enabled ?? false);
  const threeDWhiteBackground = Boolean(payload.threeDWhiteBackground ?? (payload.threeDEffect as Record<string, unknown>)?.whiteBackground ?? false);
  const whiteBackground = Boolean(payload.whiteBackground ?? (payload.whiteBgRetouched as Record<string, unknown>)?.front ?? false);
  const whiteBgFront = Boolean(payload.whiteBgFront ?? false);
  const whiteBgBack = Boolean(payload.whiteBgBack ?? false);
  const detailCloseupCount = Number(payload.detailCloseupCount ?? 0);
  const sellingPointCount = Number(payload.sellingPointCount ?? 0);
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

  // Build per-plan type instructions so the AI generates one plan per selected type
  const planInstructions: string[] = [];
  let planIdx = 1;
  if (whiteBgFront) {
    planInstructions.push(`- Plan ${planIdx++}: 白底精修图（正面）— Pure white background, front view, product retouching`);
  }
  if (whiteBgBack) {
    planInstructions.push(`- Plan ${planIdx++}: 白底精修图（背面）— Pure white background, back view`);
  }
  if (threeDEnabled) {
    planInstructions.push(`- Plan ${planIdx++}: 3D立体效果图 — 3D volumetric look${threeDWhiteBackground ? ", white background" : ""}`);
  }
  if (mannequinEnabled) {
    planInstructions.push(`- Plan ${planIdx++}: 人台图 — Mannequin display${mannequinWhiteBackground ? ", white background" : ""}`);
  }
  for (let i = 0; i < detailCloseupCount; i++) {
    planInstructions.push(`- Plan ${planIdx++}: 细节特写图 — Close-up of fabric/stitching/texture detail`);
  }
  for (let i = 0; i < sellingPointCount; i++) {
    planInstructions.push(`- Plan ${planIdx++}: 卖点展示图 — Highlight a core selling point with visual emphasis`);
  }

  // Fallback: generic clothing rules for non-typed modes (e.g. model_strategy)
  const clothingRules: string[] = [];
  if (clothingMode) clothingRules.push(`Clothing mode: ${clothingMode}.`);
  if (clothingMode === "model_strategy") {
    clothingRules.push("Build try-on strategy for a specific model while preserving product realism.");
  }
  if (mannequinEnabled && planInstructions.length === 0) clothingRules.push("Include mannequin-centric layouts in at least one blueprint.");
  if (mannequinWhiteBackground && planInstructions.length === 0) clothingRules.push("Use pure white mannequin background where mannequin appears.");
  if (threeDEnabled && planInstructions.length === 0) clothingRules.push("Allow 3D-styled commercial composition as a valid direction.");
  if (threeDWhiteBackground && planInstructions.length === 0) clothingRules.push("When creating 3D-style visuals, keep a pure white background.");
  if (whiteBackground && planInstructions.length === 0) clothingRules.push("Prefer pure white seamless background across blueprints.");

  const clothingRuleBlock = planInstructions.length > 0
    ? `Each plan MUST match the specified type exactly:\n${planInstructions.join("\n")}`
    : clothingRules.length > 0
      ? clothingRules.map((line) => `- ${line}`).join("\n")
      : "- No extra clothing constraints.";

  const defaultSystemPrompt = uiLanguage === "zh"
    ? "你是顶级电商视觉总监。你的任务是根据产品图与需求输出可执行的商业图片蓝图。只输出 JSON，不要 markdown 代码块。"
    : "You are a world-class e-commerce visual director. Produce executable commercial image blueprints from product photos and brief. Return JSON only, no markdown fences.";

  const isZhUi = uiLanguage.startsWith("zh");

  const defaultUserPrompt = isZhUi
    ? `
请按以下 JSON 结构输出蓝图（所有字段内容使用中文）：
{
  "images": [
    {
      "title": "4-12 字的标题",
      "description": "1-2 句定位描述",
      "design_content": "## 图片 [N]：...\\n\\n**设计目标**：...\\n\\n**产品外观**：...\\n\\n**画面元素**：...\\n\\n**构图方案**：...\\n\\n**内容元素**：...\\n\\n**文案内容**（使用 ${outputLanguageLabel(outputLanguage)}）：...\\n\\n**氛围营造**：..."
    }
  ],
  "design_specs": "# 整体设计规范\\n\\n## 色彩体系\\n...\\n## 字体体系\\n...\\n## 视觉语言\\n...\\n## 摄影风格\\n...\\n## 品质要求\\n..."
}
约束条件：
- images 数组返回正好 ${imageCount} 个对象。
- 每张图片方案必须不同（角度、布局、场景逻辑各不相同）。
- ${textContentRule}
- 如果输出语言为"纯视觉"，文案部分一律输出"无"，并强调纯视觉构图。
- 保持高转化电商风格，真实的材质与光影细节。
- 服装模式约束：
${clothingRuleBlock}
用户需求：
${requirements || "（未提供额外需求）"}
`
    : `
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
  const blueprint = normalizeBlueprint(parsed, imageCount, outputLanguage, uiLanguage);

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
  const model = String(payload.model ?? "flux-kontext-pro");
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

    // Collect ALL input images (product + model) so the AI can see the full product
    const workflowMode = typeof payload.workflowMode === "string" ? payload.workflowMode : "product";
    const allImagePaths: string[] = [];

    // For model try-on: model image first, then product images
    if (workflowMode === "model" && typeof payload.modelImage === "string" && payload.modelImage) {
      allImagePaths.push(payload.modelImage);
    }
    // Add all product images
    if (Array.isArray(payload.productImages)) {
      for (const img of payload.productImages) {
        if (typeof img === "string" && img.trim()) allImagePaths.push(img);
      }
    }
    // Fallback: single productImage
    if (allImagePaths.length === 0 && typeof payload.productImage === "string" && payload.productImage) {
      allImagePaths.push(payload.productImage);
    }
    // Final fallback: the source we already resolved
    if (allImagePaths.length === 0) {
      allImagePaths.push(source);
    }

    const allDataUrls = await Promise.all(allImagePaths.map(toDataUrl));

    // Wrap user prompt with e-commerce photography system prefix
    const ecomPrefix = "Professional e-commerce product photography. High-end commercial catalog quality. " +
      "Studio lighting with soft shadows. Clean, premium aesthetic. Product is the hero — sharp focus, " +
      "realistic materials and textures. White or contextual lifestyle background. 4K ultra-detailed rendering. ";
    const finalPrompt = ecomPrefix + String(payload.prompt);
    const apiResponse = await callQnImageAPI({
      imageDataUrl: allDataUrls[0],
      imageDataUrls: allDataUrls.length > 1 ? allDataUrls : undefined,
      prompt: finalPrompt,
      n: 1,
      model: resolveModel(model),
      size: aspectRatioToSize(aspectRatio),
    });

    // Handle both URL and b64 responses (Volcengine returns URL, others may return b64)
    const generated = extractGeneratedImageResult(apiResponse);
    const generatedBase64 = generated.b64 ?? null;
    let resultUrl = generated.url ?? null;

    const outputBucket = Deno.env.get("GENERATIONS_BUCKET") ?? "generations";
    let objectPath: string | null = null;
    let actualMime = "image/png";

    if (generatedBase64) {
      // b64 response: decode and upload to our storage
      const imageBytes = base64ToBytes(generatedBase64);
      objectPath = `${job.user_id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
      const { error: uploadError } = await supabase.storage
        .from(outputBucket)
        .upload(objectPath, imageBytes, { contentType: "image/png", upsert: false });
      if (uploadError) {
        throw new Error(`STORAGE_UPLOAD_FAILED: ${uploadError.message}`);
      }
      const { data: publicData } = supabase.storage.from(outputBucket).getPublicUrl(objectPath);
      resultUrl = publicData.publicUrl;
    } else if (resultUrl) {
      // URL response: download from provider and re-upload to our storage
      const imgRes = await fetch(resultUrl);
      if (!imgRes.ok) throw new Error(`IMAGE_DOWNLOAD_FAILED ${imgRes.status}`);
      const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
      actualMime = imgRes.headers.get("content-type") || "image/png";
      const ext = actualMime.includes("jpeg") || actualMime.includes("jpg") ? "jpg"
        : actualMime.includes("webp") ? "webp" : "png";
      objectPath = `${job.user_id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(outputBucket)
        .upload(objectPath, imgBytes, { contentType: actualMime, upsert: false });
      if (uploadError) {
        throw new Error(`STORAGE_UPLOAD_FAILED: ${uploadError.message}`);
      }
      const { data: publicData } = supabase.storage.from(outputBucket).getPublicUrl(objectPath);
      resultUrl = publicData.publicUrl;
    }

    if (!resultUrl) {
      throw new Error("IMAGE_RESULT_MISSING");
    }

    await supabase
      .from("generation_jobs")
      .update({
        status: "success",
        result_url: resultUrl,
        result_data: {
          provider: "volcengine",
          model,
          image_size: imageSize,
          mime_type: actualMime,
          object_path: objectPath ? `${outputBucket}/${objectPath}` : null,
          b64_json: generatedBase64,
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
  const modelName = String(payload.model ?? "flux-kontext-pro");
  // Clamp minimum to 2K — many providers require at least ~3.7M pixels (1920×1920)
  const rawImageSize = String(payload.imageSize ?? "2K");
  const imageSize = rawImageSize === "1K" ? "2K" : rawImageSize;
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
  const refinementBasePrompt =
    "作为专业电商图片精修模型,在不改变产品本体的前提下，对单张产品图进行商业级精修。仅做精修优化,允许进行瑕疵清理、边缘优化、光影校正、色彩与清晰度增强。";
  const refinementWhiteBackgroundPrompt = "除产品主体外的背景与非主体元素统一为纯白背景干净无杂物。";
  const requestSize = scaledRequestSize(aspectRatio, imageSize);
  const styleTimeoutMs = Number(
    Deno.env.get("STYLE_REPLICATE_IMAGE_TIMEOUT_MS")
      ?? Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS")
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
        provider: "volcengine",
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
          reference_style_summary: mode === "refinement" ? null : "Style transfer from reference image",
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
      promptParts.push(`输出比例为 ${aspectRatio}，参考尺寸为 ${requestSize}。`);
      if (userPrompt) {
        promptParts.push(userPrompt);
      }
      return promptParts.join("\n");
    }

    // Image 1 = reference style image, Image 2 = product image.
    // The prompt must clearly separate "style reference" from "product identity";
    // otherwise edit models tend to keep the second image almost unchanged.
    const promptParts = [
      "第1张图仅作为风格参考图，第2张图是需要保留的产品主体图。",
      "请生成一张全新的电商展示图：继承第1张图的视觉风格，包括构图语言、背景氛围、灯光方向、色彩倾向、景别和版式节奏。",
      "只保留第2张图中的产品主体本身，保留产品的形状、材质、颜色、纹理、logo、文字和关键设计特征。",
      "不要直接照搬第2张图原始构图，不要只是对第2张图做轻微修改，不要输出与第2张图几乎相同的画面。",
      "可以改变产品的位置、角度、大小、裁切、展示方式、场景、人物或道具，只要产品主体本身保持一致。",
      "如果第2张图里包含人物、手部、模特或原始背景，这些都不是必须保留的内容；请优先保留产品，不必保留原图场景。",
      "不要复制第1张图里的具体产品主体，只借鉴其风格与展示方式。最终画面应当是新的、自然的、可商用的高质量电商图。",
      "Image 1 is style reference only. Image 2 contains the product to preserve.",
      "Create a new e-commerce image in the style of image 1, but do not simply return image 2 or make only a minimal edit to image 2.",
      "Preserve only the product identity from image 2, not its original composition, pose, scene, or framing.",
      `Output aspect ratio: ${aspectRatio}, size: ${requestSize}.`,
    ];
    if (userPrompt) {
      promptParts.push(`Additional instructions: ${userPrompt}`);
    }
    return promptParts.join(" ");
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
          imageDataUrl: referenceDataUrl ?? productDataUrl,
          ...(referenceDataUrl ? { imageDataUrls: [referenceDataUrl, productDataUrl] } : {}),
          prompt,
          n: 1,
          model: resolveModel(modelName),
          ...(requestSize ? { size: requestSize } : {}),
          timeoutMsOverride: styleTimeoutMs,
        });

        const providerEntry = Array.isArray(apiResponse.data) && apiResponse.data.length > 0
          ? apiResponse.data[0] as Record<string, unknown>
          : null;
        const providerSize = providerEntry && typeof providerEntry.size === "string"
          ? providerEntry.size
          : null;
        lastProviderSize = providerSize;

        const generated = extractGeneratedImageResult(apiResponse);
        const generatedBase64 = generated.b64 ?? null;
        let resultUrl = generated.url ?? null;
        let objectPath: string | null = null;

        let unitMime = "image/png";

        if (generatedBase64) {
          // b64 response: decode and upload to our storage
          const imageBytes = base64ToBytes(generatedBase64);
          objectPath = `${job.user_id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
          const { error: uploadError } = await supabase.storage
            .from(outputBucket)
            .upload(objectPath, imageBytes, { contentType: "image/png", upsert: false });
          if (uploadError) throw new Error(`STORAGE_UPLOAD_FAILED: ${uploadError.message}`);
          const { data: publicData } = supabase.storage.from(outputBucket).getPublicUrl(objectPath);
          resultUrl = publicData.publicUrl;
        } else if (resultUrl) {
          // URL response: download from provider and re-upload to our storage
          const imgRes = await fetch(resultUrl);
          if (!imgRes.ok) throw new Error(`IMAGE_DOWNLOAD_FAILED ${imgRes.status}`);
          const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
          unitMime = imgRes.headers.get("content-type") || "image/png";
          const ext = unitMime.includes("jpeg") || unitMime.includes("jpg") ? "jpg"
            : unitMime.includes("webp") ? "webp" : "png";
          objectPath = `${job.user_id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from(outputBucket)
            .upload(objectPath, imgBytes, { contentType: unitMime, upsert: false });
          if (uploadError) throw new Error(`STORAGE_UPLOAD_FAILED: ${uploadError.message}`);
          const { data: publicData } = supabase.storage.from(outputBucket).getPublicUrl(objectPath);
          resultUrl = publicData.publicUrl;
        }

        chosen = {
          url: resultUrl,
          b64_json: generatedBase64,
          object_path: objectPath ? `${outputBucket}/${objectPath}` : null,
          mime_type: unitMime,
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
