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
import {
  getCreditCostForModel,
  getDefaultImageSizeForModel,
  isImageSizeSupportedForModel,
  normalizeRequestedModel,
  OPENROUTER_MODEL_MAP,
} from "../_shared/generation-config.ts";
import Jimp from "npm:jimp@0.22.12";
import { Buffer } from "node:buffer";

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

type GenesisStyleDirectionKey = "sceneStyle" | "lighting" | "composition";

type GenesisStyleDirectionGroup = {
  key: GenesisStyleDirectionKey;
  options: string[];
  recommended: string | null;
};

type ProductVisualIdentity = {
  primary_color: string;
  secondary_colors: string[];
  material: string;
  key_features: string[];
};

type GenesisAnalysisResult = {
  product_summary: string;
  product_visual_identity?: ProductVisualIdentity;
  style_directions: GenesisStyleDirectionGroup[];
  copy_plan: string;
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
    ?? "https://cdn.shopix.ai";
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
  if (!trimmed) {
    return { __parse_failed: true, __raw_preview: "" };
  }

  const baseCandidates = new Set<string>([trimmed]);
  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (blockMatch?.[1]) baseCandidates.add(blockMatch[1].trim());
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch?.[0]) baseCandidates.add(objMatch[0].trim());
  const arrMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrMatch?.[0]) baseCandidates.add(arrMatch[0].trim());

  const allCandidates: string[] = [];
  for (const candidate of baseCandidates) {
    const normalizedQuotes = candidate.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
    const noTrailingCommas = candidate.replace(/,\s*([}\]])/g, "$1");
    allCandidates.push(
      candidate,
      normalizedQuotes,
      noTrailingCommas,
      normalizedQuotes.replace(/,\s*([}\]])/g, "$1"),
    );
  }

  for (const candidate of allCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return { images: parsed as unknown[] };
      }
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // keep trying other candidates
    }
  }

  // Never hard-fail the whole ANALYSIS task for malformed model output.
  // Downstream normalizeBlueprint() will synthesize a safe fallback blueprint.
  return {
    __parse_failed: true,
    __raw_preview: trimmed.slice(0, 4000),
  };
}

function sanitizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function normalizeStyleConstraintPrompt(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  return prompt.length > 0 ? prompt : "";
}

function normalizeStyleConstraintSource(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const source = typeof record.source === "string" ? record.source.trim() : "";
  return source.length > 0 ? source : null;
}

function outputLanguageLabel(outputLanguage: string): string {
  switch (outputLanguage) {
    case "none":
      return "No Text (Visual Only)";
    case "zh":
      return "Simplified Chinese";
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

function buildVisibleCopyLanguageRule(outputLanguage: string, isZh: boolean): string {
  if (outputLanguage === "none") {
    return isZh
      ? "新增设计文案必须为空，禁止添加任何额外画面文字。"
      : "All added design copy must be omitted. Do not add any extra visible text.";
  }

  if (outputLanguage === "zh") {
    return isZh
      ? "所有新增设计文案必须使用简体中文，禁止英文、拼音、双语混排，以及 Title、Subtitle、Description、Selling Point、Feature 等英文占位词。规格表、售后保障、使用建议、成分说明、前后对比、核心卖点等信息型模块如有新增可见文字，也必须全部使用简体中文。产品自身已有的 logo、包装原文、型号、成分表、技术单位不属于新增设计文案，无需擦除或翻译。"
      : "All added visible design copy must be Simplified Chinese only. Do not use English words, pinyin, bilingual mixing, or placeholder labels such as Title, Subtitle, Description, Selling Point, or Feature. This also applies to spec tables, after-sales guarantees, usage tips, ingredient callouts, before/after labels, and selling-point modules. Existing product text such as logos, original packaging text, model numbers, ingredient tables, and technical units is not considered added design copy and should be preserved.";
  }

  const languageLabel = outputLanguageLabel(outputLanguage);
  return isZh
    ? `所有新增设计文案必须只使用${languageLabel}，禁止混入其他语言；产品自身已有的 logo、包装原文、型号、成分表、技术单位不属于新增设计文案。`
    : `All added visible design copy must use ${languageLabel} only and must not mix in other languages. Existing product text such as logos, original packaging text, model numbers, ingredient tables, and technical units is not considered added design copy.`;
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
      ? `# 整体设计规范\n\n## 色彩体系\n- 主色调：以产品为主导\n- 辅助色：基于品牌调性的点缀色\n- 背景色：干净的中性色\n\n## 字体体系\n- 标题字体：无衬线商业展示字体\n- 正文字体：无衬线易读字体\n- 层级关系：标题:副标题:正文 = 3:1.8:1\n\n## 视觉语言\n- 装饰元素：极简几何点缀\n- 图标风格：细线图标\n- 留白原则：高留白率\n\n## 文案语言约束\n- ${buildVisibleCopyLanguageRule(outputLanguage, true)}\n- 若需要示例文案、信息层级或文字区域说明，示例内容必须直接使用目标语言，不得使用英文占位。\n\n## 摄影风格\n- 照明：柔光箱漫射光配合轮廓光\n- 景深：产品聚焦、背景柔化\n- 相机参考参数：ISO 100, 85mm 定焦\n\n## 品质要求\n- 分辨率：4K/高清\n- 风格：专业电商摄影\n- 真实度：超写实`
      : `# Overall Design Specifications\n\n## Color System\n- Primary color: Product-led\n- Secondary color: Accent based on brand tone\n- Background color: Clean neutral\n\n## Font System\n- Heading Font: Sans-serif commercial display\n- Body Font: Sans-serif readability\n- Hierarchy: Heading:Subtitle:Body = 3:1.8:1\n\n## Copy Language Guardrail\n- ${buildVisibleCopyLanguageRule(outputLanguage, false)}\n- If examples for copy, text hierarchy, or text zones are needed, write those examples directly in the target language instead of English placeholders.\n\n## Visual Language\n- Decorative Elements: Minimal geometric accents\n- Icon Style: Thin-line icons when needed\n- Negative Space Principle: High whitespace utilization\n\n## Photography Style\n- Lighting: Soft-box diffused light with rim highlights\n- Depth of Field: Product-focused with soft background blur\n- Camera Parameter Reference: ISO 100, 85mm prime\n\n## Quality Requirements\n- Resolution: 4K/HD\n- Style: Professional e-commerce photography\n- Realism: Hyper-realistic`,
  );

  return {
    images,
    design_specs: designSpecs,
    _ai_meta: {},
  };
}

function limitLabelLength(value: string, isZh: boolean): string {
  const chars = Array.from(value.trim());
  return chars.slice(0, isZh ? 5 : 24).join("");
}

function fallbackGenesisDirectionOptions(
  key: GenesisStyleDirectionKey,
  isZh: boolean,
): string[] {
  if (isZh) {
    if (key === "sceneStyle") return ["极简", "生活感", "高级感"];
    if (key === "lighting") return ["柔光", "自然光", "层次光"];
    return ["正视角", "微俯拍", "特写"];
  }

  if (key === "sceneStyle") return ["minimal", "lifestyle", "premium"];
  if (key === "lighting") return ["soft light", "daylight", "contrast"];
  return ["front", "overhead", "close-up"];
}

function extractGenesisDirectionRecord(
  raw: unknown,
  key: GenesisStyleDirectionKey,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw)) {
    const match = raw.find((item) =>
      item &&
      typeof item === "object" &&
      (item as Record<string, unknown>).key === key
    );
    return match && typeof match === "object" ? match as Record<string, unknown> : null;
  }
  const obj = raw as Record<string, unknown>;
  const direct = obj[key];
  return direct && typeof direct === "object" ? direct as Record<string, unknown> : null;
}

function normalizeGenesisStyleDirections(
  parsed: Record<string, unknown>,
  uiLanguage?: string,
): GenesisStyleDirectionGroup[] {
  const isZh = (uiLanguage ?? "en").startsWith("zh");
  const rawDirections = parsed.style_directions ?? parsed.styleDirections ?? null;
  const keys: GenesisStyleDirectionKey[] = ["sceneStyle", "lighting", "composition"];

  return keys.map((key) => {
    const record = extractGenesisDirectionRecord(rawDirections, key);
    const rawOptions = Array.isArray(record?.options) ? record?.options : [];
    const options = Array.from(new Set(
      rawOptions
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => limitLabelLength(item, isZh))
        .filter((item) => item.length > 0),
    )).slice(0, 3);
    const fallbackOptions = fallbackGenesisDirectionOptions(key, isZh);
    const finalOptions = options.length > 0 ? options : fallbackOptions;
    const rawRecommended = typeof record?.recommended === "string"
      ? limitLabelLength(record.recommended, isZh)
      : "";
    const recommended = rawRecommended && finalOptions.includes(rawRecommended)
      ? rawRecommended
      : finalOptions[0] ?? null;
    return {
      key,
      options: finalOptions,
      recommended,
    };
  });
}

