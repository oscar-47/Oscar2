import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { isInternalWorkerRequest, requireUser } from "../_shared/auth.ts";
import { getIntegerSystemConfig } from "../_shared/system-config.ts";
import {
  callQnChatAPI,
  callQnImageAPI,
  extractGeneratedImageResult,
  getQnChatConfig,
  aspectRatioToSize,
} from "../_shared/qn-image.ts";
import {
  normalizeRequestedModel,
  OPENROUTER_MODEL_MAP,
} from "../_shared/generation-config.ts";
import {
  getAdminImageModelConfig,
  getAdminImageModelConfigs,
  getEffectiveCreditCostForModel,
  getEffectiveDefaultImageSizeForModel,
  isEffectiveImageSizeSupportedForModel,
} from "../_shared/admin-model-config.ts";
import { applyPromptVariant, buildPromptRegistryKey } from "../_shared/prompt-registry.ts";
import { sanitizePromptProfile } from "../_shared/prompt-profile.ts";
import {
  buildRefinementAnalysisSystemPrompt,
  buildRefinementAnalysisUserPrompt,
  buildRefinementPrompt,
  buildRefinementPromptCacheKey,
} from "../_shared/refinement-prompts.ts";
import {
  DEFAULT_OPENROUTER_MAX_INPUT_IMAGES,
  selectImageGenInputPaths,
  shouldUseUrlBackedImageInputs,
} from "./image-gen-inputs.ts";
import Jimp from "npm:jimp@0.22.12";
import { Buffer } from "node:buffer";

type GenerationJobRow = {
  id: string;
  user_id: string;
  type: "ANALYSIS" | "IMAGE_GEN" | "STYLE_REPLICATE";
  status: "processing" | "success" | "failed";
  payload: Record<string, unknown>;
  cost_amount: number;
  charged_subscription_credits?: number;
  charged_purchased_credits?: number;
  is_refunded?: boolean;
  refund_reason?: string | null;
  refunded_at?: string | null;
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
  id?: string;
  title: string;
  description: string;
  design_content: string;
  type?: string;
  scene_recipe?: GenesisSceneRecipe;
};

type AnalysisBlueprint = {
  images: BlueprintImagePlan[];
  design_specs: string;
  _ai_meta: Record<string, unknown>;
  subject_profile?: Record<string, unknown>;
  garment_profile?: Record<string, unknown>;
  tryon_strategy?: Record<string, unknown>;
  copy_analysis?: BlueprintCopyAnalysis;
  product_summary?: string;
  product_visual_identity?: ProductVisualIdentity;
  style_directions?: GenesisStyleDirectionGroup[];
  commercial_intent?: Partial<GenesisCommercialIntent>;
};

type BlueprintCopyMode = "user-brief" | "product-inferred" | "visual-only";

type BlueprintCopyRole = "headline" | "headline+support" | "label" | "none";

type BlueprintCopyPlanAdaptation = {
  plan_index: number;
  plan_type: string;
  copy_role: BlueprintCopyRole;
  adaptation_summary: string;
};

type BlueprintCopyAnalysis = {
  mode: BlueprintCopyMode;
  source_brief: string;
  brief_summary: string;
  product_summary: string;
  resolved_output_language: string;
  shared_copy: string;
  can_clear_to_visual_only: true;
  per_plan_adaptations: BlueprintCopyPlanAdaptation[];
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

type GenesisProductArchetype =
  | "apparel"
  | "beauty-liquid"
  | "beauty-bottle"
  | "footwear"
  | "electronics"
  | "jewelry"
  | "generic";

type GenesisCommercialIntent = {
  archetype: GenesisProductArchetype;
  brief_summary: string;
  visual_tone: string;
  mood_keywords: string[];
  composition_bias: string;
  set_treatment: string;
  lighting_bias: string;
  copy_strategy: string;
  hero_expression: "rational-tech" | "expressive-packaging" | "premium-material";
  hero_layout_archetype: string;
  text_tension: string;
  copy_dominance: "subordinate" | "co-hero";
  human_interaction_mode: "none" | "optional" | "required";
};

type GenesisSceneRecipe = {
  shot_role: string;
  hero_focus: string;
  product_ratio: string;
  layout_method: string;
  subject_angle: string;
  support_elements: string;
  background_surface: string;
  background_elements: string;
  decorative_elements: string;
  lighting_setup: string;
  lens_hint: string;
  text_zone: string;
  mood_keywords: string;
};

type GenesisPlanTextContent = {
  mainTitle: string;
  subtitle: string;
  descriptionText: string;
  typographyTone: string;
  typefaceDirection: string;
  typographyColorStrategy: string;
  layoutAggression: string;
  layoutArchetype: string;
  textTension: string;
  copyDominance: string;
  layoutGuidance: string;
};

type GenesisTypographyRole = "hero" | "selling" | "label";

type GenesisPlanSectionKey =
  | "designGoal"
  | "productAppearance"
  | "inGraphicElements"
  | "compositionPlan"
  | "contentElements"
  | "textContent"
  | "atmosphereCreation";

type GenesisAnalysisResult = {
  product_summary: string;
  product_visual_identity?: ProductVisualIdentity;
  style_directions: GenesisStyleDirectionGroup[];
  copy_plan: string;
  _ai_meta: Record<string, unknown>;
};

function promptLocaleFromValue(value: string): "en" | "zh" {
  return value.startsWith("zh") ? "zh" : "en";
}

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`SOURCE_IMAGE_FETCH_FAILED ${res.status}: ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || guessMime(url);
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`SOURCE_IMAGE_FETCH_TIMEOUT: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Return a URL suitable for chat API image_url fields.
 * For public https/http URLs, returns as-is — the API fetches server-side,
 * avoiding expensive base64 encoding (CPU + memory) in the Edge Function.
 * For data: URIs, returns as-is.
 * For relative paths, resolves via toPublicUrl().
 */
function toChatImageUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("data:image/")) return pathOrUrl;
  if (pathOrUrl.startsWith("https://") || pathOrUrl.startsWith("http://")) return pathOrUrl;
  return toPublicUrl(pathOrUrl);
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

function normalizeOptionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => sanitizeString(item, "")).filter(Boolean)
    : [];
}

function normalizeGenesisSceneRecipeValue(value: unknown): GenesisSceneRecipe | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const recipe: GenesisSceneRecipe = {
    shot_role: sanitizeString(record.shot_role ?? record.shotRole, ""),
    hero_focus: sanitizeString(record.hero_focus ?? record.heroFocus, ""),
    product_ratio: sanitizeString(record.product_ratio ?? record.productRatio, ""),
    layout_method: sanitizeString(record.layout_method ?? record.layoutMethod, ""),
    subject_angle: sanitizeString(record.subject_angle ?? record.subjectAngle, ""),
    support_elements: sanitizeString(record.support_elements ?? record.supportElements, ""),
    background_surface: sanitizeString(record.background_surface ?? record.backgroundSurface, ""),
    background_elements: sanitizeString(record.background_elements ?? record.backgroundElements, ""),
    decorative_elements: sanitizeString(record.decorative_elements ?? record.decorativeElements, ""),
    lighting_setup: sanitizeString(record.lighting_setup ?? record.lightingSetup, ""),
    lens_hint: sanitizeString(record.lens_hint ?? record.lensHint, ""),
    text_zone: sanitizeString(record.text_zone ?? record.textZone, ""),
    mood_keywords: sanitizeString(record.mood_keywords ?? record.moodKeywords, ""),
  };

  return Object.values(recipe).some((item) => item.trim().length > 0) ? recipe : undefined;
}

function mergeGenesisSceneRecipe(
  base: GenesisSceneRecipe,
  override?: GenesisSceneRecipe,
): GenesisSceneRecipe {
  if (!override) return base;
  const merged: GenesisSceneRecipe = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (typeof value === "string" && value.trim().length > 0) {
      (merged as Record<string, string>)[key] = value.trim();
    }
  }
  return merged;
}

function normalizeParsedGenesisCommercialIntent(value: unknown): Partial<GenesisCommercialIntent> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const archetype = sanitizeString(record.archetype, "");
  const heroExpression = sanitizeString(record.hero_expression ?? record.heroExpression, "");
  const copyDominance = sanitizeString(record.copy_dominance ?? record.copyDominance, "");
  const humanInteractionMode = sanitizeString(record.human_interaction_mode ?? record.humanInteractionMode, "");

  const normalized: Partial<GenesisCommercialIntent> = {
    brief_summary: sanitizeString(record.brief_summary ?? record.briefSummary, ""),
    visual_tone: sanitizeString(record.visual_tone ?? record.visualTone, ""),
    mood_keywords: normalizeOptionalStringArray(record.mood_keywords ?? record.moodKeywords),
    composition_bias: sanitizeString(record.composition_bias ?? record.compositionBias, ""),
    set_treatment: sanitizeString(record.set_treatment ?? record.setTreatment, ""),
    lighting_bias: sanitizeString(record.lighting_bias ?? record.lightingBias, ""),
    copy_strategy: sanitizeString(record.copy_strategy ?? record.copyStrategy, ""),
    hero_layout_archetype: sanitizeString(record.hero_layout_archetype ?? record.heroLayoutArchetype, ""),
    text_tension: sanitizeString(record.text_tension ?? record.textTension, ""),
  };

  if (["apparel", "beauty-liquid", "beauty-bottle", "footwear", "electronics", "jewelry", "generic"].includes(archetype)) {
    normalized.archetype = archetype as GenesisProductArchetype;
  }
  if (["rational-tech", "expressive-packaging", "premium-material"].includes(heroExpression)) {
    normalized.hero_expression = heroExpression as GenesisCommercialIntent["hero_expression"];
  }
  if (["subordinate", "co-hero"].includes(copyDominance)) {
    normalized.copy_dominance = copyDominance as GenesisCommercialIntent["copy_dominance"];
  }
  if (["none", "optional", "required"].includes(humanInteractionMode)) {
    normalized.human_interaction_mode = humanInteractionMode as GenesisCommercialIntent["human_interaction_mode"];
  }

  return Object.values(normalized).some((item) =>
    Array.isArray(item) ? item.length > 0 : typeof item === "string" ? item.trim().length > 0 : Boolean(item)
  )
    ? normalized
    : undefined;
}

function mergeGenesisCommercialIntent(
  base: GenesisCommercialIntent,
  override?: Partial<GenesisCommercialIntent>,
): GenesisCommercialIntent {
  if (!override) return base;
  return {
    ...base,
    ...(override.archetype ? { archetype: override.archetype } : {}),
    ...(override.brief_summary?.trim() ? { brief_summary: override.brief_summary.trim() } : {}),
    ...(override.visual_tone?.trim() ? { visual_tone: override.visual_tone.trim() } : {}),
    ...(override.mood_keywords?.length ? { mood_keywords: override.mood_keywords } : {}),
    ...(override.composition_bias?.trim() ? { composition_bias: override.composition_bias.trim() } : {}),
    ...(override.set_treatment?.trim() ? { set_treatment: override.set_treatment.trim() } : {}),
    ...(override.lighting_bias?.trim() ? { lighting_bias: override.lighting_bias.trim() } : {}),
    ...(override.copy_strategy?.trim() ? { copy_strategy: override.copy_strategy.trim() } : {}),
    ...(override.hero_expression ? { hero_expression: override.hero_expression } : {}),
    ...(override.hero_layout_archetype?.trim()
      ? { hero_layout_archetype: override.hero_layout_archetype.trim() }
      : {}),
    ...(override.text_tension?.trim() ? { text_tension: override.text_tension.trim() } : {}),
    ...(override.copy_dominance ? { copy_dominance: override.copy_dominance } : {}),
    ...(override.human_interaction_mode ? { human_interaction_mode: override.human_interaction_mode } : {}),
  };
}