function extractGenesisBriefHints(requirements: string, isZh: boolean): { product: string; sellingPoints: string[] } {
  const cleaned = requirements.trim();
  if (!cleaned) return { product: "", sellingPoints: [] };

  if (isZh) {
    const normalized = cleaned.replace(/\s+/g, " ").replace(/[：:]/g, "是");
    const productMatch = normalized.match(/(?:我的商品|商品|产品)\s*是\s*([^，,。；;\n]+)/);
    const sellingMatch = normalized.match(/(?:主要卖点|卖点)\s*是\s*([^。;\n]+)/);

    return {
      product: (productMatch?.[1] ?? "").trim(),
      sellingPoints: (sellingMatch?.[1] ?? "")
        .split(/[，,、/|；;\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4),
    };
  }

  const normalized = cleaned.replace(/\s+/g, " ");
  const productMatch = normalized.match(/(?:my product is|product is)\s+([^,.;\n]+)/i);
  const sellingMatch = normalized.match(/(?:key selling points? are|key selling point is|selling points? are|selling point is)\s+([^.;\n]+)/i);

  return {
    product: (productMatch?.[1] ?? "").trim(),
    sellingPoints: (sellingMatch?.[1] ?? "")
      .split(/[,/|;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4),
  };
}

function buildGenesisCopyFallback(requirements: string, outputLanguage: string, uiLanguage: string): string {
  if (outputLanguage === "none") return "";

  const isZh = uiLanguage.startsWith("zh");
  const { product, sellingPoints } = extractGenesisBriefHints(requirements, isZh);

  if (isZh) {
    if (product && sellingPoints.length > 0) return `${product}，${sellingPoints.join("，")}`;
    if (product) return `${product}，突出核心卖点`;
    if (sellingPoints.length > 0) return `主打${sellingPoints.join("，")}`;
    return requirements.trim();
  }

  if (product && sellingPoints.length > 0) return `${product}: ${sellingPoints.join(", ")}`;
  if (product) return `${product} with standout selling points`;
  if (sellingPoints.length > 0) return `Highlight ${sellingPoints.join(", ")}`;
  return requirements.trim();
}

function copyPlanMatchesBrief(copyPlan: string, requirements: string, uiLanguage: string): boolean {
  const { product, sellingPoints } = extractGenesisBriefHints(requirements, uiLanguage.startsWith("zh"));
  const keywords = [product, ...sellingPoints]
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (keywords.length === 0) return true;

  const normalizedCopy = copyPlan.replace(/\s+/g, "").toLowerCase();
  return keywords.some((keyword) => normalizedCopy.includes(keyword.replace(/\s+/g, "").toLowerCase()));
}

function normalizeGenesisAnalysis(
  parsed: Record<string, unknown>,
  outputLanguage: string,
  uiLanguage: string,
  requirements: string,
): GenesisAnalysisResult {
  const isZh = uiLanguage.startsWith("zh");
  const fallbackSummary = requirements
    || (isZh
      ? "根据产品图分析产品特征，并围绕核心卖点生成主图。"
      : "Analyze the product images and generate hero images around the key selling points.");
  const rawCopyPlan = sanitizeString(parsed.copy_plan ?? parsed.copyPlan, "");
  const fallbackCopyPlan = buildGenesisCopyFallback(requirements, outputLanguage, uiLanguage);

  const rawIdentity = (parsed.product_visual_identity ?? parsed.productVisualIdentity) as Record<string, unknown> | undefined;
  const productVisualIdentity: ProductVisualIdentity | undefined = rawIdentity && typeof rawIdentity === "object"
    ? {
        primary_color: sanitizeString(rawIdentity.primary_color ?? rawIdentity.primaryColor, ""),
        secondary_colors: Array.isArray(rawIdentity.secondary_colors ?? rawIdentity.secondaryColors)
          ? (rawIdentity.secondary_colors ?? rawIdentity.secondaryColors as string[]).map(String)
          : [],
        material: sanitizeString(rawIdentity.material, ""),
        key_features: Array.isArray(rawIdentity.key_features ?? rawIdentity.keyFeatures)
          ? (rawIdentity.key_features ?? rawIdentity.keyFeatures as string[]).map(String)
          : [],
      }
    : undefined;

  return {
    product_summary: sanitizeString(
      parsed.product_summary ?? parsed.productSummary,
      fallbackSummary,
    ),
    product_visual_identity: productVisualIdentity,
    style_directions: normalizeGenesisStyleDirections(parsed, uiLanguage),
    copy_plan: outputLanguage === "none"
      ? ""
      : rawCopyPlan && copyPlanMatchesBrief(rawCopyPlan, requirements, uiLanguage)
        ? rawCopyPlan
        : fallbackCopyPlan,
    _ai_meta: {},
  };
}

function computeCost(model: string, turboEnabled: boolean, imageSize: string): number {
  void turboEnabled;
  return getCreditCostForModel(model, imageSize);
}

function imageGenErrorCodeFromError(error: unknown): string {
  const message = String(error ?? "");
  if (message.includes("AbortError")) return "UPSTREAM_TIMEOUT";
  if (message.includes("IMAGE_INPUT_SOURCE_MISSING")) return "IMAGE_INPUT_SOURCE_MISSING";
  if (message.includes("IMAGE_INPUT_PROMPT_MISSING")) return "IMAGE_INPUT_PROMPT_MISSING";
  if (message.includes("STORAGE_UPLOAD_FAILED")) return "STORAGE_UPLOAD_FAILED";
  if (message.includes("IMAGE_RESULT_MISSING")) return "IMAGE_RESULT_MISSING";
  if (message.includes("IMAGE_SIZE_UNSATISFIED")) return "IMAGE_SIZE_UNSATISFIED";
  if (message.includes("INSUFFICIENT_CREDITS")) return "INSUFFICIENT_CREDITS";
  if (
    message.includes("InvalidEndpointOrModel.NotFound") ||
    message.includes("does not exist or you do not have access to it")
  ) return "MODEL_UNAVAILABLE";
  return "UPSTREAM_ERROR";
}

type ImageRoute = {
  provider: "azure" | "openai" | "qiniu" | "volcengine" | "openrouter" | "toapis" | "goapi" | "stability" | "ideogram" | "default";
  model?: string;
  endpoint?: string;
  apiKey?: string;
};

const TA_MODEL_MAP: Record<string, string> = {
  "ta-gemini-2.5-flash": "gemini-2.5-flash-image-preview",
  "ta-gemini-3.1-flash": "gemini-3.1-flash-image-preview",
  "ta-gemini-3-pro": "gemini-3-pro-image-preview",
};

function resolveImageRoute(modelFromRequest: string): ImageRoute {
  const model = normalizeRequestedModel(modelFromRequest.trim());
  const qnEndpoint = Deno.env.get("QN_IMAGE_API_ENDPOINT");
  const qnApiKey = Deno.env.get("QN_IMAGE_API_KEY");

  if (model === "azure-flux" || model === "flux-kontext-pro") {
    return {
      provider: "azure",
      endpoint: Deno.env.get("AZURE_FLUX_API_ENDPOINT") ?? qnEndpoint,
      apiKey: Deno.env.get("AZURE_FLUX_API_KEY") ?? qnApiKey,
      model: Deno.env.get("AZURE_FLUX_MODEL")
        ?? Deno.env.get("QN_IMAGE_MODEL")
        ?? "black-forest-labs/FLUX.1-Kontext-pro",
    };
  }

  if (model === "qiniu-gemini-pro" || model === "gemini-pro-image") {
    return {
      provider: "qiniu",
      endpoint: Deno.env.get("QINIU_GEMINI_API_ENDPOINT") ?? qnEndpoint,
      apiKey: Deno.env.get("QINIU_GEMINI_API_KEY") ?? qnApiKey,
      model: Deno.env.get("QN_IMAGE_GEMINI_PRO_MODEL") ?? "gemini-3.0-pro-image-preview",
    };
  }

  if (model === "qiniu-gemini-flash" || model === "gemini-flash-image") {
    return {
      provider: "qiniu",
      endpoint: Deno.env.get("QINIU_GEMINI_API_ENDPOINT") ?? qnEndpoint,
      apiKey: Deno.env.get("QINIU_GEMINI_API_KEY") ?? qnApiKey,
      model: Deno.env.get("QN_IMAGE_FLASH_MODEL") ?? "gemini-2.0-flash-preview-image-generation",
    };
  }

  if (model === "gpt-image") {
    return {
      provider: "openai",
      endpoint: Deno.env.get("GPT_IMAGE_API_ENDPOINT") ?? "https://api.openai.com/v1/images/edits",
      apiKey: Deno.env.get("GPT_IMAGE_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
      model: Deno.env.get("GPT_IMAGE_MODEL") ?? "gpt-image-1",
    };
  }

  if (model === "volc-seedream-4.5") {
    return {
      provider: "volcengine",
      endpoint: Deno.env.get("DOUBAO_IMAGE_API_ENDPOINT") ?? "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      apiKey: Deno.env.get("DOUBAO_IMAGE_API_KEY") ?? "",
      model: Deno.env.get("DOUBAO_MODEL_45") ?? "doubao-seedream-4-5-250915",
    };
  }

  if (model === "volc-seedream-5.0-lite") {
    return {
      provider: "volcengine",
      endpoint: Deno.env.get("DOUBAO_IMAGE_API_ENDPOINT") ?? "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      apiKey: Deno.env.get("DOUBAO_IMAGE_API_KEY") ?? "",
      model: Deno.env.get("DOUBAO_MODEL_50_LITE") ?? "doubao-seedream-5.0-lite",
    };
  }

  // New model providers
  if (model === "midjourney") {
    return {
      provider: "goapi",
      endpoint: Deno.env.get("GOAPI_API_ENDPOINT") ?? "https://api.goapi.ai/v1/images/generations",
      apiKey: Deno.env.get("GOAPI_API_KEY") ?? "",
      model: "midjourney",
    };
  }

  if (model === "sd-3.5-ultra") {
    return {
      provider: "stability",
      endpoint: Deno.env.get("STABILITY_API_ENDPOINT") ?? "https://api.stability.ai/v2beta/stable-image/generate/ultra",
      apiKey: Deno.env.get("STABILITY_API_KEY") ?? "",
      model: "sd3.5-ultra",
    };
  }

  if (model === "dall-e-4") {
    return {
      provider: "openai",
      endpoint: Deno.env.get("DALLE4_API_ENDPOINT") ?? "https://api.openai.com/v1/images/generations",
      apiKey: Deno.env.get("DALLE4_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
      model: "dall-e-4",
    };
  }

  if (model === "ideogram-3") {
    return {
      provider: "ideogram",
      endpoint: Deno.env.get("IDEOGRAM_API_ENDPOINT") ?? "https://api.ideogram.ai/generate",
      apiKey: Deno.env.get("IDEOGRAM_API_KEY") ?? "",
      model: "V_3",
    };
  }

  // OpenRouter models (or-*)
  if (OPENROUTER_MODEL_MAP[model]) {
    return {
      provider: "openrouter",
      endpoint: Deno.env.get("OPENROUTER_API_ENDPOINT") ?? "https://openrouter.ai/api/v1/chat/completions",
      apiKey: Deno.env.get("OPENROUTER_API_KEY") ?? "",
      model: OPENROUTER_MODEL_MAP[model],
    };
  }

  // ToAPIs models (ta-*)
  if (TA_MODEL_MAP[model]) {
    const toApisEndpoint = Deno.env.get("TOAPIS_API_ENDPOINT") ?? "";
    const toApisApiKey = Deno.env.get("TOAPIS_API_KEY") ?? "";
    if (toApisEndpoint && toApisApiKey) {
      return {
        provider: "toapis",
        endpoint: toApisEndpoint,
        apiKey: toApisApiKey,
        model: TA_MODEL_MAP[model],
      };
    }

    // Fallback for environments without ToAPIs credentials:
    // map ta-* aliases back to equivalent OpenRouter models.
    const openRouterAlias = model.replace(/^ta-/, "or-");
    if (OPENROUTER_MODEL_MAP[openRouterAlias]) {
      console.warn(`TOAPIS_NOT_CONFIGURED fallback_to_openrouter model=${model} alias=${openRouterAlias}`);
      return {
        provider: "openrouter",
        endpoint: Deno.env.get("OPENROUTER_API_ENDPOINT") ?? "https://openrouter.ai/api/v1/chat/completions",
        apiKey: Deno.env.get("OPENROUTER_API_KEY") ?? "",
        model: OPENROUTER_MODEL_MAP[openRouterAlias],
      };
    }

    return {
      provider: "toapis",
      endpoint: toApisEndpoint,
      apiKey: toApisApiKey,
      model: TA_MODEL_MAP[model],
    };
  }

  return { provider: "default" };
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

/** Map imageSize to longest-edge target: 1K=1024, 2K=2048, 4K=4096 */
function longestEdgeForSize(imageSize: string): number {
  if (imageSize === "1K") return 1024;
  if (imageSize === "4K") return 4096;
  return 2048; // 2K default
}

function scaledRequestSize(aspectRatio: string, imageSize: string): string {
  const baseSize = aspectRatioToSize(aspectRatio);
  const match = baseSize.match(/^(\d+)x(\d+)$/i);
  if (!match) return baseSize;

  const baseW = Number(match[1]);
  const baseH = Number(match[2]);
  const longest = Math.max(baseW, baseH);
  const target = longestEdgeForSize(imageSize);
  if (longest === target) return baseSize;

  const scale = target / longest;
  const round64 = (v: number) => Math.max(512, Math.round(v * scale / 64) * 64);
  return `${round64(baseW)}x${round64(baseH)}`;
}

/** Parse image dimensions from PNG/JPEG/WebP header bytes */
function parseImageDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 30) return null;
  // PNG: bytes 0-7 = signature, IHDR at 16: 4-byte width, 4-byte height (big-endian)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { w, h };
  }
  // JPEG: find SOF0 (0xFF 0xC0) or SOF2 (0xFF 0xC2) marker
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        return { w, h };
      }
      const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
      i += 2 + segLen;
    }
  }
  // WebP: RIFF header, VP8 chunk
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    // VP8L (lossless): starts at byte 21, first 14 bits = width-1, next 14 bits = height-1
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4C) {
      const bits = (bytes[21]) | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      const w = (bits & 0x3FFF) + 1;
      const h = ((bits >> 14) & 0x3FFF) + 1;
      return { w, h };
    }
    // VP8 (lossy): width/height at bytes 26-29
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
      const w = (bytes[26] | (bytes[27] << 8)) & 0x3FFF;
      const h = (bytes[28] | (bytes[29] << 8)) & 0x3FFF;
      return { w, h };
    }
  }
  return null;
}