function normalizeGenesisTextContentValue(value: unknown): GenesisPlanTextContent {
  const fallback: GenesisPlanTextContent = {
    mainTitle: "",
    subtitle: "",
    descriptionText: "",
    typographyTone: "",
    typefaceDirection: "",
    typographyColorStrategy: "",
    layoutAggression: "",
    layoutArchetype: "",
    textTension: "",
    copyDominance: "",
    layoutGuidance: "",
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  return {
    mainTitle: sanitizeString(record.main_title ?? record.mainTitle, "").trim(),
    subtitle: sanitizeString(record.subtitle, "").trim(),
    descriptionText: sanitizeString(record.description_text ?? record.descriptionText, "").trim(),
    typographyTone: sanitizeString(
      record.typography_tone ?? record.typographyTone ?? record.font_tone ?? record.fontTone ?? record["字体气质"],
      "",
    ).trim(),
    typefaceDirection: sanitizeString(
      record.typeface_direction ?? record.typefaceDirection ?? record["字体风格"],
      "",
    ).trim(),
    typographyColorStrategy: sanitizeString(
      record.typography_color_strategy ?? record.typographyColorStrategy ?? record["文字颜色策略"],
      "",
    ).trim(),
    layoutAggression: sanitizeString(
      record.layout_aggression ?? record.layoutAggression ?? record["版式激进度"],
      "",
    ).trim(),
    layoutArchetype: sanitizeString(
      record.layout_archetype ?? record.layoutArchetype ?? record["版式类型"],
      "",
    ).trim(),
    textTension: sanitizeString(
      record.text_tension ?? record.textTension ?? record["文字张力"],
      "",
    ).trim(),
    copyDominance: sanitizeString(
      record.copy_dominance ?? record.copyDominance ?? record["主次关系"],
      "",
    ).trim(),
    layoutGuidance: sanitizeString(
      record.layout_guidance ?? record.layoutGuidance ?? record["排版说明"],
      "",
    ).trim(),
  };
}

function buildGenesisCompactTextSection(params: {
  textContent: GenesisPlanTextContent;
  outputLanguage: string;
  isZh: boolean;
}): string {
  const { textContent, outputLanguage, isZh } = params;
  const hasMeaningfulText = Object.values(textContent).some((item) => item.trim().length > 0);
  if (!hasMeaningfulText) return "";
  const entries = [
    isZh ? `- 主标题：${textContent.mainTitle || "无"}` : `- Main Title: ${textContent.mainTitle || "None"}`,
    isZh ? `- 副标题：${textContent.subtitle || "无"}` : `- Subtitle: ${textContent.subtitle || "None"}`,
    isZh
      ? `- 描述文案：${textContent.descriptionText || "无"}`
      : `- Description Text: ${textContent.descriptionText || "None"}`,
    textContent.typographyTone
      ? (isZh ? `- 字体气质：${textContent.typographyTone}` : `- Typography Tone: ${textContent.typographyTone}`)
      : "",
    textContent.typefaceDirection
      ? (isZh ? `- 字体风格：${textContent.typefaceDirection}` : `- Typeface Direction: ${textContent.typefaceDirection}`)
      : "",
    textContent.typographyColorStrategy
      ? (isZh
        ? `- 文字颜色策略：${textContent.typographyColorStrategy}`
        : `- Typography Color Strategy: ${textContent.typographyColorStrategy}`)
      : "",
    textContent.layoutAggression
      ? (isZh ? `- 版式激进度：${textContent.layoutAggression}` : `- Layout Aggression: ${textContent.layoutAggression}`)
      : "",
    textContent.layoutArchetype
      ? (isZh ? `- 版式类型：${textContent.layoutArchetype}` : `- Layout Archetype: ${textContent.layoutArchetype}`)
      : "",
    textContent.textTension
      ? (isZh ? `- 文字张力：${textContent.textTension}` : `- Text Tension: ${textContent.textTension}`)
      : "",
    textContent.copyDominance
      ? (isZh ? `- 主次关系：${textContent.copyDominance}` : `- Copy Dominance: ${textContent.copyDominance}`)
      : "",
    textContent.layoutGuidance
      ? (isZh ? `- 排版说明：${textContent.layoutGuidance}` : `- Layout Guidance: ${textContent.layoutGuidance}`)
      : "",
  ].filter(Boolean);

  if (entries.length === 0) return "";
  const header = isZh
    ? `**文字内容**（使用 ${outputLanguage === "none" ? "纯视觉" : outputLanguageLabel(outputLanguage)}）：`
    : `**Text Content** (Using ${outputLanguage === "none" ? "Visual Only" : outputLanguageLabel(outputLanguage)}):`;
  return `${header}\n${entries.join("\n")}`;
}

function buildGenesisCompactDesignContent(params: {
  item: Record<string, unknown>;
  outputLanguage: string;
  isZh: boolean;
}): string {
  const { item, outputLanguage, isZh } = params;
  const explicit = sanitizeString(item.design_content ?? item.designContent, "").trim();
  if (explicit) return explicit;
  const textContent = normalizeGenesisTextContentValue(item.text_content ?? item.textContent);
  return buildGenesisCompactTextSection({ textContent, outputLanguage, isZh });
}

function getGenesisAnalysisMaxTokens(imageCount: number): number {
  if (imageCount <= 1) return 1200;
  if (imageCount <= 3) return 1800;
  return 2400;
}

function getGenesisAnalysisRetryMaxTokens(imageCount: number): number {
  if (imageCount <= 1) return 1800;
  if (imageCount <= 3) return 2400;
  return 3000;
}

function hasGenesisAnalysisCriticalFields(
  parsed: Record<string, unknown>,
  imageCount: number,
): boolean {
  const productSummary = sanitizeString(parsed.product_summary ?? parsed.productSummary, "").trim();
  const rawIdentity = parsed.product_visual_identity ?? parsed.productVisualIdentity;
  const identity = rawIdentity && typeof rawIdentity === "object" && !Array.isArray(rawIdentity)
    ? rawIdentity as Record<string, unknown>
    : null;
  const primaryColor = sanitizeString(identity?.primary_color ?? identity?.primaryColor, "").trim();
  const imagePlans = Array.isArray(parsed.images) ? parsed.images.filter((item) => item && typeof item === "object") : [];
  const expectedCount = Math.max(1, Math.min(15, Number(imageCount || 1)));
  return productSummary.length > 0 && primaryColor.length > 0 && imagePlans.length >= expectedCount;
}

function clipGenesisTextLine(value: string, maxChars: number): string {
  return Array.from(value.trim()).slice(0, maxChars).join("");
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

function sanitizeOutputLanguage(value: unknown, fallback: string): string {
  const candidate = sanitizeString(value, fallback).toLowerCase();
  if (["none", "en", "zh", "ja", "ko", "es", "fr", "de", "pt", "ar", "ru"].includes(candidate)) {
    return candidate;
  }
  return fallback;
}

function detectBlueprintPlanType(input: {
  title?: unknown;
  description?: unknown;
  design_content?: unknown;
  type?: unknown;
}): string {
  const explicit = sanitizeString(input.type, "").toLowerCase();
  if (["refined", "3d", "mannequin", "detail", "selling_point"].includes(explicit)) return explicit;

  const text = `${sanitizeString(input.title, "")} ${sanitizeString(input.description, "")} ${sanitizeString(input.design_content, "")}`.toLowerCase();
  if (/3d|ghost/.test(text)) return "3d";
  if (/人台|mannequin/.test(text)) return "mannequin";
  if (/细节|特写|macro|detail/.test(text)) return "detail";
  if (/卖点|selling point/.test(text)) return "selling_point";
  return "refined";
}

function defaultCopyRole(planType: string, visualOnly: boolean): BlueprintCopyRole {
  if (visualOnly) return "none";
  if (planType === "detail") return "label";
  if (planType === "selling_point") return "headline+support";
  if (planType === "3d" || planType === "mannequin") return "headline+support";
  return "headline";
}

function defaultCopyAdaptationSummary(planType: string, isZh: boolean, visualOnly: boolean): string {
  if (visualOnly) {
    return isZh
      ? "纯视觉优先，不添加任何新增画面文字，只保留商品主体、材质、结构和光影表达。"
      : "Visual-only priority. Do not add any new in-image text; keep the focus on the product, material, structure, and lighting.";
  }

  switch (planType) {
    case "detail":
      return isZh
        ? "使用短标签或工艺注释型文案，靠近细节焦点并保留充足留白，文字不能遮挡材质与车线。"
        : "Use short labels or craft-callout copy near the detail focal point with enough whitespace, without covering the material or stitching.";
    case "selling_point":
      return isZh
        ? "使用主标题加卖点短句的层级结构，把文字放在安全留白区内，形成最强卖点聚焦但不遮挡主体。"
        : "Use a headline plus support-copy hierarchy in a safe whitespace zone to create the strongest selling-point emphasis without covering the product.";
    case "3d":
      return isZh
        ? "以短标题加辅助短句为主，文字层级弱于服装主体，布局需配合立体轮廓与背景纵深。"
        : "Use a short headline with support text. Keep the text hierarchy weaker than the garment itself and align it with the volumetric silhouette and depth.";
    case "mannequin":
      return isZh
        ? "允许短标题和辅助短句，文字应服务于版型和穿着感展示，不抢主体视觉重心。"
        : "Allow a short headline and support copy, but keep the text subordinate to the fit and silhouette presentation.";
    default:
      return isZh
        ? "优先使用短标题或小标签，文字放在安全留白区，不影响商品识别和展示效率。"
        : "Prefer a short headline or badge-style label inside a safe whitespace zone without hurting product recognition or showcase efficiency.";
  }
}

function fallbackSharedCopy(mode: BlueprintCopyMode, requirements: string, isZh: boolean): string {
  if (mode === "visual-only") return "";
  if (requirements.trim().length > 0) return requirements.trim();
  return isZh
    ? "高质感面料，清晰版型，细节经得起近看"
    : "Premium texture, sharp silhouette, and details that hold up close";
}

function normalizeCopyAnalysis(
  parsed: Record<string, unknown>,
  images: BlueprintImagePlan[],
  outputLanguage: string,
  requirements: string,
  uiLanguage: string,
): BlueprintCopyAnalysis {
  const isZh = uiLanguage.startsWith("zh");
  const raw = parsed.copy_analysis && typeof parsed.copy_analysis === "object" && !Array.isArray(parsed.copy_analysis)
    ? parsed.copy_analysis as Record<string, unknown>
    : parsed.copyAnalysis && typeof parsed.copyAnalysis === "object" && !Array.isArray(parsed.copyAnalysis)
    ? parsed.copyAnalysis as Record<string, unknown>
    : {};

  const fallbackMode: BlueprintCopyMode = outputLanguage === "none"
    ? "visual-only"
    : requirements.trim().length > 0
    ? "user-brief"
    : "product-inferred";
  const rawMode = sanitizeString(raw.mode, fallbackMode);
  const mode: BlueprintCopyMode = rawMode === "user-brief" || rawMode === "product-inferred" || rawMode === "visual-only"
    ? rawMode
    : fallbackMode;
  const visualOnly = mode === "visual-only";
  const rawPerPlanValue = raw.per_plan_adaptations ?? raw.perPlanAdaptations;
  const rawPerPlan = Array.isArray(rawPerPlanValue)
    ? rawPerPlanValue as unknown[]
    : [];

  return {
    mode,
    source_brief: sanitizeString(raw.source_brief ?? raw.sourceBrief, requirements.trim()),
    brief_summary: sanitizeString(
      raw.brief_summary ?? raw.briefSummary,
      requirements.trim().length > 0
        ? requirements.trim()
        : isZh
        ? "未输入组图文字，系统将根据产品图自动补全文案。"
        : "No brief provided. The system will infer shared copy from the product images.",
    ),
    product_summary: sanitizeString(
      raw.product_summary ?? raw.productSummary,
      isZh
        ? "已锁定同一件服装的颜色、材质、轮廓与关键结构，用于整批图片保持一致。"
        : "The same garment identity is locked across the full set, including color, material, silhouette, and key construction details.",
    ),
    resolved_output_language: sanitizeOutputLanguage(raw.resolved_output_language ?? raw.resolvedOutputLanguage, visualOnly ? "none" : outputLanguage),
    shared_copy: visualOnly ? "" : sanitizeString(raw.shared_copy ?? raw.sharedCopy, fallbackSharedCopy(mode, requirements, isZh)),
    can_clear_to_visual_only: true,
    per_plan_adaptations: images.map((image, index) => {
      const record = rawPerPlan[index] && typeof rawPerPlan[index] === "object" && !Array.isArray(rawPerPlan[index])
        ? rawPerPlan[index] as Record<string, unknown>
        : {};
      const planType = sanitizeString(record.plan_type ?? record.planType, image.type ?? detectBlueprintPlanType(image));
      const rawCopyRole = sanitizeString(record.copy_role ?? record.copyRole, "");
      const copyRole: BlueprintCopyRole =
        rawCopyRole === "headline" || rawCopyRole === "headline+support" || rawCopyRole === "label" || rawCopyRole === "none"
          ? rawCopyRole
          : defaultCopyRole(planType, visualOnly);

      return {
        plan_index: Number.isFinite(Number(record.plan_index ?? record.planIndex))
          ? Math.max(0, Math.round(Number(record.plan_index ?? record.planIndex)))
          : index,
        plan_type: planType,
        copy_role: copyRole,
        adaptation_summary: sanitizeString(
          record.adaptation_summary ?? record.adaptationSummary,
          defaultCopyAdaptationSummary(planType, isZh, visualOnly),
        ),
      };
    }),
  };
}

function normalizeBlueprint(
  parsed: Record<string, unknown>,
  imageCount: number,
  outputLanguage: string,
  requirements: string,
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
          design_content: buildGenesisCompactDesignContent({ item, outputLanguage, isZh }) || fallbackDesignContent(i),
          type: detectBlueprintPlanType(item),
          scene_recipe: normalizeGenesisSceneRecipeValue(item.scene_recipe ?? item.sceneRecipe),
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

  const subjectProfile = parsed.subject_profile && typeof parsed.subject_profile === "object" && !Array.isArray(parsed.subject_profile)
    ? parsed.subject_profile as Record<string, unknown>
    : undefined;
  const garmentProfile = parsed.garment_profile && typeof parsed.garment_profile === "object" && !Array.isArray(parsed.garment_profile)
    ? parsed.garment_profile as Record<string, unknown>
    : undefined;
  const tryOnStrategy = parsed.tryon_strategy && typeof parsed.tryon_strategy === "object" && !Array.isArray(parsed.tryon_strategy)
    ? parsed.tryon_strategy as Record<string, unknown>
    : undefined;

  return {
    images,
    design_specs: designSpecs,
    _ai_meta: {},
    copy_analysis: normalizeCopyAnalysis(parsed, images, outputLanguage, requirements, uiLanguage ?? "en"),
    commercial_intent: normalizeParsedGenesisCommercialIntent(parsed.commercial_intent ?? parsed.commercialIntent),
    ...(subjectProfile ? { subject_profile: subjectProfile } : {}),
    ...(garmentProfile ? { garment_profile: garmentProfile } : {}),
    ...(tryOnStrategy ? { tryon_strategy: tryOnStrategy } : {}),
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

function genesisRequestsVisibleCopy(requirements: string, outputLanguage: string): boolean {
  return outputLanguage !== "none";
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

function inferGenesisProductArchetype(
  productSummary: string,
  identity: ProductVisualIdentity | undefined,
  requirements: string,
): GenesisProductArchetype {
  const haystack = [productSummary, identity?.material ?? "", ...(identity?.key_features ?? []), requirements].join(" ").toLowerCase();
  if (GENESIS_APPAREL_RE.test(haystack)) return "apparel";
  if (/\b(foundation|serum|essence|lotion|cream|skincare|cosmetic|makeup|concealer|primer|base)\b|粉底|粉底液|精华|乳液|面霜|护肤|彩妆|遮瑕|底妆|液体|肤感/.test(haystack)) {
    return "beauty-liquid";
  }
  if (/\b(perfume|fragrance|cologne|bottle|jar|spray)\b|香水|香氛|喷雾|玻璃瓶|香氛瓶|膏霜瓶/.test(haystack)) {
    return "beauty-bottle";
  }
  if (/\b(shoe|sneaker|boot|heel|loafer|sandal|footwear)\b|鞋|球鞋|运动鞋|靴|凉鞋/.test(haystack)) return "footwear";
  if (/\b(phone|laptop|tablet|camera|headphone|earbud|speaker|keyboard|mouse|monitor|electronic|device|gadget)\b|手机|电脑|平板|相机|耳机|音箱|键盘|鼠标|显示器|电子/.test(haystack)) {
    return "electronics";
  }
  if (/\b(ring|necklace|bracelet|earring|pendant|watch|jewelry|jewellery|diamond|gold|silver)\b|戒指|项链|手链|耳环|吊坠|腕表|珠宝|钻石|黄金|白银/.test(haystack)) {
    return "jewelry";
  }
  return "generic";
}

function detectGenesisToneKey(requirements: string, styleLabels: string[]): "premium" | "natural" | "tech" | "energetic" | "clean" {
  const haystack = `${requirements} ${styleLabels.join(" ")}`.toLowerCase();
  if (/\b(premium|luxury|editorial|magazine|campaign)\b|高级|奢华|轻奢|大片|广告|杂志/.test(haystack)) return "premium";
  if (/\b(natural|soft|organic|comfort|everyday|lifestyle)\b|自然|舒适|通勤|日常|柔和|生活感/.test(haystack)) return "natural";
  if (/\b(tech|futuristic|metallic|cyber|minimal tech)\b|科技|未来|金属|赛博|冷感/.test(haystack)) return "tech";
  if (/\b(sport|dynamic|energetic|motion|outdoor)\b|运动|动感|活力|户外/.test(haystack)) return "energetic";
  return "clean";
}

function inferGenesisHeroExpression(params: {
  archetype: GenesisProductArchetype;
  toneKey: "premium" | "natural" | "tech" | "energetic" | "clean";
  productSummary: string;
  identity?: ProductVisualIdentity;
  requirements: string;
  styleLabels: string[];
}): "rational-tech" | "expressive-packaging" | "premium-material" {
  const { archetype, toneKey, productSummary, identity, requirements, styleLabels } = params;
  const haystack = [
    productSummary,
    identity?.material ?? "",
    ...(identity?.key_features ?? []),
    requirements,
    styleLabels.join(" "),
  ].join(" ").toLowerCase();

  const packagingHeavy = /\b(sauce|condiment|mustard|wasabi|snack|beverage|drink|tea|coffee|instant|fmcg|packaging|pack|box|tube|jar|bottle|can|logo|brand slogan|headline)\b|酱|辣|芥末|调味|零食|饮料|茶|咖啡|快消|包装|盒装|袋装|管装|罐装|瓶装|品牌口号|国货|包装感/.test(haystack);
  const premiumMaterial = /\b(leather|suede|saffiano|nappa|calfskin|grain leather|metal trim|brushed metal|aluminum|stainless|titanium|ceramic|wood|marble|glass|perfume|fragrance|jewelry|jewellery|watch|premium accessory)\b|真皮|皮革|头层皮|牛皮|羊皮|麂皮|金属边框|拉丝金属|钛|陶瓷|木纹|大理石|玻璃|香氛|珠宝|腕表|精品配件/.test(haystack);
  const accessoryLike = /\b(phone case|case|cover|shell|wallet case|strap|band|accessory|airpods case)\b|手机壳|保护壳|手机套|壳套|表带|耳机壳|配件/.test(haystack);
  const hardTech = /\b(chip|processor|battery|port|gaming|spec|cooling|performance|sensor|display|camera module|wireless charging)\b|芯片|性能|续航|散热|传感器|规格|接口|镜头模组|无线充|显示/.test(haystack);

  if (packagingHeavy) return "expressive-packaging";
  if (archetype === "beauty-bottle" || archetype === "jewelry") return "premium-material";
  if (archetype === "electronics" && accessoryLike && premiumMaterial && !hardTech) return "premium-material";
  if (premiumMaterial && (toneKey === "premium" || archetype !== "electronics" || accessoryLike)) return "premium-material";
  if (toneKey === "tech" || (archetype === "electronics" && hardTech)) return "rational-tech";
  if (toneKey === "premium") return "premium-material";
  if (toneKey === "energetic" || packagingHeavy) return "expressive-packaging";
  return archetype === "electronics" ? "rational-tech" : premiumMaterial ? "premium-material" : "expressive-packaging";
}

function inferGenesisHumanInteractionMode(params: {
  archetype: GenesisProductArchetype;
  heroExpression: "rational-tech" | "expressive-packaging" | "premium-material";
  productSummary: string;
  identity?: ProductVisualIdentity;
  requirements: string;
}): "none" | "optional" | "required" {
  const { archetype, heroExpression, productSummary, identity, requirements } = params;
  const haystack = [
    productSummary,
    identity?.material ?? "",
    ...(identity?.key_features ?? []),
    requirements,
  ].join(" ").toLowerCase();

  const explicitRequired = /\b(handheld|hand held|hold in hand|in hand|hand model|holding|grip shot|grasp|person holding|held by hand|lifestyle hand)\b|手持|拿在手里|手拿|手模|手部展示|拿握|握持|用手展示|上手图/.test(haystack);
  if (explicitRequired) return "required";

  const scaleOrUseDependent = /\b(squeeze|spread|apply|spray|eat|drink|sip|portable|one-hand|one handed|pocket|travel size|mini tube|lip balm|concealer|snack pack)\b|挤压|涂抹|喷洒|食用|饮用|便携|一手|口袋|旅行装|迷你|唇膏|遮瑕|小包装/.test(haystack);
  const portablePackaging = /\b(tube|sachet|stick|snack|condiment|sauce|lipstick|balm|dropper|roller)\b|管装|袋装|棒状|零食|调味酱|辣酱|唇膏|润唇|滴管|滚珠/.test(haystack);

  if (heroExpression === "expressive-packaging" && (scaleOrUseDependent || portablePackaging)) return "optional";
  if (archetype === "beauty-liquid" && scaleOrUseDependent) return "optional";
  return "none";
}

function buildGenesisHeroExpressionProfile(
  expression: "rational-tech" | "expressive-packaging" | "premium-material",
  isZh: boolean,
): {
  layoutArchetype: string;
  textTension: string;
  copyDominance: "subordinate" | "co-hero";
  heroTypography: string;
  heroLayout: string;
} {
  if (isZh) {
    if (expression === "expressive-packaging") {
      return {
        layoutArchetype: "竖向强口号区或双列对冲排版",
        textTension: "高对比、高存在感，文字与商品形成双主角节奏",
        copyDominance: "co-hero",
        heroTypography: "高识别展示字或偏压缩大标题字型，允许大字、纵排或对撞色强调，形成广告级首屏节奏。",
        heroLayout: "允许纵向大标题、双列对冲或角标爆点与商品形成双主角；文字可以成为第一眼节奏之一，但必须避开商品关键细节与品牌识别。",
      };
    }
    if (expression === "premium-material") {
      return {
        layoutArchetype: "大留白压缩标题组或边缘编辑式标题区",
        textTension: "低密度但高气质，文字与商品形成克制双焦点",
        copyDominance: "co-hero",
        heroTypography: "偏压缩展示字或高级商业无衬线，字面挺拔、重心稳定，以材质感和留白建立高级感。",
        heroLayout: "使用大留白中的压缩大标题或边缘编辑式标题组，让文字和商品共同建立高级首屏，但绝不压住主体轮廓、五金和关键细节。",
      };
    }
    return {
      layoutArchetype: "侧边信息带或角落技术标签区",
      textTension: "克制精准，文字服务结构秩序与功能识别",
      copyDominance: "subordinate",
      heroTypography: "高识别商业无衬线或现代新怪体，强调结构感、秩序感和技术阅读性，但避免模板化说明书气质。",
      heroLayout: "使用侧边信息带、角落技术标签或结构化信息块，文字可以更有设计感，但主次仍服务商品结构展示，绝不遮挡关键功能区。",
    };
  }

  if (expression === "expressive-packaging") {
    return {
      layoutArchetype: "dominant vertical slogan block or split-column contrast typography",
      textTension: "high-contrast, high-presence typography that shares first-read priority with the product",
      copyDominance: "co-hero",
      heroTypography: "Use a bold display face or condensed commercial headline style that supports oversized type, vertical rhythm, and contrast-led emphasis.",
      heroLayout: "Allow a dominant vertical slogan, split-column contrast layout, or bold badge callout so the copy and product form a deliberate dual-focus composition without covering critical product details.",
    };
  }
  if (expression === "premium-material") {
    return {
      layoutArchetype: "compressed editorial title block inside large whitespace",
      textTension: "low-density but high-presence editorial contrast with restrained dual focus",
      copyDominance: "co-hero",
      heroTypography: "Use a refined display sans or condensed editorial face with strong silhouette control, elegant spacing, and premium restraint.",
      heroLayout: "Use a compressed title block or edge-aligned editorial group inside generous whitespace so copy and product co-lead the frame while staying clear of the silhouette and hardware details.",
    };
  }
  return {
    layoutArchetype: "structured side information band or technical corner label system",
    textTension: "restrained precision with typography supporting structure and functionality",
    copyDominance: "subordinate",
    heroTypography: "Use a sharp commercial display sans or contemporary grotesk with disciplined hierarchy, technical clarity, and a less template-like rhythm.",
    heroLayout: "Use a side information band, corner technical tags, or a structured information block so typography stays designed and precise without overpowering the product.",
  };
}

function buildGenesisHeroExpressionTokens(
  expression: "rational-tech" | "expressive-packaging" | "premium-material",
): {
  layoutArchetype: string;
  textTension: string;
} {
  switch (expression) {
    case "expressive-packaging":
      return {
        layoutArchetype: "dominant-vertical-slogan",
        textTension: "high-contrast-dual-focus",
      };
    case "premium-material":
      return {
        layoutArchetype: "compressed-editorial-title",
        textTension: "editorial-material-contrast",
      };
    default:
      return {
        layoutArchetype: "structured-information-band",
        textTension: "restrained-precision",
      };
  }
}

function buildGenesisHeroTypographyStrategy(params: {
  heroExpression: "rational-tech" | "expressive-packaging" | "premium-material";
  humanInteractionMode: "none" | "optional" | "required";
  isZh: boolean;
  identity?: ProductVisualIdentity;
  styleLabels: string[];
  requirements: string;
}): {
  typefaceDirection: string;
  typographyColorStrategy: string;
  layoutAggression: string;
} {
  const { heroExpression, humanInteractionMode, isZh, identity, styleLabels, requirements } = params;
  const primary = identity?.primary_color?.trim();
  const secondary = (identity?.secondary_colors ?? []).map((item) => item.trim()).filter(Boolean);
  const accent = secondary[0] || primary || (isZh ? "商品辅助色" : "a restrained product-derived accent");
  const brief = `${requirements} ${styleLabels.join(" ")}`.toLowerCase();
  const wantsBold = /\b(ad|campaign|poster|impact|bold|dramatic|striking)\b|广告|大片|冲击|醒目|强对比|震撼/.test(brief);

  if (isZh) {
    if (heroExpression === "expressive-packaging") {
      return {
        typefaceDirection: humanInteractionMode === "required"
          ? "高冲击广告标题字或粗展示字，允许纵排、对冲或口号式大字势"
          : "高识别广告展示字、粗标题字或现代国货感大字，允许形成强烈节奏",
        typographyColorStrategy: primary
          ? `标题优先从 ${primary} 与 ${accent} 中抽取品牌色/卖点色做主副对比，必要时加入深色中性字稳定信息层级，但不得误导商品本体颜色`
          : `标题优先使用品牌色或卖点强调色形成双色对冲，辅助信息用深色中性字收束层级，不能干扰商品真实颜色识别`,
        layoutAggression: wantsBold ? "激进" : "中强",
      };
    }
    if (heroExpression === "premium-material") {
      return {
        typefaceDirection: "偏压缩编辑式标题字、高级商业无衬线或精致展示字，强调挺拔轮廓和材质气质",
        typographyColorStrategy: primary
          ? `文字以烟黑、暖灰、骨白或从 ${primary} / ${accent} 提炼的低饱和高级色为主，克制使用金属感或品牌色点缀`
          : "文字以烟黑、暖灰、骨白等高级中性色为主，低密度点入品牌辅助色，避免廉价高饱和对撞",
        layoutAggression: wantsBold ? "中强" : "克制",
      };
    }
    return {
      typefaceDirection: "现代新怪体、理性商业无衬线或结构化展示字，强调秩序感、技术感和清晰阅读性",
      typographyColorStrategy: primary
        ? `以深色中性字为主，辅以从 ${accent} 提炼的功能强调色或冷感点缀，文字颜色必须让商品真实主色 ${primary} 保持第一识别`
        : "以深色中性字为主，搭配少量功能强调色或冷感点缀，不得抢走商品本体的颜色识别",
      layoutAggression: wantsBold ? "中强" : "克制",
    };
  }

  if (heroExpression === "expressive-packaging") {
    return {
      typefaceDirection: humanInteractionMode === "required"
        ? "Use bold advertising display type with room for vertical slogans, split columns, and oversized callouts."
        : "Use a high-recognition advertising display face or bold commercial headline style with more brand rhythm than a safe template.",
      typographyColorStrategy: primary
        ? `Drive headline color from ${primary} and ${accent} as brand or benefit accents, with dark neutrals only to stabilize hierarchy and never to confuse the true product color.`
        : "Drive the headline with brand or benefit accent colors, then stabilize supporting text with dark neutrals without confusing the product colorway.",
      layoutAggression: wantsBold ? "aggressive" : "medium-strong",
    };
  }
  if (heroExpression === "premium-material") {
    return {
      typefaceDirection: "Use a refined editorial display sans, condensed luxury headline face, or elegant commercial title style with premium restraint.",
      typographyColorStrategy: primary
        ? `Favor smoke, bone, warm gray, or low-saturation tones derived from ${primary} and ${accent}, with only restrained metallic or brand-color accents.`
        : "Favor smoke, bone, warm gray, and other premium neutrals with restrained accent color only where needed.",
      layoutAggression: wantsBold ? "medium-strong" : "restrained",
    };
  }
  return {
    typefaceDirection: "Use a contemporary grotesk, structured commercial sans, or technical display face with precise rhythm and readability.",
    typographyColorStrategy: primary
      ? `Keep typography mostly in dark neutrals with a restrained functional accent derived from ${accent}, while preserving ${primary} as the first-read product color anchor.`
      : "Keep typography mostly in dark neutrals with a restrained functional accent, preserving the product as the dominant color read.",
    layoutAggression: wantsBold ? "medium-strong" : "restrained",
  };
}

function buildGenesisCommercialIntent(params: {
  productSummary: string;
  identity?: ProductVisualIdentity;
  requirements: string;
  outputLanguage: string;
  isZh: boolean;
  styleLabels: string[];
  wantsVisibleCopy: boolean;
}): GenesisCommercialIntent {
  const { productSummary, identity, requirements, outputLanguage, isZh, styleLabels, wantsVisibleCopy } = params;
  const archetype = inferGenesisProductArchetype(productSummary, identity, requirements);
  const toneKey = detectGenesisToneKey(requirements, styleLabels);
  const heroExpression = inferGenesisHeroExpression({
    archetype,
    toneKey,
    productSummary,
    identity,
    requirements,
    styleLabels,
  });
  const humanInteractionMode = inferGenesisHumanInteractionMode({
    archetype,
    heroExpression,
    productSummary,
    identity,
    requirements,
  });
  const expressionProfile = buildGenesisHeroExpressionProfile(heroExpression, isZh);
  const expressionTokens = buildGenesisHeroExpressionTokens(heroExpression);
  const briefSummary = requirements.trim() || productSummary.trim();

  if (isZh) {
    const toneMap = {
      premium: {
        visualTone: "商业大片、克制高级、材质主导",
        mood: ["高级", "克制", "精致"],
        composition: "偏轴主视觉、明确焦点、避免目录式摆放",
        set: "分层背景表面、可读支撑面、前中后景都有商业摄影语境",
        lighting: "定向侧上主光配轮廓补光，突出边缘与材质高光",
      },
      natural: {
        visualTone: "自然通勤、柔和真实、轻生活感",
        mood: ["自然", "舒适", "清新"],
        composition: "三分法或轻偏轴构图，留白柔和，避免僵直正拍",
        set: "布面、微纹理墙面、柔和渐层或日常材质表面组成场景",
        lighting: "柔和侧光与环境补光，保留真实阴影与空气感",
      },
      tech: {
        visualTone: "冷静科技、结构清晰、反射受控",
        mood: ["科技", "冷静", "精确"],
        composition: "对角线推进或结构化偏轴构图，强调体块与边线",
        set: "金属、亚克力、玻璃或微纹理硬质表面构成层次背景",
        lighting: "方向性硬朗主光配受控轮廓光，突出结构线与反射",
      },
      energetic: {
        visualTone: "动感有张力、节奏明确、主体有推进感",
        mood: ["动感", "利落", "有冲击"],
        composition: "对角线、俯仰机位或前景遮挡制造运动张力",
        set: "具有速度感的支撑面、阴影切片和层次背景加强节奏",
        lighting: "侧逆光和局部高光制造速度感与体积变化",
      },
      clean: {
        visualTone: "极简商业、干净利落、主体优先",
        mood: ["简洁", "干净", "利落"],
        composition: "偏轴平衡构图，保持清晰留白但禁止空白海报感",
        set: "中性但有材质的背景表面和克制支撑元素",
        lighting: "干净定向主光与柔和补光，避免平打光",
      },
    } as const;
    const tone = toneMap[toneKey];
    return {
      archetype,
      brief_summary: briefSummary || shortGenesisCue(productSummary, true, "商品主体商业主图"),
      visual_tone: tone.visualTone,
      mood_keywords: [...tone.mood, ...styleLabels.slice(0, 2)].filter((value, index, arr) => value && arr.indexOf(value) === index),
      composition_bias: tone.composition,
      set_treatment: tone.set,
      lighting_bias: tone.lighting,
      copy_strategy: !wantsVisibleCopy ? "默认纯视觉主图，不新增文案，只保留纯视觉留白。" : `文案仅服务于主图节奏，使用 ${outputLanguageLabel(outputLanguage)}，不改变画面构图逻辑。`,
      hero_expression: heroExpression,
      hero_layout_archetype: expressionTokens.layoutArchetype,
      text_tension: expressionTokens.textTension,
      copy_dominance: expressionProfile.copyDominance,
      human_interaction_mode: humanInteractionMode,
    };
  }

  const toneMap = {
    premium: {
      visualTone: "editorial campaign polish with restrained luxury and material-led detail",
      mood: ["premium", "restrained", "refined"],
      composition: "offset editorial balance with a clear hero zone instead of catalog centering",
      set: "layered set surfaces with readable support planes and foreground/midground/background depth",
      lighting: "directional side-top key light with rim separation and controlled highlights",
    },
    natural: {
      visualTone: "soft lifestyle realism with everyday comfort and tactile warmth",
      mood: ["natural", "comfortable", "fresh"],
      composition: "rule-of-thirds or light offset framing with soft breathing room and no rigid frontality",
      set: "textile surfaces, micro-textured walls, and gentle gradient planes for a lived-in commercial set",
      lighting: "soft side light with ambient fill and realistic shadow falloff",
    },
    tech: {
      visualTone: "calm high-tech precision with controlled reflections and sharp structure",
      mood: ["tech", "precise", "cool"],
      composition: "diagonal or structural offset framing that emphasizes edges, planes, and geometry",
      set: "metal, acrylic, glass, or micro-textured hard surfaces with layered depth",
      lighting: "directional key light with controlled contour highlights and reflective discipline",
    },
    energetic: {
      visualTone: "dynamic commercial energy with a sense of movement and forward pull",
      mood: ["dynamic", "crisp", "impactful"],
      composition: "diagonal momentum, high/low angles, or foreground overlap to build motion",
      set: "speed-led support planes, shadow slices, and layered backdrops that add rhythm",
      lighting: "side-back light with sharp highlight accents and readable volume shifts",
    },
    clean: {
      visualTone: "clean commercial focus with crisp hierarchy and no empty catalog stiffness",
      mood: ["clean", "minimal", "focused"],
      composition: "offset balance with controlled whitespace and no blank poster-like centering",
      set: "neutral but tactile surfaces with restrained supporting elements",
      lighting: "clean directional key light with soft fill and no flat front light",
    },
  } as const;
  const tone = toneMap[toneKey];
  return {
    archetype,
    brief_summary: briefSummary || shortGenesisCue(productSummary, false, "commercial hero visual"),
    visual_tone: tone.visualTone,
    mood_keywords: [...tone.mood, ...styleLabels.slice(0, 2)].filter((value, index, arr) => value && arr.indexOf(value) === index),
    composition_bias: tone.composition,
    set_treatment: tone.set,
    lighting_bias: tone.lighting,
    copy_strategy: !wantsVisibleCopy
      ? "Visual-only hero image by default with no added typography."
      : `Copy only supports the hero rhythm and must stay in ${outputLanguageLabel(outputLanguage)} without changing scene logic.`,
    hero_expression: heroExpression,
    hero_layout_archetype: expressionTokens.layoutArchetype,
    text_tension: expressionTokens.textTension,
    copy_dominance: expressionProfile.copyDominance,
    human_interaction_mode: humanInteractionMode,
  };
}

function applyGenesisHeroExpressionToSceneRecipe(params: {
  sceneRecipe: GenesisSceneRecipe;
  index: number;
  commercialIntent: GenesisCommercialIntent;
  outputLanguage: string;
  isZh: boolean;
}): GenesisSceneRecipe {
  const { sceneRecipe, index, commercialIntent, outputLanguage, isZh } = params;
  if (index !== 0) return sceneRecipe;
  if (outputLanguage === "none") {
    return {
      ...sceneRecipe,
      text_zone: isZh ? "纯视觉首屏主视觉，不新增文案，保留可承载未来文字的强留白结构" : "visual-only hero composition with no added copy, but keep strong whitespace architecture for future typography",
    };
  }

  const profile = buildGenesisHeroExpressionProfile(commercialIntent.hero_expression, isZh);
  const textZone = profile.heroLayout;

  if (commercialIntent.hero_expression === "premium-material") {
    return {
      ...sceneRecipe,
      shot_role: isZh ? "材质高级首屏主视觉" : "premium material hero visual",
      layout_method: isZh
        ? "采用偏轴编辑感构图与大留白压缩标题组，让商品材质、轮廓和文字共同建立首屏高级感"
        : "use an offset editorial composition with large whitespace and a compressed title group so material, silhouette, and typography co-lead the hero frame",
      support_elements: isZh
        ? "使用低矮石面、拉丝金属、烟熏亚克力或柔和阴影切片建立高级落点，避免硬核科技支架感"
        : "use low stone planes, brushed metal, smoked acrylic, or soft shadow slices to anchor the product without over-indexing on hard-tech staging",
      background_surface: isZh
        ? "背景使用雾面矿物板、暖灰纸面、细腻金属或柔和渐层硬面，突出材质高级感与留白"
        : "use matte mineral boards, warm gray paper tones, refined metal, or softly graded hard surfaces to emphasize material luxury and whitespace",
      decorative_elements: isZh
        ? "仅允许材质回声、压印、缝线、五金呼应或低密度品牌色细节，不使用几何科技光带"
        : "allow only material echoes, embossed details, stitching, hardware callbacks, or low-density brand-color accents instead of generic tech light bands",
      text_zone: textZone,
    };
  }

  if (commercialIntent.hero_expression === "expressive-packaging") {
    const supportElements = commercialIntent.human_interaction_mode === "required"
      ? (isZh
        ? "利用品牌色平面、包装轮廓回声、轻道具与明确手持关系建立高张力广告场景，手部只作为尺度与动作辅助"
        : "use brand-color planes, packaging echoes, light props, and a clearly intentional hand-held relationship, with the hand only supporting scale and usage")
      : commercialIntent.human_interaction_mode === "optional"
        ? (isZh
          ? "优先使用品牌色平面、包装轮廓回声与轻道具建立广告场景；仅在确有助于尺度或使用动作时可加入轻量手持关系"
          : "build the scene primarily with brand-color planes, packaging echoes, and light props; only introduce a light hand-held relationship when it helps scale or usage clarity")
        : (isZh
          ? "利用品牌色平面、包装轮廓回声、轻道具或功能相关局部物件建立生活化但高张力的广告场景，不默认加入手持"
          : "use brand-color planes, packaging echoes, light props, or function-related objects to create a lively but controlled ad scene without defaulting to a hand-held setup");
    return {
      ...sceneRecipe,
      shot_role: isZh ? "情绪包装首屏主视觉" : "expressive packaging hero visual",
      layout_method: isZh
        ? "采用竖向强口号区、双列对冲或高对比标题块，让商品与文字共同形成广告级第一眼节奏"
        : "use a dominant vertical slogan zone, split-column contrast, or a high-contrast headline block so product and typography build an advertising-grade first read together",
      support_elements: supportElements,
      background_surface: isZh
        ? "背景使用暖色桌面、柔焦生活场景或高对比色块面，不再局限于金属亚克力科技底"
        : "use warm tabletop surfaces, soft lifestyle depth, or high-contrast color planes instead of defaulting to metal-and-acrylic tech sets",
      decorative_elements: isZh
        ? "允许品牌色标记、卖点色强调、食材/功能回声或角标爆点，但控制密度与主体识别"
        : "allow brand-color accents, benefit-color emphasis, ingredient or function echoes, and bold badge callouts while preserving product readability",
      text_zone: textZone,
    };
  }

  return {
    ...sceneRecipe,
    text_zone: textZone,
    layout_method: isZh
      ? `${sceneRecipe.layout_method}，并让首张图的文字系统更像结构化信息带而不是普通侧边留白。`
      : `${sceneRecipe.layout_method}, and let the first-frame typography feel like a designed information band rather than generic leftover whitespace.`,
  };
}

function applyGenesisRecipeVariation(
  sceneRecipe: GenesisSceneRecipe,
  archetype: GenesisProductArchetype,
  variationIndex: number,
  isZh: boolean,
): GenesisSceneRecipe {
  if (variationIndex === 0) return sceneRecipe;

  const variations = isZh
    ? {
        apparel: [
          {
            layout_method: `${sceneRecipe.layout_method}，并加入更明显的高低错层和雕塑化支撑关系`,
            background_surface: `${sceneRecipe.background_surface}，同时引入更明确的哑光石面或硬质支撑结构`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让光切片更明显，层次更戏剧化`,
            mood_keywords: `${sceneRecipe.mood_keywords}、结构感`,
          },
          {
            layout_method: `${sceneRecipe.layout_method}，但整体节奏更轻盈、更有生活化空气感`,
            background_surface: `${sceneRecipe.background_surface}，并加入更柔和的布面渐层与空气留白`,
            lighting_setup: `${sceneRecipe.lighting_setup}，整体更柔和并保留空气感`,
            mood_keywords: `${sceneRecipe.mood_keywords}、轻生活感`,
          },
        ],
        "beauty-liquid": [
          {
            support_elements: `${sceneRecipe.support_elements}，同时增加更明显的液体抹痕和珠光反射层`,
            background_surface: `${sceneRecipe.background_surface}，让珠光与流体层次更丰富`,
            lighting_setup: `${sceneRecipe.lighting_setup}，高光滚降更浓郁，肤感更明显`,
            mood_keywords: `${sceneRecipe.mood_keywords}、润泽`,
          },
          {
            support_elements: `${sceneRecipe.support_elements}，并让支撑面更干净、更克制`,
            background_surface: `${sceneRecipe.background_surface}，整体更偏极简丝面和柔雾渐层`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让光线更柔滑、通透感更强`,
            mood_keywords: `${sceneRecipe.mood_keywords}、通透`,
          },
        ],
        "beauty-bottle": [
          {
            background_surface: `${sceneRecipe.background_surface}，并加入更强的镜面反射与切面光`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让玻璃切面和边缘高光更凌厉`,
            mood_keywords: `${sceneRecipe.mood_keywords}、折射感`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}，更偏深浅层次渐层和绒面克制对比`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让香氛氛围更柔和而克制`,
            mood_keywords: `${sceneRecipe.mood_keywords}、香氛感`,
          },
        ],
        footwear: [
          {
            layout_method: `${sceneRecipe.layout_method}，并强化前冲式对角线和速度感`,
            support_elements: `${sceneRecipe.support_elements}，加入更明确的阴影切片和速度方向`,
            lighting_setup: `${sceneRecipe.lighting_setup}，边缘冲击更强`,
            mood_keywords: `${sceneRecipe.mood_keywords}、张力`,
          },
          {
            layout_method: `${sceneRecipe.layout_method}，让整体更偏雕塑感陈列和材质沉稳`,
            background_surface: `${sceneRecipe.background_surface}，增加更稳定的硬质台面与空间秩序`,
            lighting_setup: `${sceneRecipe.lighting_setup}，更强调鞋面材质和鞋底厚度`,
            mood_keywords: `${sceneRecipe.mood_keywords}、雕塑感`,
          },
        ],
        electronics: [
          {
            background_surface: `${sceneRecipe.background_surface}，并引入更清晰的几何光带与硬质反射`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让边线和切面更锐`,
            mood_keywords: `${sceneRecipe.mood_keywords}、冷感`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}，整体更偏理性极简和留白`,
            lighting_setup: `${sceneRecipe.lighting_setup}，更强调受控反射和秩序感`,
            mood_keywords: `${sceneRecipe.mood_keywords}、理性`,
          },
        ],
        jewelry: [
          {
            background_surface: `${sceneRecipe.background_surface}，并加入更强的镜面反射与高光闪点`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让金属高光和宝石闪点更鲜明`,
            mood_keywords: `${sceneRecipe.mood_keywords}、闪耀`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}，整体更偏绒面与深浅渐层的静奢氛围`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让珠宝更克制、更高级`,
            mood_keywords: `${sceneRecipe.mood_keywords}、静奢`,
          },
        ],
        generic: [
          {
            layout_method: `${sceneRecipe.layout_method}，增加更明显的层次错位和支撑关系`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让方向性更强`,
            mood_keywords: `${sceneRecipe.mood_keywords}、层次感`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}，整体更偏克制极简和表面质感`,
            lighting_setup: `${sceneRecipe.lighting_setup}，让画面更纯净`,
            mood_keywords: `${sceneRecipe.mood_keywords}、极简`,
          },
        ],
      }
    : {
        apparel: [
          {
            layout_method: `${sceneRecipe.layout_method}, with more pronounced height variation and sculptural support relationships`,
            background_surface: `${sceneRecipe.background_surface}, adding clearer matte stone and hard support planes`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with stronger light slicing and more dramatic layering`,
            mood_keywords: `${sceneRecipe.mood_keywords}, sculptural`,
          },
          {
            layout_method: `${sceneRecipe.layout_method}, but with a lighter rhythm and more lived-in air`,
            background_surface: `${sceneRecipe.background_surface}, adding softer textile gradients and breathing space`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with softer atmospheric separation`,
            mood_keywords: `${sceneRecipe.mood_keywords}, airy lifestyle`,
          },
        ],
        "beauty-liquid": [
          {
            support_elements: `${sceneRecipe.support_elements}, with stronger liquid swipes and pearl reflections`,
            background_surface: `${sceneRecipe.background_surface}, with richer pearl and fluid layering`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with fuller highlight roll-off and skin-like richness`,
            mood_keywords: `${sceneRecipe.mood_keywords}, dewy`,
          },
          {
            support_elements: `${sceneRecipe.support_elements}, but with a cleaner and more restrained stage`,
            background_surface: `${sceneRecipe.background_surface}, leaning toward minimal silk planes and soft haze gradients`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with smoother translucency and gentler light`,
            mood_keywords: `${sceneRecipe.mood_keywords}, translucent`,
          },
        ],
        "beauty-bottle": [
          {
            background_surface: `${sceneRecipe.background_surface}, with stronger mirror reflections and facet light`,
            lighting_setup: `${sceneRecipe.lighting_setup}, making glass facets and edge highlights sharper`,
            mood_keywords: `${sceneRecipe.mood_keywords}, refractive`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}, leaning more into tonal gradients and restrained suede contrast`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with a softer, more atmospheric fragrance mood`,
            mood_keywords: `${sceneRecipe.mood_keywords}, perfumed`,
          },
        ],
        footwear: [
          {
            layout_method: `${sceneRecipe.layout_method}, with stronger forward diagonals and motion tension`,
            support_elements: `${sceneRecipe.support_elements}, adding clearer shadow slices and directional pull`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with more edge impact`,
            mood_keywords: `${sceneRecipe.mood_keywords}, tense`,
          },
          {
            layout_method: `${sceneRecipe.layout_method}, leaning more sculptural and materially grounded`,
            background_surface: `${sceneRecipe.background_surface}, with steadier hard plinths and spatial order`,
            lighting_setup: `${sceneRecipe.lighting_setup}, emphasizing upper texture and sole thickness`,
            mood_keywords: `${sceneRecipe.mood_keywords}, sculptural`,
          },
        ],
        electronics: [
          {
            background_surface: `${sceneRecipe.background_surface}, adding clearer geometric light bands and hard reflections`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with sharper edge definition`,
            mood_keywords: `${sceneRecipe.mood_keywords}, cool`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}, leaning further into rational minimalism and clean whitespace`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with more disciplined reflections and order`,
            mood_keywords: `${sceneRecipe.mood_keywords}, rational`,
          },
        ],
        jewelry: [
          {
            background_surface: `${sceneRecipe.background_surface}, with stronger mirror reflection and sharper sparkle points`,
            lighting_setup: `${sceneRecipe.lighting_setup}, making metal highlights and gemstone sparks more vivid`,
            mood_keywords: `${sceneRecipe.mood_keywords}, radiant`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}, leaning toward suede stillness and tonal luxury`,
            lighting_setup: `${sceneRecipe.lighting_setup}, making the jewelry feel more restrained and elevated`,
            mood_keywords: `${sceneRecipe.mood_keywords}, quiet luxury`,
          },
        ],
        generic: [
          {
            layout_method: `${sceneRecipe.layout_method}, with stronger layered offsets and support relationships`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with more directional definition`,
            mood_keywords: `${sceneRecipe.mood_keywords}, layered`,
          },
          {
            background_surface: `${sceneRecipe.background_surface}, leaning more minimal and surface-led`,
            lighting_setup: `${sceneRecipe.lighting_setup}, with a cleaner overall frame`,
            mood_keywords: `${sceneRecipe.mood_keywords}, minimal`,
          },
        ],
      };

  const bucket = variations[archetype] ?? variations.generic;
  const patch = bucket[Math.min(variationIndex - 1, bucket.length - 1)];
  return patch ? { ...sceneRecipe, ...patch } : sceneRecipe;
}