type SizeStatus = "exact" | "normalized_down" | "too_small" | "unknown";

type PersistedGeneratedImage = {
  resultUrl: string;
  objectPath: string | null;
  mimeType: string;
  providerSize: string | null;
  actualSize: { w: number; h: number } | null;
  deliveredSize: { w: number; h: number } | null;
  normalizedByServer: boolean;
  sizeStatus: SizeStatus;
};

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function targetDimensionsForLongestEdge(dimensions: { w: number; h: number }, targetLongestEdge: number): { w: number; h: number } {
  if (dimensions.w >= dimensions.h) {
    return {
      w: targetLongestEdge,
      h: Math.max(1, Math.round(dimensions.h * (targetLongestEdge / dimensions.w))),
    };
  }
  return {
    w: Math.max(1, Math.round(dimensions.w * (targetLongestEdge / dimensions.h))),
    h: targetLongestEdge,
  };
}

async function normalizeImageBytes(
  bytes: Uint8Array,
  mimeType: string,
  targetLongestEdge: number,
): Promise<{ bytes: Uint8Array; mimeType: string; deliveredSize: { w: number; h: number } }> {
  const dimensions = parseImageDimensions(bytes);
  if (!dimensions) {
    throw new Error("IMAGE_NORMALIZATION_FAILED missing_source_dimensions");
  }

  const target = targetDimensionsForLongestEdge(dimensions, targetLongestEdge);
  // Jimp 0.22.x requires Buffer, not plain Uint8Array, in Deno
  const image = await Jimp.read(Buffer.from(bytes));
  image.resize(target.w, target.h, Jimp.RESIZE_LANCZOS);
  const outputMime = mimeType.includes("jpeg") || mimeType.includes("jpg")
    ? Jimp.MIME_JPEG
    : Jimp.MIME_PNG;
  const resized = await image.getBufferAsync(outputMime);
  return {
    bytes: new Uint8Array(resized),
    mimeType: outputMime,
    deliveredSize: target,
  };
}

async function persistGeneratedImage(params: {
  supabase: ReturnType<typeof createServiceClient>;
  outputBucket: string;
  userId: string;
  providerSize: string | null;
  generatedBase64?: string | null;
  generatedUrl?: string | null;
  imageSize: string;
}): Promise<PersistedGeneratedImage> {
  let imageBytes: Uint8Array | null = null;
  let mimeType = "image/png";

  if (params.generatedBase64) {
    imageBytes = base64ToBytes(params.generatedBase64);
  } else if (params.generatedUrl) {
    const imgRes = await fetch(params.generatedUrl);
    if (!imgRes.ok) throw new Error(`IMAGE_DOWNLOAD_FAILED ${imgRes.status}`);
    imageBytes = new Uint8Array(await imgRes.arrayBuffer());
    mimeType = imgRes.headers.get("content-type") || mimeType;
  }

  if (!imageBytes) {
    throw new Error("IMAGE_RESULT_MISSING");
  }

  const actualSize = parseImageDimensions(imageBytes);
  const targetLongestEdge = longestEdgeForSize(params.imageSize);
  let deliveredBytes = imageBytes;
  let deliveredMime = mimeType;
  let deliveredSize = actualSize;
  let normalizedByServer = false;
  let sizeStatus: SizeStatus = actualSize ? "exact" : "unknown";

  if (actualSize) {
    const actualLongestEdge = Math.max(actualSize.w, actualSize.h);
    if (actualLongestEdge < targetLongestEdge) {
      // Deliver as-is instead of failing — the model returned a smaller image than
      // requested but a usable image is better than an error.
      console.warn(`IMAGE_SIZE_DOWNGRADED requested=${params.imageSize} actual=${actualSize.w}x${actualSize.h}`);
      sizeStatus = "too_small";
    }
    if (actualLongestEdge > targetLongestEdge) {
      const normalized = await normalizeImageBytes(imageBytes, mimeType, targetLongestEdge);
      deliveredBytes = normalized.bytes;
      deliveredMime = normalized.mimeType;
      deliveredSize = normalized.deliveredSize;
      normalizedByServer = true;
      sizeStatus = "normalized_down";
    }
  }

  const objectPath = `${params.userId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${extensionForMime(deliveredMime)}`;
  const { error: uploadError } = await params.supabase.storage
    .from(params.outputBucket)
    .upload(objectPath, deliveredBytes, { contentType: deliveredMime, upsert: false });
  if (uploadError) {
    throw new Error(`STORAGE_UPLOAD_FAILED: ${uploadError.message}`);
  }
  const { data: publicData } = params.supabase.storage.from(params.outputBucket).getPublicUrl(objectPath);

  return {
    resultUrl: publicData.publicUrl,
    objectPath: `${params.outputBucket}/${objectPath}`,
    mimeType: deliveredMime,
    providerSize: params.providerSize,
    actualSize,
    deliveredSize,
    normalizedByServer,
    sizeStatus,
  };
}

type StyleOutputItem = {
  url: string | null;
  b64_json: string | null;
  object_path: string | null;
  mime_type: string | null;
  provider_size: string | null;
  actual_size?: { w: number; h: number } | null;
  delivered_size?: { w: number; h: number } | null;
  normalized_by_server?: boolean;
  size_status?: SizeStatus;
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
  if (text.includes("IMAGE_SIZE_UNSATISFIED")) {
    return "Selected resolution was not satisfied by the model output. Please switch model or lower the resolution.";
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
  if (message.includes("IMAGE_SIZE_UNSATISFIED")) return "IMAGE_SIZE_UNSATISFIED";
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

function normalizeProductVisualIdentityMetadata(value: unknown): ProductVisualIdentity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const secondaryColors = Array.isArray(record.secondary_colors)
    ? record.secondary_colors
    : Array.isArray(record.secondaryColors)
    ? record.secondaryColors
    : [];
  const keyFeatures = Array.isArray(record.key_features)
    ? record.key_features
    : Array.isArray(record.keyFeatures)
    ? record.keyFeatures
    : [];

  return {
    primary_color: sanitizeString(record.primary_color ?? record.primaryColor, ""),
    secondary_colors: secondaryColors.map(String).map((item) => item.trim()).filter(Boolean),
    material: sanitizeString(record.material, ""),
    key_features: keyFeatures.map(String).map((item) => item.trim()).filter(Boolean),
  };
}

function buildIdentityLockPromptParts(params: {
  identity: ProductVisualIdentity | null;
  heroPlanTitle: string;
  heroPlanDescription: string;
}): string[] {
  const { identity, heroPlanTitle, heroPlanDescription } = params;
  const parts: string[] = [];
  if (heroPlanTitle) parts.push(`Hero plan title: ${heroPlanTitle}.`);
  if (heroPlanDescription) parts.push(`Hero plan objective: ${heroPlanDescription}.`);
  if (identity?.primary_color) {
    parts.push(`Exact color anchor: ${identity.primary_color}. Keep this true product color unchanged.`);
  } else {
    parts.push("Exact color anchor: keep the real product color from the uploaded reference images unchanged.");
  }
  if (identity?.material) {
    parts.push(`Exact material anchor: ${identity.material}. Do not replace or restyle the material.`);
  } else {
    parts.push("Exact material anchor: preserve the original material from the uploaded reference images.");
  }
  if (identity && identity.key_features.length > 0) {
    parts.push(`Immutable product features: ${identity.key_features.join(", ")}.`);
  } else {
    parts.push("Immutable product features: preserve the visible logo, hardware, texture, stitching, silhouette, proportions, and structure from the uploaded reference images.");
  }
  parts.push("Hard identity lock: exact same SKU, exact same product, exact same design. Do not recolor, redesign, simplify, replace, remove logo, change hardware, alter texture, adjust silhouette, distort proportions, or modify structure.");
  return parts;
}

function buildAvoidInstruction(negativePrompt: string): string {
  const normalized = negativePrompt.trim();
  if (!normalized) return "";
  return `Avoid these drift outcomes: ${normalized}.`;
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

async function processOcrJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
): Promise<void> {
  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const image = String(payload.image ?? "");
  if (!image) throw new Error("OCR_IMAGE_MISSING");

  const dataUrl = await toDataUrl(image);

  const chatResult = await callQnChatAPI({
    messages: [
      {
        role: "system",
        content: `You are a precise OCR assistant. Detect ALL visible text in the image.
Return valid JSON only (no markdown, no explanation):
{
  "data": [
    { "text": "exact text content", "box_2d": [y1, x1, y2, x2] }
  ]
}
- box_2d uses coordinates from 0 to 1000 (normalized to image dimensions).
- y1,x1 = top-left corner; y2,x2 = bottom-right corner.
- Include ALL text: titles, labels, captions, watermarks, brand names.
- If no text found, return { "data": [] }.`,
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: "Detect all visible text in this image with bounding box positions. Return JSON." },
        ],
      },
    ],
    maxTokens: 2048,
  });

  const choices = chatResult.choices as Array<{ message?: { content?: string } }> | undefined;
  const content = choices?.[0]?.message?.content ?? "";

  let ocrData: Array<{ text: string; box_2d: number[] }> = [];
  try {
    const parsed = parseJsonFromContent(content);
    if (Array.isArray(parsed.data)) {
      ocrData = parsed.data
        .filter((item: unknown) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).text === "string")
        .map((item: Record<string, unknown>) => ({
          text: String(item.text),
          box_2d: Array.isArray(item.box_2d) ? (item.box_2d as number[]).map(Number) : [0, 0, 0, 0],
        }));
    }
  } catch {
    ocrData = [];
  }

  const { error: ocrUpdateError } = await supabase
    .from("generation_jobs")
    .update({
      status: "success",
      result_data: { data: ocrData },
      result_url: null,
      error_code: null,
      error_message: null,
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", job.id);
  if (ocrUpdateError) {
    throw new Error(`OCR_JOB_UPDATE_FAILED: ${ocrUpdateError.message}`);
  }
}

async function processAnalysisJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
): Promise<void> {
  // Route OCR tasks to dedicated handler
  if (job.payload?.task === "ocr") {
    return processOcrJob(supabase, job);
  }

  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const uiLanguage = String(payload.uiLanguage ?? payload.targetLanguage ?? "en");
  const outputLanguage = String(payload.outputLanguage ?? payload.targetLanguage ?? uiLanguage ?? "en");
  const imageCount = Math.max(1, Math.min(15, Number(payload.imageCount ?? 1)));
  const requirements = sanitizeString(payload.requirements, "");
  const studioType = sanitizeString(payload.studioType, "");
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

  const isClothingMode = Boolean(clothingMode);
  const isModelStrategy = clothingMode === "model_strategy";
  const isGenesisStudio = studioType === "genesis";
  const isEcomDetailStudio = studioType === "ecom-detail";

  if (isGenesisStudio) {
    const isZhGenesis = uiLanguage.startsWith("zh");
    const genesisSystemPrompt = isZhGenesis
      ? `你是顶级电商主图策划专家。请基于产品图和用户填写的主图要求，输出一个紧凑的 JSON 分析结果，用于后续主图生成。

强规则：
1. 用户填写的”组图要求/主图要求”优先级高于产品图分析。
2. 只输出风格方向与共享文案，不要输出图片规划，不要输出整体设计规范。
3. 风格方向只保留三个维度：sceneStyle、lighting、composition。
4. 每个维度返回 1 到 3 个中文动态标签，每个标签不超过 5 个字。
5. 每个维度必须给出一个 recommended 标签，且 recommended 必须来自 options。
6. 如果输出语言不是纯视觉，copy_plan 必须是一段可直接用于电商主图的共享文案，必须明确吸收用户填写的商品名称和主要卖点，不能泛化，不能忽略卖点关键词。
7. 如果输出语言为纯视觉，copy_plan 才能返回空字符串。
8. 所有输出必须是合法 JSON，不要 Markdown，不要解释。
9. 【颜色提取——最高优先级】product_visual_identity.primary_color 必须准确反映产品图中产品的真实主色调。仔细观察产品图片的实际颜色，不要受背景色、光影或个人偏见影响。粉色就写粉色，白色就写白色，绝对不能把浅色产品识别为深色。`
      : `You are a top-tier e-commerce hero image strategist. Based on the product images and the user's hero-image brief, return a compact JSON analysis result for downstream hero image generation.

Hard rules:
1. The user's brief has higher priority than inferred product-image analysis.
2. Output only style directions and shared copy. Do not output image plans. Do not output design specs.
3. Style directions must contain only sceneStyle, lighting, and composition.
4. Each dimension returns 1 to 3 dynamic tags.
5. Each dimension must provide one recommended tag from its own options.
6. If the output is not visual-only, copy_plan must be a usable e-commerce hero-image copy block that directly reflects the product description and key selling points from the user's brief.
7. copy_plan may be empty only in visual-only mode.
8. Return valid JSON only. No markdown. No explanations.
9. [COLOR EXTRACTION — HIGHEST PRIORITY] product_visual_identity.primary_color must accurately reflect the true dominant color of the product as seen in the uploaded images. Carefully observe the actual product color — do not confuse it with the background, lighting, or shadows. If the product is pink, write pink. Never misidentify a light-colored product as dark.`;

    const genesisUserPrompt = isZhGenesis
      ? `请严格输出如下 JSON：
{
  "product_summary": "一句简洁总结，概括产品特点与用户卖点要求",
  "product_visual_identity": {
    "primary_color": "产品主色调，必须从产品图中精确识别（如：粉色、白色、黑色、深蓝色），附带近似十六进制色值",
    "secondary_colors": ["辅助颜色列表"],
    "material": "材质描述（如：皮革、帆布、尼龙、金属）",
    "key_features": ["3-5个不可改变的关键视觉特征，如：金色五金扣、品牌logo浮雕、菱格纹车线"]
  },
  "style_directions": {
    "sceneStyle": { "options": ["标签1","标签2","标签3"], "recommended": "标签1" },
    "lighting": { "options": ["标签1","标签2","标签3"], "recommended": "标签1" },
    "composition": { "options": ["标签1","标签2","标签3"], "recommended": "标签1" }
  },
  "copy_plan": "一段共享文案，非纯视觉模式下必须直接体现商品名称和主要卖点"
}

强制视觉身份提取规则：
- product_visual_identity 是最关键的字段，必须严格从产品图中提取，不得臆造、不得泛化。
- primary_color 必须准确描述产品的真实主色调（例如粉色就写粉色，不能写成黑色或白色），并给出近似十六进制色值。
- key_features 必须列出产品图中可见的、不可改变的设计特征。

分析依据：
- 优先依据用户要求，尤其是商品描述和主要卖点。
- 再结合产品图补足真实材质、结构、拍摄角度与商业表现方式。
- 用户要求与图片冲突时，优先遵循用户要求。
- 输出语言：${outputLanguageLabel(outputLanguage)}
- 如果输出语言不是无文字（纯视觉），copy_plan 必须是电商可用文案，直接覆盖用户填写的商品和卖点，不要写空话套话。
- 如果输出语言为无文字（纯视觉），copy_plan 可以为空；但风格方向仍要正常输出。

用户要求：
${requirements || "（用户未填写额外要求，仅根据产品图分析）"}
`
      : `Return strict JSON in this shape:
{
  "product_summary": "One concise summary of product traits and the user's key selling-point brief",
  "product_visual_identity": {
    "primary_color": "The product's true dominant color as seen in the uploaded images (e.g. pink, white, black, navy blue), with approximate hex value",
    "secondary_colors": ["list of secondary colors"],
    "material": "Material description (e.g. leather, canvas, nylon, metal)",
    "key_features": ["3-5 immutable visual features, e.g. gold hardware buckle, embossed brand logo, quilted stitching"]
  },
  "style_directions": {
    "sceneStyle": { "options": ["tag1","tag2","tag3"], "recommended": "tag1" },
    "lighting": { "options": ["tag1","tag2","tag3"], "recommended": "tag1" },
    "composition": { "options": ["tag1","tag2","tag3"], "recommended": "tag1" }
  },
  "copy_plan": "One shared copy block that must directly reflect the product and key selling points unless this is visual-only mode"
}

Mandatory visual identity extraction rules:
- product_visual_identity is the most critical field. Extract it strictly from the product images. Do not fabricate or generalize.
- primary_color must accurately describe the true dominant color of the product (e.g. if the product is pink, write pink, not black or white), with an approximate hex value.
- key_features must list visible, immutable design features from the product images.

Analysis rules:
- Prioritize the user's brief, especially the product description and key selling points.
- Use the product images only to refine real product traits, structure, angle cues, and commercial presentation.
- If the brief conflicts with the images, the brief wins.
- Output language: ${outputLanguageLabel(outputLanguage)}
- If output language is not visual-only, copy_plan must be usable e-commerce copy that explicitly reflects the product and selling points from the user's brief.
- If output language is visual-only, copy_plan may be empty, but style directions must still be returned.

User brief:
${requirements || "(No extra brief provided. Analyze from product images only.)"}
`;

    const genesisMessages: Array<Record<string, unknown>> = [
      { role: "system", content: genesisSystemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: genesisUserPrompt },
          { type: "text", text: "Product reference images:" },
          ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ];

    const chatConfig = getQnChatConfig();
    const analysisTimeoutMs = Math.max(chatConfig.timeoutMs, 90_000);
    let genesisChatResponse: Record<string, unknown>;
    try {
      genesisChatResponse = await callQnChatAPI({
        model: chatConfig.model,
        messages: genesisMessages,
        maxTokens: 900,
        timeoutMsOverride: analysisTimeoutMs,
      });
    } catch (primaryErr) {
      const fallbackModel = Deno.env.get("QN_IMAGE_MODEL");
      if (!fallbackModel || fallbackModel === chatConfig.model) throw primaryErr;
      genesisChatResponse = await callQnChatAPI({
        model: fallbackModel,
        messages: genesisMessages,
        maxTokens: 900,
        timeoutMsOverride: analysisTimeoutMs,
      });
    }

    const content = String((genesisChatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
    const parsed = parseJsonFromContent(content);
    const parseFailed = parsed.__parse_failed === true;
    const parseRawPreview = typeof parsed.__raw_preview === "string" ? parsed.__raw_preview : null;
    const genesisResult = normalizeGenesisAnalysis(parsed, outputLanguage, uiLanguage, requirements);

    genesisResult._ai_meta = {
      model: String((genesisChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      usage: ((genesisChatResponse as Record<string, unknown>)?.usage as Record<string, unknown>) ?? {},
      provider: "qnaigc",
      image_count: imageCount,
      target_language: outputLanguage,
      studio_type: studioType,
      parse_failed: parseFailed,
      parse_warning: parseFailed ? "ANALYSIS_JSON_PARSE_FAILED_FALLBACK_USED" : null,
      parse_raw_preview: parseFailed ? parseRawPreview : null,
    };

    const aiRequest = {
      model: String((genesisChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      messages: genesisMessages,
      max_tokens: 900,
    };

    const { error: genesisUpdateError } = await supabase
      .from("generation_jobs")
      .update({
        status: "success",
        payload: { ...payload, ai_request: aiRequest },
        result_data: genesisResult,
        result_url: null,
        error_code: null,
        error_message: null,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", job.id);
    if (genesisUpdateError) {
      throw new Error(`ANALYSIS_JOB_UPDATE_FAILED: ${genesisUpdateError.message}`);
    }
    return;
  }

  if (isEcomDetailStudio) {
    const isZhDetail = uiLanguage.startsWith("zh");
    const rawModules = Array.isArray(payload.ecomDetailModules)
      ? payload.ecomDetailModules
      : [];
    const modules = rawModules
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, index) => {
        const titleRecord = item.title && typeof item.title === "object"
          ? item.title as Record<string, unknown>
          : {};
        const subtitleRecord = item.subtitle && typeof item.subtitle === "object"
          ? item.subtitle as Record<string, unknown>
          : {};
        const seedRecord = item.defaultPromptSeed && typeof item.defaultPromptSeed === "object"
          ? item.defaultPromptSeed as Record<string, unknown>
          : {};
        return {
          id: typeof item.id === "string" ? item.id : `module-${index + 1}`,
          title: String((isZhDetail ? titleRecord.zh : titleRecord.en) ?? titleRecord.zh ?? titleRecord.en ?? `Module ${index + 1}`),
          subtitle: String((isZhDetail ? subtitleRecord.zh : subtitleRecord.en) ?? subtitleRecord.zh ?? subtitleRecord.en ?? ""),
          seed: String((isZhDetail ? seedRecord.zh : seedRecord.en) ?? seedRecord.zh ?? seedRecord.en ?? ""),
        };
      })
      .slice(0, imageCount);

    const moduleBlock = modules.map((module, index) =>
      isZhDetail
        ? `${index + 1}. ${module.title}\n定位：${module.subtitle}\n内部重点：${module.seed}`
        : `${index + 1}. ${module.title}\nPositioning: ${module.subtitle}\nInternal focus: ${module.seed}`
    ).join("\n\n");
    const visibleCopyLanguageRule = buildVisibleCopyLanguageRule(outputLanguage, isZhDetail);

    const ecomDetailSystemPrompt = isZhDetail
      ? `你是顶级电商详情页视觉策划专家。请基于同一商品的参考图、用户组图要求和所选详情页模块，输出一个严格可编辑的详情页规划蓝图 JSON。

强规则：
1. 所有图片都必须是同一个商品，不允许把多张参考图理解为多个商品。
2. images 数组必须严格等于所选模块数量，且顺序与用户提供的模块顺序一致。
3. 每个 images[i].title 必须直接使用对应模块名称，不要改写。
4. 每个模块的 description 和 design_content 必须围绕该模块的职责展开，且要结合用户组图要求。
5. design_specs 只输出整组详情页共享的视觉规范。
6. ${visibleCopyLanguageRule}
7. 如果需要提供文案示例、文字区域说明、信息层级或参数表字段名，在 outputLanguage=zh 时必须直接写简体中文，不能用 Title、Subtitle、Description、Selling Point、Feature 等英文占位。
8. 规格表、售后保障、使用建议、成分说明、前后对比、核心卖点等信息型模块，如果包含新增可见文字，必须全部遵守目标语言约束。
9. 只输出合法 JSON，不要 Markdown，不要解释。`
      : `You are a top-tier e-commerce detail-page visual strategist. Based on the same product reference images, the user's brief, and the selected detail-page modules, return a strict editable JSON blueprint.

Hard rules:
1. All images must represent the same product; never treat multiple references as multiple products.
2. The images array must exactly match the selected module count and stay in the same order as the provided modules.
3. Each images[i].title must use the corresponding module title exactly as provided.
4. Each description and design_content must stay faithful to that module's purpose and the user's brief.
5. design_specs should contain only the shared detail-page visual system.
6. ${visibleCopyLanguageRule}
7. If you need example copy, text-zone notes, hierarchy guidance, or table headers, write them directly in the target language. Do not use placeholder labels such as Title, Subtitle, Description, Selling Point, or Feature when outputLanguage=zh.
8. Spec tables, after-sales guarantees, usage tips, ingredient explanations, before/after comparisons, and selling-point modules must follow the same visible-copy language rule whenever they introduce added on-image text.
9. Return valid JSON only. No markdown. No explanations.`;

    const ecomDetailUserPrompt = isZhDetail
      ? `请严格输出如下 JSON 结构：
{
  "design_specs": "整组详情页共享规范",
  "images": [
    {
      "title": "模块名称",
      "description": "该模块的定位描述",
      "design_content": "该模块的详细内容规划"
    }
  ]
}

要求：
- images 数组返回正好 ${imageCount} 个对象。
- 模块顺序和名称必须严格对应如下列表，不得改名，不得打乱顺序：
${moduleBlock || "1. 首屏主视觉"}
- 每个 design_content 都要明确该模块要表达的内容、构图方式、信息层级、场景或材质重点、文案表达方式。
- 输出语言：${outputLanguageLabel(outputLanguage)}
- 文案语言硬约束：${visibleCopyLanguageRule}
- 如果输出语言为简体中文，所有新增可见文案示例、标题、副标题、说明文案、参数表头、参数值、角标、CTA、保障语、步骤说明、注释、对比标签都必须直接写简体中文，不能出现英文单词、拼音、双语混排或英文占位。
- 产品自身已有的 logo、包装原文、型号、成分表、技术单位不属于新增设计文案，不需要翻译或擦除。
- 如果输出语言为纯视觉，请避免依赖大段文案，优先用视觉信息组织画面。

用户组图要求：
${requirements || "（未提供额外要求，请根据参考图和所选模块自动规划）"}
`
      : `Return strict JSON with this shape:
{
  "design_specs": "shared detail-page visual rules",
  "images": [
    {
      "title": "module title",
      "description": "module positioning",
      "design_content": "detailed module planning content"
    }
  ]
}

Requirements:
- Return exactly ${imageCount} objects in images.
- Module order and titles must exactly match this list:
${moduleBlock || "1. Hero Visual"}
- Each design_content must clearly define the message hierarchy, composition, scene or material focus, and copy treatment of that module.
- Output language: ${outputLanguageLabel(outputLanguage)}
- Visible-copy language rule: ${visibleCopyLanguageRule}
- If outputLanguage is Simplified Chinese, all added visible copy examples, titles, subtitles, body copy, spec-table headers, spec values, badges, CTAs, guarantee lines, step labels, annotations, and comparison labels must be written directly in Simplified Chinese only.
- Existing product text such as logos, original packaging text, model numbers, ingredient tables, and technical units is not added design copy and should remain untouched.
- If output language is visual-only, avoid relying on long copy and prioritize visual communication.

User brief:
${requirements || "(No extra brief provided. Infer the plan from the references and selected modules.)"}
`;

    const detailMessages: Array<Record<string, unknown>> = [
      { role: "system", content: ecomDetailSystemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: ecomDetailUserPrompt },
          { type: "text", text: "Product reference images:" },
          ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ];

    const chatConfig = getQnChatConfig();
    const analysisTimeoutMs = Math.max(chatConfig.timeoutMs, 90_000);
    let detailChatResponse: Record<string, unknown>;
    try {
      detailChatResponse = await callQnChatAPI({
        model: chatConfig.model,
        messages: detailMessages,
        maxTokens: 2048,
        timeoutMsOverride: analysisTimeoutMs,
      });
    } catch (primaryErr) {
      const fallbackModel = Deno.env.get("QN_IMAGE_MODEL");
      if (!fallbackModel || fallbackModel === chatConfig.model) throw primaryErr;
      detailChatResponse = await callQnChatAPI({
        model: fallbackModel,
        messages: detailMessages,
        maxTokens: 2048,
        timeoutMsOverride: analysisTimeoutMs,
      });
    }

    const content = String((detailChatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
    const parsed = parseJsonFromContent(content);
    const parseFailed = parsed.__parse_failed === true;
    const parseRawPreview = typeof parsed.__raw_preview === "string" ? parsed.__raw_preview : null;
    const blueprint = normalizeBlueprint(parsed, imageCount, outputLanguage, uiLanguage);

    blueprint._ai_meta = {
      model: String((detailChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      usage: ((detailChatResponse as Record<string, unknown>)?.usage as Record<string, unknown>) ?? {},
      provider: "qnaigc",
      image_count: imageCount,
      target_language: outputLanguage,
      studio_type: studioType,
      module_count: modules.length,
      parse_failed: parseFailed,
      parse_warning: parseFailed ? "ANALYSIS_JSON_PARSE_FAILED_FALLBACK_USED" : null,
      parse_raw_preview: parseFailed ? parseRawPreview : null,
    };

    const aiRequest = {
      model: String((detailChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      messages: detailMessages,
      max_tokens: 2048,
    };

    const { error: detailUpdateError } = await supabase
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
    if (detailUpdateError) {
      throw new Error(`ANALYSIS_JOB_UPDATE_FAILED: ${detailUpdateError.message}`);
    }
    return;
  }

  const defaultSystemPrompt = isModelStrategy
    ? "你是一位顶级电商视觉导演。你的任务是分析上传的服装图片和模特参考图，并根据用户的设计需求，为一次模特拍摄活动制定一套完整的视觉指南。你需要先定义全局的视觉调性，然后针对每一张照片（镜头）制定极具营销感的构图、卖点展示方案。必须且仅输出一个合法的 JSON 对象，不要包含 Markdown 代码块标签或任何说明文字。"
    : uiLanguage === "zh"
    ? isClothingMode
      ? "你是顶级电商视觉总监与服装分析专家。你的任务是对服装产品图进行深度视觉解构，输出精确的商业图片蓝图。分析时必须识别面料类型、提取精确颜色色值（十六进制）、记录关键设计细节，并为每种图片类型制定专业的拍摄方案。只输出 JSON，不要 markdown 代码块。"
      : `你是资深电商视觉规划专家，精通为各品类产品制定视觉设计方案。请为用户创建正好 ${imageCount} 张独立且各不重复的图片设计方案。

你的任务：
1. 分析用户上传的产品图片。
2. 结合用户需求描述（重点关注是否要求"纯视觉/无文字"版本）。
3. 制定整体设计规范（design_specs）。
4. 为每张图片制定详细的设计方案。

重要逻辑规则：
- 文案区分原则：区分"设计文案"（后期排版叠加的标题/卖点）与"产品原有文字"（产品瓶身/包装上固有的 logo、成分、标签）。禁止在 design_content 中要求擦除产品固有信息。
- 保真要求：无论是否添加设计文案，design_content 中必须明确要求保留产品所有固有细节。
- 纯视觉模式：若用户要求"纯视觉"设计，design_specs 的字体体系部分输出"无（纯视觉设计，不涉及排版）"，文案内容全部填写"无"，构图焦点强调"以纯视觉构图和光影展示产品"。

只输出原始 JSON 字符串，不要 markdown 代码块，不要任何说明文字。`
    : isClothingMode
      ? "You are a world-class e-commerce visual director and apparel analysis expert. Your task is to deeply analyze clothing product images and produce precise commercial image blueprints. During analysis, identify fabric type, extract exact hex color values, document key design details, and define professional shot plans for each image type. Return JSON only, no markdown fences."
      : `You are a senior e-commerce visual planning expert, proficient in formulating visual design specifications for products across multiple categories. Please create independent and non-repetitive design plans for exactly ${imageCount} image(s).

Your tasks are:
1. Analyze the product images provided by the user.
2. Combine the analysis with the user's requirement descriptions (pay close attention to whether the user requests a "no-text/pure" version).
3. Formulate the overall design specifications (design_specs).
4. Develop a detailed design plan for each image.

Important Logic Rules:
- Copywriting Distinction: Distinguish between "Design Copy" (titles/selling points added during post-production) and "Product Text" (inherent logos, ingredients, labels on the product packaging). Never erase product text.
- Fidelity Requirement: Always explicitly require the preservation of all inherent product details in design_content.
- No-Text Processing: If the user requests a "no-text" design, set the Font System section in design_specs to "None (Pure visual design, no typography involved)". Fill all Text Content fields with "None" and emphasize pure visual composition.

Return only the raw JSON string. No markdown fences. No explanatory text.`;

  const isZhUi = uiLanguage.startsWith("zh");

  const modelStrategyUserPrompt = `
你需要基于服装调性和模特特质，输出如下 JSON 结构（不要 Markdown 代码块）：
{
  "design_specs": "...",
  "images": [{ "title": "...", "description": "...", "design_content": "..." }]
}

design_specs 必须包含以下五个维度：

**1. 核心视觉基调 (Overall Visual Theme)**
基于图片特征定义整组照片的视觉灵魂、背景环境设定、全局色彩调性。

**2. 全局摄影参数建议 (Global Photography Specs)**
镜头焦段建议、全局布光原则、画质与技术参数标准。

**3. 模特基础画像 (Model Profile)**
基于模特参考图，识别并提取 4 个核心特征：性别、肤色/人种、发色、发型。表述极其精炼（如：亚裔女性，肤色白皙，棕黑色直短发），仅作为身份锁定的锚点，严禁过度描述。

**4. 服装基础特征 (Garment Core Features)**
服装核心特征：色彩 + 材质 + 版型的（服装名称），仅作为服装锚点，严禁过度描述。

**5. 文字系统规范 (Typography System)**
标题字体类型与颜色（十六进制）、正文字体、字号层级（3:1.8:1）、字体风格。
${outputLanguage === "none" ? "当前目标语言为纯视觉（无文字），文字内容统一输出 None。" : `文字内容使用 ${outputLanguageLabel(outputLanguage)}。`}

images 数组输出正好 ${imageCount} 个镜头方案，每个方案 design_content 必须包含：
**设计目标** | **模特要求**（姿势/表情/动作，并强调必须与模特参考图保持绝对的面部和身份一致性）| **服饰工艺焦点** | **构图方案**（景别+占比+布局）| **光影方案** | **背景描述** | **配色方案**（含精确 hex 色值）| **文字内容** | **视觉氛围关键词**

用户需求：${requirements || "（无额外需求）"}
`;

  const defaultUserPrompt = isModelStrategy
    ? modelStrategyUserPrompt
    : isZhUi
    ? isClothingMode
      ? `
请对服装产品图进行深度视觉分析，然后按以下 JSON 结构输出蓝图（所有字段内容使用中文）：
{
  "images": [
    {
      "title": "4-12 字的标题（含图片类型，如：白底精修图、3D幽灵模特图、细节特写图）",
      "description": "1-2 句定位描述",
      "design_content": "## 图片 [N]：...\\n\\n**图片类型**：（白底精修图 / 3D幽灵模特图 / 细节特写图 / 卖点展示图）\\n\\n**服装属性**：类型、面料材质（含视觉特征如哑光/光泽）\\n\\n**精确颜色**：主色 #XXXXXX，辅色 #XXXXXX（必须从产品图中提取十六进制色值）\\n\\n**关键设计细节**：图案、印花、logo、工艺细节、特殊结构\\n\\n**构图方案**：主体占比（如75%）、构图方式（居中/对角线等）\\n\\n**光影方案**：光源方向、光质（软光/硬光）、阴影处理\\n\\n**文案内容**（使用 ${outputLanguageLabel(outputLanguage)}）：...\\n\\n**氛围关键词**：..."
    }
  ],
  "design_specs": "# 整体设计规范\\n\\n## 色彩体系（含精确 hex 色值）\\n...\\n## 面料材质\\n...\\n## 摄影风格\\n...\\n## 品质要求\\n..."
}
约束条件：
- images 数组返回正好 ${imageCount} 个对象。
- 每个 design_content 必须包含精确的十六进制颜色值（从产品图中提取）。
- 每张图片方案必须不同（角度、布局、场景逻辑各不相同）。
- ${textContentRule}
- 如果输出语言为"纯视觉"，文案部分一律输出"无"，并强调纯视觉构图。
- 服装拍摄类型约束：
${clothingRuleBlock}
用户需求：
${requirements || "（未提供额外需求）"}
`
      : `
**重要：所有字段内容必须使用简体中文撰写（色值除外，保留英文 hex 格式）。**

请按以下 JSON 结构输出蓝图：
{
  "design_specs": "# 整体设计规范\\n\\n> 所有图片须遵循以下统一规范以确保视觉一致性\\n\\n## 色彩体系\\n- **主色**：[根据产品分析确定]（十六进制色值）\\n- **辅助色**：[根据产品分析确定]（十六进制色值）\\n- **背景色**：[根据产品分析确定]（十六进制色值）\\n\\n## 字体体系\\n- **标题字体**：[推荐字体类型]\\n- **正文字体**：[推荐字体类型]\\n- **层级比例**：标题:副标题:正文 = 3:1.8:1\\n\\n## 视觉语言\\n- **装饰元素**：[根据产品类型推荐]\\n- **图标风格**：[推荐风格]\\n- **留白原则**：[具体说明]\\n\\n## 摄影风格\\n- **布光方式**：[具体说明]\\n- **景深设置**：[具体说明]\\n- **相机参数参考**：[如 ISO 100、85mm 定焦镜头]\\n\\n## 品质要求\\n- 分辨率：4K/高清\\n- 风格：专业产品摄影 / 商业广告级\\n- 真实感：超写实 / 照片级真实",
  "images": [
    {
      "title": "4-8 字的中文标题，简洁有力",
      "description": "1-2 句中文定位描述，说明本图的设计目标与定位",
      "design_content": "## 图片 [N]：[图片类型]\\n\\n**设计目标**：[具体目标]\\n\\n**产品外观**：[是/否 — 描述展示产品的哪个角度/面]\\n\\n**画面元素**：\\n- [每个元素说明：类型、形状、位置、占比（%）、内容]\\n\\n**构图方案**：\\n- 产品占比：[如 65%]\\n- 布局方式：[如居中竖向排列，轻微15度倾斜]\\n- 文字区域：[具体位置，若无文案则写"无文字区域"]\\n\\n**内容元素**：\\n- 展示焦点：[具体视觉焦点]\\n- 核心卖点：[具体卖点]\\n- 背景元素：[详细描述]\\n- 装饰元素：[详细描述]\\n\\n**文案内容**（使用 ${outputLanguageLabel(outputLanguage)}）：\\n- 主标题：[具体文字 / 若纯视觉则填"无"]\\n- 副标题：[具体文字 / 若纯视觉则填"无"]\\n- 描述文案：[具体文字 / 若纯视觉则填"无"]\\n\\n**氛围营造**：\\n- 情绪关键词：[3-5 个关键词]\\n- 光影效果：[详细描述]"
    }
  ]
}
约束条件：
- images 数组返回正好 ${imageCount} 个对象。
- 每张图片方案必须不同（角度、布局、场景逻辑各不相同）。
- ${textContentRule}
- 如果输出语言为"纯视觉"，字体体系输出"无（纯视觉设计）"，所有文案内容填"无"，强调纯视觉构图。
- 所有色值须基于实际产品图提取。
- 保持高转化电商风格，真实的材质与光影细节。
用户需求：
${requirements || "（未提供额外需求）"}
`
    : isClothingMode
      ? `
Perform a deep visual analysis of the clothing product image, then output a blueprint with this exact JSON shape:
{
  "images": [
    {
      "title": "4-12 words title (include shot type: White Background Refined / 3D Ghost Mannequin / Detail Close-up / Selling Point)",
      "description": "1-2 sentence positioning",
      "design_content": "## Image [N]: ...\\n\\n**Shot Type**: (White Background / 3D Ghost Mannequin / Detail Close-up / Selling Point)\\n\\n**Garment Attributes**: type, fabric/material (matte/glossy/textured)\\n\\n**Exact Colors**: Primary #XXXXXX, Secondary #XXXXXX (MUST extract hex values from product image)\\n\\n**Key Design Details**: pattern, print, logo, stitching, special structure\\n\\n**Composition**: subject framing % (e.g. 75%), layout style (centered/diagonal)\\n\\n**Lighting Plan**: light source direction, quality (soft/hard), shadow treatment\\n\\n**Text Content** (Using ${outputLanguageLabel(outputLanguage)}): ...\\n\\n**Atmosphere Keywords**: ..."
    }
  ],
  "design_specs": "# Overall Design Specifications\\n\\n## Color System (with exact hex values)\\n...\\n## Fabric & Material\\n...\\n## Photography Style\\n...\\n## Quality Requirements\\n..."
}
Constraints:
- Return exactly ${imageCount} objects in images.
- Every design_content MUST include precise hex color values extracted from the product image.
- Every image plan must be different (angle, layout, scene logic).
- ${textContentRule}
- If output language is visual-only, keep typography as None.
- Clothing shot type constraints:
${clothingRuleBlock}
User brief:
${requirements || "(no extra brief provided)"}
`
      : `
Output a blueprint JSON with this exact shape:
{
  "design_specs": "(Written in English) # Overall Design Specifications\\n\\n> All images must follow the unified specifications below to ensure visual consistency\\n\\n## Color System\\n- **Primary Color**: [Determined from product image] (hex code)\\n- **Secondary Color**: [Determined from product image] (hex code)\\n- **Background Color**: [Determined from product image] (hex code)\\n\\n## Font System\\n- **Heading Font**: [Recommended font type]\\n- **Body Font**: [Recommended font type]\\n- **Hierarchy**: Heading:Subtitle:Body = 3:1.8:1\\n\\n## Visual Language\\n- **Decorative Elements**: [Based on product type]\\n- **Icon Style**: [Recommended style]\\n- **Negative Space Principle**: [Specific instructions]\\n\\n## Photography Style\\n- **Lighting**: [Specific instructions]\\n- **Depth of Field**: [Specific instructions]\\n- **Camera Parameter Reference**: [e.g. ISO 100, 85mm Prime Lens]\\n\\n## Quality Requirements\\n- Resolution: 4K/HD\\n- Style: Professional product photography / Commercial advertising grade\\n- Realism: Hyper-realistic / Photorealistic",
  "images": [
    {
      "title": "[English title, concise and powerful, 4-8 words]",
      "description": "[English description of design goal and positioning, 1-2 sentences]",
      "design_content": "## Image [N]: [Image Type]\\n\\n**Design Goal**: [Specific goal]\\n\\n**Product Appearance**: [Yes/No — describe which angle/side of product is shown]\\n\\n**In-Graphic Elements**:\\n- [For each element: type, shape, position, size (% of frame), content]\\n\\n**Composition Plan**:\\n- Product Proportion: [e.g. 65% of frame]\\n- Layout Method: [e.g. central vertical alignment, slight 15-degree tilt]\\n- Text Area: [Specific location, or 'No-text area' if no copy]\\n\\n**Content Elements**:\\n- Focus of Display: [Specific visual focus]\\n- Key Selling Points: [Concrete selling points]\\n- Background Elements: [Detailed description]\\n- Decorative Elements: [Detailed description]\\n\\n**Text Content** (Using ${outputLanguageLabel(outputLanguage)}):\\n- Main Title: [Specific text / None if no-text]\\n- Subtitle: [Specific text / None if no-text]\\n- Description Text: [Specific text / None if no-text]\\n\\n**Atmosphere Creation**:\\n- Mood Keywords: [3-5 keywords]\\n- Light and Shadow Effects: [Detailed description]"
    }
  ]
}
Constraints:
- Return exactly ${imageCount} objects in images array.
- Each image plan must be unique — different angles, layouts, and scene logic.
- ${textContentRule}
- If output language is visual-only, set Font System to "None (Pure visual design)", fill all Text Content fields with "None", and emphasize pure visual composition.
- Base all color values on actual product image analysis.
- Keep high-conversion e-commerce style with realistic material and lighting details.
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
  // Analysis may need to generate many detailed plans — allow more time than the default 30s
  const analysisTimeoutMs = Math.max(chatConfig.timeoutMs, 90_000);
  let chatResponse: Record<string, unknown>;
  try {
    chatResponse = await callQnChatAPI({
      model: chatConfig.model,
      messages,
      maxTokens: 2048,
      timeoutMsOverride: analysisTimeoutMs,
    });
  } catch (primaryErr) {
    const fallbackModel = Deno.env.get("QN_IMAGE_MODEL");
    if (!fallbackModel || fallbackModel === chatConfig.model) throw primaryErr;
    chatResponse = await callQnChatAPI({
      model: fallbackModel,
      messages,
      maxTokens: 2048,
      timeoutMsOverride: analysisTimeoutMs,
    });
  }

  const content = String((chatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
  const parsed = parseJsonFromContent(content);
  const parseFailed = parsed.__parse_failed === true;
  const parseRawPreview = typeof parsed.__raw_preview === "string" ? parsed.__raw_preview : null;
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
    parse_failed: parseFailed,
    parse_warning: parseFailed ? "ANALYSIS_JSON_PARSE_FAILED_FALLBACK_USED" : null,
    parse_raw_preview: parseFailed ? parseRawPreview : null,
  };

  const aiRequest = {
    model: String((chatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
    messages,
    max_tokens: 4096,
  };

  const { error: analysisUpdateError } = await supabase
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
  if (analysisUpdateError) {
    throw new Error(`ANALYSIS_JOB_UPDATE_FAILED: ${analysisUpdateError.message}`);
  }
}

async function processImageGenJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
): Promise<void> {
  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const model = normalizeRequestedModel(String(payload.model ?? "or-gemini-3.1-flash"));
  const imageRoute = resolveImageRoute(model);
  const imageSize = payload.imageSize == null
    ? getDefaultImageSizeForModel(model)
    : String(payload.imageSize);
  if (!isImageSizeSupportedForModel(model, imageSize, { includeInternal: true })) {
    throw new Error(`IMAGE_SIZE_UNSATISFIED requested=${imageSize} model=${model}`);
  }
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
      const { error: insufficientCreditsUpdateError } = await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error_code: "INSUFFICIENT_CREDITS",
          error_message: "Not enough credits",
          duration_ms: Date.now() - startedAt,
        })
        .eq("id", job.id);
      if (insufficientCreditsUpdateError) {
        throw new Error(`INSUFFICIENT_CREDITS_UPDATE_FAILED: ${insufficientCreditsUpdateError.message}`);
      }
      await syncModelHistoryStatus(supabase, job.id, job.user_id, {
        status: "failed",
        result_url: null,
        error_message: "Not enough credits",
      });
      return;
    }
    creditDeducted = true;

    // Quick Edit / Text Edit mode: different image assembly + prompt prefix
    const isQuickEdit = Boolean(payload.editMode) && payload.editType === "quick";
    const isTextEdit = Boolean(payload.editMode) && payload.editType === "text";
    const workflowMode = typeof payload.workflowMode === "string" ? payload.workflowMode : "product";
    const allImagePaths: string[] = [];

    if (isQuickEdit || isTextEdit) {
      // Edit modes: originalImage first, then referenceImages
      if (typeof payload.originalImage === "string" && payload.originalImage) {
        allImagePaths.push(payload.originalImage);
      }
      if (Array.isArray(payload.referenceImages)) {
        for (const img of payload.referenceImages) {
          if (typeof img === "string" && img.trim()) allImagePaths.push(img);
        }
      }
      // Fallback to productImage if no originalImage
      if (allImagePaths.length === 0 && source) {
        allImagePaths.push(source);
      }
    } else {
      // Standard mode: collect ALL input images (product + model)
      if (workflowMode === "model" && typeof payload.modelImage === "string" && payload.modelImage) {
        allImagePaths.push(payload.modelImage);
      }
      if (Array.isArray(payload.productImages)) {
        for (const img of payload.productImages) {
          if (typeof img === "string" && img.trim()) allImagePaths.push(img);
        }
      }
      if (allImagePaths.length === 0 && typeof payload.productImage === "string" && payload.productImage) {
        allImagePaths.push(payload.productImage);
      }
      if (allImagePaths.length === 0) {
        allImagePaths.push(source);
      }
    }

    const allDataUrls = await Promise.all(allImagePaths.map(toDataUrl));

    // Build prompt
    const styleConstraintPrompt = normalizeStyleConstraintPrompt(payload.styleConstraint);
    const styleConstraintSource = normalizeStyleConstraintSource(payload.styleConstraint);
    const metadata = payload.metadata && typeof payload.metadata === "object"
      ? payload.metadata as Record<string, unknown>
      : {};
    const negativePrompt = typeof payload.negativePrompt === "string" ? payload.negativePrompt.trim() : "";
    const productIdentity = normalizeProductVisualIdentityMetadata(metadata.product_visual_identity);
    const heroPlanTitle = sanitizeString(metadata.hero_plan_title, "");
    const heroPlanDescription = sanitizeString(metadata.hero_plan_description, "");
    let finalPrompt = String(payload.prompt);
    if (isTextEdit) {
      // Text Edit mode: build bilingual replacement prompt from textEdits
      const textEdits = typeof payload.textEdits === "object" && payload.textEdits !== null
        ? payload.textEdits as Record<string, string>
        : {};
      const entries = Object.entries(textEdits);
      if (entries.length > 0) {
        // English part
        const enParts = entries.map(([from, to]) => `"${from}" to "${to}"`).join(", ");
        // Chinese part
        const zhParts = entries.map(([from, to]) => `文字${from}替换为${to}`).join(",");
        finalPrompt = `Replace text in image: ${enParts}. ${zhParts}，字体样式大小颜色保持不变，图中其他元素保持不变。`;
      }
    } else if (isQuickEdit) {
      // Idempotent System Hint prefix for Quick Edit
      if (!finalPrompt.startsWith("[System Hint:")) {
        const refCount = allImagePaths.length - 1;
        let hint = "[System Hint: Product is at index 0.";
        for (let ri = 0; ri < refCount; ri++) {
          hint += ` Reference ${ri + 1} is at index ${ri + 1}.`;
        }
        hint += "] ";
        finalPrompt = hint + finalPrompt;
      }
    } else {
      // Standard mode: e-commerce photography prefix
      const ecomPrefix = "Professional e-commerce product photography. High-end commercial catalog quality. " +
        "Clean, premium aesthetic. Product is the hero — sharp focus, realistic materials and textures. " +
        "Use the uploaded product images as hard references for the exact same SKU. " +
        "Preserve the exact same product identity, colorway, material, texture, silhouette, proportions, logo, print, hardware, stitching, trims, and all key design details. " +
        "Do not recolor, redesign, simplify, replace, or invent new product features. " +
        "Only scene, composition, camera angle, crop, lighting, and background styling may change. " +
        "4K ultra-detailed rendering. ";
      const identityLockPrompt = buildIdentityLockPromptParts({
        identity: productIdentity,
        heroPlanTitle,
        heroPlanDescription,
      }).join(" ");
      const avoidInstruction = buildAvoidInstruction(negativePrompt);
      const prefixParts = [
        ecomPrefix.trim(),
        identityLockPrompt,
        styleConstraintPrompt,
        avoidInstruction,
      ].filter((item) => item && item.trim().length > 0);
      finalPrompt = `${prefixParts.join("\n")}\n${finalPrompt}`;
    }
    const imageGenTimeoutMs = (isQuickEdit || isTextEdit)
      ? Number(Deno.env.get("QUICK_EDIT_IMAGE_TIMEOUT_MS") ?? Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS") ?? "120000")
      : Number(Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS") ?? "60000");
    const apiResponse = await callQnImageAPI({
      imageDataUrl: allDataUrls[0],
      imageDataUrls: allDataUrls.length > 1 ? allDataUrls : undefined,
      prompt: finalPrompt,
      n: 1,
      model: imageRoute.model,
      endpointOverride: imageRoute.endpoint,
      apiKeyOverride: imageRoute.apiKey,
      size: scaledRequestSize(aspectRatio, imageSize),
      imageSize,
      aspectRatio,
      timeoutMsOverride: imageGenTimeoutMs,
    });

    const providerEntry = Array.isArray(apiResponse.data) && apiResponse.data.length > 0
      ? apiResponse.data[0] as Record<string, unknown>
      : null;
    const providerSize = providerEntry && typeof providerEntry.size === "string"
      ? providerEntry.size
      : null;

    // Handle both URL and b64 responses (Volcengine returns URL, others may return b64)
    const generated = extractGeneratedImageResult(apiResponse);
    const generatedBase64 = generated.b64 ?? null;
    const outputBucket = Deno.env.get("GENERATIONS_BUCKET") ?? "generations";
    const persisted = await persistGeneratedImage({
      supabase,
      outputBucket,
      userId: job.user_id,
      providerSize,
      generatedBase64,
      generatedUrl: generated.url ?? null,
      imageSize,
    });

    const requestedSize = scaledRequestSize(aspectRatio, imageSize);

    const resultDataBase = {
      provider: imageRoute.provider,
      model: imageRoute.model ?? model,
      image_size: imageSize,
      style_constraint_applied: Boolean(styleConstraintPrompt),
      style_constraint_source: styleConstraintSource,
      requested_size: requestedSize,
      provider_size: persisted.providerSize,
      actual_size: persisted.actualSize,
      delivered_size: persisted.deliveredSize,
      size_status: persisted.sizeStatus,
      normalized_by_server: persisted.normalizedByServer,
      mime_type: persisted.mimeType,
      object_path: persisted.objectPath,
    };

    const resultData: Record<string, unknown> = resultDataBase;

    const { error: finalizeError } = await supabase
      .from("generation_jobs")
      .update({
        status: "success",
        result_url: persisted.resultUrl,
        result_data: resultData,
        error_code: null,
        error_message: null,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", job.id);

    if (finalizeError) {
      throw new Error(`GENERATION_JOB_FINALIZE_FAILED: ${finalizeError.message}`);
    }
    await syncModelHistoryStatus(supabase, job.id, job.user_id, {
      status: "success",
      result_url: persisted.resultUrl,
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

const STYLE_ANALYSIS_SYSTEM_PROMPT =
  `作为顶级的电子商务视觉总监与 AI 绘画专家，你负责深度解构"参考图"的视觉基因，并将用户提供的"产品图"中的单个或多个主体元素完美融入该风格中。你生成的提示词必须基于以下维度的精细拆解：

1. 布局拓扑（Layout Topology）：分析参考图的网格系统与空间切割方式。确定所有产品元素在画面中的视觉落点与构架（对称、对角线、F型分布），确保遵循原图物理支撑逻辑。
2. 视觉流向（Visual Flow）：解构画面的权重层级。明确背景如何引导视线落向产品主体，定义多产品元素间的主次引导顺序，保持原图视觉叙事节奏。
3. 元素逻辑（Element Logic）：组合关系（排列密度、堆叠/阶梯/散落）+ 语义一致性（材质、装饰物抽象语义）+ 物理交互（遮挡、投影、嵌入）。
4. 色彩机理（Color Mechanism）：解析配色逻辑与饱和度策略，确保全图色调与参考图高度统一。
5. 容器排版（Container Typography）：存在性判定（参考图是否含文字，无则严禁包含文本描述）+ 语种一致性（遵循参考图语种）+ 确定性指令（字体描述唯一明确，严禁"或类似"表述）。
6. 光影质感（Light & Texture）：精准定义光源逻辑与材质属性，统一照亮所有产品元素，形成物理空间感。
7. 生成要求：保持所有输入产品图主体的核心形态特征与材质细节不失真。最终输出必须是一段高度详细、工程化、无冗余解释的图像生成提示词。仅输出提示词文本，不含 Markdown 格式，不含任何解释说明。`;

async function generateStyleAnalysisPrompt(
  productDataUrl: string,
  referenceDataUrl: string,
): Promise<string> {
  const response = await callQnChatAPI({
    messages: [
      { role: "system", content: STYLE_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: productDataUrl } },
          { type: "image_url", image_url: { url: referenceDataUrl } },
          {
            type: "text",
            text: "图1是产品图（需完整保留产品主体），图2是参考风格图（只学习其视觉风格）。请生成一段详细的英文图像生成提示词，将图1的产品主体以图2的视觉风格重新呈现。",
          },
        ],
      },
    ],
    maxTokens: 800,
  });
  // deno-lint-ignore no-explicit-any
  const content = (response as any)?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }
  throw new Error("STYLE_ANALYSIS_EMPTY_RESPONSE");
}

const REFINEMENT_ANALYSIS_SYSTEM_PROMPT =
  `你是一名专业的商业产品精修师，需要对所有品类的产品进行专业级精修处理，以达到崭新、高级且极具吸引力的视觉效果。必须强调：产品外观需与原图完全一致，包含造型、尺寸比例、细节结构、标识/Logo的位置与样式，不得随意修改产品原有形态、细节与核心特征。

核心精修要求：
1. 背景规范：将背景统一替换为纯净无杂色的纯白，色号为 #FFFFFF（RGB: 255, 255, 255），确保背景无渐变、无阴影、无任何干扰元素，让产品主体成为绝对视觉焦点。
2. 质感还原与强化：强化产品材质的原始特性，如玻璃的通透感、布料的柔软纹理、塑料的细腻哑光等，并全面优化，去除表面划痕、污渍、指纹、氧化痕迹等所有瑕疵，使其呈现崭新无瑕的状态。
3. 光影与立体感优化：采用专业商业棚拍级布光，通过添加柔和渐变的底部倒影、细腻的高光层次和自然的阴影过渡，增强产品的立体感与悬浮感，让产品从背景中脱颖而出，光影贴合产品原有形态，层次自然不突兀。
4. 细节精致度提升：强化产品上的文字、Logo、标签等元素的锐利度，确保边缘干净利落、颜色均匀饱满；处理接缝、螺丝、边角等细节，使其整齐无痕，精准还原产品本身的精致肌理。
5. 色彩与氛围营造：根据产品的定位与目标受众，调整整体色调至舒适高级的状态，做到无偏色、不发灰、色彩饱和度适中；美妆类可营造清新治愈感，电子类可营造科技未来感，家居类可营造温暖氛围感。添加轻微的空气感光晕或环境光效提升吸引力，光效不抢占产品主体视觉。
6. 构图优化：构图上遵循居中或黄金分割原则，确保画面平衡、专业，产品在画面中占比合理，无裁切不全、位置偏移等问题。

金属材质特殊要求：金属材质按原图特性还原并强化，普通金属必须统一加上一句：完美镀铬表面。哑光/拉丝/磨砂等金属需强化其低反光、细腻的原始材质质感，无额外反光干扰。

输出格式：单行文本精修提示词，中文描述，不要输出 JSON，直接输出文本即可。`;

async function generateRefinementPrompt(productDataUrl: string): Promise<string> {
  const response = await callQnChatAPI({
    messages: [
      { role: "system", content: REFINEMENT_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: productDataUrl } },
          { type: "text", text: "请分析这张产品图，生成一段专业的商业级精修提示词，描述如何对该产品进行精修处理。" },
        ],
      },
    ],
    maxTokens: 600,
  });
  // deno-lint-ignore no-explicit-any
  const content = (response as any)?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }
  throw new Error("REFINEMENT_ANALYSIS_EMPTY_RESPONSE");
}

async function processStyleReplicateJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
): Promise<void> {
  const startedAt = Date.now();
  const payload = job.payload ?? {};
  const modelName = normalizeRequestedModel(String(payload.model ?? "or-gemini-3.1-flash"));
  const imageRoute = resolveImageRoute(modelName);
  const imageSize = payload.imageSize == null
    ? getDefaultImageSizeForModel(modelName)
    : String(payload.imageSize);
  if (!isImageSizeSupportedForModel(modelName, imageSize, { includeInternal: true })) {
    throw new Error(`IMAGE_SIZE_UNSATISFIED requested=${imageSize} model=${modelName}`);
  }
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
  const styleConstraintPrompt = normalizeStyleConstraintPrompt(payload.styleConstraint);
  const styleConstraintSource = normalizeStyleConstraintSource(payload.styleConstraint);
  const refinementBasePrompt =
    "作为专业电商图片精修模型,在不改变产品本体的前提下，对单张产品图进行商业级精修。仅做精修优化,允许进行瑕疵清理、边缘优化、光影校正、色彩与清晰度增强。";
  const refinementWhiteBackgroundPrompt = "除产品主体外的背景与非主体元素统一为纯白背景干净无杂物。";
  const requestSize = scaledRequestSize(aspectRatio, imageSize);
  const styleTimeoutMs = Number(
    mode === "refinement"
      ? (Deno.env.get("REFINEMENT_IMAGE_TIMEOUT_MS") ?? "90000")
      : (Deno.env.get("STYLE_REPLICATE_IMAGE_TIMEOUT_MS")
        ?? Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS")
        ?? "120000"),
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

  // Two-stage style analysis: cache by (productUrl || referenceUrl) to avoid duplicate vision calls
  const stylePromptCache = new Map<string, Promise<string>>();
  const getStyleAnalysisPrompt = (productUrl: string, referenceUrl: string): Promise<string> => {
    const key = `${productUrl}||${referenceUrl}`;
    if (!stylePromptCache.has(key)) {
      stylePromptCache.set(key, generateStyleAnalysisPrompt(productUrl, referenceUrl));
    }
    return stylePromptCache.get(key)!;
  };

  // Refinement analysis: cache by productUrl to avoid duplicate vision calls per product image
  const refinementPromptCache = new Map<string, Promise<string>>();
  const getRefinementPrompt = (productUrl: string): Promise<string> => {
    if (!refinementPromptCache.has(productUrl)) {
      refinementPromptCache.set(productUrl, generateRefinementPrompt(productUrl));
    }
    return refinementPromptCache.get(productUrl)!;
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
        provider: imageRoute.provider,
        model: imageRoute.model ?? modelName,
        image_size: imageSize,
        mime_type: firstOutput?.mime_type ?? null,
        object_path: firstOutput?.object_path ?? null,
        requested_size: requestSize,
        provider_size: firstOutput?.provider_size ?? null,
        actual_size: firstOutput?.actual_size ?? null,
        delivered_size: firstOutput?.delivered_size ?? null,
        size_status: firstOutput?.size_status ?? "unknown",
        normalized_by_server: firstOutput?.normalized_by_server ?? false,
        outputs: mergedOutputs.map(({ b64_json: _b64, ...rest }) => rest),
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
          style_constraint_applied: Boolean(styleConstraintPrompt),
          style_constraint_source: styleConstraintSource,
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

  const buildPrompt = (unit: StyleReplicateUnit, analysisPrompt?: string, refinementAnalysisPrompt?: string): string => {
    if (unit.mode === "refinement") {
      if (refinementAnalysisPrompt) {
        // Two-stage: use vision-model-generated product-specific refinement prompt
        const parts = [refinementAnalysisPrompt];
        if (styleConstraintPrompt) parts.push(styleConstraintPrompt);
        if (userPrompt) parts.push(userPrompt);
        return parts.join("\n");
      }
      // Fallback: use hardcoded generic prompt
      const promptParts = [refinementBasePrompt];
      if (backgroundMode === "white") {
        promptParts.push(refinementWhiteBackgroundPrompt);
      }
      promptParts.push(`输出比例为 ${aspectRatio}，参考尺寸为 ${requestSize}。`);
      if (styleConstraintPrompt) {
        promptParts.push(styleConstraintPrompt);
      }
      if (userPrompt) {
        promptParts.push(userPrompt);
      }
      return promptParts.join("\n");
    }

    if (analysisPrompt) {
      // Two-stage: use the vision-model-generated detailed style prompt.
      // Image 1 = reference style, Image 2 = product to preserve.
      const parts = [
        analysisPrompt,
        styleConstraintPrompt,
        "Image 1 is the reference style image only — do not copy its products or subjects.",
        "Image 2 contains the product to preserve — maintain its exact shape, material, color, texture, logo, and all key design details.",
        "Do not simply return Image 2 unchanged or make only a minimal edit.",
        `Output aspect ratio: ${aspectRatio}, size: ${requestSize}.`,
      ].filter((v): v is string => Boolean(v && v.trim()));
      if (userPrompt) parts.push(`Additional instructions: ${userPrompt}`);
      return parts.join(" ");
    }

    // Fallback single-stage prompt (used if vision analysis fails)
    const promptParts = [
      styleConstraintPrompt,
      "Image 1 is style reference only. Image 2 contains the product to preserve.",
      "Create a brand-new high-quality e-commerce image: adopt the visual style, composition, background, lighting direction, color palette, and layout rhythm of Image 1.",
      "Preserve only the product identity from Image 2 — its shape, material, color, texture, logo, and key design details.",
      "Do not copy the original composition, pose, or scene from Image 2. Do not simply return Image 2 unchanged.",
      "Do not copy any product subjects from Image 1 — only borrow its style and presentation.",
      `Output aspect ratio: ${aspectRatio}, size: ${requestSize}.`,
    ].filter((v): v is string => Boolean(v && v.trim()));
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

      // Stage 1: vision model generates a detailed prompt before image gen.
      // Style replicate: analyze reference+product for style transfer.
      // Refinement: analyze product for product-specific retouching instructions.
      // Both fall back gracefully to hardcoded prompt if the analysis call fails.
      let analysisPrompt: string | undefined;
      let refinementAnalysisPrompt: string | undefined;
      if (unit.mode !== "refinement" && referenceDataUrl) {
        try {
          analysisPrompt = await getStyleAnalysisPrompt(productDataUrl, referenceDataUrl);
        } catch {
          analysisPrompt = undefined;
        }
      } else if (unit.mode === "refinement") {
        // Skip vision analysis for refinement to stay within edge function time limits.
        // The hardcoded refinement prompt is comprehensive and produces good results.
        refinementAnalysisPrompt = undefined;
      }

      const prompt = buildPrompt(unit, analysisPrompt, refinementAnalysisPrompt);
      let chosen: Omit<StyleOutputItem, "reference_index" | "group_index" | "unit_status" | "error_message"> | null = null;
      let lastProviderSize: string | null = null;

      for (let attempt = 0; attempt < maxRatioRetries; attempt++) {
        const apiResponse = await callQnImageAPI({
          imageDataUrl: referenceDataUrl ?? productDataUrl,
          ...(referenceDataUrl ? { imageDataUrls: [referenceDataUrl, productDataUrl] } : {}),
          prompt,
          n: 1,
          model: imageRoute.model,
          endpointOverride: imageRoute.endpoint,
          apiKeyOverride: imageRoute.apiKey,
          ...(requestSize ? { size: requestSize } : {}),
          imageSize,
          aspectRatio,
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
        const persisted = await persistGeneratedImage({
          supabase,
          outputBucket,
          userId: job.user_id,
          providerSize,
          generatedBase64,
          generatedUrl: generated.url ?? null,
          imageSize,
        });

        chosen = {
          url: persisted.resultUrl,
          b64_json: null,
          object_path: persisted.objectPath,
          mime_type: persisted.mimeType,
          provider_size: providerSize,
          actual_size: persisted.actualSize,
          delivered_size: persisted.deliveredSize,
          normalized_by_server: persisted.normalizedByServer,
          size_status: persisted.sizeStatus,
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

  const { error: styleReplicateUpdateError } = await supabase
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
  if (styleReplicateUpdateError) {
    throw new Error(`STYLE_REPLICATE_JOB_UPDATE_FAILED: ${styleReplicateUpdateError.message}`);
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
    } else if (task.task_type === "STYLE_REPLICATE") {
      await processStyleReplicateJob(supabase, job as GenerationJobRow);
    } else {
      throw new Error(`UNSUPPORTED_TASK_TYPE ${task.task_type}`);
    }

    const { error: taskSuccessError } = await supabase
      .from("generation_job_tasks")
      .update({
        status: "success",
        locked_at: null,
        last_error: null,
      })
      .eq("id", task.id);
    if (taskSuccessError) {
      throw new Error(`TASK_SUCCESS_UPDATE_FAILED: ${taskSuccessError.message}`);
    }

    return ok({ ok: true, status: "processed", job_id: job.id, task_type: task.task_type });
  } catch (e) {
    const attempts = Number(task.attempts ?? 1);
    const retryable = attempts < 3;
    const runAfter = new Date(Date.now() + 10_000).toISOString();

    const { error: taskRetryUpdateError } = await supabase
      .from("generation_job_tasks")
      .update(retryable
        ? { status: "queued", locked_at: null, run_after: runAfter, last_error: String(e) }
        : { status: "failed", locked_at: null, last_error: String(e) })
      .eq("id", task.id);
    if (taskRetryUpdateError) {
      return err("TASK_UPDATE_FAILED", "Failed to update generation task status", 500, taskRetryUpdateError);
    }

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
      const { error: jobFailedUpdateError } = await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error_code: errorCode,
          error_message: errorMessage,
        })
        .eq("id", job.id)
        .eq("status", "processing");
      if (jobFailedUpdateError) {
        return err("JOB_UPDATE_FAILED", "Failed to update generation job status", 500, jobFailedUpdateError);
      }
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