function buildGenesisSceneRecipe(params: {
  index: number;
  productSummary: string;
  identity?: ProductVisualIdentity;
  commercialIntent: GenesisCommercialIntent;
  outputLanguage: string;
  isZh: boolean;
  totalImages: number;
}): GenesisSceneRecipe {
  const { index, productSummary, identity, commercialIntent, outputLanguage, isZh, totalImages } = params;
  const summaryCue = shortGenesisCue(productSummary, isZh, isZh ? "商品主体" : "the product");
  const material = identity?.material?.trim();
  const roleIndex = index % 3;
  const variationIndex = totalImages > 3 ? Math.floor(index / 3) % 3 : 0;

  const copyZone = outputLanguage === "none"
    ? (isZh ? "纯视觉构图，不新增文案，仅保留边缘呼吸留白" : "visual-only composition with no added copy, keeping only edge breathing room")
    : roleIndex === 0
    ? (isZh ? "优先侧边安全区，文字弱于主体，绝不压住产品" : "side safe zone first, with typography subordinate to the hero product")
    : roleIndex === 1
    ? (isZh ? "仅保留一组轻量标题区，依附边缘留白排布" : "only one light title cluster anchored to the edge whitespace")
    : (isZh ? "只允许短标签或一句文案落在边缘留白" : "allow only a short label or one compact line in the edge whitespace");

  const genericRole = roleIndex === 0
    ? (isZh ? "主视觉英雄图" : "hero image")
    : roleIndex === 1
    ? (isZh ? "角度变化图" : "angle variation")
    : (isZh ? "细节强化图" : "detail emphasis");

  if (commercialIntent.archetype === "apparel") {
    const recipeMap = isZh
      ? [
          {
            shot_role: "服装英雄主图",
            hero_focus: `${summaryCue} 的整体版型、门襟/领口/袖口结构与 ${material || "面料"} 质感`,
            product_ratio: "主体约占画面 62%-72%",
            layout_method: "采用偏轴主视觉或三分法构图，让主体落在偏左或偏右重心，避免目录式居中海报",
            subject_angle: "保持正面识别的同时引入 5°-12° 轻微倾角或结构化前 3/4 站位",
            support_elements: "使用折叠布片、低矮支撑面、前景柔焦或阴影切片承托服装，而不是悬空陈列",
            background_surface: "背景使用微纹理墙面叠加织物/哑光表面，形成前中后景的商业静物层次",
            background_elements: "用渐层阴影、材质过渡和局部支撑面制造场景深度，不要空背景",
            decorative_elements: "仅允许布料回声、裁片切面、纽扣/缝线呼应元素，装饰必须服务于服装结构",
            lighting_setup: "侧上方定向主光配柔和轮廓补光，突出布料褶皱、边缘高光和轮廓体积",
            lens_hint: "70mm-100mm 商业镜头，f/5.6-f/8，保持服装结构清晰并控制背景层次",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "服装角度变化图",
            hero_focus: `${summaryCue} 的轮廓张力、材质体积和细节节奏`,
            product_ratio: "主体约占画面 54%-64%",
            layout_method: "通过对角线、前景遮挡或高低机位建立空间感，避免平铺式展示",
            subject_angle: "用轻俯拍、轻仰拍或前景遮挡制造服装体积感，但不得改变真实版型",
            support_elements: "加入克制的支撑面、折叠布面或局部悬停阴影，让主体更有落点",
            background_surface: "背景使用层次渐层、布面与微纹理硬面组合，保证视觉不空",
            background_elements: "前景保留轻微虚化或阴影带，中景有支撑，背景有可读材质",
            decorative_elements: "仅使用与服装材质、缝线和结构相关的弱装饰元素",
            lighting_setup: "方向性主光从侧前或侧后打入，辅以环境补光，制造体积与层次",
            lens_hint: "85mm 商业镜头，f/5.6 左右，保持主体清晰并让背景微虚化",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "服装材质细节图",
            hero_focus: `${summaryCue} 的材质、车线、门襟或袖口等高价值细节`,
            product_ratio: "主体约占画面 45%-58%",
            layout_method: "使用局部斜切或细节近景构图，保留一定背景层次而不是完全贴满画面",
            subject_angle: "细节视角优先，允许局部对角切入和层叠遮挡，强化触感",
            support_elements: "以前景柔焦、裁片切面和材料回声形成近景层次",
            background_surface: "背景用更近距离的织物、石材或哑光板材做微观衬底",
            background_elements: "背景要为质感服务，只保留低密度但可读的层次信息",
            decorative_elements: "仅允许材质呼应、纽扣/五金/车线局部强化，禁止无关道具",
            lighting_setup: "斜向主光扫过材质表面，辅以边缘高光，突出纹理深浅变化",
            lens_hint: "90mm-100mm 微距或近摄镜头，f/6.3-f/8，保证关键细节锐利",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
        ]
      : [
          {
            shot_role: "apparel hero image",
            hero_focus: `the full silhouette, collar/placket/cuff structure, and ${material || "fabric"} tactility of ${summaryCue}`,
            product_ratio: "garment occupies roughly 62%-72% of the frame",
            layout_method: "use an offset hero balance or rule-of-thirds placement instead of catalog-style centering",
            subject_angle: "keep the garment front-readable while introducing a subtle 5-12 degree tilt or structured front three-quarter stance",
            support_elements: "use folded fabric echoes, a low support plane, foreground haze, or shadow slices so the garment feels staged rather than floating",
            background_surface: "combine a micro-textured wall with textile or matte support surfaces to create readable front/mid/back scene depth",
            background_elements: "use gradient shadows, material transitions, and a visible support plane instead of an empty backdrop",
            decorative_elements: "allow only fabric echoes, construction slices, and stitching/button-related accents that reinforce garment structure",
            lighting_setup: "use a directional side-top key light with soft rim support to reveal folds, edge highlights, and silhouette volume",
            lens_hint: "70mm-100mm commercial lens, f/5.6-f/8, keeping structure crisp with controlled background depth",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "apparel angle variation",
            hero_focus: `the volume, layering, and secondary structural cues of ${summaryCue}`,
            product_ratio: "garment occupies roughly 54%-64% of the frame",
            layout_method: "build space with diagonal tension, foreground overlap, or a restrained high/low camera shift",
            subject_angle: "use a light high angle, low angle, or foreground overlap to add volume without changing the true garment pattern",
            support_elements: "add a restrained support plane, folded textile, or shadow anchor so the garment has a believable set position",
            background_surface: "mix tonal gradients with textile and micro-textured hard surfaces to avoid a flat backdrop",
            background_elements: "let the foreground carry soft blur, the midground hold the garment, and the background show readable material depth",
            decorative_elements: "only weak, garment-relevant supporting elements are allowed",
            lighting_setup: "use directional side-front or side-back lighting with ambient fill to create volume and scene separation",
            lens_hint: "85mm commercial lens around f/5.6 for clean detail with restrained depth falloff",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "apparel detail emphasis",
            hero_focus: `high-value fabric, stitch, placket, cuff, or trim details from ${summaryCue}`,
            product_ratio: "garment occupies roughly 45%-58% of the frame",
            layout_method: "use a diagonal detail crop or close composition that still preserves a sense of scene depth",
            subject_angle: "favor a detail-driven cut-in with layered overlap and tactile perspective",
            support_elements: "build the near field with foreground blur, material slices, and tonal overlaps",
            background_surface: "use close textile, matte board, or stone surfaces as a micro backdrop for detail readability",
            background_elements: "background depth should stay low-density but readable and never disappear completely",
            decorative_elements: "only texture echoes and relevant trim details may appear",
            lighting_setup: "let an angled key light skim across the surface and use restrained edge highlights to reveal texture depth",
            lens_hint: "90mm-100mm macro or close commercial lens, f/6.3-f/8, with tack-sharp key detail",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
        ];
    return applyGenesisHeroExpressionToSceneRecipe({
      sceneRecipe: applyGenesisRecipeVariation(recipeMap[roleIndex], commercialIntent.archetype, variationIndex, isZh),
      index,
      commercialIntent,
      outputLanguage,
      isZh,
    });
  }

  if (commercialIntent.archetype === "beauty-liquid") {
    const recipeMap = isZh
      ? [
          {
            shot_role: "液体美妆英雄主图",
            hero_focus: `${summaryCue} 的瓶身轮廓、液体质感与高光反射控制`,
            product_ratio: "主体约占画面 48%-60%",
            layout_method: "采用偏轴主视觉或低角度对角线构图，让产品与液体肌理共同主导画面",
            subject_angle: "保持品牌识别的同时引入 8°-18° 轻微倾斜或结构化 3/4 角度",
            support_elements: "使用液体抹痕、丝绸折面、柔光反射面或半透明支撑块承托主体",
            background_surface: "背景使用大理石、丝绸、珠光渐层或雾面石材，形成柔和奢感层次",
            background_elements: "以前景液体肌理、中景产品、背景柔焦表面形成三层结构，不要空白影棚底",
            decorative_elements: "仅允许与肤感、丝滑、保湿、通透相关的流体或表面元素",
            lighting_setup: "侧后方柔性主光配边缘轮廓光，控制玻璃/塑料高光滚降并突出液体丝滑感",
            lens_hint: "85mm-100mm 商业微距镜头，f/5.6-f/8，保证瓶身与液体纹理兼顾清晰",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "液体美妆质感变化图",
            hero_focus: `${summaryCue} 的材质细节、液体流动感和包装精致度`,
            product_ratio: "主体约占画面 42%-54%",
            layout_method: "通过高低错层、前景流体或局部遮挡建立空间张力",
            subject_angle: "用轻俯拍或结构化侧前 3/4 视角展示瓶肩、泵头或盖体细节",
            support_elements: "加入液滴、镜面反射、珠光表面或丝绸边缘加强美妆广告气质",
            background_surface: "背景保留珠光雾面或石材表面，避免纯平和杂乱道具",
            background_elements: "前景允许柔焦液滴或丝面，中景产品清晰，背景微虚化",
            decorative_elements: "装饰必须围绕液体丝滑、肤感润泽和包装精致感展开",
            lighting_setup: "主光由侧上方切入，辅以柔和底部反射和轻轮廓光，避免塑料感死白高光",
            lens_hint: "90mm 商业镜头，f/6.3 左右，保留适度景深层次",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "液体美妆细节特写图",
            hero_focus: `${summaryCue} 的液体纹理、泵头/瓶口结构或关键材质特写`,
            product_ratio: "主体约占画面 36%-48%",
            layout_method: "局部特写与对角线切入构图，突出微观质感但保留品牌识别线索",
            subject_angle: "使用微距近拍或局部斜切视角强化液体厚度与材质表现",
            support_elements: "以前景液体肌理、微反射和柔和高光衬托细节",
            background_surface: "背景使用更近距离的珠光板、磨砂石面或柔焦丝面作为衬底",
            background_elements: "背景低密度但要有材质层次和阴影关系",
            decorative_elements: "只允许微量液滴、涂抹纹理或细腻反射面",
            lighting_setup: "斜向柔光扫过液体表面，利用轮廓高光提升通透感和丝滑感",
            lens_hint: "100mm 微距镜头，f/7.1-f/9，保持关键液体纹理锐利",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
        ]
      : [
          {
            shot_role: "beauty liquid hero image",
            hero_focus: `the bottle silhouette, liquid tactility, and controlled highlight roll-off of ${summaryCue}`,
            product_ratio: "product occupies roughly 48%-60% of the frame",
            layout_method: "use an offset hero balance or low-angle diagonal composition where the package and liquid texture share the frame",
            subject_angle: "keep the branding readable while introducing an 8-18 degree tilt or structured three-quarter stance",
            support_elements: "use liquid swipes, silk folds, reflective surfaces, or translucent support blocks to stage the product",
            background_surface: "use marble, silk, pearl gradients, or matte stone surfaces to build a soft luxurious set",
            background_elements: "build three layers with liquid texture in the foreground, the product in the midground, and a soft-focus surface behind",
            decorative_elements: "only fluid or surface accents that communicate slip, hydration, radiance, or smooth skin feel are allowed",
            lighting_setup: "use a soft side-back key light with rim separation to control glass/plastic highlights and emphasize silky liquid depth",
            lens_hint: "85mm-100mm commercial macro lens at f/5.6-f/8 for sharp packaging and liquid texture",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "beauty liquid variation image",
            hero_focus: `material detail, fluid movement, and packaging refinement for ${summaryCue}`,
            product_ratio: "product occupies roughly 42%-54% of the frame",
            layout_method: "build space with layered heights, foreground fluid shapes, or partial occlusion",
            subject_angle: "use a light overhead or structured front-side three-quarter angle to reveal shoulder, pump, or cap details",
            support_elements: "add droplets, mirrored reflections, pearl surfaces, or silk edges to keep the frame ad-like",
            background_surface: "keep pearl matte or stone-like surfaces and avoid a plain studio slab",
            background_elements: "allow soft-focus droplets or silk in the foreground, keep the product crisp, and the background softly diffused",
            decorative_elements: "all accents must support silky slip, skin-like softness, and refined packaging cues",
            lighting_setup: "let the key light enter from the side-top with soft lower bounce and a restrained rim so highlights do not turn chalky",
            lens_hint: "90mm commercial lens around f/6.3 with readable depth layering",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "beauty liquid detail close-up",
            hero_focus: `liquid texture, pump or opening structure, and high-value material detail from ${summaryCue}`,
            product_ratio: "product occupies roughly 36%-48% of the frame",
            layout_method: "use a tight diagonal detail crop that preserves some brand recognition",
            subject_angle: "favor macro close-ups or oblique detail views that reveal thickness and translucency",
            support_elements: "use foreground liquid texture, micro reflections, and soft highlight bands to support detail readability",
            background_surface: "use close pearl boards, matte stone, or soft silk as a macro backdrop",
            background_elements: "keep the background low-density but still materially layered",
            decorative_elements: "only micro droplets, swipe textures, or delicate reflective planes are allowed",
            lighting_setup: "skim soft light across the liquid surface and use edge highlights to increase translucency and depth",
            lens_hint: "100mm macro lens at f/7.1-f/9 for tack-sharp liquid detail",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
        ];
    return applyGenesisHeroExpressionToSceneRecipe({
      sceneRecipe: applyGenesisRecipeVariation(recipeMap[roleIndex], commercialIntent.archetype, variationIndex, isZh),
      index,
      commercialIntent,
      outputLanguage,
      isZh,
    });
  }

  if (commercialIntent.archetype === "beauty-bottle") {
    const recipeMap = isZh
      ? [
          {
            shot_role: "玻璃瓶香氛英雄主图",
            hero_focus: `${summaryCue} 的瓶身比例、玻璃折射与高光边缘`,
            product_ratio: "主体约占画面 40%-52%",
            layout_method: "采用偏轴英雄构图或镜面反射式对角线构图，让瓶身与反射共同形成主视觉",
            subject_angle: "用结构化前 3/4 角度或轻微低机位展示瓶肩、瓶塞和正面标签",
            support_elements: "使用镜面台、玻璃台、石材台或轻雾反射面承托瓶体",
            background_surface: "背景使用深浅层次玻璃、石材、绒面或雾面渐层，增强折射和高级感",
            background_elements: "前景反射、中景瓶体、背景柔焦光斑或材质面构成三层空间",
            decorative_elements: "仅允许薄雾、微水珠、花瓣或矿石等与香氛调性相关的弱元素",
            lighting_setup: "侧后方硬柔结合主光配边缘轮廓光，突出玻璃折射、边线高光和瓶塞体积",
            lens_hint: "85mm-100mm 商业镜头，f/6.3-f/8，控制玻璃边缘清晰与背景虚化",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "玻璃瓶角度变化图",
            hero_focus: `${summaryCue} 的折射变化、瓶塞结构和材质层次`,
            product_ratio: "主体约占画面 36%-48%",
            layout_method: "使用镜面延展、偏心构图或局部遮挡制造空间感",
            subject_angle: "轻俯拍或低位斜拍，强调瓶肩、棱角或标签厚度",
            support_elements: "允许镜面反射、折射影子或玻璃边缘前景进入画面",
            background_surface: "背景保持材质化而不复杂，优先玻璃、石材、绒面或雾面硬质面",
            background_elements: "保留反射层、主体层和背景光层，避免单薄空景",
            decorative_elements: "只允许与香氛气质一致的低密度元素",
            lighting_setup: "用方向性主光加边缘背光制造玻璃切面和标签层次",
            lens_hint: "90mm 商业镜头，f/6.3 左右，保证瓶身结构清晰",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "玻璃瓶细节特写图",
            hero_focus: `${summaryCue} 的瓶塞、喷头、标签压印或玻璃切面细节`,
            product_ratio: "主体约占画面 30%-42%",
            layout_method: "局部近景或斜切特写构图，强化玻璃材质与工艺感",
            subject_angle: "优先用微距或斜切角度观察玻璃边缘和局部五金/压印",
            support_elements: "使用微反射、局部折射和轻微雾化高光支撑特写气质",
            background_surface: "背景使用近距离玻璃、金属或绒面做细节衬底",
            background_elements: "背景保持低密度但要保留明暗和反射层次",
            decorative_elements: "仅保留极轻的香氛相关质感元素",
            lighting_setup: "用窄幅高光和边缘反射拉出玻璃切面与表面工艺",
            lens_hint: "100mm 微距镜头，f/8-f/10，确保玻璃细节稳定锐利",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
        ]
      : [
          {
            shot_role: "glass bottle hero image",
            hero_focus: `the bottle proportion, glass refraction, and highlight edges of ${summaryCue}`,
            product_ratio: "product occupies roughly 40%-52% of the frame",
            layout_method: "use an offset hero balance or reflective diagonal composition where the bottle and reflection co-drive the frame",
            subject_angle: "use a structured front three-quarter angle or subtle low angle to reveal shoulders, cap, and front label",
            support_elements: "stage the bottle on mirror, glass, stone, or gently misted reflective planes",
            background_surface: "use layered glass, stone, suede, or matte gradients to amplify refraction and luxury",
            background_elements: "build three layers with foreground reflections, the bottle mid-plane, and soft-focus light or material planes behind",
            decorative_elements: "only mist, micro droplets, petals, or mineral accents that fit the fragrance mood are allowed",
            lighting_setup: "use a mixed hard-soft side-back key light with rim separation to reveal refraction, edge highlights, and cap volume",
            lens_hint: "85mm-100mm commercial lens at f/6.3-f/8 for clean glass edges and soft background falloff",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "glass bottle variation image",
            hero_focus: `refraction shifts, cap structure, and material layering for ${summaryCue}`,
            product_ratio: "product occupies roughly 36%-48% of the frame",
            layout_method: "use mirror extension, eccentric balance, or partial occlusion to create space",
            subject_angle: "use a light overhead or low oblique angle to stress shoulders, facets, or label depth",
            support_elements: "allow reflected planes, refracted shadows, or glass-edge foreground accents to enter the frame",
            background_surface: "keep the set tactile but disciplined with glass, stone, suede, or matte hard surfaces",
            background_elements: "preserve reflection, subject, and light layers so the set never feels thin",
            decorative_elements: "only low-density accents aligned with the fragrance mood are allowed",
            lighting_setup: "use directional key light with edge backlight to shape glass facets and label depth",
            lens_hint: "90mm commercial lens around f/6.3 with crisp bottle structure",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "glass bottle detail close-up",
            hero_focus: `cap, sprayer, embossing, or glass-facet details from ${summaryCue}`,
            product_ratio: "product occupies roughly 30%-42% of the frame",
            layout_method: "use a tight close crop or diagonal detail framing to stress material precision",
            subject_angle: "favor macro or oblique detail views of glass edges and localized hardware or embossing",
            support_elements: "use micro reflections, localized refraction, and soft misted highlights to support the close-up",
            background_surface: "use close glass, metal, or suede surfaces as a detail backdrop",
            background_elements: "keep the backdrop low-density but still layered in tone and reflection",
            decorative_elements: "only the lightest fragrance-relevant texture accents are allowed",
            lighting_setup: "use narrow highlight bands and edge reflections to reveal glass facets and surface finish",
            lens_hint: "100mm macro lens at f/8-f/10 for stable tack-sharp glass detail",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
        ];
    return applyGenesisHeroExpressionToSceneRecipe({
      sceneRecipe: applyGenesisRecipeVariation(recipeMap[roleIndex], commercialIntent.archetype, variationIndex, isZh),
      index,
      commercialIntent,
      outputLanguage,
      isZh,
    });
  }

  if (commercialIntent.archetype === "footwear") {
    const recipeMap = isZh
      ? [
          {
            shot_role: "鞋履英雄主图",
            hero_focus: `${summaryCue} 的鞋型轮廓、鞋面材质和鞋底结构`,
            product_ratio: "主体约占画面 50%-62%",
            layout_method: "采用对角线推进或偏轴构图，让鞋头和鞋侧同时建立识别点",
            subject_angle: "使用前侧 3/4 角度或轻低机位，突出鞋头、侧墙和鞋底厚度",
            support_elements: "使用低矮台面、轻雕塑支撑块、阴影切片或前景虚化增强落点",
            background_surface: "背景采用混合硬质表面与柔和层次墙面，形成空间纵深",
            background_elements: "保留前景切片、中景主体和背景层次，不允许只剩一张平板背景",
            decorative_elements: "仅允许与鞋履材质、运动感或生活方式相关的弱元素",
            lighting_setup: "侧前主光加边缘轮廓光，突出鞋面纹理、鞋底厚度和体积感",
            lens_hint: "70mm-85mm 商业镜头，f/5.6-f/8，保证鞋型结构和材质清晰",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "鞋履角度变化图",
            hero_focus: `${summaryCue} 的动态姿态、鞋侧线条和鞋底细节`,
            product_ratio: "主体约占画面 44%-56%",
            layout_method: "利用高低机位、对角线或双层支撑制造动态张力",
            subject_angle: "轻俯拍、轻仰拍或前景遮挡都可，用于强调速度感或结构感",
            support_elements: "加入低饱和支撑块、反射面或阴影切片加强空间关系",
            background_surface: "背景需有层次墙面或地面交界，避免纯平广告板",
            background_elements: "背景至少保留两个景层和明确的地平/支撑关系",
            decorative_elements: "仅允许鞋带、材质切片或速度感阴影等相关元素",
            lighting_setup: "方向性主光配侧逆光，让鞋侧线和鞋底边缘更有冲击力",
            lens_hint: "85mm 商业镜头，f/5.6 左右",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "鞋履细节特写图",
            hero_focus: `${summaryCue} 的鞋头纹理、鞋底纹路、鞋带孔或品牌细节`,
            product_ratio: "主体约占画面 36%-48%",
            layout_method: "局部近景或斜切特写构图，突出工艺和材料层次",
            subject_angle: "优先局部斜切或近距离结构视角，增强质感和厚度",
            support_elements: "利用微反射、前景虚化或局部支撑面托住细节",
            background_surface: "背景使用更近距离的硬面、橡胶、织物或磨砂表面",
            background_elements: "背景低密度但必须有材质与光影变化",
            decorative_elements: "仅允许与鞋材和工艺相关的微量元素",
            lighting_setup: "斜向主光扫过鞋面和鞋底细节，保留清晰阴影关系",
            lens_hint: "90mm-100mm 近摄商业镜头，f/6.3-f/8",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
        ]
      : [
          {
            shot_role: "footwear hero image",
            hero_focus: `the shoe silhouette, upper material, and sole structure of ${summaryCue}`,
            product_ratio: "product occupies roughly 50%-62% of the frame",
            layout_method: "use a diagonal push or offset framing so the toe and sidewall both create recognition",
            subject_angle: "use a front-side three-quarter angle or subtle low angle to reveal toe box, sidewall, and sole thickness",
            support_elements: "use low plinths, sculptural blocks, shadow slices, or foreground blur to anchor the shoe",
            background_surface: "combine hard commercial surfaces with a layered wall plane to create spatial depth",
            background_elements: "preserve foreground slices, the shoe mid-plane, and a readable background instead of a flat ad board",
            decorative_elements: "only low-density accents tied to material, motion, or lifestyle may appear",
            lighting_setup: "use a side-front key light with rim support to reveal upper texture, sole thickness, and volume",
            lens_hint: "70mm-85mm commercial lens at f/5.6-f/8 for crisp shape and material readability",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "footwear variation image",
            hero_focus: `dynamic stance, side lines, and outsole detail for ${summaryCue}`,
            product_ratio: "product occupies roughly 44%-56% of the frame",
            layout_method: "use high/low camera shifts, diagonals, or dual supports to add tension",
            subject_angle: "light overhead, low-angle, or partial overlap views may be used to intensify motion or structure",
            support_elements: "add restrained blocks, reflective planes, or shadow slices to strengthen spatial relations",
            background_surface: "the backdrop must retain layered walls or floor-line separation instead of a flat plane",
            background_elements: "keep at least two readable scene layers and a clear support relationship",
            decorative_elements: "only laces, material slices, or motion-like shadow accents are allowed",
            lighting_setup: "use directional key light with side-back edge light so the sidewall and outsole read with more impact",
            lens_hint: "85mm commercial lens around f/5.6",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "footwear detail close-up",
            hero_focus: `toe texture, outsole pattern, eyelets, or branding details from ${summaryCue}`,
            product_ratio: "product occupies roughly 36%-48% of the frame",
            layout_method: "use a tight close-up or diagonal detail crop to stress construction and material layers",
            subject_angle: "favor oblique detail angles or close structural viewpoints to increase thickness and texture",
            support_elements: "use micro reflections, foreground blur, or localized support planes to hold the detail",
            background_surface: "use close hard, rubber, textile, or matte surfaces as the detail base",
            background_elements: "keep the background low-density but materially active",
            decorative_elements: "only micro accents related to footwear material and craft are allowed",
            lighting_setup: "skim angled light across the upper and sole detail while preserving readable shadows",
            lens_hint: "90mm-100mm close commercial lens at f/6.3-f/8",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
        ];
    return applyGenesisHeroExpressionToSceneRecipe({
      sceneRecipe: applyGenesisRecipeVariation(recipeMap[roleIndex], commercialIntent.archetype, variationIndex, isZh),
      index,
      commercialIntent,
      outputLanguage,
      isZh,
    });
  }

  if (commercialIntent.archetype === "electronics") {
    const recipeMap = isZh
      ? [
          {
            shot_role: "3C 英雄主图",
            hero_focus: `${summaryCue} 的结构线、材质反射和关键功能部位`,
            product_ratio: "主体约占画面 46%-58%",
            layout_method: "采用结构化偏轴或对角线构图，让产品边线和体块形成明确秩序",
            subject_angle: "使用前侧 3/4 角度或轻低机位，突出厚度、接口、镜头模组或关键按钮",
            support_elements: "利用亚克力支撑、金属平台、反射面或阴影切片建立高科技落点",
            background_surface: "背景使用金属、亚克力、玻璃或微纹理硬面，保持理性科技感",
            background_elements: "前景反射、中景设备、背景结构光层次必须同时存在",
            decorative_elements: "仅允许几何光带、微反射或功能相关的弱元素",
            lighting_setup: "方向性主光配边缘轮廓光和受控反射，突出结构线与材质切面",
            lens_hint: "70mm-100mm 商业镜头，f/5.6-f/8，避免廉价广角变形",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "3C 角度变化图",
            hero_focus: `${summaryCue} 的接口、边线、功能区和结构层次`,
            product_ratio: "主体约占画面 40%-52%",
            layout_method: "通过错层支撑、对角线推进或局部遮挡制造结构张力",
            subject_angle: "轻俯拍、斜拍或局部遮挡视角，用于强化体块关系",
            support_elements: "加入克制的金属台、玻璃面或反射边缘构成空间秩序",
            background_surface: "背景以理性硬质表面为主，避免软弱生活化道具",
            background_elements: "背景要有明暗层次和几何节奏，不可单薄空平",
            decorative_elements: "仅保留科技感光线、几何切片或极轻功能关联元素",
            lighting_setup: "方向性侧光与受控反射配合，拉出边缘线和材料对比",
            lens_hint: "85mm 商业镜头，f/5.6 左右",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "3C 细节特写图",
            hero_focus: `${summaryCue} 的接口、按键、镜头模组或材质切面细节`,
            product_ratio: "主体约占画面 32%-44%",
            layout_method: "使用结构化近景或斜切特写，突出工业细节",
            subject_angle: "优先局部斜切和近距离微观视角，避免平视说明书感",
            support_elements: "用微反射和局部支撑关系托住细节区域",
            background_surface: "背景使用近距离金属、玻璃或细纹硬面做衬底",
            background_elements: "背景低密度但要有反射和暗部层次",
            decorative_elements: "只允许极少量功能相关质感元素",
            lighting_setup: "窄幅高光和受控阴影强化工业边线和材质切换",
            lens_hint: "90mm-100mm 近摄商业镜头，f/7.1-f/9",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
        ]
      : [
          {
            shot_role: "electronics hero image",
            hero_focus: `the structural lines, material reflections, and key functional zones of ${summaryCue}`,
            product_ratio: "product occupies roughly 46%-58% of the frame",
            layout_method: "use structured offset or diagonal framing so the edges and massing create a clear order",
            subject_angle: "use a front-side three-quarter or subtle low angle to reveal thickness, ports, camera modules, or key controls",
            support_elements: "use acrylic stands, metal plinths, reflective planes, or shadow slices to create a high-tech stage",
            background_surface: "use metal, acrylic, glass, or micro-textured hard surfaces to keep the scene rational and technological",
            background_elements: "foreground reflections, the device mid-plane, and structured background light layers should all be present",
            decorative_elements: "only geometric light bands, micro reflections, or function-related accents may appear",
            lighting_setup: "use directional key light with rim separation and controlled reflections to reveal edges and material transitions",
            lens_hint: "70mm-100mm commercial lens at f/5.6-f/8 with no cheap wide-angle distortion",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "electronics variation image",
            hero_focus: `ports, edge lines, functional zones, and layered structure for ${summaryCue}`,
            product_ratio: "product occupies roughly 40%-52% of the frame",
            layout_method: "use layered supports, diagonal pushes, or partial occlusion to add structural tension",
            subject_angle: "light overhead, oblique, or partially occluded angles can be used to strengthen block relationships",
            support_elements: "add restrained metal stands, glass planes, or reflected edges to organize the space",
            background_surface: "keep the set grounded in hard rational surfaces rather than soft lifestyle props",
            background_elements: "the background needs tonal separation and geometric rhythm rather than a flat slab",
            decorative_elements: "only technological light, geometric slices, or minimal function-related accents are allowed",
            lighting_setup: "combine directional side light with controlled reflections to draw out edges and material contrast",
            lens_hint: "85mm commercial lens around f/5.6",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "electronics detail close-up",
            hero_focus: `ports, buttons, camera modules, or material-cut details from ${summaryCue}`,
            product_ratio: "product occupies roughly 32%-44% of the frame",
            layout_method: "use a structured close crop or oblique detail composition to stress industrial precision",
            subject_angle: "favor close oblique technical viewpoints instead of manual-like flat views",
            support_elements: "use micro reflections and localized supports to hold the detail area",
            background_surface: "use close metal, glass, or fine hard textures as a detail backdrop",
            background_elements: "keep the backdrop low-density but still layered in reflection and shadow",
            decorative_elements: "only very minimal function-related texture accents are allowed",
            lighting_setup: "use narrow highlight bands and controlled shadow fields to amplify industrial edges and material changes",
            lens_hint: "90mm-100mm close commercial lens at f/7.1-f/9",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
        ];
    return applyGenesisHeroExpressionToSceneRecipe({
      sceneRecipe: applyGenesisRecipeVariation(recipeMap[roleIndex], commercialIntent.archetype, variationIndex, isZh),
      index,
      commercialIntent,
      outputLanguage,
      isZh,
    });
  }

  if (commercialIntent.archetype === "jewelry") {
    const recipeMap = isZh
      ? [
          {
            shot_role: "珠宝英雄主图",
            hero_focus: `${summaryCue} 的镶嵌细节、金属光泽和切面反射`,
            product_ratio: "主体约占画面 28%-40%",
            layout_method: "采用留白充足的偏轴构图或镜面反射构图，让珠宝显得精致而不拥挤",
            subject_angle: "轻微前 3/4 角度或低机位展示镶嵌、厚度和边缘切面",
            support_elements: "利用小尺度镜面台、绒面台、亚克力柱或矿石基座承托珠宝",
            background_surface: "背景使用绒面、石材、镜面或深浅渐层，突出金属和宝石反射",
            background_elements: "保持前景反射、中景珠宝、背景柔焦层次三段式空间",
            decorative_elements: "仅允许宝石碎光、极轻织物、矿石或珠光表面等精致元素",
            lighting_setup: "点状高光与柔和主光结合，控制金属高光和宝石闪点，不可死亮",
            lens_hint: "90mm-100mm 微距商业镜头，f/8-f/11，保证珠宝细节完整锐利",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "珠宝角度变化图",
            hero_focus: `${summaryCue} 的厚度、切面和反射变化`,
            product_ratio: "主体约占画面 24%-34%",
            layout_method: "用偏心构图、镜面倒影或层叠支撑制造精巧空间关系",
            subject_angle: "通过轻俯拍或侧前斜角强调镶嵌层次和边缘抛光",
            support_elements: "加入小尺度镜面反射或绒面基座，但保持克制",
            background_surface: "背景需细腻且高端，避免粗糙或生活化道具",
            background_elements: "背景保留光斑、反射和层次过渡，不得完全空白",
            decorative_elements: "只允许微弱闪点或极轻材质元素",
            lighting_setup: "用窄束高光和柔和填充控制切面闪烁与金属过渡",
            lens_hint: "100mm 商业微距镜头，f/8-f/10",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
          {
            shot_role: "珠宝细节特写图",
            hero_focus: `${summaryCue} 的爪镶、纹理、刻印或局部反射细节`,
            product_ratio: "主体约占画面 18%-28%",
            layout_method: "使用微距特写和斜切局部构图，强调工艺精度",
            subject_angle: "微距近拍或局部斜切视角优先，强化镶嵌和表面工艺",
            support_elements: "用极少量镜面或绒面衬底托住细节区域",
            background_surface: "背景使用近距离绒面、镜面或珠光表面",
            background_elements: "背景低密度但要有层次和反射/暗部关系",
            decorative_elements: "仅允许最弱的珠光或闪点元素",
            lighting_setup: "精细点状高光配柔和过渡光，突出爪镶与刻印细节",
            lens_hint: "100mm 微距镜头，f/10-f/13，保持极高细节稳定性",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join("、"),
          },
        ]
      : [
          {
            shot_role: "jewelry hero image",
            hero_focus: `the setting detail, metal luster, and facet reflections of ${summaryCue}`,
            product_ratio: "product occupies roughly 28%-40% of the frame",
            layout_method: "use offset balance or reflective composition with ample whitespace so the piece feels precise and elevated",
            subject_angle: "use a slight front three-quarter or low angle to reveal setting depth, thickness, and polished edges",
            support_elements: "use micro mirrors, suede plinths, acrylic columns, or mineral bases to stage the jewelry",
            background_surface: "use suede, stone, mirror, or tonal gradients that amplify metal and gemstone reflections",
            background_elements: "keep a three-layer space with foreground reflection, mid-plane jewelry, and a soft-focus background",
            decorative_elements: "only refined accents such as gem sparkles, delicate textiles, minerals, or pearl surfaces are allowed",
            lighting_setup: "combine point highlights with a soft key light so metal edges and gemstone flashes stay controlled rather than blown out",
            lens_hint: "90mm-100mm macro commercial lens at f/8-f/11 for full jewelry detail sharpness",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "jewelry variation image",
            hero_focus: `thickness, faceting, and reflection shifts for ${summaryCue}`,
            product_ratio: "product occupies roughly 24%-34% of the frame",
            layout_method: "use eccentric balance, mirrored echoes, or layered supports to create a precise spatial relationship",
            subject_angle: "use light overhead or front-oblique angles to reveal setting layers and polished edges",
            support_elements: "add restrained mirror or suede bases without crowding the piece",
            background_surface: "the set must stay refined and elevated with no rough or lifestyle props",
            background_elements: "background light falloff, reflection, and layered tonal transitions should remain visible",
            decorative_elements: "only the lightest sparkle or texture accents are allowed",
            lighting_setup: "use narrow highlight accents and soft fill to control gemstone sparkle and metal transition",
            lens_hint: "100mm macro commercial lens at f/8-f/10",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
          {
            shot_role: "jewelry detail close-up",
            hero_focus: `prongs, engravings, texture, or local reflections from ${summaryCue}`,
            product_ratio: "product occupies roughly 18%-28% of the frame",
            layout_method: "use macro close-ups and oblique detail crops to stress craft precision",
            subject_angle: "favor macro or partial oblique detail views to reveal setting and surface craft",
            support_elements: "use minimal mirror or suede support to hold the detail zone",
            background_surface: "use close suede, mirror, or pearl surfaces as the macro backdrop",
            background_elements: "the background should stay low-density yet layered in tone and reflection",
            decorative_elements: "only the faintest pearl or sparkle accent is allowed",
            lighting_setup: "use precise point highlights and smooth transition light to reveal prongs and engraving detail",
            lens_hint: "100mm macro lens at f/10-f/13 for extremely stable fine detail",
            text_zone: copyZone,
            mood_keywords: commercialIntent.mood_keywords.join(", "),
          },
        ];
    return applyGenesisHeroExpressionToSceneRecipe({
      sceneRecipe: applyGenesisRecipeVariation(recipeMap[roleIndex], commercialIntent.archetype, variationIndex, isZh),
      index,
      commercialIntent,
      outputLanguage,
      isZh,
    });
  }

  const genericRecipe = isZh
    ? [
        {
          shot_role: genericRole,
          hero_focus: `${summaryCue} 的第一眼识别与核心卖点`,
          product_ratio: "主体约占画面 58%-68%",
          layout_method: `${commercialIntent.composition_bias}，构图必须有明确主次和呼吸区`,
          subject_angle: "使用轻微倾角、结构化机位变化或前景遮挡，避免僵直正摆",
          support_elements: "使用与商品相关的克制支撑面、反射、折射或前景元素建立落点",
          background_surface: `${commercialIntent.set_treatment}`,
          background_elements: "背景必须有可读材质与层次，不得是空白单层底",
          decorative_elements: "装饰元素只允许服务商品卖点，不得喧宾夺主",
          lighting_setup: `${commercialIntent.lighting_bias}`,
          lens_hint: "70mm-100mm 商业镜头，f/5.6-f/8，强调主体识别和层次控制",
          text_zone: copyZone,
          mood_keywords: commercialIntent.mood_keywords.join("、"),
        },
        {
          shot_role: genericRole,
          hero_focus: `${summaryCue} 的角度变化与层次张力`,
          product_ratio: "主体约占画面 52%-62%",
          layout_method: "采用三分法、对角线或高低机位建立空间张力",
          subject_angle: "用轻俯拍、轻仰拍或前景遮挡制造动态感",
          support_elements: "加入弱支撑和前景过渡元素，增强空间关系",
          background_surface: `${commercialIntent.set_treatment}`,
          background_elements: "保证前景、中景、背景至少两个层级可读",
          decorative_elements: "仅保留与核心卖点呼应的低密度装饰",
          lighting_setup: `${commercialIntent.lighting_bias}`,
          lens_hint: "85mm 商业镜头，f/5.6 左右",
          text_zone: copyZone,
          mood_keywords: commercialIntent.mood_keywords.join("、"),
        },
        {
          shot_role: genericRole,
          hero_focus: `${summaryCue} 的材质、结构或高价值细节`,
          product_ratio: "主体约占画面 45%-55%",
          layout_method: "使用细节近景或局部斜切构图，但保留场景背景层次",
          subject_angle: "局部切入、微距或斜角视角优先",
          support_elements: "用近景虚化、反射面或材质切片拉开层次",
          background_surface: `${commercialIntent.set_treatment}`,
          background_elements: "背景低密度但必须有材质和阴影关系",
          decorative_elements: "只允许强化细节质感的弱元素",
          lighting_setup: `${commercialIntent.lighting_bias}`,
          lens_hint: "90mm-100mm 近摄商业镜头，f/6.3-f/8",
          text_zone: copyZone,
          mood_keywords: commercialIntent.mood_keywords.join("、"),
        },
      ]
    : [
        {
          shot_role: genericRole,
          hero_focus: `instant recognition and the core selling point of ${summaryCue}`,
          product_ratio: "product occupies roughly 58%-68% of the frame",
          layout_method: `${commercialIntent.composition_bias}, with a clear hero zone and breathing room`,
          subject_angle: "use a subtle tilt, structured camera variation, or foreground overlap instead of rigid straight-on placement",
          support_elements: "use restrained product-relevant support planes, reflections, refractions, or foreground accents to ground the subject",
          background_surface: commercialIntent.set_treatment,
          background_elements: "the background must have readable material and depth instead of a single blank layer",
          decorative_elements: "supporting elements may only reinforce the product story and cannot overpower the hero subject",
          lighting_setup: commercialIntent.lighting_bias,
          lens_hint: "70mm-100mm commercial lens, f/5.6-f/8, with controlled depth and clear subject hierarchy",
          text_zone: copyZone,
          mood_keywords: commercialIntent.mood_keywords.join(", "),
        },
        {
          shot_role: genericRole,
          hero_focus: `angle variation and spatial tension for ${summaryCue}`,
          product_ratio: "product occupies roughly 52%-62% of the frame",
          layout_method: "build depth with rule-of-thirds balance, diagonal flow, or restrained high/low camera variation",
          subject_angle: "use a light high angle, low angle, or foreground overlap to increase dynamism",
          support_elements: "add restrained support planes and transition accents so the scene feels intentional",
          background_surface: commercialIntent.set_treatment,
          background_elements: "keep at least two readable scene layers across foreground, subject plane, and backdrop",
          decorative_elements: "only low-density product-relevant accents are allowed",
          lighting_setup: commercialIntent.lighting_bias,
          lens_hint: "85mm commercial lens around f/5.6",
          text_zone: copyZone,
          mood_keywords: commercialIntent.mood_keywords.join(", "),
        },
        {
          shot_role: genericRole,
          hero_focus: `material, structure, or high-value detail from ${summaryCue}`,
          product_ratio: "product occupies roughly 45%-55% of the frame",
          layout_method: "use a tighter detail crop or diagonal close framing while preserving some scene depth",
          subject_angle: "favor a detail-driven close view, macro crop, or oblique angle",
          support_elements: "use foreground blur, reflective surfaces, or material slices to build depth",
          background_surface: commercialIntent.set_treatment,
          background_elements: "the background should stay low-density but still show material and shadow relationships",
          decorative_elements: "only restrained detail-supporting accents may appear",
          lighting_setup: commercialIntent.lighting_bias,
          lens_hint: "90mm-100mm close commercial lens, f/6.3-f/8",
          text_zone: copyZone,
          mood_keywords: commercialIntent.mood_keywords.join(", "),
        },
      ];

  return applyGenesisHeroExpressionToSceneRecipe({
    sceneRecipe: applyGenesisRecipeVariation(genericRecipe[roleIndex], commercialIntent.archetype, variationIndex, isZh),
    index,
    commercialIntent,
    outputLanguage,
    isZh,
  });
}

type GenesisTemplateSectionKey =
  | "colorSystem"
  | "typographyCopySystem"
  | "visualLanguage"
  | "photographyStyle"
  | "qualityRequirements";

type GenesisSectionRequirement = {
  label: string;
  line: string;
};

function shortGenesisCue(value: string, isZh: boolean, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  const chars = Array.from(normalized);
  return chars.slice(0, isZh ? 30 : 72).join("").trim() || fallback;
}

function compactGenesisPlanLine(value: string): string {
  return sanitizeString(value, "").replace(/\s+/g, " ").trim();
}

function stripGenesisPlanBulletPrefix(value: string): string {
  return compactGenesisPlanLine(value)
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function stripBulletPrefix(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function extractSectionDetail(lines: string[] | undefined, label: string): string {
  if (!Array.isArray(lines)) return "";
  const target = normalizeGenesisPlanSectionLabel(label);
  for (const line of lines) {
    const clean = stripBulletPrefix(line);
    const idx = clean.search(/[：:]/);
    if (idx === -1) continue;
    const key = normalizeGenesisPlanSectionLabel(clean.slice(0, idx));
    if (key === target) return clean.slice(idx + 1).trim();
  }
  return "";
}

function normalizeGenesisPlanSectionLabel(value: string): string {
  const raw = compactGenesisPlanLine(value);
  if (!raw) return "";

  const zhCompact = raw.replace(/\s+/g, "");
  switch (zhCompact) {
    case "设计目标":
      return "design_goal";
    case "产品外观":
    case "商品外观":
      return "product_appearance";
    case "画内元素":
      return "in_graphic_elements";
    case "构图规划":
      return "composition_plan";
    case "内容元素":
      return "content_elements";
    case "文字内容":
      return "text_content";
    case "氛围营造":
      return "atmosphere_creation";
    case "商品占比":
      return "product_proportion";
    case "布局方式":
      return "layout_method";
    case "主体角度":
    case "机位角度":
      return "subject_angle";
    case "文字区域":
      return "text_area";
    case "展示重点":
      return "focus_of_display";
    case "核心卖点":
      return "key_selling_points";
    case "背景元素":
      return "background_elements";
    case "装饰元素":
      return "decorative_elements";
    case "主标题":
      return "main_title";
    case "副标题":
      return "subtitle";
    case "描述文案":
    case "说明文字":
      return "description_text";
    case "字体气质":
      return "typography_tone";
    case "字体风格":
      return "typeface_direction";
    case "文字颜色策略":
      return "typography_color_strategy";
    case "版式激进度":
      return "layout_aggression";
    case "版式类型":
      return "layout_archetype";
    case "文字张力":
      return "text_tension";
    case "主次关系":
    case "文字主次关系":
      return "copy_dominance";
    case "排版说明":
      return "layout_guidance";
    case "氛围关键词":
    case "情绪关键词":
      return "mood_keywords";
    case "光影效果":
      return "light_and_shadow_effects";
    case "镜头/光圈参考":
    case "镜头光圈参考":
    case "相机参数参考":
      return "camera_parameter_reference";
    default:
      break;
  }

  const ascii = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  switch (ascii) {
    case "design_goal":
    case "product_appearance":
    case "in_graphic_elements":
    case "composition_plan":
    case "content_elements":
    case "text_content":
    case "atmosphere_creation":
    case "product_proportion":
    case "layout_method":
    case "subject_angle":
    case "text_area":
    case "focus_of_display":
    case "key_selling_points":
    case "background_elements":
    case "decorative_elements":
    case "main_title":
    case "subtitle":
    case "description_text":
    case "typography_tone":
    case "typeface_direction":
    case "typography_color_strategy":
    case "layout_aggression":
    case "layout_archetype":
    case "text_tension":
    case "copy_dominance":
    case "layout_guidance":
    case "mood_keywords":
    case "light_and_shadow_effects":
    case "camera_parameter_reference":
      return ascii;
    case "lens_aperture_reference":
    case "camera_reference":
      return "camera_parameter_reference";
    default:
      return ascii;
  }
}

function detectGenesisPlanSectionKey(value: string): GenesisPlanSectionKey | null {
  switch (normalizeGenesisPlanSectionLabel(value)) {
    case "design_goal":
      return "designGoal";
    case "product_appearance":
      return "productAppearance";
    case "in_graphic_elements":
      return "inGraphicElements";
    case "composition_plan":
      return "compositionPlan";
    case "content_elements":
      return "contentElements";
    case "text_content":
      return "textContent";
    case "atmosphere_creation":
      return "atmosphereCreation";
    default:
      return null;
  }
}

function extractGenesisPlanSections(value: string): Partial<Record<GenesisPlanSectionKey, string[]>> {
  const sections: Partial<Record<GenesisPlanSectionKey, string[]>> = {};
  let activeKey: GenesisPlanSectionKey | null = null;

  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("## ")) continue;

    const headingMatch = line.match(/^\*\*(.+?)\*\*(?:\s*(?:\([^)]+\)|（[^）]+）))?\s*[：:]\s*(.*)$/);
    if (headingMatch) {
      activeKey = detectGenesisPlanSectionKey(headingMatch[1]);
      if (!activeKey) continue;
      const rest = compactGenesisPlanLine(headingMatch[2] ?? "");
      if (rest) {
        sections[activeKey] = [...(sections[activeKey] ?? []), rest];
      } else if (!sections[activeKey]) {
        sections[activeKey] = [];
      }
      continue;
    }

    if (!activeKey) continue;
    const cleaned = stripGenesisPlanBulletPrefix(line);
    if (!cleaned) continue;
    sections[activeKey] = [...(sections[activeKey] ?? []), cleaned];
  }

  return sections;
}

function cleanGenesisSectionLines(lines: string[] | undefined): string[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => stripGenesisPlanBulletPrefix(line)).filter(Boolean);
}

function extractGenesisLineLabel(line: string): string {
  const clean = stripGenesisPlanBulletPrefix(line);
  const separatorIndex = clean.search(/[：:]/);
  if (separatorIndex === -1) return "";
  return normalizeGenesisPlanSectionLabel(clean.slice(0, separatorIndex));
}

function mergeGenesisNarrativeSection(
  existingLines: string[] | undefined,
  fallback: string,
  options?: { appendIdentityLock?: boolean },
): string[] {
  const cleaned = cleanGenesisSectionLines(existingLines);
  if (cleaned.length === 0) return [fallback];
  if (options?.appendIdentityLock) {
    const hasIdentityLock = cleaned.some((line) => /(same sku|same product|同一sku|同一商品)/i.test(line));
    if (!hasIdentityLock) return [...cleaned, fallback];
  }
  return cleaned;
}

function mergeGenesisLabeledSection(existingLines: string[] | undefined, defaults: string[]): string[] {
  const cleanedExisting = cleanGenesisSectionLines(existingLines);
  if (cleanedExisting.length === 0) return defaults;

  const existingLabels = new Set(
    cleanedExisting.map((line) => extractGenesisLineLabel(line)).filter(Boolean),
  );
  const merged = [...cleanedExisting];
  for (const line of defaults) {
    const normalizedLine = stripGenesisPlanBulletPrefix(line);
    const label = extractGenesisLineLabel(line);
    if (!label) {
      if (!cleanedExisting.includes(normalizedLine)) merged.push(line);
      continue;
    }
    if (!existingLabels.has(label)) merged.push(line);
  }
  return merged;
}

function preferGenesisLabeledSection(defaults: string[], existingLines: string[] | undefined): string[] {
  const cleanedExisting = cleanGenesisSectionLines(existingLines);
  if (cleanedExisting.length === 0) return defaults;

  const defaultLabels = new Set(defaults.map((line) => extractGenesisLineLabel(line)).filter(Boolean));
  const extras = cleanedExisting.filter((line) => {
    const label = extractGenesisLineLabel(line);
    return !label || !defaultLabels.has(label);
  });

  return [...defaults, ...extras.filter((line) => !defaults.includes(line))];
}

const GENESIS_APPAREL_RE = /\b(shirt|t-?shirt|tee|blouse|jacket|coat|dress|skirt|hoodie|sweater|cardigan|pants|trousers|jeans|denim|garment|apparel|outerwear|top|shirting)\b|衬衫|衬衣|上衣|外套|夹克|连衣裙|裙装|半裙|裤子|长裤|牛仔|卫衣|毛衣|针织|服装/i;
const GENESIS_WHITE_BG_PLAN_RE = /\b(clean\s*packshot|packshot|pure white|white background|white backdrop|seamless white)\b|白底|纯白背景|白色背景/i;
const GENESIS_APPAREL_RESTRICTED_SCENE_RE = /\b(hanger|white hanger|mannequin|hang separately|floating garment|blank white backdrop|empty white background|flat lay)\b|衣架|白色衣架|人台|悬挂|挂拍|纯白背景|空白背景|平铺/i;
const GENESIS_APPAREL_STATIC_LAYOUT_RE = /\b(strictly centered|centered symmetric|symmetrical centered|front vertical|front-on vertical|flat front|dead-center|straight-on|zero-degree front|centered placement|centered display)\b|严格居中对称|居中对称|中心对称|绝对居中|正面垂直|正面平视|垂直居中|画面正中央|位于画面正中央|正中央|0度正拍|零度正拍|正拍|文字居中排列|居中摆放|居中陈列|居中位置|居中正拍|顶部居中/i;
const GENESIS_APPAREL_BLAND_SET_RE = /\b(matte gray|plain gray background|clean plain background|no distracting elements?|linen background|neutral textile background|support elements?: none|decorative elements?: none)\b|浅灰.*磨砂|磨砂质感|无干扰元素|低饱和度.*背景|浅灰磨砂|浅灰.*亚麻|亚麻布材质|亚麻布背景|中性布面背景|浅灰渐变背景|布纹纹理|无辅助道具|辅助道具：无|装饰元素：无|无繁杂装饰/i;

function isLikelyGenesisApparelProduct(productSummary: string, identity?: ProductVisualIdentity): boolean {
  const haystack = [
    productSummary,
    identity?.material ?? "",
    ...(identity?.key_features ?? []),
  ].join(" ");
  return GENESIS_APPAREL_RE.test(haystack);
}

function isGenesisWhiteBackgroundPlan(plan: BlueprintImagePlan, rawSupplement: string): boolean {
  const haystack = [plan.type ?? "", plan.title, plan.description, rawSupplement].join(" ");
  return GENESIS_WHITE_BG_PLAN_RE.test(haystack);
}

function shouldUseGenesisApparelHeroGuard(
  productSummary: string,
  identity: ProductVisualIdentity | undefined,
  plan: BlueprintImagePlan,
  rawSupplement: string,
): boolean {
  return isLikelyGenesisApparelProduct(productSummary, identity) && !isGenesisWhiteBackgroundPlan(plan, rawSupplement);
}

function sanitizeGenesisProductVisualIdentity(
  productSummary: string,
  identity: ProductVisualIdentity | undefined,
): ProductVisualIdentity | undefined {
  if (!identity) return identity;
  if (!isLikelyGenesisApparelProduct(productSummary, identity)) return identity;

  const stripSupportArtifacts = (value: string) =>
    !/\b(hanger|white hanger|mannequin)\b|衣架|白色衣架|木质衣架|人台|挂拍/i.test(value);

  return {
    ...identity,
    secondary_colors: (identity.secondary_colors ?? []).filter(stripSupportArtifacts),
    key_features: (identity.key_features ?? []).filter(stripSupportArtifacts),
  };
}

function filterGenesisRestrictedApparelLines(lines: string[] | undefined, apparelHeroGuard: boolean): string[] {
  const cleaned = cleanGenesisSectionLines(lines);
  if (!apparelHeroGuard) return cleaned;
  return cleaned.filter((line) =>
    !GENESIS_APPAREL_RESTRICTED_SCENE_RE.test(line) &&
    !GENESIS_APPAREL_STATIC_LAYOUT_RE.test(line) &&
    !GENESIS_APPAREL_BLAND_SET_RE.test(line)
  );
}

function selectedGenesisStyleLabelsFromDirections(directions?: GenesisStyleDirectionGroup[]): string[] {
  return (directions ?? [])
    .map((group) => group.recommended ?? group.options[0] ?? "")
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

function buildGenesisIdentityLockLines(
  productSummary: string,
  identity: ProductVisualIdentity | undefined,
  isZh: boolean,
): string[] {
  const primaryColor = identity?.primary_color?.trim();
  const material = identity?.material?.trim();
  const keyFeatures = (identity?.key_features ?? []).map((item) => item.trim()).filter(Boolean);
  const summary = productSummary.trim();

  return [
    summary
      ? (isZh ? `- 商品锚定：${summary}` : `- Product anchor: ${summary}`)
      : (isZh ? "- 商品锚定：保持上传商品本体与核心卖点一致。" : "- Product anchor: keep the uploaded product identity and hero selling points intact."),
    primaryColor
      ? (isZh ? `- 主色锚定：${primaryColor}` : `- Color anchor: ${primaryColor}`)
      : (isZh ? "- 主色锚定：严格保持产品图真实主色，不得错色。" : "- Color anchor: keep the true product color from the reference images, no recoloring."),
    material
      ? (isZh ? `- 材质锚定：${material}` : `- Material anchor: ${material}`)
      : (isZh ? "- 材质锚定：严格保持原始材质，不得替换材质。" : "- Material anchor: preserve the original material, no material swap."),
    keyFeatures.length > 0
      ? (isZh ? `- 关键特征：${keyFeatures.join("、")}` : `- Key features: ${keyFeatures.join(", ")}`)
      : (isZh ? "- 关键特征：保留产品图中可见的 logo、五金、纹理、车线、轮廓与结构。" : "- Key features: preserve the visible logo, hardware, texture, stitching, silhouette, and structure from the reference images."),
    isZh
      ? "- 硬约束：必须是同一 SKU、同一商品，不得改色、改材质、改 logo、改五金、改纹理、改版型、改结构。"
      : "- Hard lock: exact same SKU and same product. Do not change color, material, logo, hardware, texture, silhouette, proportions, or structure.",
  ];
}

function normalizeGenesisTemplateHeadingLabel(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/[*`]/g, "")
    .replace(/[：:]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/\//g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function detectGenesisTemplateSectionKey(heading: string): GenesisTemplateSectionKey | null {
  const label = normalizeGenesisTemplateHeadingLabel(heading);
  if (label.includes("色彩系统") || label.includes("colorsystem")) return "colorSystem";
  if (
    label.includes("字体系统文案系统") ||
    label.includes("字体文案系统") ||
    (label.includes("typography") && label.includes("copy")) ||
    (label.includes("font") && label.includes("copy"))
  ) {
    return "typographyCopySystem";
  }
  if (label.includes("视觉语言") || label.includes("visuallanguage")) return "visualLanguage";
  if (label.includes("摄影风格") || label.includes("photographystyle")) return "photographyStyle";
  if (label.includes("品质要求") || label.includes("qualityrequirements")) return "qualityRequirements";
  return null;
}

function extractGenesisTemplateSections(raw: string): {
  sections: Partial<Record<GenesisTemplateSectionKey, string[]>>;
  extras: string[];
} {
  const sections: Partial<Record<GenesisTemplateSectionKey, string[]>> = {};
  const extras: string[] = [];
  let currentSection: GenesisTemplateSectionKey | "extras" | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentSection && currentSection !== "extras") {
        sections[currentSection] = [...(sections[currentSection] ?? []), ""];
      } else if (currentSection === "extras" && extras.length > 0 && extras[extras.length - 1] !== "") {
        extras.push("");
      }
      continue;
    }

    if (/^#\s+/.test(trimmed) || /^>\s*/.test(trimmed)) continue;

    const headingMatch = trimmed.match(/^##+\s*(.+)$/);
    if (headingMatch) {
      const key = detectGenesisTemplateSectionKey(headingMatch[1]);
      currentSection = key ?? "extras";
      if (!key) extras.push(trimmed.replace(/^##+\s*/, ""));
      continue;
    }

    if (currentSection && currentSection !== "extras") {
      sections[currentSection] = [...(sections[currentSection] ?? []), line];
    } else {
      extras.push(line);
    }
  }

  return { sections, extras };
}

function hasGenesisTemplateLabel(lines: string[], label: string): boolean {
  const normalizedLabel = normalizeGenesisTemplateHeadingLabel(label);
  return lines.some((line) => {
    const cleaned = normalizeGenesisTemplateHeadingLabel(line.replace(/^-+\s*/, ""));
    return cleaned.includes(normalizedLabel);
  });
}

function normalizeGenesisExtraLines(extraLines: string[], isZh: boolean): string[] {
  return extraLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("-")) return line;
      return isZh ? `- 补充说明：${line}` : `- Additional note: ${line}`;
    });
}

function composeGenesisTemplateSection(
  rawLines: string[],
  requirements: GenesisSectionRequirement[],
  extraLines: string[] = [],
): string {
  const cleanedRaw = rawLines
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line.length === 0 && arr[index - 1]?.length === 0));
  const merged = [...cleanedRaw];

  for (const item of requirements) {
    if (!hasGenesisTemplateLabel(cleanedRaw, item.label)) {
      merged.push(item.line);
    }
  }

  for (const line of extraLines) {
    if (!merged.includes(line)) merged.push(line);
  }

  return merged
    .filter((line, index, arr) => !(line.length === 0 && arr[index - 1]?.length === 0))
    .join("\n")
    .trim();
}

function buildGenesisColorRequirements(params: {
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
}): GenesisSectionRequirement[] {
  const { isZh, productSummary, identity } = params;
  const primaryColor = identity?.primary_color?.trim();
  const secondaryColors = (identity?.secondary_colors ?? []).map((item) => item.trim()).filter(Boolean);
  const material = identity?.material?.trim();

  return isZh
    ? [
        {
          label: "主色调",
          line: primaryColor
            ? `- 主色调：锁定商品真实主色 ${primaryColor}，围绕主体延展主画面色锚，不得偏色。`
            : `- 主色调：围绕商品真实主色建立商业主画面色锚，确保 ${shortGenesisCue(productSummary, true, "商品主体")} 识别稳定。`,
        },
        {
          label: "辅助色",
          line: secondaryColors.length > 0
            ? `- 辅助色：从 ${secondaryColors.join("、")} 与材质反光中提炼点缀色，强化层次但不抢主体。`
            : "- 辅助色：从品牌调性、材质反光与卖点信息中提炼点缀色，控制对比度与商业质感。",
        },
        {
          label: "背景色",
          line: material
            ? `- 背景色：选择与 ${material} 质感兼容的商业背景色，保证商品边缘、阴影和高光层次清晰。`
            : "- 背景色：使用与商品卖点匹配的商业背景色和表面材质，保证主体轮廓与留白区清晰。",
        },
      ]
    : [
        {
          label: "Primary Color",
          line: primaryColor
            ? `- Primary Color: lock the product's true dominant color ${primaryColor} as the hero palette anchor with no color drift.`
            : `- Primary Color: build the hero palette around the product's true dominant color so ${shortGenesisCue(productSummary, false, "the product")} stays instantly recognizable.`,
        },
        {
          label: "Secondary Color",
          line: secondaryColors.length > 0
            ? `- Secondary Color: extract accents from ${secondaryColors.join(", ")} and material reflections without stealing focus from the product.`
            : "- Secondary Color: derive restrained accents from brand tone, material reflections, and selling points to add depth without noise.",
        },
        {
          label: "Background Color",
          line: material
            ? `- Background Color: choose a commercial background palette and surface treatment that matches the ${material} finish and keeps product edges readable.`
            : "- Background Color: use a product-appropriate commercial backdrop and surface tone that keeps silhouette, shadow, and whitespace separation clear.",
        },
      ];
}

function buildGenesisTypographyRequirements(params: {
  isZh: boolean;
  outputLanguage: string;
  wantsVisibleCopy: boolean;
}): GenesisSectionRequirement[] {
  const { isZh, outputLanguage, wantsVisibleCopy } = params;
  const copyRule = !wantsVisibleCopy
    ? (isZh
      ? "默认按纯视觉商业主图处理，不添加任何文字叠加，依靠构图、光影与材质表达卖点。"
      : "This set is visual-only. Add no typography overlays and communicate the selling points through composition, lighting, and material tactility.")
    : (isZh
      ? "所有可见文案都必须分别写在各图片方案的“文字内容”里；文字必须放在安全留白区，不得遮挡商品主体。"
      : "All visible copy must be defined inside each image plan's Text Content block, with typography placed in safe whitespace and never covering the product.");

  return isZh
    ? [
        {
          label: "标题字体",
          line: "- 标题字体：使用高识别商业展示无衬线或偏压缩展示字型，字面挺拔、字重明确，建立品牌级主次但不压过商品主体。",
        },
        {
          label: "正文字体",
          line: "- 正文字体：使用清晰易读的现代辅助无衬线，服务副标题、功能短句与标签信息，避免说明文堆砌和密集排版。",
        },
        {
          label: "字号层级",
          line: "- 字号层级：大标题:副标题:正文 = 3:1.8:1，默认每张图不超过 2 组文字区。",
        },
        {
          label: "文案规则",
          line: `- 文案规则：${copyRule} 主标题 <= 12 个中文字符，辅助短句 <= 18 个中文字符，标签 <= 8 个中文字符；禁止大段说明文。默认让文字服务卖点与阅读节奏，但首张主图在需要时可与商品形成双主角，不得遮挡主体。`,
        },
        {
          label: "版式原则",
          line: "- 版式原则：优先使用侧边安全区、边角标签区、纵向口号区或编辑式留白区；文字必须避开商品轮廓与关键细节，默认不超过两级文字层级。首张主图可按画面需要让文字与商品形成双主角，但仍不得压住关键卖点。",
        },
      ]
    : [
        {
          label: "Heading Font",
          line: "- Heading Font: use a high-recognition commercial display sans or lightly condensed display face with a confident silhouette and clear hierarchy over the support copy.",
        },
        {
          label: "Body Font",
          line: "- Body Font: use a clear modern supporting sans for subtitles, short benefit lines, and labels; avoid dense paragraph-style blocks.",
        },
        {
          label: "Hierarchy",
          line: "- Hierarchy: headline:support:body = 3:1.8:1, with no more than 2 text groups per image by default.",
        },
        {
          label: "Copy Rules",
          line: `- Copy Rules: ${copyRule} Keep headlines compact, support lines short, and labels minimal; avoid paragraph-like copy. By default the product leads, but the first hero image may let typography become a co-hero when the concept needs stronger visual tension.`,
        },
        {
          label: "Layout Principles",
          line: "- Layout Principles: prioritize a side safe zone, edge badge zone, vertical slogan zone, or editorial whitespace block; typography must stay off the product silhouette and key details, with no more than two text levels by default.",
        },
      ];
}

function buildGenesisVisualRequirements(params: {
  isZh: boolean;
  productSummary: string;
  styleLabels: string[];
}): GenesisSectionRequirement[] {
  const { isZh, productSummary, styleLabels } = params;
  const styleNote = styleLabels.length > 0
    ? (isZh ? ` 统一风格方向：${styleLabels.join(" / ")}` : ` Unified style direction: ${styleLabels.join(" / ")}`)
    : "";

  return isZh
    ? [
        {
          label: "装饰元素",
          line: `- 装饰元素：围绕 ${shortGenesisCue(productSummary, true, "商品卖点")} 选择相关表面、道具、材质肌理或结构化背景，不引入无关品类元素。${styleNote}`,
        },
        {
          label: "图标风格",
          line: "- 图标风格：默认使用极简线条或不使用图标，所有辅助元素都必须弱于商品主体。",
        },
        {
          label: "留白原则",
          line: "- 留白原则：保持约 30%-40% 可用留白，商品区、文字区与背景层次要清晰分离。",
        },
      ]
    : [
        {
          label: "Decorative Elements",
          line: `- Decorative Elements: choose surfaces, props, texture cues, or structured backgrounds that directly support ${shortGenesisCue(productSummary, false, "the product story")} and avoid irrelevant category language.${styleNote}`,
        },
        {
          label: "Icon Style",
          line: "- Icon Style: default to minimal line icons or no icons at all so every supporting element stays weaker than the product.",
        },
        {
          label: "Whitespace Principle",
          line: "- Whitespace Principle: keep roughly 30%-40% usable negative space with clear separation between product zone, text zone, and background depth.",
        },
      ];
}

function buildGenesisPhotographyRequirements(params: {
  isZh: boolean;
  identity?: ProductVisualIdentity;
}): GenesisSectionRequirement[] {
  const { isZh, identity } = params;
  const material = identity?.material?.trim();

  return isZh
    ? [
        {
          label: "光线",
          line: material
            ? `- 光线：根据 ${material} 的表面反光与体积感设计主光、轮廓光和补光，突出边缘、阴影与材质层次。`
            : "- 光线：采用能拉开主体层次的商业主光、轮廓光与补光组合，避免把商品拍平。",
        },
        {
          label: "景深",
          line: "- 景深：优先中浅景深，保持商品主体绝对清晰，背景适度虚化并保留空间层次。",
        },
        {
          label: "相机参数参考",
          line: "- 相机参数参考：优先使用 85mm 商业产品镜头或适合类目的稳定机位，避免广角畸变与廉价视角。",
        },
      ]
    : [
        {
          label: "Lighting",
          line: material
            ? `- Lighting: design key light, rim light, and fill light around the reflective and volumetric behavior of the ${material} surface.`
            : "- Lighting: use a commercial key/rim/fill setup that gives the product real volume, edge definition, and texture separation.",
        },
        {
          label: "Depth of Field",
          line: "- Depth of Field: prefer medium-to-shallow depth so the product stays tack sharp while the background remains controlled and layered.",
        },
        {
          label: "Camera Reference",
          line: "- Camera Reference: favor an 85mm product-photography lens or another category-appropriate commercial angle with no cheap wide-angle distortion.",
        },
      ];
}

function buildGenesisQualityRequirements(isZh: boolean): GenesisSectionRequirement[] {
  return isZh
    ? [
        { label: "分辨率", line: "- 分辨率：8K" },
        { label: "风格", line: "- 风格：高端商业主图摄影 / 电商广告级视觉" },
        { label: "真实感", line: "- 真实感：超写实 / 准确材质物理表现 / 照片级细节" },
      ]
    : [
        { label: "Resolution", line: "- Resolution: 8K" },
        { label: "Style", line: "- Style: high-end commercial hero photography / e-commerce advertising grade" },
        { label: "Realism", line: "- Realism: hyper-realistic with accurate material physics and photo-grade detail" },
      ];
}

function normalizeGenesisDesignSpecsTemplate(params: {
  rawDesignSpecs: string;
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
  outputLanguage: string;
  styleLabels: string[];
  wantsVisibleCopy: boolean;
}): string {
  const { rawDesignSpecs, isZh, productSummary, identity, outputLanguage, styleLabels, wantsVisibleCopy } = params;
  const { sections, extras } = extractGenesisTemplateSections(rawDesignSpecs);
  const normalizedExtras = normalizeGenesisExtraLines(extras, isZh);

  const composedSections: Record<GenesisTemplateSectionKey, string> = {
    colorSystem: composeGenesisTemplateSection(
      sections.colorSystem ?? [],
      buildGenesisColorRequirements({ isZh, productSummary, identity }),
    ),
    typographyCopySystem: composeGenesisTemplateSection(
      sections.typographyCopySystem ?? [],
      buildGenesisTypographyRequirements({ isZh, outputLanguage, wantsVisibleCopy }),
    ),
    visualLanguage: composeGenesisTemplateSection(
      sections.visualLanguage ?? [],
      buildGenesisVisualRequirements({ isZh, productSummary, styleLabels }),
    ),
    photographyStyle: composeGenesisTemplateSection(
      sections.photographyStyle ?? [],
      buildGenesisPhotographyRequirements({ isZh, identity }),
    ),
    qualityRequirements: composeGenesisTemplateSection(
      sections.qualityRequirements ?? [],
      buildGenesisQualityRequirements(isZh),
      normalizedExtras,
    ),
  };

  return [
    isZh ? "# 整体设计规范" : "# Overall Design Specifications",
    isZh
      ? "> 所有图片必须遵循以下统一规范，确保视觉连贯性"
      : "> All images must follow the unified specifications below to ensure visual consistency",
    "",
    isZh ? "## 色彩系统" : "## Color System",
    composedSections.colorSystem,
    "",
    isZh ? "## 字体系统/文案系统" : "## Font System",
    composedSections.typographyCopySystem,
    "",
    isZh ? "## 视觉语言" : "## Visual Language",
    composedSections.visualLanguage,
    "",
    isZh ? "## 摄影风格" : "## Photography Style",
    composedSections.photographyStyle,
    "",
    isZh ? "## 品质要求" : "## Quality Requirements",
    composedSections.qualityRequirements,
  ].join("\n").trim();
}

function buildGenesisPlanProductAppearance(params: {
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
}): string {
  const { isZh, productSummary, identity } = params;
  const primaryColor = identity?.primary_color?.trim();
  const material = identity?.material?.trim();
  const keyFeatures = (identity?.key_features ?? []).map((item) => item.trim()).filter(Boolean);
  const summary = shortGenesisCue(productSummary, isZh, isZh ? "上传商品主体" : "the uploaded product");
  const features = keyFeatures.length > 0
    ? (isZh ? `关键特征包括 ${keyFeatures.join("、")}` : `Key features include ${keyFeatures.join(", ")}`)
    : (isZh ? "保留原图可见的 logo、五金、纹理与结构细节" : "Preserve the visible logo, hardware, texture, and structural details");

  return isZh
    ? `必须严格保持与参考图同一 SKU、同一商品。主体表现为 ${summary}；${primaryColor ? `真实主色为 ${primaryColor}；` : ""}${material ? `材质为 ${material}；` : ""}${features}。`
    : `The subject in this image must stay strictly consistent with the same SKU and product from the reference image. The product appearance should match ${summary}; ${primaryColor ? `the true dominant color is ${primaryColor}; ` : ""}${material ? `the material is ${material}; ` : ""}${features}.`;
}

function buildGenesisPlanGraphicElements(params: {
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
  styleLabels: string[];
  apparelHeroGuard: boolean;
}): string[] {
  const { isZh, productSummary, identity, styleLabels, apparelHeroGuard } = params;
  const summaryCue = shortGenesisCue(productSummary, isZh, isZh ? "商品卖点" : "the hero selling point");
  const styleCue = styleLabels.length > 0 ? styleLabels.join(" / ") : (isZh ? "统一商业风格" : "a coherent commercial direction");
  const material = identity?.material?.trim();

  if (apparelHeroGuard) {
    return isZh
      ? [
          `- Product：以 ${shortGenesisCue(productSummary, true, "服装主体")} 为绝对主角，完整保留轮廓、缝线、门襟/领口/袖口等可见关键结构与材质识别。`,
          `- Support Elements：使用折叠布片、局部材质切面、克制支撑面、前景虚化或阴影带来强化 ${summaryCue}${material ? ` 与 ${material} 触感` : ""}，禁止衣架、人台和空白挂拍语义。`,
          `- Background：背景与承托表面采用 ${styleCue} 的商业静物语境，可使用布面、哑光石材、微纹理墙面或柔和渐层背景，至少形成前中后景层次。`,
        ]
      : [
          `- Product: keep ${shortGenesisCue(productSummary, false, "the garment")} as the absolute hero subject with silhouette, seam work, placket/collar/cuff structure, and material identity fully intact.`,
          `- Support Elements: use folded fabric echoes, restrained support planes, foreground blur, material slices, or shaped shadows that reinforce ${summaryCue}${material ? ` and the ${material} tactility` : ""}, with no hanger, mannequin, or empty hanging-display language.`,
          `- Background: place the garment inside a layered editorial still-life set using textile sweeps, matte stone, micro-textured walls, or soft gradient surfaces within ${styleCue}.`,
        ];
  }

  return [
    isZh
      ? `- Product：以 ${shortGenesisCue(productSummary, true, "商品主体")} 为画面主角，完整保留标签、结构与材质识别。`
      : `- Product: keep ${shortGenesisCue(productSummary, false, "the product")} as the clear primary subject, with label, structure, and material identity intact.`,
    isZh
      ? `- Support Elements：仅允许与 ${summaryCue} 相关的手部、材质切片、反射、折射或轻道具点缀${material ? `，强化 ${material} 触感` : ""}，禁止喧宾夺主。`
      : `- Support Elements: allow only hands, material slices, reflections, refractions, or light props that support ${summaryCue}${material ? ` and reinforce the ${material} tactility` : ""}, without overpowering the product.`,
    isZh
      ? `- Background：背景与表面统一为 ${styleCue} 的商业摄影语境，保留约 30%-40% 安全留白，不得压迫主体。`
      : `- Background: keep the backdrop and surface treatment inside ${styleCue}, with roughly 30%-40% safe whitespace and no crowding around the product.`,
  ];
}

function buildGenesisPlanCompositionLines(index: number, isZh: boolean, apparelHeroGuard: boolean): string[] {
  if (apparelHeroGuard) {
    if (isZh) {
      if (index === 0) {
        return [
          "- 商品占比：主体约占画面 58%-68%",
          "- 布局方式：采用偏轴主视觉或轻微对角线构图，避免呆板正中挂拍",
          "- 主体角度：保持正面识别的同时引入 5°-15° 轻微倾角或结构化前 3/4 角度",
          "- 文字区域：优先预留侧边安全留白区，文字不得覆盖服装主体",
        ];
      }
      if (index === 1) {
        return [
          "- 商品占比：主体约占画面 52%-62%",
          "- 布局方式：用三分法、对角线或高低机位制造层次感，保持轮廓不变",
          "- 主体角度：通过轻俯拍、轻仰拍或前景遮挡建立服装体积感，禁止平面正挂",
          "- 文字区域：只允许一个轻量标题或标签区，依附边缘留白排布",
        ];
      }
      return [
        "- 商品占比：主体约占画面 45%-55%",
        "- 布局方式：收紧景别，围绕面料、结构或裁片细节组织近景构图",
        "- 主体角度：优先局部斜切、细节切入或局部堆叠视角，强化材质与结构深度",
        "- 文字区域：如需文字，仅在边缘安全区使用短标签，不得压住服装主体",
      ];
    }

    if (index === 0) {
      return [
        "- Product Proportion: garment occupies roughly 58%-68% of the frame",
        "- Layout Method: use an offset hero composition or restrained diagonal flow rather than a flat centered hanging display",
        "- Subject Angle: keep the garment readable while introducing a subtle 5-15 degree tilt or structured front three-quarter stance",
        "- Text Area: reserve the side safe zone in the negative space and never let copy touch the garment",
      ];
    }
    if (index === 1) {
      return [
        "- Product Proportion: garment occupies roughly 52%-62% of the frame",
        "- Layout Method: build depth with rule-of-thirds balance, diagonal layering, or a restrained high/low camera variation",
        "- Subject Angle: use a light high angle, low angle, or foreground overlap to add volume without changing silhouette",
        "- Text Area: allow only one light headline or label zone in the edge whitespace",
      ];
    }
    return [
      "- Product Proportion: garment occupies roughly 45%-55% of the frame",
      "- Layout Method: tighten the crop around fabric, tailoring, or construction details while keeping readable scene depth",
      "- Subject Angle: favor a partial diagonal crop, detail cut-in, or layered overlap that emphasizes structure and tactility",
      "- Text Area: if typography is used, keep it as a short edge-safe label with the garment fully unobstructed",
    ];
  }

  if (isZh) {
    if (index === 0) {
      return [
        "- 商品占比：主体约占画面 60%-70%",
        "- 布局方式：采用偏轴主视觉或轻微对角线构图，避免呆板正中摆放",
        "- 主体角度：保持主体识别度的同时加入轻微倾角或结构化机位变化",
        "- 文字区域：优先预留右上或左上安全区，文字不得遮挡商品主体",
      ];
    }
    if (index === 1) {
      return [
        "- 商品占比：主体约占画面 55%-65%",
        "- 布局方式：通过三分法、对角线或景别变化建立层次感，但轮廓与比例保持不变",
        "- 主体角度：使用轻微高低机位或前景遮挡制造动态深度",
        "- 文字区域：只允许一个轻量标题或标签区，保持留白",
      ];
    }
    return [
      "- 商品占比：主体约占画面 50%-60%",
      "- 布局方式：收紧景别，突出材质、工艺或卖点细节，同时保留背景层次",
      "- 主体角度：优先用局部斜切或细节视角增强体积感与焦点控制",
      "- 文字区域：如需文字，仅使用边缘安全区并保持商品无遮挡",
    ];
  }

  if (index === 0) {
    return [
      "- Product Proportion: product occupies roughly 60%-70% of the frame",
      "- Layout Method: use an offset hero composition or restrained diagonal flow instead of a static centered display",
      "- Subject Angle: keep the product highly legible while introducing a subtle tilt or structured camera shift",
      "- Text Area: reserve a top-left or top-right safe zone and never let text cover the product",
    ];
  }
  if (index === 1) {
    return [
      "- Product Proportion: product occupies roughly 55%-65% of the frame",
      "- Layout Method: introduce rule-of-thirds balance, diagonal tension, or a restrained angle shift while keeping silhouette identical",
      "- Subject Angle: use a light high/low angle or foreground overlap to create layered depth without redesigning the product",
      "- Text Area: allow only one light headline or label zone with generous whitespace",
    ];
  }
  return [
    "- Product Proportion: product occupies roughly 50%-60% of the frame",
    "- Layout Method: tighter framing to emphasize material, craft, or hero feature detail while keeping some scene depth",
    "- Subject Angle: favor a detail-driven crop or diagonal close framing that preserves the true structure",
    "- Text Area: if typography is used, keep it in the edge safe zone without touching the product",
  ];
}

function buildGenesisPlanContentLines(params: {
  index: number;
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
  styleLabels: string[];
  apparelHeroGuard: boolean;
}): string[] {
  const { index, isZh, productSummary, identity, styleLabels, apparelHeroGuard } = params;
  const material = identity?.material?.trim();
  const primaryColor = identity?.primary_color?.trim();
  const keyFeatures = (identity?.key_features ?? []).map((item) => item.trim()).filter(Boolean);
  const styleCue = styleLabels.length > 0 ? styleLabels.join(" / ") : (isZh ? "统一商业风格" : "a coherent commercial direction");
  const focus = index === 0
    ? (isZh ? "第一眼商品识别与核心卖点" : "instant product recognition and the core selling point")
    : index === 1
    ? (isZh ? "轮廓、角度和层次变化" : "silhouette, angle, and layered depth")
    : (isZh ? "材质、工艺或关键卖点细节" : "material, craft, or key selling-point detail");

  if (apparelHeroGuard) {
    return isZh
      ? [
          `- 展示重点：${focus}`,
          `- 核心卖点：围绕 ${shortGenesisCue(productSummary, true, "服装卖点")} 展开，${material ? `强化 ${material} 的垂坠、纹理与体积感，` : ""}${primaryColor ? `稳住 ${primaryColor} 的色锚，` : ""}不得改款、改色或改变服装结构。`,
          "- 背景元素：使用布面、石材、墙面渐层、局部阴影或前景虚化建立商业静物层次，禁止空白白底和单层挂拍背景。",
          `- 装饰元素：${keyFeatures.length > 0 ? `仅允许呼应 ${keyFeatures.join("、")} 的折叠布片、裁片细节、材质切面或克制支撑元素` : "仅允许与服装材质和剪裁相关的克制辅助元素"}，风格统一为 ${styleCue}，禁止衣架和人台。`,
        ]
      : [
          `- Focus of Display: ${focus}`,
          `- Key Selling Points: build around ${shortGenesisCue(productSummary, false, "the garment story")}; ${material ? `emphasize the drape, texture, and volume of the ${material}, ` : ""}${primaryColor ? `keep ${primaryColor} as the color anchor, ` : ""}and do not redesign, recolor, or restructure the garment.`,
          "- Background Elements: use textile sweeps, stone/plaster surfaces, shadow gradients, or foreground blur to create editorial still-life depth instead of a blank white apparel backdrop.",
          `- Decorative Elements: ${keyFeatures.length > 0 ? `allow only restrained fabric echoes, construction details, material slices, or support elements that relate to ${keyFeatures.join(", ")}` : "allow only restrained garment-relevant supporting elements"} within ${styleCue}, with no hanger or mannequin.`,
        ];
  }

  return isZh
    ? [
        `- 展示重点：${focus}`,
        `- 核心卖点：围绕 ${shortGenesisCue(productSummary, true, "商品卖点")} 展开，${material ? `强化 ${material} 的质感，` : ""}${primaryColor ? `稳住 ${primaryColor} 的色锚，` : ""}不得改款或偏色。`,
        "- 背景元素：使用与商品匹配的商业背景层次、表面材质和阴影结构，保持主体边缘清晰。",
        `- 装饰元素：${keyFeatures.length > 0 ? `允许弱化呼应 ${keyFeatures.join("、")} 的视觉元素` : "允许极简商业辅助元素"}，风格统一为 ${styleCue}。`,
      ]
    : [
        `- Focus of Display: ${focus}`,
        `- Key Selling Points: build around ${shortGenesisCue(productSummary, false, "the product story")}; ${material ? `reinforce the ${material} texture, ` : ""}${primaryColor ? `keep ${primaryColor} as the color anchor, ` : ""}and do not redesign or recolor the product.`,
        "- Background Elements: use a commercial backdrop, surface treatment, and shadow structure that keep the product edge clean and readable.",
        `- Decorative Elements: ${keyFeatures.length > 0 ? `allow subtle supporting elements that echo ${keyFeatures.join(", ")}` : "allow only restrained supporting elements"} within ${styleCue}.`,
      ];
}

function inferGenesisTypographyRole(params: {
  plan: BlueprintImagePlan;
  index: number;
  title: string;
  description: string;
}): GenesisTypographyRole {
  const { plan, index, title, description } = params;
  const haystack = [
    String(plan.type ?? ""),
    title,
    description,
    String(plan.design_content ?? ""),
  ].join(" ").toLowerCase();

  if (/\b(hero|kv|lifestyle|campaign)\b|主视觉|主图|首屏|品牌/i.test(haystack)) return "hero";
  if (/\b(feature|benefit|selling|comparison|compare|advantage)\b|卖点|优势|对比|功能|亮点/i.test(haystack)) return "selling";
  if (/\b(detail|close|macro|label|badge|angle|packshot|clean)\b|细节|特写|标签|角度|白底|精修/i.test(haystack)) return "label";
  if (index === 0) return "hero";
  return index % 2 === 1 ? "selling" : "label";
}

function buildGenesisPlanTypeFromRole(role: GenesisTypographyRole): string {
  switch (role) {
    case "hero":
      return "hero";
    case "selling":
      return "feature";
    default:
      return "detail";
  }
}

function buildGenesisCopyRoleFromTypographyRole(role: GenesisTypographyRole): "headline+support" | "label" | "none" {
  return role === "label" ? "label" : "headline+support";
}

function buildGenesisTextContentLines(params: {
  isZh: boolean;
  outputLanguage: string;
  plan: BlueprintImagePlan;
  index: number;
  title: string;
  description: string;
  productSummary: string;
  identity?: ProductVisualIdentity;
  commercialIntent: GenesisCommercialIntent;
  sceneRecipe: GenesisSceneRecipe;
  existingText: GenesisPlanTextContent;
  wantsVisibleCopy: boolean;
}): string[] {
  const {
    isZh,
    outputLanguage,
    plan,
    index,
    title,
    description,
    productSummary,
    identity,
    commercialIntent,
    sceneRecipe,
    existingText,
    wantsVisibleCopy,
  } = params;

  const role = inferGenesisTypographyRole({ plan, index, title, description });
  const heroFirstFrame = role === "hero" && index === 0;
  const heroExpressionProfile = buildGenesisHeroExpressionProfile(commercialIntent.hero_expression, isZh);
  const heroTypographyStrategy = buildGenesisHeroTypographyStrategy({
    heroExpression: commercialIntent.hero_expression,
    humanInteractionMode: commercialIntent.human_interaction_mode,
    isZh,
    identity,
    styleLabels: commercialIntent.mood_keywords,
    requirements: commercialIntent.brief_summary,
  });
  const firstLine = (value: string): string => value.replace(/[。.!?].*$/u, "").replace(/\s+/g, " ").trim();
  const briefCue = firstLine(commercialIntent.brief_summary || description || productSummary);
  const focusCue = firstLine(sceneRecipe.hero_focus || description || productSummary);
  const productCue = firstLine(productSummary || title);
  const fallbackTone = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh
      ? "无（纯视觉设计，不涉及排版）"
      : "None (visual-only composition with no typography).")
    : heroFirstFrame
      ? heroExpressionProfile.heroTypography
      : role === "hero"
      ? (isZh
        ? "高识别商业展示无衬线，标题重心明确，字面挺拔，形成品牌级首屏主视觉。"
        : "Use a high-recognition commercial display sans with a confident silhouette and strong hero-headline presence.")
      : role === "selling"
        ? (isZh
          ? "现代商业无衬线配中黑字重，信息利落，适合卖点标题与功能短句。"
          : "Use a modern commercial sans with a medium-heavy weight for a crisp selling-point headline plus support line.")
        : (isZh
          ? "克制简洁的轻量无衬线或窄体标签字型，信息轻量，弱于商品主体。"
          : "Use a restrained light sans or narrow label-style face so the text stays light and clearly secondary to the product.");
  const fallbackLayout = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh
      ? "无新增文字，保留纯视觉留白与主体呼吸区。"
      : "No added typography; preserve pure visual whitespace and breathing room around the product.")
    : heroFirstFrame
      ? heroExpressionProfile.heroLayout
      : role === "hero"
      ? (isZh
        ? "主标题与副标题放在侧边安全留白区，形成清晰主次层级；文字不得遮挡商品主体与关键细节。"
        : "Place the headline and subtitle inside a side safe zone with a clear two-level hierarchy, keeping all typography off the product silhouette and key details.")
      : role === "selling"
        ? (isZh
          ? "使用标题加辅助短句的卖点结构，依附侧边或角落信息块排布，强化功能信息但不抢主体。"
          : "Use a selling-point headline plus support line inside a side or corner information block, strengthening the message without overpowering the product.")
        : (isZh
          ? "仅使用轻量标签或一句短句落在边角留白区，保持可读性与留白，绝不压住主体。"
          : "Use only a light label or one compact support line in the edge whitespace zone with generous breathing room and no product overlap.");
  const fallbackLayoutArchetype = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh ? "无（纯视觉构图）" : "None (visual-only composition).")
    : heroFirstFrame
      ? heroExpressionProfile.layoutArchetype
      : role === "selling"
        ? (isZh ? "侧边卖点信息块或角标式短信息区" : "side selling-point block or compact corner information zone")
        : (isZh ? "边角轻量标签区" : "edge label zone");
  const fallbackTypefaceDirection = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh ? "无（纯视觉构图）" : "None (visual-only composition).")
    : heroFirstFrame
      ? heroTypographyStrategy.typefaceDirection
      : role === "selling"
        ? (isZh ? "现代商业无衬线或中黑卖点标题字" : "modern commercial sans or medium-heavy selling-point headline style")
        : (isZh ? "轻量无衬线或标签式窄体字" : "light sans or narrow label-style type");
  const fallbackTypographyColorStrategy = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh ? "无（纯视觉构图）" : "None (visual-only composition).")
    : heroFirstFrame
      ? heroTypographyStrategy.typographyColorStrategy
      : role === "selling"
        ? (isZh ? "以深色中性字为主，必要时用一处卖点强调色提亮标题" : "use dark neutrals for most copy with one restrained benefit-accent color on the headline if needed")
        : (isZh ? "保持低对比中性色，避免标签颜色抢走主体识别" : "keep labels in low-contrast neutrals so they never steal attention from the product");
  const fallbackLayoutAggression = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh ? "无（纯视觉构图）" : "None (visual-only composition).")
    : heroFirstFrame
      ? heroTypographyStrategy.layoutAggression
      : role === "selling"
        ? (isZh ? "中强" : "medium-strong")
        : (isZh ? "克制" : "restrained");
  const fallbackTextTension = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh ? "无（纯视觉构图）" : "None (visual-only composition).")
    : heroFirstFrame
      ? heroExpressionProfile.textTension
      : role === "selling"
        ? (isZh ? "中等张力，信息清晰可读但不抢主体" : "medium tension with readable selling-point emphasis that does not overtake the product")
        : (isZh ? "低张力，仅作轻量辅助提示" : "low tension with lightweight supporting guidance only");
  const fallbackCopyDominance = outputLanguage === "none" || !wantsVisibleCopy
    ? (isZh ? "纯视觉" : "Visual-only")
    : heroFirstFrame
      ? (commercialIntent.copy_dominance === "co-hero"
        ? (isZh ? "文字与商品形成双主角" : "Typography and product act as co-heroes")
        : (isZh ? "商品主导，文字辅助" : "Product-led with typography in support"))
      : role === "selling"
        ? (isZh ? "商品主导，信息块辅助" : "Product-led with a supporting information block")
        : (isZh ? "商品主导，标签轻量辅助" : "Product-led with lightweight label support");
  if (outputLanguage === "none" || !wantsVisibleCopy) {
    return [
      isZh ? "- 主标题：无" : "- Main Title: None",
      isZh ? "- 副标题：无" : "- Subtitle: None",
      isZh ? "- 描述文案：无" : "- Description Text: None",
      isZh ? `- 字体气质：${existingText.typographyTone || fallbackTone}` : `- Typography Tone: ${existingText.typographyTone || fallbackTone}`,
      isZh ? `- 字体风格：${existingText.typefaceDirection || fallbackTypefaceDirection}` : `- Typeface Direction: ${existingText.typefaceDirection || fallbackTypefaceDirection}`,
      isZh ? `- 文字颜色策略：${existingText.typographyColorStrategy || fallbackTypographyColorStrategy}` : `- Typography Color Strategy: ${existingText.typographyColorStrategy || fallbackTypographyColorStrategy}`,
      isZh ? `- 版式激进度：${existingText.layoutAggression || fallbackLayoutAggression}` : `- Layout Aggression: ${existingText.layoutAggression || fallbackLayoutAggression}`,
      isZh ? `- 版式类型：${existingText.layoutArchetype || fallbackLayoutArchetype}` : `- Layout Archetype: ${existingText.layoutArchetype || fallbackLayoutArchetype}`,
      isZh ? `- 文字张力：${existingText.textTension || fallbackTextTension}` : `- Text Tension: ${existingText.textTension || fallbackTextTension}`,
      isZh ? `- 主次关系：${existingText.copyDominance || fallbackCopyDominance}` : `- Copy Dominance: ${existingText.copyDominance || fallbackCopyDominance}`,
      isZh ? `- 排版说明：${existingText.layoutGuidance || fallbackLayout}` : `- Layout Guidance: ${existingText.layoutGuidance || fallbackLayout}`,
    ];
  }

  const isTargetZh = outputLanguage === "zh";
  const mainFallback = isTargetZh
    ? clipGenesisTextLine(
      role === "label"
        ? (title || focusCue || "核心标签")
        : (title || briefCue || "核心卖点"),
      role === "label" ? 8 : 12,
    )
    : clipGenesisTextLine(
      title || briefCue || (role === "hero" ? "Hero Product Highlight" : role === "selling" ? "Key Product Benefit" : "Signature Detail"),
      role === "label" ? 24 : 40,
    );
  const subtitleFallback = isTargetZh
    ? clipGenesisTextLine(
      role === "hero"
        ? (focusCue || "突出核心卖点")
        : role === "selling"
          ? (briefCue || "核心优势一眼看清")
          : (focusCue || "细节信息轻量提示"),
      18,
    )
    : clipGenesisTextLine(
      role === "hero"
        ? (focusCue || "Built around the core selling point")
        : role === "selling"
          ? (briefCue || "Make the key product benefit immediately readable")
          : (focusCue || "Use one light detail cue in the edge whitespace"),
      64,
    );
  const descriptionFallback = isTargetZh
    ? clipGenesisTextLine(
      role === "hero"
        ? (productCue || "围绕商品核心价值展开")
        : role === "selling"
          ? (productCue || "突出优势信息与阅读节奏")
          : (briefCue || "保持轻量标签式辅助说明"),
      22,
    )
    : clipGenesisTextLine(
      role === "hero"
        ? (productCue || "Built around the product's core value")
        : role === "selling"
          ? (productCue || "Keep the benefit readable and commercially sharp")
          : (briefCue || "Keep the support copy light and label-like"),
      72,
    );

  const main = existingText.mainTitle || mainFallback;
  const subtitle = existingText.subtitle || subtitleFallback;
  const descriptionText = existingText.descriptionText || descriptionFallback;

  return [
    isZh ? `- 主标题：${main || "无"}` : `- Main Title: ${main || "None"}`,
    isZh ? `- 副标题：${subtitle || "无"}` : `- Subtitle: ${subtitle || "None"}`,
    isZh ? `- 描述文案：${descriptionText}` : `- Description Text: ${descriptionText}`,
    isZh ? `- 字体气质：${existingText.typographyTone || fallbackTone}` : `- Typography Tone: ${existingText.typographyTone || fallbackTone}`,
    isZh ? `- 字体风格：${existingText.typefaceDirection || fallbackTypefaceDirection}` : `- Typeface Direction: ${existingText.typefaceDirection || fallbackTypefaceDirection}`,
    isZh ? `- 文字颜色策略：${existingText.typographyColorStrategy || fallbackTypographyColorStrategy}` : `- Typography Color Strategy: ${existingText.typographyColorStrategy || fallbackTypographyColorStrategy}`,
    isZh ? `- 版式激进度：${existingText.layoutAggression || fallbackLayoutAggression}` : `- Layout Aggression: ${existingText.layoutAggression || fallbackLayoutAggression}`,
    isZh ? `- 版式类型：${existingText.layoutArchetype || fallbackLayoutArchetype}` : `- Layout Archetype: ${existingText.layoutArchetype || fallbackLayoutArchetype}`,
    isZh ? `- 文字张力：${existingText.textTension || fallbackTextTension}` : `- Text Tension: ${existingText.textTension || fallbackTextTension}`,
    isZh ? `- 主次关系：${existingText.copyDominance || fallbackCopyDominance}` : `- Copy Dominance: ${existingText.copyDominance || fallbackCopyDominance}`,
    isZh ? `- 排版说明：${existingText.layoutGuidance || fallbackLayout}` : `- Layout Guidance: ${existingText.layoutGuidance || fallbackLayout}`,
  ];
}

function extractGenesisExistingTextContent(raw: string, isZh: boolean): GenesisPlanTextContent {
  const fallback: GenesisPlanTextContent = {
    mainTitle: "",
    subtitle: "",
    descriptionText: "",
    typographyTone: "",
    typefaceDirection: "",
    typographyColorStrategy: "",
    layoutAggression: "",
    layoutArchetype: "",
    textTension: "",
    copyDominance: "",
    layoutGuidance: "",
  };
  const normalized = raw.trim();
  if (!normalized) return fallback;

  const mainMatch = normalized.match(isZh ? /-\s*主标题\s*[：:]\s*(.+)/i : /-\s*Main Title\s*:\s*(.+)/i);
  const subtitleMatch = normalized.match(isZh ? /-\s*副标题\s*[：:]\s*(.+)/i : /-\s*Subtitle\s*:\s*(.+)/i);
  const descriptionMatch = normalized.match(
    isZh ? /-\s*(?:描述文案|说明文字)\s*[：:]\s*(.+)/i : /-\s*Description Text\s*:\s*(.+)/i,
  );
  const toneMatch = normalized.match(isZh ? /-\s*字体气质\s*[：:]\s*(.+)/i : /-\s*Typography Tone\s*:\s*(.+)/i);
  const typefaceDirectionMatch = normalized.match(isZh ? /-\s*字体风格\s*[：:]\s*(.+)/i : /-\s*Typeface Direction\s*:\s*(.+)/i);
  const typographyColorStrategyMatch = normalized.match(
    isZh ? /-\s*文字颜色策略\s*[：:]\s*(.+)/i : /-\s*Typography Color Strategy\s*:\s*(.+)/i,
  );
  const layoutAggressionMatch = normalized.match(isZh ? /-\s*版式激进度\s*[：:]\s*(.+)/i : /-\s*Layout Aggression\s*:\s*(.+)/i);
  const layoutArchetypeMatch = normalized.match(isZh ? /-\s*版式类型\s*[：:]\s*(.+)/i : /-\s*Layout Archetype\s*:\s*(.+)/i);
  const textTensionMatch = normalized.match(isZh ? /-\s*文字张力\s*[：:]\s*(.+)/i : /-\s*Text Tension\s*:\s*(.+)/i);
  const copyDominanceMatch = normalized.match(isZh ? /-\s*主次关系\s*[：:]\s*(.+)/i : /-\s*Copy Dominance\s*:\s*(.+)/i);
  const layoutGuidanceMatch = normalized.match(isZh ? /-\s*排版说明\s*[：:]\s*(.+)/i : /-\s*Layout Guidance\s*:\s*(.+)/i);

  return {
    mainTitle: sanitizeString(mainMatch?.[1], "").trim(),
    subtitle: sanitizeString(subtitleMatch?.[1], "").trim(),
    descriptionText: sanitizeString(descriptionMatch?.[1], "").trim(),
    typographyTone: sanitizeString(toneMatch?.[1], "").trim(),
    typefaceDirection: sanitizeString(typefaceDirectionMatch?.[1], "").trim(),
    typographyColorStrategy: sanitizeString(typographyColorStrategyMatch?.[1], "").trim(),
    layoutAggression: sanitizeString(layoutAggressionMatch?.[1], "").trim(),
    layoutArchetype: sanitizeString(layoutArchetypeMatch?.[1], "").trim(),
    textTension: sanitizeString(textTensionMatch?.[1], "").trim(),
    copyDominance: sanitizeString(copyDominanceMatch?.[1], "").trim(),
    layoutGuidance: sanitizeString(layoutGuidanceMatch?.[1], "").trim(),
  };
}

function buildGenesisAtmosphereLines(params: {
  isZh: boolean;
  identity?: ProductVisualIdentity;
  styleLabels: string[];
  title: string;
  apparelHeroGuard: boolean;
}): string[] {
  const { isZh, identity, styleLabels, title, apparelHeroGuard } = params;
  const material = identity?.material?.trim();
  const mood = styleLabels.length > 0 ? styleLabels.join(", ") : (isZh ? "高级商业感、真实材质、清晰焦点" : "premium commercial mood, real material tactility, clear visual focus");

  if (apparelHeroGuard) {
    return isZh
      ? [
          `- 氛围关键词：${mood}，围绕“${title}”建立服装商业大片记忆点`,
          `- 光影效果：${material ? `以侧上方定向主光塑造 ${material} 的纹理、褶皱与边缘高光，再用轮廓光和环境补光拉开服装层次` : "用侧上方主光、轮廓光与柔和环境补光塑造服装体积感"}，阴影要真实可读，避免平打光。`,
          "- 镜头/光圈参考：70mm-100mm 商业镜头，f/5.6-f/8，控制服装结构清晰度并保留前中后景层次。",
        ]
      : [
          `- Mood Keywords: ${mood}, built around the garment-memory cue of "${title}"`,
          `- Light and Shadow Effects: ${material ? `use a directional side-top key light to shape the texture, folds, and edge highlights of the ${material}, then separate the garment with rim light and ambient lift` : "use a directional side-top key light with rim support and soft ambient fill to build garment volume"}, keeping the shadows readable instead of flat front lighting.`,
          "- Lens / Aperture Reference: 70mm-100mm commercial lens, f/5.6-f/8, with controlled depth that keeps garment structure crisp while preserving scene layering.",
        ];
  }

  return isZh
    ? [
        `- 氛围关键词：${mood}，围绕“${title}”建立镜头记忆点`,
        `- 光影效果：${material ? `根据 ${material} 的反光与体积感控制主光、轮廓光与高光层次` : "使用商业主光、轮廓光与补光"}，保留中浅景深与真实阴影过渡。`,
        "- 镜头/光圈参考：70mm-100mm 商业镜头，f/5.6-f/8，避免廉价广角感并保持主体层次。",
      ]
    : [
        `- Mood Keywords: ${mood}, built around the shot memory of "${title}"`,
        `- Light and Shadow Effects: ${material ? `tune the key light, rim light, and highlight roll-off to the ${material} surface` : "use a commercial key light, rim light, and fill light setup"}, while keeping medium-shallow depth and realistic shadow falloff.`,
      "- Lens / Aperture Reference: 70mm-100mm commercial lens, f/5.6-f/8, with controlled depth and no cheap wide-angle distortion.",
    ];
}

function buildGenesisRecipeGraphicLines(sceneRecipe: GenesisSceneRecipe, isZh: boolean): string[] {
  return isZh
    ? [
        `- Product：${sceneRecipe.product_ratio}，重点表现 ${sceneRecipe.hero_focus}。`,
        `- Support Elements：${sceneRecipe.support_elements}。`,
        `- Background：${sceneRecipe.background_surface}。`,
      ]
    : [
        `- Product: ${sceneRecipe.product_ratio}, with focus on ${sceneRecipe.hero_focus}.`,
        `- Support Elements: ${sceneRecipe.support_elements}.`,
        `- Background: ${sceneRecipe.background_surface}.`,
      ];
}

function buildGenesisRecipeProductAppearanceLines(params: {
  sceneRecipe: GenesisSceneRecipe;
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
}): string[] {
  const { sceneRecipe, isZh, productSummary, identity } = params;
  const layoutCue = sceneRecipe.layout_method.replace(/^(采用|使用)\s*/u, "");
  const visibilityCue = isZh
    ? `${sceneRecipe.shot_role}采用 ${layoutCue}，${sceneRecipe.subject_angle}，重点呈现 ${sceneRecipe.hero_focus}。`
    : `${sceneRecipe.shot_role} uses ${sceneRecipe.layout_method}, ${sceneRecipe.subject_angle}, and prioritizes ${sceneRecipe.hero_focus}.`;
  const identityLock = buildGenesisPlanProductAppearance({ isZh, productSummary, identity });
  return [visibilityCue, identityLock];
}

function buildGenesisSellingPointSummary(params: {
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
  commercialIntent: GenesisCommercialIntent;
}): string {
  const { isZh, productSummary, identity, commercialIntent } = params;
  const material = identity?.material?.trim();
  const keyFeatures = (identity?.key_features ?? []).map((item) => item.trim()).filter(Boolean);
  const featureCue = keyFeatures.slice(0, 2).join(isZh ? "、" : ", ");
  const briefCue = shortGenesisCue(commercialIntent.brief_summary, isZh, shortGenesisCue(productSummary, isZh, isZh ? "商品卖点" : "the key selling point"));

  if (isZh) {
    return [
      material ? `${material} 的真实舒适触感` : "",
      featureCue ? `${featureCue} 等经典结构细节` : "",
      briefCue ? `服务于“${briefCue}”的主图目标` : "",
    ].filter(Boolean).join("，");
  }

  return [
    material ? `the true tactile quality of ${material}` : "",
    featureCue ? `${featureCue} as the key structural details` : "",
    briefCue ? `in service of the hero-image goal "${briefCue}"` : "",
  ].filter(Boolean).join(", ");
}

function buildGenesisRecipeCompositionLines(sceneRecipe: GenesisSceneRecipe, isZh: boolean): string[] {
  return [
    isZh ? `- 商品占比：${sceneRecipe.product_ratio}` : `- Product Proportion: ${sceneRecipe.product_ratio}`,
    isZh ? `- 布局方式：${sceneRecipe.layout_method}` : `- Layout Method: ${sceneRecipe.layout_method}`,
    isZh ? `- 主体角度：${sceneRecipe.subject_angle}` : `- Subject Angle: ${sceneRecipe.subject_angle}`,
    isZh ? `- 文字区域：${sceneRecipe.text_zone}` : `- Text Area: ${sceneRecipe.text_zone}`,
  ];
}

function buildGenesisRecipeContentLines(params: {
  sceneRecipe: GenesisSceneRecipe;
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
  commercialIntent: GenesisCommercialIntent;
}): string[] {
  const { sceneRecipe, isZh, productSummary, identity, commercialIntent } = params;
  const sellingPointSummary = buildGenesisSellingPointSummary({ isZh, productSummary, identity, commercialIntent });
  return [
    isZh ? `- 展示重点：${sceneRecipe.hero_focus}` : `- Focus of Display: ${sceneRecipe.hero_focus}`,
    isZh ? `- 核心卖点：${sellingPointSummary}` : `- Key Selling Points: ${sellingPointSummary}`,
    isZh ? `- 背景元素：${sceneRecipe.background_elements}` : `- Background Elements: ${sceneRecipe.background_elements}`,
    isZh ? `- 装饰元素：${sceneRecipe.decorative_elements}` : `- Decorative Elements: ${sceneRecipe.decorative_elements}`,
  ];
}

function buildGenesisRecipeAtmosphereLines(sceneRecipe: GenesisSceneRecipe, isZh: boolean): string[] {
  return [
    isZh ? `- 情绪关键词：${sceneRecipe.mood_keywords}` : `- Mood Keywords: ${sceneRecipe.mood_keywords}`,
    isZh ? `- 光影效果：${sceneRecipe.lighting_setup}` : `- Light and Shadow Effects: ${sceneRecipe.lighting_setup}`,
    isZh ? `- 镜头/光圈参考：${sceneRecipe.lens_hint}` : `- Lens / Aperture Reference: ${sceneRecipe.lens_hint}`,
  ];
}

function normalizeGenesisImagePlanTemplate(params: {
  index: number;
  plan: BlueprintImagePlan;
  isZh: boolean;
  productSummary: string;
  identity?: ProductVisualIdentity;
  outputLanguage: string;
  commercialIntent: GenesisCommercialIntent;
  totalImages: number;
  wantsVisibleCopy: boolean;
}): BlueprintImagePlan {
  const {
    index,
    plan,
    isZh,
    productSummary,
    identity,
    outputLanguage,
    commercialIntent,
    totalImages,
    wantsVisibleCopy,
  } = params;
  const roleIndex = index + 1;
  const title = sanitizeString(plan.title, isZh ? `图片方案 ${roleIndex}` : `Image Plan ${roleIndex}`).trim();
  const rawSupplement = sanitizeString(plan.design_content, "").trim();
  const apparelHeroGuard = shouldUseGenesisApparelHeroGuard(productSummary, identity, plan, rawSupplement);
  const parsedSections = extractGenesisPlanSections(rawSupplement);
  const fallbackDescription = apparelHeroGuard
    ? (isZh
      ? "以商业服装静物大片方式展示主体版型、层次与面料质感，避免平面挂拍。"
      : "Show the garment as a premium editorial still life with structure, depth, and fabric tactility rather than a flat hanging display.")
    : (isZh ? "请编辑该图片方案的描述。" : "Edit this image plan description.");
  const rawDescription = sanitizeString(plan.description, fallbackDescription).trim();
  const description = apparelHeroGuard && GENESIS_APPAREL_RESTRICTED_SCENE_RE.test(rawDescription)
    ? fallbackDescription
    : rawDescription;
  const sceneRecipe = mergeGenesisSceneRecipe(
    buildGenesisSceneRecipe({
      index,
      productSummary,
      identity,
      commercialIntent,
      outputLanguage,
      isZh,
      totalImages,
    }),
    plan.scene_recipe,
  );
  const existingText = extractGenesisExistingTextContent(rawSupplement, isZh);
  const productAppearanceLines = buildGenesisRecipeProductAppearanceLines({
    sceneRecipe,
    isZh,
    productSummary,
    identity,
  });
  const graphicDefaults = buildGenesisRecipeGraphicLines(sceneRecipe, isZh);
  const compositionDefaults = buildGenesisRecipeCompositionLines(sceneRecipe, isZh);
  const contentDefaults = buildGenesisRecipeContentLines({
    sceneRecipe,
    isZh,
    productSummary,
    identity,
    commercialIntent,
  });
  const defaultTextLines = [
    ...buildGenesisTextContentLines({
      isZh,
      outputLanguage,
      plan,
      index,
      title,
      description,
      productSummary,
      identity,
      commercialIntent,
      sceneRecipe,
      existingText,
      wantsVisibleCopy,
    }),
  ];
  const textLines = wantsVisibleCopy
    ? mergeGenesisLabeledSection(parsedSections.textContent, defaultTextLines)
    : defaultTextLines;
  const atmosphereDefaults = buildGenesisRecipeAtmosphereLines(sceneRecipe, isZh);
  const graphicLines = preferGenesisLabeledSection(
    graphicDefaults,
    filterGenesisRestrictedApparelLines(parsedSections.inGraphicElements, apparelHeroGuard),
  );
  const compositionLines = preferGenesisLabeledSection(
    compositionDefaults,
    filterGenesisRestrictedApparelLines(parsedSections.compositionPlan, apparelHeroGuard),
  );
  const contentLines = preferGenesisLabeledSection(
    contentDefaults,
    filterGenesisRestrictedApparelLines(parsedSections.contentElements, apparelHeroGuard),
  );
  const atmosphereLines = preferGenesisLabeledSection(
    atmosphereDefaults,
    filterGenesisRestrictedApparelLines(parsedSections.atmosphereCreation, apparelHeroGuard),
  );
  const designGoalLines = mergeGenesisNarrativeSection(
    filterGenesisRestrictedApparelLines(parsedSections.designGoal, apparelHeroGuard),
    description,
  );

  const parts = [
    isZh ? `## 图片 [${roleIndex}]：${title}` : `## Image [${roleIndex}]: ${title}`,
    isZh ? `**设计目标**：${designGoalLines[0] ?? description}` : `**Design Goal**: ${designGoalLines[0] ?? description}`,
    ...designGoalLines.slice(1),
    isZh
      ? `**商品外观**：${productAppearanceLines[0] ?? buildGenesisPlanProductAppearance({ isZh: true, productSummary, identity })}`
      : `**Product Appearance**: ${productAppearanceLines[0] ?? buildGenesisPlanProductAppearance({ isZh: false, productSummary, identity })}`,
    ...productAppearanceLines.slice(1),
    isZh ? "**画内元素**：" : "**In-Graphic Elements**:",
    ...graphicLines,
    "",
    isZh ? "**构图规划**：" : "**Composition Plan**:",
    ...compositionLines,
    "",
    isZh ? "**内容元素**：" : "**Content Elements**:",
    ...contentLines,
    "",
    isZh ? `**文字内容**（使用 ${outputLanguage === "none" ? "纯视觉" : outputLanguageLabel(outputLanguage)}）：` : `**Text Content** (Using ${outputLanguage === "none" ? "Visual Only" : outputLanguageLabel(outputLanguage)}):`,
    ...textLines,
    "",
    isZh ? "**氛围营造**：" : "**Atmosphere Creation**:",
    ...atmosphereLines,
  ];

  return {
    ...plan,
    title,
    description,
    design_content: parts.join("\n\n"),
    scene_recipe: sceneRecipe,
  };
}

export function normalizeGenesisBlueprintTemplate(
  blueprint: AnalysisBlueprint,
  outputLanguage: string,
  uiLanguage: string,
  requirements: string,
): AnalysisBlueprint {
  const isZh = uiLanguage.startsWith("zh");
  const wantsVisibleCopy = genesisRequestsVisibleCopy(requirements, outputLanguage);
  const productSummary = sanitizeString(
    blueprint.product_summary,
    sanitizeString(blueprint.copy_analysis?.product_summary, requirements),
  ).trim();
  const styleLabels = selectedGenesisStyleLabelsFromDirections(blueprint.style_directions);
  const commercialIntent = mergeGenesisCommercialIntent(
    buildGenesisCommercialIntent({
      productSummary,
      identity: blueprint.product_visual_identity,
      requirements,
      outputLanguage,
      isZh,
      styleLabels,
      wantsVisibleCopy,
    }),
    blueprint.commercial_intent,
  );
  const normalizedImages = blueprint.images.map((plan, index) => {
    return normalizeGenesisImagePlanTemplate({
      index,
      plan,
      isZh,
      productSummary,
      identity: blueprint.product_visual_identity,
      outputLanguage,
      commercialIntent,
      totalImages: blueprint.images.length,
      wantsVisibleCopy,
    });
  });

  return {
    ...blueprint,
    images: normalizedImages,
    design_specs: normalizeGenesisDesignSpecsTemplate({
      rawDesignSpecs: sanitizeString(blueprint.design_specs, ""),
      isZh,
      productSummary,
      identity: blueprint.product_visual_identity,
      outputLanguage,
      styleLabels,
      wantsVisibleCopy,
    }),
    copy_analysis: blueprint.copy_analysis
      ? {
          ...blueprint.copy_analysis,
          mode: wantsVisibleCopy
            ? (blueprint.copy_analysis.mode === "visual-only" ? "product-inferred" : blueprint.copy_analysis.mode)
            : "visual-only",
          shared_copy: "",
          resolved_output_language: outputLanguage,
          product_summary: productSummary,
          per_plan_adaptations: normalizedImages.map((plan, index) => {
            const existing = blueprint.copy_analysis?.per_plan_adaptations?.[index];
            const role = inferGenesisTypographyRole({
              plan,
              index,
              title: plan.title,
              description: plan.description,
            });
            const textSections = extractGenesisPlanSections(plan.design_content);
            const layoutGuidance = extractSectionDetail(textSections.textContent, "Layout Guidance");
            const copyDominance = extractSectionDetail(textSections.textContent, "Copy Dominance");
            const adaptationSummary = [layoutGuidance, copyDominance].filter(Boolean).join(isZh ? "；" : "; ");
            return {
              plan_index: index,
              plan_type: existing?.plan_type ?? buildGenesisPlanTypeFromRole(role),
              copy_role: outputLanguage === "none" || !wantsVisibleCopy ? "none" : buildGenesisCopyRoleFromTypographyRole(role),
              adaptation_summary: existing?.adaptation_summary ?? adaptationSummary,
            };
          }),
        }
      : blueprint.copy_analysis,
    product_summary: productSummary,
    commercial_intent: commercialIntent,
  };
}

export function normalizeGenesisAnalysis(
  parsed: Record<string, unknown>,
  outputLanguage: string,
  uiLanguage: string,
  requirements: string,
): GenesisAnalysisResult {
  const isZh = uiLanguage.startsWith("zh");
  const wantsVisibleCopy = genesisRequestsVisibleCopy(requirements, outputLanguage);
  const fallbackSummary = requirements
    || (isZh
      ? "根据产品图分析产品特征，并围绕核心卖点生成主图。"
      : "Analyze the product images and generate hero images around the key selling points.");
  const rawCopyPlan = sanitizeString(parsed.copy_plan ?? parsed.copyPlan, "");
  const fallbackCopyPlan = buildGenesisCopyFallback(requirements, outputLanguage, uiLanguage);

  const rawIdentity = (parsed.product_visual_identity ?? parsed.productVisualIdentity) as Record<string, unknown> | undefined;
  const unsanitizedIdentity: ProductVisualIdentity | undefined = rawIdentity && typeof rawIdentity === "object"
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
  const productSummary = sanitizeString(
    parsed.product_summary ?? parsed.productSummary,
    fallbackSummary,
  );
  const productVisualIdentity = sanitizeGenesisProductVisualIdentity(productSummary, unsanitizedIdentity);

  return {
    product_summary: productSummary,
    product_visual_identity: productVisualIdentity,
    style_directions: normalizeGenesisStyleDirections(parsed, uiLanguage),
    copy_plan: outputLanguage === "none" || !wantsVisibleCopy
      ? ""
      : clipGenesisTextLine(
        rawCopyPlan && copyPlanMatchesBrief(rawCopyPlan, requirements, uiLanguage)
          ? rawCopyPlan
          : fallbackCopyPlan,
        isZh ? 36 : 96,
      ),
    _ai_meta: {},
  };
}

function upstreamHttpStatusFromError(error: unknown): number | null {
  const message = String(error ?? "");
  const match = message.match(/(?:API_ERROR|CREATE_ERROR)\s+(\d{3})\b/);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function isRefundableUpstreamRejection(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500;
}

function imageGenErrorCodeFromError(error: unknown): string {
  const message = String(error ?? "");
  if (message.includes("WORKER_LIMIT") || message.includes("compute resources exhausted")) return "WORKER_LIMIT";
  if (message.includes("AbortError") || message.includes("IMAGE_GEN_TIMEOUT")) return "UPSTREAM_TIMEOUT";
  if (message.includes("IMAGE_INPUT_SOURCE_MISSING")) return "IMAGE_INPUT_SOURCE_MISSING";
  if (message.includes("SOURCE_IMAGE_FETCH_FAILED")) return "IMAGE_INPUT_SOURCE_MISSING";
  if (message.includes("IMAGE_INPUT_PROMPT_MISSING")) return "IMAGE_INPUT_PROMPT_MISSING";
  if (message.includes("STORAGE_UPLOAD_FAILED")) return "STORAGE_UPLOAD_FAILED";
  if (message.includes("IMAGE_RESULT_MISSING")) return "IMAGE_RESULT_MISSING";
  if (message.includes("IMAGE_SIZE_UNSATISFIED")) return "IMAGE_SIZE_UNSATISFIED";
  if (message.includes("INSUFFICIENT_CREDITS")) return "INSUFFICIENT_CREDITS";
  if (
    message.includes("InvalidEndpointOrModel.NotFound") ||
    message.includes("does not exist or you do not have access to it")
  ) return "MODEL_UNAVAILABLE";
  if (isRefundableUpstreamRejection(upstreamHttpStatusFromError(error))) return "UPSTREAM_REJECTED";
  return "UPSTREAM_ERROR";
}

function shouldRefundImageGenFailure(errorCode: string): boolean {
  // Image generation charges the whole job up front. Any terminal failure after that
  // should refund the tracked charge; the RPC is idempotent and no-ops if nothing was charged.
  return errorCode !== "INSUFFICIENT_CREDITS";
}

type ImageRoute = {
  provider: "azure" | "openai" | "qiniu" | "volcengine" | "openrouter" | "toapis" | "goapi" | "stability" | "ideogram" | "fal" | "default";
  model?: string;
  endpoint?: string;
  apiKey?: string;
  providerHint?: string;
};

const TA_MODEL_MAP: Record<string, string> = {
  "ta-gemini-2.5-flash": "gemini-2.5-flash-image-preview",
  "ta-gemini-3.1-flash": "gemini-3.1-flash-image-preview",
  "ta-gemini-3-pro": "gemini-3-pro-image-preview",
};

function resolveImageRoute(
  modelFromRequest: string,
  adminModelConfigs: Awaited<ReturnType<typeof getAdminImageModelConfigs>>,
): ImageRoute {
  const model = normalizeRequestedModel(modelFromRequest.trim());
  const qnEndpoint = Deno.env.get("QN_IMAGE_API_ENDPOINT");
  const qnApiKey = Deno.env.get("QN_IMAGE_API_KEY");
  const adminModel = getAdminImageModelConfig(adminModelConfigs, model);

  if (adminModel) {
    return {
      provider: "default",
      endpoint: adminModel.endpoint,
      apiKey: Deno.env.get(adminModel.apiKeyEnvVar) ?? "",
      model: adminModel.providerModel,
      providerHint: adminModel.providerHint === "auto" ? undefined : adminModel.providerHint,
    };
  }

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

  // fal.ai models
  if (model === "fal-nano-banana-pro") {
    return {
      provider: "fal",
      endpoint: "https://fal.run/fal-ai/nano-banana-pro",
      apiKey: Deno.env.get("FAL_API_KEY") ?? "",
      model: "fal-ai/nano-banana-pro",
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
  prompt_source?: "analysis" | "fallback";
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
  if (text.includes("TASK_STALE_NO_HEARTBEAT")) {
    return "Style replication worker stopped heartbeating before completion. Please retry.";
  }
  if (text.includes("WORKER_LIMIT") || text.includes("compute resources exhausted")) {
    return "Worker capacity is exhausted. Please retry shortly.";
  }
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
  if (text.includes("IMAGE_INPUT_TOO_LARGE")) {
    return "Input image is too large. Please keep each uploaded image at or below 10 MB.";
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
  if (message.includes("TASK_STALE_NO_HEARTBEAT")) return "TASK_STALE_NO_HEARTBEAT";
  if (message.includes("WORKER_LIMIT") || message.includes("compute resources exhausted")) return "WORKER_LIMIT";
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
  if (message.includes("IMAGE_INPUT_TOO_LARGE")) return "IMAGE_INPUT_TOO_LARGE";
  if (message.includes("SOURCE_IMAGE_FETCH_FAILED")) return "IMAGE_INPUT_SOURCE_MISSING";
  if (message.includes("SOURCE_IMAGE_FETCH_TIMEOUT")) return "IMAGE_INPUT_SOURCE_TIMEOUT";
  if (message.includes("STYLE_REPLICATE_TIMEOUT")) return "STYLE_REPLICATE_TIMEOUT";
  if (message.includes("INSUFFICIENT_CREDITS")) return "INSUFFICIENT_CREDITS";
  return "UPSTREAM_ERROR";
}

function isFatalStyleReplicateError(error: unknown): boolean {
  const code = styleReplicateErrorCode(error);
  return code === "MODEL_UNAVAILABLE" ||
    code === "STYLE_PRODUCT_IMAGE_MISSING" ||
    code === "STYLE_REFERENCE_IMAGE_MISSING" ||
    code === "BATCH_PRODUCT_IMAGE_REQUIRED" ||
    code === "BATCH_REFERENCE_IMAGES_REQUIRED" ||
    code === "BATCH_INPUT_INVALID" ||
    code === "REFINEMENT_PRODUCT_IMAGES_REQUIRED" ||
    code === "REFINEMENT_BACKGROUND_MODE_INVALID" ||
    code === "IMAGE_SIZE_UNSATISFIED" ||
    code === "IMAGE_INPUT_TOO_LARGE" ||
    code === "IMAGE_INPUT_SOURCE_MISSING" ||
    code === "IMAGE_INPUT_SOURCE_TIMEOUT" ||
    code === "INSUFFICIENT_CREDITS";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function getOpenRouterMaxInputImages(): Promise<number> {
  const configured = await getIntegerSystemConfig(
    "generation_openrouter_max_input_images",
    DEFAULT_OPENROUTER_MAX_INPUT_IMAGES,
  );
  return clampInt(configured, 1, 12, DEFAULT_OPENROUTER_MAX_INPUT_IMAGES);
}

function logImageGenEvent(
  event: string,
  fields: Record<string, unknown>,
): void {
  console.log(JSON.stringify({
    event,
    task_type: "IMAGE_GEN",
    ...fields,
  }));
}

const TASK_MAX_ATTEMPTS = clampInt(
  Deno.env.get("GENERATION_TASK_MAX_ATTEMPTS") ?? 5,
  1,
  10,
  5,
);
const TASK_RETRY_DELAY_MS = clampInt(
  Deno.env.get("GENERATION_TASK_RETRY_DELAY_MS") ?? 10_000,
  1_000,
  300_000,
  10_000,
);
const TASK_HEARTBEAT_INTERVAL_MS = 30_000;

type TaskLease = {
  pulse: () => Promise<void>;
  stop: () => Promise<void>;
};

function startTaskHeartbeat(
  supabase: ReturnType<typeof createServiceClient>,
  taskId: string,
): TaskLease {
  let stopped = false;
  let pending = Promise.resolve();

  const beat = async () => {
    const lockedAt = new Date().toISOString();
    const { error } = await supabase
      .from("generation_job_tasks")
      .update({ locked_at: lockedAt })
      .eq("id", taskId)
      .eq("status", "running");
    if (error) {
      console.warn(`TASK_HEARTBEAT_FAILED task_id=${taskId} error=${error.message}`);
    }
  };

  const enqueueBeat = (): Promise<void> => {
    if (stopped) return pending;
    pending = pending
      .then(() => beat())
      .catch((error) => {
        console.warn(`TASK_HEARTBEAT_CHAIN_FAILED task_id=${taskId} error=${String(error)}`);
      });
    return pending;
  };

  const interval = setInterval(() => {
    void enqueueBeat();
  }, TASK_HEARTBEAT_INTERVAL_MS);

  return {
    pulse: async () => {
      await enqueueBeat();
    },
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      await pending;
    },
  };
}

function isWorkerPressureError(error: unknown): boolean {
  const message = String(error ?? "");
  return message.includes("WORKER_LIMIT") ||
    message.includes("compute resources exhausted") ||
    message.includes("worker limit");
}

function retryDelayMsForError(error: unknown): number {
  return isWorkerPressureError(error) ? TASK_RETRY_DELAY_MS * 6 : TASK_RETRY_DELAY_MS;
}

function isFatalImageGenError(error: unknown): boolean {
  const code = imageGenErrorCodeFromError(error);
  return code === "MODEL_UNAVAILABLE" ||
    code === "IMAGE_INPUT_SOURCE_MISSING" ||
    code === "IMAGE_INPUT_PROMPT_MISSING" ||
    code === "IMAGE_SIZE_UNSATISFIED" ||
    code === "INSUFFICIENT_CREDITS" ||
    code === "UPSTREAM_REJECTED";
}

function isAzureContentFilterError(error: unknown): boolean {
  const message = String(error ?? "");
  return message.includes("ResponsibleAIPolicyViolation") ||
    message.includes('"code":"content_filter"') ||
    (message.includes("content_filter_results") && message.includes('"param":"prompt"'));
}

function prefersChinese(payload: Record<string, unknown>): boolean {
  const uiLanguage = String(payload.uiLanguage ?? payload.outputLanguage ?? payload.targetLanguage ?? "");
  return uiLanguage.toLowerCase().startsWith("zh");
}

function providerPolicyBlockedMessage(payload: Record<string, unknown>): string {
  return prefersChinese(payload)
    ? "PROMPT_BLOCKED_BY_PROVIDER_POLICY: 当前请求触发了 Azure 内容安全策略，无法继续处理。请调整商品描述、文案或图片后重试。"
    : "PROMPT_BLOCKED_BY_PROVIDER_POLICY: This request was blocked by Azure safety policy. Please revise the product description, copy, or images and try again.";
}

function isFatalAnalysisError(error: unknown): boolean {
  const message = String(error ?? "");
  // Image source gone (e.g. temp upload expired) — retrying won't help
  if (message.includes("SOURCE_IMAGE_FETCH_FAILED")) return true;
  // Input validation errors — retrying with same payload will always fail
  if (message.includes("ANALYSIS_INPUT_IMAGE_MISSING")) return true;
  if (message.includes("ANALYSIS_MODEL_IMAGE_MISSING")) return true;
  if (isAzureContentFilterError(error)) return true;
  return false;
}

function isTaskRetryable(taskType: TaskRow["task_type"], attempts: number, error: unknown): boolean {
  if (attempts >= TASK_MAX_ATTEMPTS) return false;
  if (taskType === "STYLE_REPLICATE") return !isFatalStyleReplicateError(error);
  if (taskType === "IMAGE_GEN") return !isFatalImageGenError(error);
  if (taskType === "ANALYSIS") return !isFatalAnalysisError(error);
  return true;
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
  if (heroPlanTitle) parts.push(`Hero direction: ${heroPlanTitle}.`);
  if (heroPlanDescription) parts.push(`Shot objective: ${heroPlanDescription}.`);
  if (identity?.primary_color) {
    parts.push(`Keep the exact color anchor as ${identity.primary_color}.`);
  } else {
    parts.push("Keep the real product color from the uploaded reference images unchanged.");
  }
  if (identity?.material) {
    parts.push(`Keep the exact material anchor as ${identity.material}.`);
  } else {
    parts.push("Preserve the original material from the uploaded reference images.");
  }
  if (identity && identity.key_features.length > 0) {
    parts.push(`Preserve these immutable product features: ${identity.key_features.join(", ")}.`);
  } else {
    parts.push("Preserve the visible logo, hardware, texture, stitching, silhouette, proportions, and structure from the uploaded reference images.");
  }
  parts.push("Hard identity lock: exact same SKU and exact same design. No recolor, redesign, missing logo, hardware swap, texture loss, silhouette drift, or structural change.");
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

  const dataUrl = toChatImageUrl(image);

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

/** Strip base64 image data from chat messages before storing to avoid DB statement timeout. */
function stripBase64FromMessages(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    const m = msg as Record<string, unknown>;
    if (!Array.isArray(m.content)) return msg;
    return {
      ...m,
      content: (m.content as unknown[]).map((part) => {
        const p = part as Record<string, unknown>;
        if (p.type === "image_url") {
          const url = (p.image_url as Record<string, unknown>)?.url;
          if (typeof url === "string" && url.startsWith("data:")) {
            return { type: "image_url", image_url: { url: "[base64_stripped]" } };
          }
        }
        return part;
      }),
    };
  });
}

const ANALYSIS_TIMEOUT_MS = clampInt(
  Deno.env.get("ANALYSIS_TIMEOUT_MS") ?? 120_000,
  30_000,
  300_000,
  120_000,
);

const STYLE_REPLICATE_TIMEOUT_MS = clampInt(
  Deno.env.get("STYLE_REPLICATE_TIMEOUT_MS") ?? 120_000,
  30_000,
  300_000,
  120_000,
);

const IMAGE_GEN_STALE_AFTER_MS = 3 * 60_000;
const IMAGE_GEN_TIMEOUT_MS = clampInt(
  Deno.env.get("IMAGE_GEN_TIMEOUT_MS") ?? IMAGE_GEN_STALE_AFTER_MS - TASK_HEARTBEAT_INTERVAL_MS,
  30_000,
  IMAGE_GEN_STALE_AFTER_MS - 5_000,
  IMAGE_GEN_STALE_AFTER_MS - TASK_HEARTBEAT_INTERVAL_MS,
);

type ImageGenStage =
  | "charge_credits"
  | "prepare_inputs"
  | "build_prompt"
  | "provider_request"
  | "persist_result"
  | "finalize_job";

async function processAnalysisJob(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
  taskLease?: TaskLease,
): Promise<void> {
  // Route OCR tasks to dedicated handler
  if (job.payload?.task === "ocr") {
    return processOcrJob(supabase, job);
  }

  const pulse = taskLease?.pulse ?? (async () => {});

  const startedAt = Date.now();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("ANALYSIS_TIMEOUT")), ANALYSIS_TIMEOUT_MS);
  });

  await Promise.race([
    _processAnalysisJobInner(supabase, job, pulse, startedAt),
    timeoutPromise,
  ]);
}

async function _processAnalysisJobInner(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
  pulse: () => Promise<void>,
  startedAt: number,
): Promise<void> {
  const payload = job.payload ?? {};
  const uiLanguage = String(payload.uiLanguage ?? payload.targetLanguage ?? "en");
  const outputLanguage = String(payload.outputLanguage ?? payload.targetLanguage ?? uiLanguage ?? "en");
  const promptProfile = sanitizePromptProfile(payload.promptProfile ?? payload.prompt_profile);
  const promptLocale = promptLocaleFromValue(uiLanguage);
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

  // Pass URLs directly to the chat API instead of downloading + base64-encoding.
  // This avoids ~30MB of base64 data for multi-image jobs (6× 5MB images),
  // which was exceeding Edge Function CPU time (2s) and memory (256MB) limits.
  // The chat API (Azure OpenAI GPT-4V) natively fetches from public URLs.
  const imageDataUrls = productImages.map((path) => toChatImageUrl(path));
  const modelImageDataUrl = modelImage ? toChatImageUrl(modelImage) : null;
  await pulse();

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
      ? `你是顶级电商主图创意总监。请基于产品图和用户要求，只输出“紧凑中间蓝图 JSON”。服务端会把你的结果补全成最终完整版 blueprint。

硬规则：
1. 用户要求优先于图片推断。
2. 所有方案都必须锁定为同一 SKU、同一商品，不得改色、改材质、改 logo、改五金、改纹理、改结构。
3. 只输出以下字段：product_summary、product_visual_identity、style_directions、commercial_intent、images。不要输出 copy_analysis、design_specs、design_content。
4. style_directions 只保留 sceneStyle、lighting、composition 三个维度；每个维度 1-3 个中文短标签，并给出 recommended。
5. images 必须正好 ${imageCount} 个对象。每张图要有不同画面职责，但整体视觉系统统一。
6. outputLanguage=none 时，text_content 的 main_title / subtitle / description_text 必须为空字符串，且不要暗示画面上需要新增文字；否则必须生成目标语言的短版可上图文案。
7. 短版文案必须克制：主标题短、辅助短句短、默认最多 2 组文字区，禁止大段说明文。
8. 类目可以自适应，但禁止硬套无关道具、背景、材质或人物关系；手持/人物只在确有必要时出现，不要默认加入。
9. product_visual_identity.primary_color 是最高优先级字段，必须准确提取产品真实主色并附近似十六进制色值。
10. 返回合法 JSON，不要 Markdown，不要解释。`
      : `You are a top-tier e-commerce hero-image creative director. Return only a compact intermediate blueprint JSON from the product images and user brief. The server will expand your result into the final full blueprint.

Hard rules:
1. The user's brief overrides image inference.
2. Every plan must stay locked to the exact same SKU and product. Do not change color, material, logo, hardware, texture, or construction.
3. Return only these top-level fields: product_summary, product_visual_identity, style_directions, commercial_intent, and images. Do not return copy_analysis, design_specs, or long-form design_content.
4. style_directions must contain only sceneStyle, lighting, and composition, each with 1-3 short tags and one recommended option from its own list.
5. images must contain exactly ${imageCount} objects. Each image needs a distinct shot responsibility while preserving one coherent visual system.
6. When outputLanguage=none, text_content.main_title / subtitle / description_text must be empty strings and the plan should remain visual-only; otherwise return short usable visible copy in the target language.
7. Keep copy short-form and layout-ready: concise headline, concise support line, no paragraph copy, and by default no more than 2 text groups per image.
8. Adapt by category, but do not import irrelevant props, surfaces, backgrounds, or human interaction. Hand-held or human presence should appear only when genuinely necessary, never as a default.
9. product_visual_identity.primary_color is the highest-priority extraction field and must reflect the true dominant product color with an approximate hex value.
10. Return valid JSON only. No markdown. No explanations.`;

    const genesisUserPrompt = isZhGenesis
      ? `请返回紧凑中间蓝图 JSON，严格使用这个结构：
{
  "product_summary": "一句产品与卖点总结",
  "product_visual_identity": {
    "primary_color": "真实主色 + 近似十六进制",
    "secondary_colors": ["辅助色"],
    "material": "材质",
    "key_features": ["不可改变的关键视觉特征"]
  },
  "style_directions": {
    "sceneStyle": { "options": ["标签1","标签2"], "recommended": "标签1" },
    "lighting": { "options": ["标签1","标签2"], "recommended": "标签1" },
    "composition": { "options": ["标签1","标签2"], "recommended": "标签1" }
  },
  "commercial_intent": {
    "archetype": "apparel | beauty-liquid | beauty-bottle | footwear | electronics | jewelry | generic",
    "brief_summary": "一句话概括商业表达方向",
    "visual_tone": "整体视觉语气",
    "mood_keywords": ["情绪词1","情绪词2"],
    "composition_bias": "构图偏向",
    "set_treatment": "场景处理",
    "lighting_bias": "光线偏向",
    "copy_strategy": "文字策略",
    "hero_expression": "rational-tech | expressive-packaging | premium-material",
    "hero_layout_archetype": "首图版式原型",
    "text_tension": "文字张力",
    "copy_dominance": "subordinate | co-hero",
    "human_interaction_mode": "none | optional | required"
  },
  "images": [
    {
      "title": "方案标题",
      "description": "一句定位描述",
      "type": "hero | angle | feature | lifestyle | comparison | premium-closeup | clean-packshot",
      "scene_recipe": {
        "shot_role": "画面职责",
        "hero_focus": "展示重点",
        "product_ratio": "商品占比",
        "layout_method": "布局方式",
        "subject_angle": "主体角度/机位",
        "support_elements": "支撑或辅助元素",
        "background_surface": "背景表面材质",
        "background_elements": "前中后景关系",
        "decorative_elements": "装饰元素",
        "lighting_setup": "光线方案",
        "lens_hint": "镜头/光圈参考",
        "text_zone": "文字区域策略",
        "mood_keywords": "情绪关键词"
      },
      "text_content": {
        "main_title": "主标题或空字符串",
        "subtitle": "副标题或空字符串",
        "description_text": "描述文案或空字符串",
        "typography_tone": "字体气质",
        "typeface_direction": "字体风格",
        "typography_color_strategy": "文字颜色策略",
        "layout_aggression": "版式激进度",
        "layout_archetype": "版式类型",
        "text_tension": "文字张力",
        "copy_dominance": "主次关系",
        "layout_guidance": "排版说明"
      }
    }
  ]
}

注意：
- product_visual_identity 必须严格从产品图提取，尤其是 primary_color 和 key_features。
- images 必须正好 ${imageCount} 个。
- 每张图都要给出具体 scene_recipe，禁止抽象空话。
- 不要返回 copy_analysis、design_specs、design_content，这些由服务端补全。
- 输出语言：${outputLanguageLabel(outputLanguage)}
- 用户要求：
${requirements || "（用户未填写额外要求，仅根据产品图分析）"}`
      : `Return a compact intermediate blueprint JSON in this exact shape:
{
  "product_summary": "one concise product + selling-point summary",
  "product_visual_identity": {
    "primary_color": "true dominant color + approximate hex",
    "secondary_colors": ["secondary colors"],
    "material": "material",
    "key_features": ["immutable visual features"]
  },
  "style_directions": {
    "sceneStyle": { "options": ["tag1","tag2"], "recommended": "tag1" },
    "lighting": { "options": ["tag1","tag2"], "recommended": "tag1" },
    "composition": { "options": ["tag1","tag2"], "recommended": "tag1" }
  },
  "commercial_intent": {
    "archetype": "apparel | beauty-liquid | beauty-bottle | footwear | electronics | jewelry | generic",
    "brief_summary": "one-line commercial direction summary",
    "visual_tone": "overall visual tone",
    "mood_keywords": ["mood1","mood2"],
    "composition_bias": "composition bias",
    "set_treatment": "set treatment",
    "lighting_bias": "lighting bias",
    "copy_strategy": "copy strategy",
    "hero_expression": "rational-tech | expressive-packaging | premium-material",
    "hero_layout_archetype": "hero layout archetype",
    "text_tension": "text tension",
    "copy_dominance": "subordinate | co-hero",
    "human_interaction_mode": "none | optional | required"
  },
  "images": [
    {
      "title": "plan title",
      "description": "one-line positioning",
      "type": "hero | angle | feature | lifestyle | comparison | premium-closeup | clean-packshot",
      "scene_recipe": {
        "shot_role": "shot responsibility",
        "hero_focus": "display focus",
        "product_ratio": "product-to-frame ratio",
        "layout_method": "layout method",
        "subject_angle": "subject angle / camera angle",
        "support_elements": "supporting elements",
        "background_surface": "background surface",
        "background_elements": "foreground/midground/background relationship",
        "decorative_elements": "decorative elements",
        "lighting_setup": "lighting setup",
        "lens_hint": "lens / aperture guidance",
        "text_zone": "text zone strategy",
        "mood_keywords": "mood keywords"
      },
      "text_content": {
        "main_title": "headline or empty string",
        "subtitle": "subtitle or empty string",
        "description_text": "description text or empty string",
        "typography_tone": "typography tone",
        "typeface_direction": "typeface direction",
        "typography_color_strategy": "typography color strategy",
        "layout_aggression": "layout aggression",
        "layout_archetype": "layout archetype",
        "text_tension": "text tension",
        "copy_dominance": "copy dominance",
        "layout_guidance": "layout guidance"
      }
    }
  ]
}

Requirements:
- product_visual_identity must be extracted strictly from the product images, especially primary_color and key_features.
- images must contain exactly ${imageCount} objects.
- Every image needs concrete scene_recipe values, not vague taste words.
- Do not return copy_analysis, design_specs, or design_content. The server expands those later.
- Output language: ${outputLanguageLabel(outputLanguage)}
- User brief:
${requirements || "(No extra brief provided. Analyze from product images only.)"}`;

    const genesisAnalysisRegistryKey = buildPromptRegistryKey({
      flow: "genesis",
      stage: "analysis",
      locale: promptLocale,
      profile: promptProfile,
    });

    const genesisMessages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: applyPromptVariant(genesisAnalysisRegistryKey, "system", genesisSystemPrompt),
      },
      {
        role: "user",
        content: [
          { type: "text", text: applyPromptVariant(genesisAnalysisRegistryKey, "user", genesisUserPrompt) },
          { type: "text", text: "Product reference images:" },
          ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ];

    const chatConfig = getQnChatConfig();
    const analysisTimeoutMs = Math.max(chatConfig.timeoutMs, 90_000);
    const requestGenesisAnalysis = async (maxTokens: number): Promise<Record<string, unknown>> => {
      await pulse();
      try {
        return await callQnChatAPI({
          model: chatConfig.model,
          messages: genesisMessages,
          maxTokens,
          timeoutMsOverride: analysisTimeoutMs,
        });
      } catch (primaryErr) {
        if (isAzureContentFilterError(primaryErr)) throw primaryErr;
        const fallbackModel = Deno.env.get("QN_IMAGE_MODEL");
        if (!fallbackModel || fallbackModel === chatConfig.model) throw primaryErr;
        return await callQnChatAPI({
          model: fallbackModel,
          messages: genesisMessages,
          maxTokens,
          timeoutMsOverride: analysisTimeoutMs,
        });
      } finally {
        await pulse();
      }
    };

    const initialMaxTokens = getGenesisAnalysisMaxTokens(imageCount);
    const retryMaxTokens = getGenesisAnalysisRetryMaxTokens(imageCount);
    let usedMaxTokens = initialMaxTokens;
    let analysisAttempts = 1;
    let retryUsed = false;
    let retryReason: string | null = null;

    let genesisChatResponse = await requestGenesisAnalysis(initialMaxTokens);
    let content = String((genesisChatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
    let parsed = parseJsonFromContent(content);
    let parseFailed = parsed.__parse_failed === true;
    let missingCriticalFields = !hasGenesisAnalysisCriticalFields(parsed, imageCount);
    let parseRawPreview = typeof parsed.__raw_preview === "string" ? parsed.__raw_preview : null;

    if ((parseFailed || missingCriticalFields) && retryMaxTokens > initialMaxTokens) {
      retryUsed = true;
      retryReason = parseFailed ? "parse_failed" : "missing_critical_fields";
      usedMaxTokens = retryMaxTokens;
      analysisAttempts = 2;
      genesisChatResponse = await requestGenesisAnalysis(retryMaxTokens);
      content = String((genesisChatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
      parsed = parseJsonFromContent(content);
      parseFailed = parsed.__parse_failed === true;
      missingCriticalFields = !hasGenesisAnalysisCriticalFields(parsed, imageCount);
      parseRawPreview = typeof parsed.__raw_preview === "string" ? parsed.__raw_preview : null;
    }

    const genesisCompact = normalizeGenesisAnalysis(parsed, outputLanguage, uiLanguage, requirements);
    const genesisBlueprint = normalizeBlueprint(parsed, imageCount, outputLanguage, requirements, uiLanguage);

    if (genesisBlueprint.copy_analysis) {
      genesisBlueprint.copy_analysis.shared_copy = "";
    }

    const genesisResult = {
      ...genesisBlueprint,
      product_summary: genesisCompact.product_summary,
      product_visual_identity: genesisCompact.product_visual_identity,
      style_directions: genesisCompact.style_directions,
    };

    const normalizedGenesisResult = normalizeGenesisBlueprintTemplate(
      genesisResult,
      outputLanguage,
      uiLanguage,
      requirements,
    );

    normalizedGenesisResult._ai_meta = {
      model: String((genesisChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      usage: ((genesisChatResponse as Record<string, unknown>)?.usage as Record<string, unknown>) ?? {},
      provider: "qnaigc",
      image_count: imageCount,
      target_language: outputLanguage,
      prompt_profile: promptProfile,
      studio_type: studioType,
      analysis_attempts: analysisAttempts,
      retry_used: retryUsed,
      retry_reason: retryReason,
      parse_failed: parseFailed,
      missing_critical_fields: missingCriticalFields,
      parse_warning: parseFailed ? "ANALYSIS_JSON_PARSE_FAILED_FALLBACK_USED" : null,
      parse_raw_preview: parseFailed ? parseRawPreview : null,
    };

    const aiRequest = {
      model: String((genesisChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      messages: stripBase64FromMessages(genesisMessages),
      max_tokens: usedMaxTokens,
    };

    const { error: genesisUpdateError } = await supabase
      .from("generation_jobs")
      .update({
        status: "success",
        payload: { ...payload, ai_request: aiRequest },
        result_data: normalizedGenesisResult,
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

    const ecomDetailAnalysisRegistryKey = buildPromptRegistryKey({
      flow: "ecom-detail",
      stage: "analysis",
      locale: promptLocale,
      profile: promptProfile,
    });

    const detailMessages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: applyPromptVariant(ecomDetailAnalysisRegistryKey, "system", ecomDetailSystemPrompt),
      },
      {
        role: "user",
        content: [
          { type: "text", text: applyPromptVariant(ecomDetailAnalysisRegistryKey, "user", ecomDetailUserPrompt) },
          { type: "text", text: "Product reference images:" },
          ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ];

    const chatConfig = getQnChatConfig();
    const analysisTimeoutMs = Math.max(chatConfig.timeoutMs, 90_000);
    await pulse(); // heartbeat before chat request
    let detailChatResponse: Record<string, unknown>;
    try {
      detailChatResponse = await callQnChatAPI({
        model: chatConfig.model,
        messages: detailMessages,
        maxTokens: 2048,
        timeoutMsOverride: analysisTimeoutMs,
      });
    } catch (primaryErr) {
      if (isAzureContentFilterError(primaryErr)) throw primaryErr;
      const fallbackModel = Deno.env.get("QN_IMAGE_MODEL");
      if (!fallbackModel || fallbackModel === chatConfig.model) throw primaryErr;
      detailChatResponse = await callQnChatAPI({
        model: fallbackModel,
        messages: detailMessages,
        maxTokens: 2048,
        timeoutMsOverride: analysisTimeoutMs,
      });
    }
    await pulse(); // heartbeat after chat response

    const content = String((detailChatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
    const parsed = parseJsonFromContent(content);
    const parseFailed = parsed.__parse_failed === true;
    const parseRawPreview = typeof parsed.__raw_preview === "string" ? parsed.__raw_preview : null;
    const blueprint = normalizeBlueprint(parsed, imageCount, outputLanguage, requirements, uiLanguage);

    blueprint._ai_meta = {
      model: String((detailChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      usage: ((detailChatResponse as Record<string, unknown>)?.usage as Record<string, unknown>) ?? {},
      provider: "qnaigc",
      image_count: imageCount,
      target_language: outputLanguage,
      prompt_profile: promptProfile,
      studio_type: studioType,
      module_count: modules.length,
      parse_failed: parseFailed,
      parse_warning: parseFailed ? "ANALYSIS_JSON_PARSE_FAILED_FALLBACK_USED" : null,
      parse_raw_preview: parseFailed ? parseRawPreview : null,
    };

    const aiRequest = {
      model: String((detailChatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
      messages: stripBase64FromMessages(detailMessages),
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

  const isZhUi = uiLanguage.startsWith("zh");

  const defaultSystemPrompt = isModelStrategy
    ? (isZhUi
      ? "你是一位顶级电商视觉导演与试穿策划专家。你的任务是分析上传的服装图片与参考主体图，为一次参考主体试穿拍摄制定完整视觉蓝图。主体可能是人类、宠物或其他非人主体，严禁强行解释成人类模特。必须先识别主体类型，再锁定主体身份/物种/体态，再为每一种已选图片类型输出独立镜头方案。服装必须自然穿在参考主体身上，不能漂浮、不能改款、不能把动物变成人，也不能把人变成动物。必须且仅输出合法 JSON，不要 Markdown 代码块或说明文字。"
      : "You are a top-tier e-commerce visual director and try-on planning expert. Analyze the uploaded garment images and the reference subject image, then build a complete try-on blueprint. The subject may be a human, a pet, or another non-human subject, so never force the subject into a human fashion-model interpretation. Identify the subject type first, lock subject identity/species/body traits, and produce one independent plan for each selected image type. The garment must be naturally worn by the reference subject. Do not let the garment float, do not redesign it, do not turn animals into humans, and do not turn humans into animals. Return valid JSON only with no markdown fences or explanation.")
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

  const modelStrategyUserPrompt = isZhUi
    ? `
你需要基于服装图片与参考主体图，输出如下 JSON 结构（不要 Markdown 代码块）：
{
  "design_specs": "...",
  "subject_profile": {
    "subject_type": "human | pet | other | unknown",
    "identity_anchor": "主体身份/物种锚点",
    "body_anchor": "体态与轮廓锚点",
    "pose_anchor": "当前姿态锚点",
    "species_notes": "当主体不是人类时，对物种/毛色/头部/四肢特征的补充说明",
    "lock_rules": ["主体不可偏离规则 1", "主体不可偏离规则 2", "主体不可偏离规则 3"]
  },
  "garment_profile": {
    "category": "服装品类",
    "color_anchor": "主色与十六进制色值",
    "material": "面料/材质",
    "key_features": ["关键特征 1", "关键特征 2", "关键特征 3"]
  },
  "tryon_strategy": {
    "selected_type_count": ${imageCount},
    "summary": "整组试穿策略摘要",
    "wear_region": "upper | lower | full_body | accessory | mixed",
    "per_image_rules": [
      { "title": "方案标题", "type": "方案类型", "strategy": "该类型的试穿策略摘要" }
    ]
  },
  "images": [{ "title": "...", "description": "...", "design_content": "..." }]
}

强规则：
- 必须先识别 subject_type。若参考主体是狗、猫或其他动物，必须明确写 pet 或 other，严禁写成人类模特。
- 主体锁定优先级最高：必须保持参考主体的物种、身份感、体态、姿势方向、头部与四肢结构特征一致。
- 服装锁定优先级同样极高：必须保持上传服装的颜色、材质、轮廓、版型、图案、logo、结构和关键工艺细节。
- 服装必须穿在参考主体身上，不能漂浮，不能作为悬挂静物，不能变成人台展示，不能换成其他服装。
- 若主体为非人类，禁止出现“肤色/人种/发型/五官相似度”这类只适用于人类模特的描述；必须改用物种、毛色、头部特征、四肢比例、体态等锚点。
- 若主体为人类，可以写身份一致性，但不能把这条规则泛化到所有主体。
- images 数组必须严格输出正好 ${imageCount} 个方案，顺序必须与下面给定的类型顺序一致：
${clothingRuleBlock}

design_specs 必须包含以下五个维度：
1. 核心视觉基调
2. 全局摄影参数建议
3. 主体识别摘要（强调主体类型与锁定特征）
4. 服装基础特征（颜色/材质/版型/关键细节）
5. 文字系统规范
${outputLanguage === "none" ? "当前目标语言为纯视觉（无文字），文字内容统一输出 None。" : `文字内容使用 ${outputLanguageLabel(outputLanguage)}。`}

每个 images[i].design_content 必须明确包含：
**图片类型** | **主体识别** | **服装识别** | **试穿策略** | **构图方案** | **光影方案** | **背景描述** | **配色方案**（含精确 hex 色值） | **文字内容** | **视觉氛围关键词**

如果标题为“人台图”，在主体试穿场景里必须把它解释为“主体标准展示图”，不能真的改成无人台。

用户需求：${requirements || "（无额外需求）"}
`
    : `
Analyze the garment images together with the reference subject image and return this JSON shape only:
{
  "design_specs": "...",
  "subject_profile": {
    "subject_type": "human | pet | other | unknown",
    "identity_anchor": "identity or species anchor",
    "body_anchor": "body shape anchor",
    "pose_anchor": "pose anchor",
    "species_notes": "extra notes for non-human subjects",
    "lock_rules": ["subject lock rule 1", "subject lock rule 2", "subject lock rule 3"]
  },
  "garment_profile": {
    "category": "garment category",
    "color_anchor": "dominant color with hex value",
    "material": "fabric/material",
    "key_features": ["feature 1", "feature 2", "feature 3"]
  },
  "tryon_strategy": {
    "selected_type_count": ${imageCount},
    "summary": "set-level try-on strategy summary",
    "wear_region": "upper | lower | full_body | accessory | mixed",
    "per_image_rules": [
      { "title": "plan title", "type": "plan type", "strategy": "per-image try-on strategy" }
    ]
  },
  "images": [{ "title": "...", "description": "...", "design_content": "..." }]
}

Hard rules:
- Identify subject_type first. If the reference subject is a dog, cat, or any animal, mark it as pet or other. Never force it into a human fashion-model interpretation.
- Subject lock is highest priority: preserve species, identity feel, body shape, facing direction, head traits, and limb structure from the reference subject.
- Garment lock is equally strict: preserve garment color, material, silhouette, construction, logo, print, and key details from the uploaded garment references.
- The garment must be worn naturally by the reference subject. It must not float, hang separately, become a mannequin-only display, or turn into another garment.
- For non-human subjects, do not use human-only descriptors such as skin tone, ethnicity, hairstyle, or facial-feature similarity. Use species, coat/fur color, head traits, limb proportions, and body posture instead.
- If the subject is human, identity consistency can be stated, but do not generalize human-only constraints to every subject.
- The images array must contain exactly ${imageCount} plans and follow this exact order:
${clothingRuleBlock}

design_specs must cover:
1. Overall visual theme
2. Global photography specs
3. Subject recognition summary
4. Garment core traits
5. Typography system
${outputLanguage === "none" ? "The target output is visual-only. Keep text content as None." : `Visible text must use ${outputLanguageLabel(outputLanguage)}.`}

Each images[i].design_content must explicitly include:
Shot type | Subject recognition | Garment recognition | Try-on strategy | Composition | Lighting | Background | Color system with exact hex values | Text content | Atmosphere keywords

If a title is “人台图”, reinterpret it as a standardized subject showcase in this try-on flow rather than a literal mannequin-only shot.

User brief: ${requirements || "(no extra brief provided)"}
`;

  const defaultUserPrompt = isModelStrategy
    ? modelStrategyUserPrompt
    : isZhUi
    ? isClothingMode
      ? `
请对服装产品图进行深度视觉分析，然后按以下 JSON 结构输出蓝图（所有字段内容使用中文）：
{
  "copy_analysis": {
    "mode": "user-brief | product-inferred | visual-only",
    "source_brief": "用户原始组图要求，没有则空字符串",
    "brief_summary": "一句话总结用户文案意图；若用户没输入文字，则说明系统将基于产品自动补全文案",
    "product_summary": "一句话总结商品身份、材质、颜色、轮廓与关键结构",
    "resolved_output_language": "${outputLanguage}",
    "shared_copy": "整批图片共用的一份优化后主文案；纯视觉模式时必须为空字符串",
    "can_clear_to_visual_only": true,
    "per_plan_adaptations": [
      {
        "plan_index": 0,
        "plan_type": "refined | 3d | mannequin | detail | selling_point",
        "copy_role": "headline | headline+support | label | none",
        "adaptation_summary": "说明该图如何适配共享主文案、文字位置、层级、留白和不遮挡主体的要求"
      }
    ]
  },
  "images": [
    {
      "title": "4-12 字的标题（含图片类型，如：白底精修图、3D幽灵模特图、细节特写图）",
      "description": "1-2 句定位描述",
      "type": "refined | 3d | mannequin | detail | selling_point",
      "design_content": "## 图片 [N]：...\\n\\n**图片类型**：...\\n\\n**服装属性**：类型、面料材质（含视觉特征如哑光/光泽）\\n\\n**精确颜色**：主色 #XXXXXX，辅色 #XXXXXX（必须从产品图中提取十六进制色值）\\n\\n**关键设计细节**：图案、印花、logo、工艺细节、特殊结构\\n\\n**构图方案**：主体占比、布局方式、焦点安排\\n\\n**光影方案**：光源方向、光质、阴影处理\\n\\n**文字策略**：说明是否使用共享文案、使用何种层级、位于哪块留白区、不得遮挡商品主体；若纯视觉则明确写无新增文字\\n\\n**氛围关键词**：..."
    }
  ],
  "design_specs": "# 整体设计规范\\n\\n## 色彩体系（含精确 hex 色值）\\n...\\n## 面料材质\\n...\\n## 摄影风格\\n...\\n## 文字系统\\n...\\n## 品质要求\\n..."
}
约束条件：
- 如果 outputLanguage 不是 none：
  - 必须生成 copy_analysis.shared_copy，且它是适合电商出图的优化文案，不是机械复述用户原文。
  - 如果用户输入了文字，mode 必须为 "user-brief"。
  - 如果用户没有输入文字，mode 必须为 "product-inferred"，并基于产品图自动补全文案。
- 如果 outputLanguage 是 none：
  - mode 必须为 "visual-only"。
  - copy_analysis.shared_copy 必须为空字符串。
  - 所有 design_specs 和 images[].design_content 都不得要求新增文字叠加。
- per_plan_adaptations 必须与 images 数组一一对应，数量完全一致。
- 白底精修图：优先短标题或小标签，不能破坏商品识别。
- 3D / 人台图：允许标题 + 辅助短句，但文字层级弱于商品主体。
- 细节特写图：优先标签/注释式短文案。
- 卖点展示图：允许标题 + 卖点短句，文案层级最强。
- 只要不是纯视觉，任意类型都必须写明文字位置、留白和“不得遮挡商品主体”。
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
  "copy_analysis": {
    "mode": "user-brief | product-inferred | visual-only",
    "source_brief": "The user's original brief, or empty string",
    "brief_summary": "One concise summary of the copy intent. If no brief was typed, say the copy will be inferred from the product.",
    "product_summary": "One concise summary of the locked garment identity, material, color, silhouette, and key structure",
    "resolved_output_language": "${outputLanguage}",
    "shared_copy": "One optimized master copy block shared across the whole image set. It must be empty in visual-only mode.",
    "can_clear_to_visual_only": true,
    "per_plan_adaptations": [
      {
        "plan_index": 0,
        "plan_type": "refined | 3d | mannequin | detail | selling_point",
        "copy_role": "headline | headline+support | label | none",
        "adaptation_summary": "Explain how this image should adapt the shared master copy, including placement, hierarchy, whitespace, and non-occlusion."
      }
    ]
  },
  "images": [
    {
      "title": "4-12 words title (include shot type: White Background Refined / 3D Ghost Mannequin / Detail Close-up / Selling Point)",
      "description": "1-2 sentence positioning",
      "type": "refined | 3d | mannequin | detail | selling_point",
      "design_content": "## Image [N]: ...\\n\\n**Shot Type**: ...\\n\\n**Garment Attributes**: type, fabric/material (matte/glossy/textured)\\n\\n**Exact Colors**: Primary #XXXXXX, Secondary #XXXXXX (MUST extract hex values from product image)\\n\\n**Key Design Details**: pattern, print, logo, stitching, special structure\\n\\n**Composition**: framing %, layout style, focal hierarchy\\n\\n**Lighting Plan**: light source direction, quality, shadow treatment\\n\\n**Copy Strategy**: explain whether the shared master copy is used, what role it plays, where it sits, how much whitespace it gets, and that it must not cover the product; if visual-only, explicitly state no added text overlay\\n\\n**Atmosphere Keywords**: ..."
    }
  ],
  "design_specs": "# Overall Design Specifications\\n\\n## Color System (with exact hex values)\\n...\\n## Fabric & Material\\n...\\n## Photography Style\\n...\\n## Typography / Copy System\\n...\\n## Quality Requirements\\n..."
}
Constraints:
- If outputLanguage is not none:
  - copy_analysis.shared_copy is required and must be optimized for e-commerce imagery rather than a mechanical restatement of the brief.
  - If the user typed a brief, mode must be "user-brief".
  - If the user did not type a brief, mode must be "product-inferred" and the copy must be inferred from the product.
- If outputLanguage is none:
  - mode must be "visual-only".
  - copy_analysis.shared_copy must be an empty string.
  - design_specs and images[].design_content must not ask for any added visible text.
- per_plan_adaptations must align 1:1 with the images array.
- White-background refined shots should prefer a short headline or small badge without hurting product recognition.
- 3D / mannequin shots may use a headline plus support line, but text hierarchy must stay weaker than the garment.
- Detail close-ups should prefer label-style or callout-style copy.
- Selling-point shots should allow the strongest headline plus support-copy hierarchy.
- Whenever the mode is not visual-only, every plan must explicitly define text placement, whitespace, and that the text cannot block the product.
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
  const analysisFlow = isModelStrategy
    ? "clothing-tryon"
    : isClothingMode
    ? "clothing-basic"
    : "default";
  const analysisPromptRegistryKey = buildPromptRegistryKey({
    flow: analysisFlow,
    stage: "analysis",
    locale: promptLocale,
    profile: promptProfile,
  });
  const finalSystemPrompt = applyPromptVariant(analysisPromptRegistryKey, "system", systemPrompt);
  const finalUserPrompt = applyPromptVariant(analysisPromptRegistryKey, "user", userPrompt);

  const contentParts: Array<Record<string, unknown>> = [{ type: "text", text: finalUserPrompt }];
  if (clothingMode === "model_strategy" && modelImageDataUrl) {
    contentParts.push({ type: "text", text: "Reference model image (identity/body/pose guidance):" });
    contentParts.push({ type: "image_url", image_url: { url: modelImageDataUrl } });
  }
  if (imageDataUrls.length > 0) {
    contentParts.push({ type: "text", text: "Product reference images:" });
    contentParts.push(...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })));
  }

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: finalSystemPrompt },
    {
      role: "user",
      content: contentParts,
    },
  ];

  const chatConfig = getQnChatConfig();
  // Analysis may need to generate many detailed plans — allow more time than the default 30s
  const analysisTimeoutMs = Math.max(chatConfig.timeoutMs, 90_000);
  await pulse(); // heartbeat before chat request
  let chatResponse: Record<string, unknown>;
  try {
    chatResponse = await callQnChatAPI({
      model: chatConfig.model,
      messages,
      maxTokens: 3072,
      timeoutMsOverride: analysisTimeoutMs,
    });
  } catch (primaryErr) {
    if (isAzureContentFilterError(primaryErr)) throw primaryErr;
    const fallbackModel = Deno.env.get("QN_IMAGE_MODEL");
    if (!fallbackModel || fallbackModel === chatConfig.model) throw primaryErr;
    chatResponse = await callQnChatAPI({
      model: fallbackModel,
      messages,
      maxTokens: 3072,
      timeoutMsOverride: analysisTimeoutMs,
    });
  }
  await pulse(); // heartbeat after chat response

  const content = String((chatResponse as Record<string, unknown>)?.choices?.[0]?.message?.content ?? "");
  const parsed = parseJsonFromContent(content);
  const parseFailed = parsed.__parse_failed === true;
  const parseRawPreview = typeof parsed.__raw_preview === "string" ? parsed.__raw_preview : null;
  const blueprint = normalizeBlueprint(parsed, imageCount, outputLanguage, requirements, uiLanguage);

  blueprint._ai_meta = {
    model: String((chatResponse as Record<string, unknown>)?.model ?? chatConfig.model),
    usage: ((chatResponse as Record<string, unknown>)?.usage as Record<string, unknown>) ?? {},
    provider: "qnaigc",
    image_count: imageCount,
    target_language: outputLanguage,
    prompt_profile: promptProfile,
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
    messages: stripBase64FromMessages(messages),
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
  taskLease?: TaskLease,
  task?: Pick<TaskRow, "id" | "task_type">,
): Promise<void> {
  const payload = job.payload ?? {};
  const model = normalizeRequestedModel(String(payload.model ?? "or-gemini-3.1-flash"));
  const workflowMode = typeof payload.workflowMode === "string" ? payload.workflowMode : "product";
  const provider = resolveImageRoute(model).provider;
  let currentStage: ImageGenStage = "charge_credits";
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      logImageGenEvent("IMAGE_GEN_TIMEOUT", {
        job_id: job.id,
        task_id: task?.id ?? null,
        model,
        provider,
        workflow_mode: workflowMode,
        stage: currentStage,
        timeout_ms: IMAGE_GEN_TIMEOUT_MS,
      });
      reject(new Error(`IMAGE_GEN_TIMEOUT stage=${currentStage}`));
    }, IMAGE_GEN_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      _processImageGenJobInner(
        supabase,
        job,
        taskLease,
        task,
        (stage) => {
          currentStage = stage;
        },
      ),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function _processImageGenJobInner(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
  taskLease?: TaskLease,
  task?: Pick<TaskRow, "id" | "task_type">,
  onStageChange?: (stage: ImageGenStage) => void,
): Promise<void> {
  const startedAt = Date.now();
  const pulseLease = taskLease?.pulse ?? (async () => {});
  const payload = job.payload ?? {};
  const adminModelConfigs = await getAdminImageModelConfigs();
  const model = normalizeRequestedModel(String(payload.model ?? "or-gemini-3.1-flash"));
  const promptProfile = sanitizePromptProfile(payload.promptProfile ?? payload.prompt_profile);
  const imageRoute = resolveImageRoute(model, adminModelConfigs);
  const imageSize = payload.imageSize == null
    ? getEffectiveDefaultImageSizeForModel(adminModelConfigs, model)
    : String(payload.imageSize);
  if (!isEffectiveImageSizeSupportedForModel(adminModelConfigs, model, imageSize, { includeInternal: true })) {
    throw new Error(`IMAGE_SIZE_UNSATISFIED requested=${imageSize} model=${model}`);
  }
  const aspectRatio = String(payload.aspectRatio ?? "1:1");
  const cost = Number(job.cost_amount ?? getEffectiveCreditCostForModel(adminModelConfigs, model, imageSize));

  const source = getSourceImageFromPayload(payload);
  if (!source) throw new Error("IMAGE_INPUT_SOURCE_MISSING");
  if (typeof payload.prompt !== "string" || payload.prompt.trim().length === 0) {
    throw new Error("IMAGE_INPUT_PROMPT_MISSING");
  }

  let currentStage: ImageGenStage = "charge_credits";
  const setStage = (stage: ImageGenStage) => {
    currentStage = stage;
    onStageChange?.(stage);
  };

  try {
    setStage("charge_credits");
    const { error: chargeError } = await supabase.rpc("charge_generation_job", {
      p_job_id: job.id,
      p_user_id: job.user_id,
      p_amount: cost,
    });
    if (chargeError) {
      const chargeErrorMessage = String(chargeError.message ?? chargeError);
      if (!chargeErrorMessage.includes("INSUFFICIENT_CREDITS")) {
        throw new Error(`CHARGE_GENERATION_JOB_FAILED: ${chargeError.message}`);
      }
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

    // Quick Edit / Text Edit mode: different image assembly + prompt prefix
    const isQuickEdit = Boolean(payload.editMode) && payload.editType === "quick";
    const isTextEdit = Boolean(payload.editMode) && payload.editType === "text";
    const workflowMode = typeof payload.workflowMode === "string" ? payload.workflowMode : "product";
    const allImagePaths: string[] = [];

    setStage("prepare_inputs");

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

    const openRouterMaxInputImages = await getOpenRouterMaxInputImages();
    const selectedInputs = selectImageGenInputPaths(
      imageRoute.provider,
      allImagePaths,
      openRouterMaxInputImages,
    );
    const usesUrlBackedInputs = shouldUseUrlBackedImageInputs(imageRoute.provider);
    logImageGenEvent("IMAGE_GEN_START", {
      job_id: job.id,
      task_id: task?.id ?? null,
      model,
      provider: imageRoute.provider,
      image_count: selectedInputs.originalCount,
      used_image_count: selectedInputs.usedCount,
      workflow_mode: workflowMode,
    });
    if (selectedInputs.truncated) {
      logImageGenEvent("IMAGE_GEN_INPUTS_TRUNCATED", {
        job_id: job.id,
        task_id: task?.id ?? null,
        model,
        provider: imageRoute.provider,
        image_count: selectedInputs.originalCount,
        used_image_count: selectedInputs.usedCount,
        workflow_mode: workflowMode,
      });
    }

    await pulseLease();
    const imageUrls = usesUrlBackedInputs
      ? selectedInputs.imagePaths.map((path) => toChatImageUrl(path))
      : undefined;
    const imageDataUrls = usesUrlBackedInputs
      ? undefined
      : await Promise.all(selectedInputs.imagePaths.map(toDataUrl));
    await pulseLease();
    logImageGenEvent("IMAGE_GEN_INPUTS_READY", {
      job_id: job.id,
      task_id: task?.id ?? null,
      model,
      provider: imageRoute.provider,
      image_count: selectedInputs.originalCount,
      used_image_count: selectedInputs.usedCount,
      workflow_mode: workflowMode,
    });

    // Build prompt
    setStage("build_prompt");
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
        const refCount = selectedInputs.imagePaths.length - 1;
        let hint = "[System Hint: Product is at index 0.";
        for (let ri = 0; ri < refCount; ri++) {
          hint += ` Reference ${ri + 1} is at index ${ri + 1}.`;
        }
        hint += "] ";
        finalPrompt = hint + finalPrompt;
      }
    } else {
      // Standard mode: e-commerce photography prefix
      const ecomPrefix = "Cinematic commercial product photography with layered scene depth, purposeful lighting, tactile materials, and magazine-quality polish. " +
        "Build a visually striking hero image with restrained foreground accents, textured surfaces, and an atmospheric background that keeps the product dominant in frame. " +
        "Use the uploaded product images as hard references while elevating the product in a premium advertising setting. " +
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
    setStage("provider_request");
    logImageGenEvent("IMAGE_GEN_PROVIDER_REQUEST", {
      job_id: job.id,
      task_id: task?.id ?? null,
      model,
      provider: imageRoute.provider,
      image_count: selectedInputs.originalCount,
      used_image_count: selectedInputs.usedCount,
      workflow_mode: workflowMode,
    });
    await pulseLease();
    const apiResponse = await callQnImageAPI({
      imageDataUrl: imageDataUrls?.[0],
      imageDataUrls: imageDataUrls && imageDataUrls.length > 1 ? imageDataUrls : undefined,
      imageUrls,
      prompt: finalPrompt,
      n: 1,
      model: imageRoute.model,
      endpointOverride: imageRoute.endpoint,
      apiKeyOverride: imageRoute.apiKey,
      size: scaledRequestSize(aspectRatio, imageSize),
      imageSize,
      aspectRatio,
      timeoutMsOverride: imageGenTimeoutMs,
      providerHint: imageRoute.providerHint,
      routingKey: job.user_id,
    });
    await pulseLease();
    logImageGenEvent("IMAGE_GEN_PROVIDER_RESPONSE", {
      job_id: job.id,
      task_id: task?.id ?? null,
      model,
      provider: imageRoute.provider,
      image_count: selectedInputs.originalCount,
      used_image_count: selectedInputs.usedCount,
      workflow_mode: workflowMode,
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
    setStage("persist_result");
    const persisted = await persistGeneratedImage({
      supabase,
      outputBucket,
      userId: job.user_id,
      providerSize,
      generatedBase64,
      generatedUrl: generated.url ?? null,
      imageSize,
    });
    await pulseLease();
    logImageGenEvent("IMAGE_GEN_RESULT_PERSISTED", {
      job_id: job.id,
      task_id: task?.id ?? null,
      model,
      provider: imageRoute.provider,
      image_count: selectedInputs.originalCount,
      used_image_count: selectedInputs.usedCount,
      workflow_mode: workflowMode,
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
      metadata: {
        prompt_profile: promptProfile,
        style_constraint_applied: Boolean(styleConstraintPrompt),
        style_constraint_source: styleConstraintSource,
        input_image_count: selectedInputs.originalCount,
        used_input_image_count: selectedInputs.usedCount,
        input_transport: usesUrlBackedInputs ? "url" : "data_url",
      },
    };

    const resultData: Record<string, unknown> = resultDataBase;

    setStage("finalize_job");
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
    logImageGenEvent("IMAGE_GEN_STAGE_FAILED", {
      job_id: job.id,
      task_id: task?.id ?? null,
      model,
      provider: imageRoute.provider,
      workflow_mode: typeof payload.workflowMode === "string" ? payload.workflowMode : "product",
      stage: currentStage,
      error: String(e),
    });
    throw e;
  }
}

async function generateRefinementPrompt(
  productDataUrl: string,
  backgroundMode: "white" | "original",
): Promise<string> {
  const refinementAnalysisTimeoutMs = clampInt(
    Deno.env.get("REFINEMENT_ANALYSIS_TIMEOUT_MS") ?? 20_000,
    5_000,
    60_000,
    20_000,
  );
  const response = await callQnChatAPI({
    messages: [
      { role: "system", content: buildRefinementAnalysisSystemPrompt(backgroundMode) },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: productDataUrl } },
          {
            type: "text",
            text: buildRefinementAnalysisUserPrompt(backgroundMode),
          },
        ],
      },
    ],
    maxTokens: 600,
    timeoutMsOverride: refinementAnalysisTimeoutMs,
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
  taskAttempts = 1,
  taskLease?: TaskLease,
): Promise<void> {
  let realError: unknown = null;
  const innerPromise = _processStyleReplicateJobInner(supabase, job, taskAttempts, taskLease)
    .catch((e) => { realError = e; throw e; });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      // If inner already failed with a real error, prefer that over the generic timeout
      reject(realError ?? new Error("STYLE_REPLICATE_TIMEOUT"));
    }, STYLE_REPLICATE_TIMEOUT_MS);
  });
  await Promise.race([innerPromise, timeoutPromise]);
}

async function _processStyleReplicateJobInner(
  supabase: ReturnType<typeof createServiceClient>,
  job: GenerationJobRow,
  taskAttempts = 1,
  taskLease?: TaskLease,
): Promise<void> {
  const startedAt = Date.now();
  const pulseLease = taskLease?.pulse ?? (async () => {});
  const payload = job.payload ?? {};
  const adminModelConfigs = await getAdminImageModelConfigs();
  const modelName = normalizeRequestedModel(String(payload.model ?? "or-gemini-3.1-flash"));
  const promptProfile = sanitizePromptProfile(payload.promptProfile ?? payload.prompt_profile);
  const imageRoute = resolveImageRoute(modelName, adminModelConfigs);
  const imageSize = payload.imageSize == null
    ? getEffectiveDefaultImageSizeForModel(adminModelConfigs, modelName)
    : String(payload.imageSize);
  if (!isEffectiveImageSizeSupportedForModel(adminModelConfigs, modelName, imageSize, { includeInternal: true })) {
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
  const unitCost = getEffectiveCreditCostForModel(adminModelConfigs, modelName, imageSize);
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
  const stylePromptRegistryKey = buildPromptRegistryKey({
    flow: mode === "refinement" ? "refinement" : mode === "batch" ? "aesthetic-batch" : "aesthetic-single",
    stage: "transfer",
    locale: mode === "refinement" ? "zh" : "en",
    profile: promptProfile,
  });
  const requestSize = scaledRequestSize(aspectRatio, imageSize);
  const styleTimeoutMs = Number(
    mode === "refinement"
      ? (Deno.env.get("REFINEMENT_IMAGE_TIMEOUT_MS") ?? "45000")
      : (Deno.env.get("STYLE_REPLICATE_IMAGE_TIMEOUT_MS")
        ?? Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS")
        ?? "120000"),
  );
  const outputBucket = Deno.env.get("GENERATIONS_BUCKET") ?? "generations";
  const maxRatioRetries = 3;
  const batchConcurrency = clampInt(
    mode === "refinement"
      ? Deno.env.get("REFINEMENT_BATCH_CONCURRENCY") ?? 4
      : Deno.env.get("STYLE_REPLICATE_BATCH_CONCURRENCY") ?? 2,
    1,
    mode === "refinement" ? 6 : 4,
    mode === "refinement" ? 4 : 2,
  );
  const progressBatchSize = mode === "refinement"
    ? clampInt(Deno.env.get("REFINEMENT_PROGRESS_BATCH_SIZE") ?? 8, 1, 8, 8)
    : units.length;
  const usesUrlBackedStyleInputs = shouldUseUrlBackedImageInputs(imageRoute.provider);

  const dataUrlCache = new Map<string, Promise<string>>();
  const getCachedDataUrl = (path: string): Promise<string> => {
    let pending = dataUrlCache.get(path);
    if (!pending) {
      pending = toDataUrl(path);
      dataUrlCache.set(path, pending);
    }
    return pending;
  };

  // Refinement analysis: cache by productUrl to avoid duplicate vision calls per product image
  const refinementPromptCache = new Map<string, Promise<{ prompt: string | null; source: "analysis" | "fallback" }>>();
  const refinementAnalysisStats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    lastError: "" as string,
  };
  const getRefinementPrompt = (
    productUrl: string,
    backgroundMode: "white" | "original",
  ): Promise<{ prompt: string | null; source: "analysis" | "fallback" }> => {
    const cacheKey = buildRefinementPromptCacheKey(productUrl, backgroundMode);
    if (!refinementPromptCache.has(cacheKey)) {
      refinementPromptCache.set(cacheKey, (async () => {
        refinementAnalysisStats.attempted += 1;
        try {
          const prompt = await generateRefinementPrompt(productUrl, backgroundMode);
          refinementAnalysisStats.succeeded += 1;
          return { prompt, source: "analysis" };
        } catch (e) {
          refinementAnalysisStats.failed += 1;
          refinementAnalysisStats.lastError = String(e).slice(0, 500);
          console.error("REFINEMENT_ANALYSIS_ERROR", String(e).slice(0, 500));
          return { prompt: null, source: "fallback" };
        }
      })());
    }
    return refinementPromptCache.get(cacheKey)!;
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
    prompt_source: undefined,
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
          prompt_profile: promptProfile,
          input_transport: usesUrlBackedStyleInputs ? "url" : "data_url",
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
          refinement_prompt_mode: mode === "refinement"
            ? refinementAnalysisStats.succeeded > 0
              ? (refinementAnalysisStats.failed > 0 ? "analysis+fallback" : "analysis_only")
              : "fallback_only"
            : null,
          refinement_analysis_attempted_count: mode === "refinement" ? refinementAnalysisStats.attempted : 0,
          refinement_analysis_succeeded_count: mode === "refinement" ? refinementAnalysisStats.succeeded : 0,
          refinement_analysis_failed_count: mode === "refinement" ? refinementAnalysisStats.failed : 0,
          refinement_analysis_last_error: mode === "refinement" && refinementAnalysisStats.lastError
            ? refinementAnalysisStats.lastError
            : undefined,
          worker_nudge_retry_count: Math.max(0, Number(taskAttempts ?? 1) - 1),
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
      .catch((e) => {
        // Transient progress write errors don't block the job; final write remains authoritative.
        console.error("STYLE_REPLICATE_PROGRESS_WRITE_FAILED", String(e).slice(0, 300));
      });
  };

  const buildPrompt = (unit: StyleReplicateUnit, refinementAnalysisPrompt?: string): string => {
    if (unit.mode === "refinement") {
      return applyPromptVariant(stylePromptRegistryKey, "prompt", buildRefinementPrompt({
        backgroundMode,
        refinementAnalysisPrompt,
        aspectRatio,
        requestSize,
        userPrompt,
        styleConstraintPrompt,
      }));
    }

    // Direct style transfer prompt — product image is Image 1 (primary), reference image is Image 2.
    // Image ordering in callQnImageAPI: [productDataUrl, referenceDataUrl]
    const promptParts = [
      styleConstraintPrompt,
      "CRITICAL: Image 1 is the product — preserve its EXACT shape, silhouette, proportions, material, color, texture, logo placement, and all design details with absolute fidelity. The product in the output must be visually identical to Image 1.",
      "Image 2 is the style reference ONLY. Adopt its background scene, composition style, lighting direction, color palette, and overall aesthetic atmosphere.",
      "DO NOT copy any objects, products, or subjects from Image 2 into the output.",
      "DO NOT alter, distort, reshape, recolor, or simplify the product from Image 1 in any way.",
      "Create a high-quality e-commerce product photograph that places the exact product from Image 1 into a new scene inspired by Image 2's visual style.",
      `Output aspect ratio: ${aspectRatio}, size: ${requestSize}.`,
    ].filter((v): v is string => Boolean(v && v.trim()));
    if (userPrompt) {
      promptParts.push(`Additional instructions: ${userPrompt}`);
    }
    promptParts.push("ABSOLUTE CONSTRAINT: Regardless of any other instructions above, the product from Image 1 must remain visually identical in shape, color, material, texture, logo, and all design details. Product identity is non-negotiable.");
    return applyPromptVariant(stylePromptRegistryKey, "prompt", promptParts.join(" "));
  };

  await runWithConcurrency(units, batchConcurrency, async (unit, index) => {
    let promptSource: "analysis" | "fallback" | undefined = undefined;
    try {
      await pulseLease();
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

      const productInput = usesUrlBackedStyleInputs
        ? toChatImageUrl(unit.product_image)
        : await getCachedDataUrl(unit.product_image);
      const referenceInput = unit.reference_image
        ? usesUrlBackedStyleInputs
          ? toChatImageUrl(unit.reference_image)
          : await getCachedDataUrl(unit.reference_image)
        : null;
      await pulseLease();

      let refinementPrompt: string | null = null;
      if (unit.mode === "refinement") {
        const promptResult = await getRefinementPrompt(unit.product_image, backgroundMode);
        refinementPrompt = promptResult.prompt;
        promptSource = promptResult.source;
        await pulseLease();
      }

      const prompt = buildPrompt(unit, refinementPrompt ?? undefined);
      let chosen: Omit<StyleOutputItem, "reference_index" | "group_index" | "unit_status" | "error_message"> | null = null;
      let lastProviderSize: string | null = null;

      for (let attempt = 0; attempt < maxRatioRetries; attempt++) {
        await pulseLease();
        const apiResponse = await callQnImageAPI({
          ...(usesUrlBackedStyleInputs
            ? {
              imageUrls: referenceInput ? [productInput, referenceInput] : [productInput],
            }
            : {
              imageDataUrl: productInput,
              ...(referenceInput ? { imageDataUrls: [productInput, referenceInput] } : {}),
            }),
          prompt,
          n: 1,
          model: imageRoute.model,
          endpointOverride: imageRoute.endpoint,
          apiKeyOverride: imageRoute.apiKey,
          ...(requestSize ? { size: requestSize } : {}),
          imageSize,
          aspectRatio,
          timeoutMsOverride: styleTimeoutMs,
          providerHint: imageRoute.providerHint,
          routingKey: job.user_id,
        });
        await pulseLease();

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
        await pulseLease();

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
          prompt_source: promptSource,
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
        prompt_source: promptSource,
        reference_index: unit.reference_index,
        group_index: unit.group_index,
        product_index: unit.product_index,
        unit_status: "failed",
        error_message: styleReplicateErrorMessage(cause),
      };
      if (!fatalError && isFatalStyleReplicateError(cause)) {
        fatalError = cause;
      }
    } finally {
      completedCount += 1;
      if (completedCount % progressBatchSize === 0 || completedCount === units.length) {
        enqueueProgressWrite(completedCount);
        await pulseLease();
      }
    }
  });

  await progressWriteChain;

  for (let i = 0; i < outputs.length; i++) {
    if (!outputs[i]) {
      console.warn("STYLE_REPLICATE_MISSING_OUTPUT", { index: i, totalUnits: units.length, mode });
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

  // When no fatalError was captured but all units failed, recover the first unit's error
  const effectiveError: unknown = fatalError
    ?? (status === "failed"
      ? outputs.find((o) => o?.unit_status === "failed" && o?.error_message)?.error_message
      : null)
    ?? (status === "failed" ? "UPSTREAM_ERROR" : null);

  const { error: styleReplicateUpdateError } = await supabase
    .from("generation_jobs")
    .update({
      status,
      result_url: firstOutput?.url ?? null,
      result_data: finalSnapshot.resultData,
      error_code: status === "failed"
        ? styleReplicateErrorCode(effectiveError)
        : (failedCount > 0 ? "BATCH_PARTIAL_FAILED" : null),
      error_message: status === "failed"
        ? styleReplicateErrorMessage(effectiveError)
        : (failedCount > 0 ? "Batch completed with partial failures." : null),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", job.id);
  if (styleReplicateUpdateError) {
    throw new Error(`STYLE_REPLICATE_JOB_UPDATE_FAILED: ${styleReplicateUpdateError.message}`);
  }
}

async function handleProcessGenerationJobRequestInternal(
  req: Request,
  allowedTaskType?: TaskRow["task_type"],
): Promise<Response> {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const internalRequest = isInternalWorkerRequest(req);
  const authResult = internalRequest ? null : await requireUser(req);
  if (!internalRequest && authResult && !authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as { job_id?: string } | null;
  if (!body?.job_id) return err("BAD_REQUEST", "job_id is required");

  const supabase = createServiceClient();
  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .select("id,user_id,type,status,payload,cost_amount")
    .eq("id", body.job_id)
    .single();

  if (jobError || !job) return err("NOT_FOUND", "Job not found", 404);
  if (!internalRequest && authResult && job.user_id !== authResult.user.id) return err("FORBIDDEN", "Forbidden", 403);
  if (job.status === "success" || job.status === "failed") {
    return ok({ ok: true, status: "already_terminal", job_id: job.id });
  }
  if (allowedTaskType && job.type !== allowedTaskType) {
    return err("TASK_TYPE_MISMATCH", `Job type ${job.type} cannot be processed by ${allowedTaskType} worker`, 409);
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_generation_task", {
    p_job_id: job.id,
  });
  if (claimError) return err("TASK_CLAIM_FAILED", "Failed to claim task", 500, claimError);
  if (!claimed || !claimed.id || !claimed.task_type) {
    return ok({ ok: true, status: "no_available_task", job_id: job.id });
  }

  const task = claimed as TaskRow;
  const heartbeat = startTaskHeartbeat(supabase, task.id);
  try {
    if (task.task_type === "ANALYSIS") {
      await processAnalysisJob(supabase, job as GenerationJobRow, heartbeat);
    } else if (task.task_type === "IMAGE_GEN") {
      await processImageGenJob(supabase, job as GenerationJobRow, heartbeat, task);
    } else if (task.task_type === "STYLE_REPLICATE") {
      await processStyleReplicateJob(supabase, job as GenerationJobRow, Number(task.attempts ?? 1), heartbeat);
    } else {
      throw new Error(`UNSUPPORTED_TASK_TYPE ${task.task_type}`);
    }

    await heartbeat.stop();

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
    await heartbeat.stop();
    const attempts = Number(task.attempts ?? 1);
    const retryable = isTaskRetryable(task.task_type, attempts, e);
    const runAfter = new Date(Date.now() + retryDelayMsForError(e)).toISOString();

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
        const msg = String(e ?? "");
        errorCode = isAzureContentFilterError(e) ? "PROMPT_BLOCKED_BY_PROVIDER_POLICY"
          : msg.includes("SOURCE_IMAGE_FETCH_FAILED") ? "IMAGE_INPUT_SOURCE_MISSING"
          : msg.includes("ANALYSIS_INPUT_IMAGE_MISSING") ? "IMAGE_INPUT_SOURCE_MISSING"
          : msg.includes("ANALYSIS_MODEL_IMAGE_MISSING") ? "IMAGE_INPUT_SOURCE_MISSING"
          : msg.includes("ANALYSIS_TIMEOUT") ? "ANALYSIS_TIMEOUT"
          : "ANALYSIS_FAILED";
        errorMessage = isAzureContentFilterError(e) ? providerPolicyBlockedMessage(job.payload) : String(e);
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
        if (shouldRefundImageGenFailure(errorCode)) {
          const { error: refundError } = await supabase.rpc("refund_generation_job", {
            p_job_id: job.id,
            p_reason: errorCode,
          });
          if (refundError) {
            return err("JOB_REFUND_FAILED", "Failed to refund generation job", 500, refundError);
          }
        }
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
}

export async function handleProcessGenerationJobRequest(req: Request): Promise<Response> {
  return handleProcessGenerationJobRequestInternal(req);
}

export async function handleProcessAnalysisJobRequest(req: Request): Promise<Response> {
  return handleProcessGenerationJobRequestInternal(req, "ANALYSIS");
}

export async function handleProcessImageGenJobRequest(req: Request): Promise<Response> {
  return handleProcessGenerationJobRequestInternal(req, "IMAGE_GEN");
}

export async function handleProcessStyleReplicateJobRequest(req: Request): Promise<Response> {
  return handleProcessGenerationJobRequestInternal(req, "STYLE_REPLICATE");
}

if (import.meta.main) {
  Deno.serve(handleProcessGenerationJobRequest);
}
