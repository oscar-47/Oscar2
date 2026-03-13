import { corsHeaders } from "../_shared/cors.ts";
import { options, err } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { getQnChatConfig, getShuffledChatPool, getQnChatConfigFrom } from "../_shared/qn-image.ts";
import { applyPromptVariant, buildPromptRegistryKey } from "../_shared/prompt-registry.ts";
import { resolvePromptProfile, TA_PRO_PROMPT_PROFILE_FLAG } from "../_shared/prompt-profile.ts";
import { getBooleanSystemConfig } from "../_shared/system-config.ts";

function sanitizeLanguage(value: unknown): string {
  const v = String(value ?? "en").toLowerCase();
  if (["none", "en", "zh", "ja", "ko", "es", "fr", "de", "pt", "ar", "ru"].includes(v)) return v;
  return "en";
}

function normalizeStyleConstraintPrompt(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  return prompt.length > 0 ? prompt : "";
}

function outputLanguageLabel(value: string): string {
  switch (value) {
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

function buildVisibleCopyLanguageRule(value: string, isZh: boolean): string {
  if (value === "none") {
    return isZh
      ? "不得添加任何新增画面文字。"
      : "Do not add any new visible copy.";
  }

  if (value === "zh") {
    return isZh
      ? "所有新增可见文案必须且只能使用简体中文，禁止英文单词、拼音、双语混排，以及 Title、Subtitle、Description、Selling Point、Feature 等英文占位词。该约束覆盖主标题、副标题、说明文案、卖点标签、参数表头、参数值、角标、CTA、保障语、步骤说明、注释、对比标签。产品自身已有的 logo、包装原文、型号、成分表、技术单位不属于新增设计文案。"
      : "All added visible copy must be Simplified Chinese only. Do not use English words, pinyin, bilingual mixing, or placeholder labels such as Title, Subtitle, Description, Selling Point, or Feature. This rule covers headlines, subtitles, body copy, selling-point labels, spec-table headers, spec values, badges, CTAs, guarantee copy, step labels, annotations, and comparison labels. Existing product text such as logos, original packaging text, model numbers, ingredient tables, and technical units is not added design copy.";
  }

  const languageLabel = outputLanguageLabel(value);
  return isZh
    ? `所有新增可见文案必须只使用${languageLabel}，禁止混入其他语言；产品自身已有的 logo、包装原文、型号、成分表、技术单位不属于新增设计文案。`
    : `All added visible copy must use ${languageLabel} only and must not mix in other languages. Existing product text such as logos, original packaging text, model numbers, ingredient tables, and technical units is not added design copy.`;
}

function parseAnalysisRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeGenesisCommercialIntent(value: unknown): GenesisCommercialIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    archetype: compactLine(String(record.archetype ?? "")),
    brief_summary: compactLine(String(record.brief_summary ?? "")),
    visual_tone: compactLine(String(record.visual_tone ?? "")),
    mood_keywords: Array.isArray(record.mood_keywords)
      ? record.mood_keywords.map((item) => compactLine(String(item ?? ""))).filter(Boolean)
      : [],
    composition_bias: compactLine(String(record.composition_bias ?? "")),
    set_treatment: compactLine(String(record.set_treatment ?? "")),
    lighting_bias: compactLine(String(record.lighting_bias ?? "")),
    copy_strategy: compactLine(String(record.copy_strategy ?? "")),
    hero_expression: compactLine(String(record.hero_expression ?? "")),
    hero_layout_archetype: compactLine(String(record.hero_layout_archetype ?? "")),
    text_tension: compactLine(String(record.text_tension ?? "")),
    copy_dominance: compactLine(String(record.copy_dominance ?? "")),
    human_interaction_mode: compactLine(String(record.human_interaction_mode ?? "")),
  };
}

function normalizeGenesisSceneRecipe(value: unknown): GenesisSceneRecipe | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    shot_role: compactLine(String(record.shot_role ?? "")),
    hero_focus: compactLine(String(record.hero_focus ?? "")),
    product_ratio: compactLine(String(record.product_ratio ?? "")),
    layout_method: compactLine(String(record.layout_method ?? "")),
    subject_angle: compactLine(String(record.subject_angle ?? "")),
    support_elements: compactLine(String(record.support_elements ?? "")),
    background_surface: compactLine(String(record.background_surface ?? "")),
    background_elements: compactLine(String(record.background_elements ?? "")),
    decorative_elements: compactLine(String(record.decorative_elements ?? "")),
    lighting_setup: compactLine(String(record.lighting_setup ?? "")),
    lens_hint: compactLine(String(record.lens_hint ?? "")),
    text_zone: compactLine(String(record.text_zone ?? "")),
    mood_keywords: compactLine(String(record.mood_keywords ?? "")),
  };
}

function normalizeVisibleCopyValue(value: string): string {
  const normalized = compactLine(value);
  if (!normalized) return "";
  return /^(none|no text|无|无文字)$/i.test(normalized) ? "" : normalized;
}

function isVisualOnlyCopyStrategy(value: string): boolean {
  return /\bvisual-only|no added typography|no added visible copy\b|纯视觉|不新增文案|不加字|无新增文字/i.test(value);
}

type GenesisPlanSectionKey =
  | "design_goal"
  | "product_appearance"
  | "in_graphic_elements"
  | "composition_plan"
  | "content_elements"
  | "text_content"
  | "atmosphere_creation";

type GenesisPromptObject = {
  prompt: string;
  title: string;
  negative_prompt: string;
  marketing_hook: string;
  priority: number;
};

type GenesisCommercialIntent = {
  archetype: string;
  brief_summary: string;
  visual_tone: string;
  mood_keywords: string[];
  composition_bias: string;
  set_treatment: string;
  lighting_bias: string;
  copy_strategy: string;
  hero_expression: string;
  hero_layout_archetype: string;
  text_tension: string;
  copy_dominance: string;
  human_interaction_mode: string;
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

function normalizeGenesisBlueprintForPrompt(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!value) return null;
  return Array.isArray(value.images) ? value : null;
}

function normalizeGenesisPlanSectionLabel(label: string): string {
  const raw = label.trim();
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
    case "色彩系统":
      return "color_system";
    case "字体系统":
    case "字体系统/文案系统":
    case "文案系统":
      return "font_system";
    case "视觉语言":
      return "visual_language";
    case "摄影风格":
      return "photography_style";
    case "品质要求":
      return "quality_requirements";
    case "主色调":
      return "primary_color";
    case "辅助色":
    case "辅助颜色":
      return "secondary_color";
    case "背景色":
      return "background_color";
    case "标题字体":
      return "heading_font";
    case "正文字体":
      return "body_font";
    case "字号层级":
      return "hierarchy";
    case "文案规则":
      return "copy_rules";
    case "版式原则":
      return "layout_principles";
    case "装饰元素":
      return "decorative_elements";
    case "图标风格":
      return "icon_style";
    case "留白原则":
      return "whitespace_principle";
    case "光线":
      return "lighting";
    case "景深":
      return "depth_of_field";
    case "相机参数参考":
    case "镜头/光圈参考":
    case "镜头光圈参考":
      return "camera_parameter_reference";
    case "分辨率":
      return "resolution";
    case "风格":
      return "style";
    case "真实感":
      return "realism";
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
    case "color_system":
    case "font_system":
    case "typography_copy_system":
    case "visual_language":
    case "photography_style":
    case "quality_requirements":
    case "primary_color":
    case "secondary_color":
    case "background_color":
    case "heading_font":
    case "body_font":
    case "hierarchy":
    case "copy_rules":
    case "layout_principles":
    case "decorative_elements":
    case "icon_style":
    case "whitespace_principle":
    case "lighting":
    case "depth_of_field":
    case "camera_parameter_reference":
    case "resolution":
    case "style":
    case "realism":
    case "product_proportion":
    case "layout_method":
    case "subject_angle":
    case "text_area":
    case "focus_of_display":
    case "key_selling_points":
    case "background_elements":
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
      return ascii;
    case "typography_copy":
    case "typography_copy_system_":
      return "font_system";
    case "camera_reference":
    case "lens_aperture_reference":
      return "camera_parameter_reference";
    default:
      return ascii;
  }
}

function detectGenesisPlanSectionKey(label: string): GenesisPlanSectionKey | null {
  switch (normalizeGenesisPlanSectionLabel(label)) {
    case "design_goal":
      return "design_goal";
    case "product_appearance":
      return "product_appearance";
    case "in_graphic_elements":
      return "in_graphic_elements";
    case "composition_plan":
      return "composition_plan";
    case "content_elements":
      return "content_elements";
    case "text_content":
      return "text_content";
    case "atmosphere_creation":
      return "atmosphere_creation";
    default:
      return null;
  }
}

function stripBulletPrefix(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function clipLine(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.。;；:,，\s]+$/g, "");
}

function compactLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function extractGenesisPlanSections(
  value: string,
): Partial<Record<GenesisPlanSectionKey, string[]>> {
  const sections: Partial<Record<GenesisPlanSectionKey, string[]>> = {};
  let activeKey: GenesisPlanSectionKey | null = null;

  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("## ")) continue;

    const headingMatch = line.match(/^\*\*(.+?)\*\*(?:\s*(?:\([^)]+\)|（[^）]+）))?\s*[：:]\s*(.*)$/);
    if (headingMatch) {
      activeKey = detectGenesisPlanSectionKey(headingMatch[1]);
      if (!activeKey) continue;
      const rest = headingMatch[2]?.trim();
      if (rest) {
        sections[activeKey] = [...(sections[activeKey] ?? []), rest];
      } else if (!sections[activeKey]) {
        sections[activeKey] = [];
      }
      continue;
    }

    if (!activeKey) continue;
    sections[activeKey] = [...(sections[activeKey] ?? []), stripBulletPrefix(line)];
  }

  return sections;
}

function extractMarkdownHeadingSections(value: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let activeKey = "";

  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      activeKey = normalizeGenesisPlanSectionLabel(headingMatch[1]);
      if (!sections[activeKey]) sections[activeKey] = [];
      continue;
    }
    if (!activeKey || line.startsWith("# ")) continue;
    if (line.startsWith(">")) continue;
    sections[activeKey].push(stripBulletPrefix(line));
  }

  return sections;
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

function flattenSectionLines(lines: string[] | undefined): string[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => compactLine(stripBulletPrefix(line))).filter(Boolean);
}

function splitCopyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => clipLine(line))
    .filter(Boolean);
}

function sentenceJoin(values: string[], delimiter = ". "): string {
  const cleaned = values.map((value) => compactLine(value)).filter(Boolean);
  if (delimiter !== ". ") return cleaned.join(delimiter);

  let result = "";
  for (const value of cleaned) {
    if (!result) {
      result = value;
      continue;
    }
    result += /[.!?]$/.test(result) ? ` ${value}` : `. ${value}`;
  }
  return result;
}

function buildGenesisColorSchemeSentence(specSections: Record<string, string[]>): string {
  const colorLines = specSections.color_system ?? [];
  const primary = extractSectionDetail(colorLines, "Primary Color");
  const secondary = extractSectionDetail(colorLines, "Secondary Color");
  const background = extractSectionDetail(colorLines, "Background Color");

  const parts: string[] = [];
  if (primary) parts.push(`The primary color is ${primary}`);
  if (secondary) parts.push(`accented by ${secondary}`);
  if (background) parts.push(`on a background of ${background}`);
  return parts.join(", ");
}

function buildGenesisStyleSentence(specSections: Record<string, string[]>, styleConstraintPrompt: string, promptProfile: string): string {
  const photography = specSections.photography_style ?? [];
  const quality = specSections.quality_requirements ?? [];
  const font = specSections.font_system ?? [];

  const parts = [
    extractSectionDetail(photography, "Depth of Field"),
    extractSectionDetail(photography, "Camera Parameter Reference"),
    extractSectionDetail(quality, "Style"),
    extractSectionDetail(quality, "Realism"),
    extractSectionDetail(font, "Heading Font"),
    styleConstraintPrompt,
    promptProfile === "ta-pro" ? "zero drift same-SKU lock and exact product identity retention" : "",
  ].filter(Boolean);

  return sentenceJoin(parts);
}

function buildGenesisTypographySystemSentence(specSections: Record<string, string[]>): string {
  const font = specSections.font_system ?? [];
  const headingFont = extractSectionDetail(font, "Heading Font");
  const bodyFont = extractSectionDetail(font, "Body Font");
  const hierarchy = extractSectionDetail(font, "Hierarchy");
  const copyRules = extractSectionDetail(font, "Copy Rules");
  const layoutPrinciples = extractSectionDetail(font, "Layout Principles");

  const parts = [
    headingFont ? `Use ${headingFont} for the headline style` : "",
    bodyFont ? `supporting information should follow ${bodyFont}` : "",
    hierarchy ? `keep the typography hierarchy as ${hierarchy}` : "",
    copyRules ? `follow these copy rules: ${copyRules}` : "",
    layoutPrinciples ? `apply these layout principles: ${layoutPrinciples}` : "",
  ].filter(Boolean);

  return sentenceJoin(parts);
}

function buildGenesisHeroExpressionSentence(commercialIntent: GenesisCommercialIntent | null): string {
  if (!commercialIntent) return "";
  const layoutArchetypeMap: Record<string, string> = {
    "dominant-vertical-slogan": "a dominant vertical slogan block or split-column contrast headline",
    "compressed-editorial-title": "a compressed editorial title block inside generous whitespace",
    "structured-information-band": "a structured side information band with precise technical rhythm",
  };
  const textTensionMap: Record<string, string> = {
    "high-contrast-dual-focus": "high-contrast dual-focus energy where product and typography share the first read",
    "editorial-material-contrast": "editorial material contrast with restrained but high-presence typography",
    "restrained-precision": "restrained precision with typography supporting structure and function",
  };
  const parts = [
    commercialIntent.hero_expression ? `Treat the first hero image using the ${commercialIntent.hero_expression} expression mode` : "",
    commercialIntent.hero_layout_archetype
      ? `the preferred layout archetype is ${layoutArchetypeMap[commercialIntent.hero_layout_archetype] ?? commercialIntent.hero_layout_archetype}`
      : "",
    commercialIntent.text_tension
      ? `the intended text tension is ${textTensionMap[commercialIntent.text_tension] ?? commercialIntent.text_tension}`
      : "",
    commercialIntent.copy_dominance === "co-hero"
      ? "Typography may act as a co-hero with the product instead of staying merely supportive"
      : commercialIntent.copy_dominance === "subordinate"
        ? "Typography should stay subordinate to the product while still feeling designed and deliberate"
        : "",
    commercialIntent.human_interaction_mode === "required"
      ? "A hand-held or human-interaction relationship is required for this hero frame"
      : commercialIntent.human_interaction_mode === "optional"
        ? "Human interaction is optional and should appear only if it clarifies scale or usage"
        : commercialIntent.human_interaction_mode === "none"
          ? "Do not default to hand-held or human-interaction staging"
          : "",
  ].filter(Boolean);
  return sentenceJoin(parts);
}

function buildGenesisQualitySentence(specSections: Record<string, string[]>): string {
  const quality = specSections.quality_requirements ?? [];
  return [
    extractSectionDetail(quality, "Resolution"),
    extractSectionDetail(quality, "Style"),
    extractSectionDetail(quality, "Realism"),
  ].map((value) => clipLine(value)).filter(Boolean).join(", ");
}

function ensureSentence(value: string): string {
  const cleaned = compactLine(value);
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function paragraphJoin(values: string[]): string {
  return values.map((value) => ensureSentence(value)).filter(Boolean).join(" ");
}

function buildGenesisIdentityLockSentence(params: {
  primaryColor: string;
  productMaterial: string;
  keyFeatures: string[];
  promptProfile: string;
}): string {
  const { primaryColor, productMaterial, keyFeatures, promptProfile } = params;
  const parts = [
    primaryColor
      ? `Keep the exact same SKU and product identity locked to the uploaded reference, especially the true product color ${primaryColor}`
      : "Keep the exact same SKU and product identity locked to the uploaded reference color",
    productMaterial ? `the original material ${productMaterial}` : "the original material rendering",
    keyFeatures.length > 0 ? `and these immutable features: ${keyFeatures.join(", ")}` : "and the visible logo, hardware, texture, silhouette, and structure",
  ];
  if (promptProfile === "ta-pro") {
    parts.push("with zero drift");
  }
  return `${parts.join(", ")}. Do not recolor, redesign, simplify, or flatten the product into a generic packshot.`;
}

function buildGenesisNegativePrompt(
  colorAnchor: string,
  materialAnchor: string,
  keyFeatures: string[],
  promptProfile: string,
  apparelHeroGuard: boolean,
): string {
  const parts = [
    "blurry",
    "low resolution",
    "wrong colorway",
    "recolored product",
    materialAnchor ? `wrong ${clipLine(materialAnchor)}` : "wrong material",
    "missing logo",
    "altered hardware",
    "simplified structure",
    "distorted proportions",
    "broken cutouts",
    keyFeatures.length > 0 ? `missing ${clipLine(keyFeatures[0])}` : "missing key features",
    colorAnchor ? `off-tone ${clipLine(colorAnchor)}` : "",
    apparelHeroGuard ? "hanger display" : "",
    apparelHeroGuard ? "mannequin display" : "",
    apparelHeroGuard ? "floating garment" : "",
    apparelHeroGuard ? "blank white backdrop" : "",
    promptProfile === "ta-pro" ? "identity drift" : "",
  ];
  return parts.filter(Boolean).join(", ");
}

const GENESIS_APPAREL_RE = /\b(shirt|t-?shirt|tee|blouse|jacket|coat|dress|skirt|hoodie|sweater|cardigan|pants|trousers|jeans|denim|garment|apparel|outerwear|top|shirting)\b|衬衫|衬衣|上衣|外套|夹克|连衣裙|裙装|半裙|裤子|长裤|牛仔|卫衣|毛衣|针织|服装/i;
const GENESIS_WHITE_BG_PLAN_RE = /\b(clean\s*packshot|packshot|pure white|white background|white backdrop|seamless white)\b|白底|纯白背景|白色背景/i;
const GENESIS_APPAREL_RESTRICTED_SCENE_RE = /\b(hanger|white hanger|mannequin|hang separately|floating garment|blank white backdrop|empty white background|flat lay)\b|衣架|白色衣架|人台|悬挂|挂拍|纯白背景|空白背景|平铺/i;
const GENESIS_APPAREL_STATIC_LAYOUT_RE = /\b(strictly centered|centered symmetric|symmetrical centered|front vertical|front-on vertical|flat front|dead-center|straight-on|zero-degree front|centered placement|centered display)\b|严格居中对称|居中对称|中心对称|绝对居中|正面垂直|正面平视|垂直居中|画面正中央|位于画面正中央|正中央|0度正拍|零度正拍|正拍|文字居中排列|居中摆放|居中陈列|居中位置|居中正拍|顶部居中/i;
const GENESIS_APPAREL_BLAND_SET_RE = /\b(matte gray|plain gray background|clean plain background|no distracting elements?|linen background|neutral textile background|support elements?: none|decorative elements?: none)\b|浅灰.*磨砂|磨砂质感|无干扰元素|低饱和度.*背景|浅灰磨砂|浅灰.*亚麻|亚麻布材质|亚麻布背景|中性布面背景|浅灰渐变背景|布纹纹理|无辅助道具|辅助道具：无|装饰元素：无|无繁杂装饰/i;

function isGenesisApparelBlueprint(params: {
  analysisRecord: Record<string, unknown>;
  image: Record<string, unknown>;
}): boolean {
  const { analysisRecord, image } = params;
  const visualIdentity = analysisRecord.product_visual_identity && typeof analysisRecord.product_visual_identity === "object"
    ? analysisRecord.product_visual_identity as Record<string, unknown>
    : {};
  const haystack = [
    String(analysisRecord.product_summary ?? ""),
    String(visualIdentity.material ?? ""),
    Array.isArray(visualIdentity.key_features) ? visualIdentity.key_features.join(" ") : "",
    String(image.title ?? ""),
    String(image.description ?? ""),
    String(image.design_content ?? ""),
  ].join(" ");
  return GENESIS_APPAREL_RE.test(haystack);
}

function isGenesisWhiteBackgroundPlan(image: Record<string, unknown>): boolean {
  const haystack = [
    String(image.type ?? ""),
    String(image.title ?? ""),
    String(image.description ?? ""),
    String(image.design_content ?? ""),
  ].join(" ");
  return GENESIS_WHITE_BG_PLAN_RE.test(haystack);
}

function sanitizeGenesisApparelSceneDetail(value: string, apparelHeroGuard: boolean): string {
  const cleaned = clipLine(value);
  if (!cleaned) return "";
  if (!apparelHeroGuard) return cleaned;
  return (
    GENESIS_APPAREL_RESTRICTED_SCENE_RE.test(cleaned) ||
    GENESIS_APPAREL_STATIC_LAYOUT_RE.test(cleaned) ||
    GENESIS_APPAREL_BLAND_SET_RE.test(cleaned)
  )
    ? ""
    : cleaned;
}

export function buildGenesisHeroPromptObjects(params: {
  analysisRecord: Record<string, unknown>;
  language: string;
  promptProfile: string;
  styleConstraintPrompt: string;
}): GenesisPromptObject[] {
  const { analysisRecord, language, promptProfile, styleConstraintPrompt } = params;
  const images = Array.isArray(analysisRecord.images)
    ? analysisRecord.images.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
  const visualIdentity = analysisRecord.product_visual_identity && typeof analysisRecord.product_visual_identity === "object"
    ? analysisRecord.product_visual_identity as Record<string, unknown>
    : {};
  const copyAnalysis = analysisRecord.copy_analysis && typeof analysisRecord.copy_analysis === "object"
    ? analysisRecord.copy_analysis as Record<string, unknown>
    : {};
  const rawKeyFeatures = Array.isArray(visualIdentity.key_features)
    ? visualIdentity.key_features.map((item) => clipLine(String(item ?? ""))).filter(Boolean)
    : [];
  const productMaterial = clipLine(String(visualIdentity.material ?? ""));
  const primaryColor = clipLine(String(visualIdentity.primary_color ?? ""));
  const sharedCopy = typeof copyAnalysis.shared_copy === "string" ? copyAnalysis.shared_copy.trim() : "";
  const copyLines = splitCopyLines(sharedCopy);
  const specSections = extractMarkdownHeadingSections(String(analysisRecord.design_specs ?? ""));
  const commercialIntent = normalizeGenesisCommercialIntent(
    analysisRecord.commercial_intent ?? analysisRecord.commercialIntent,
  );

  return images.map((image, index) => {
    const title = clipLine(String(image.title ?? `Image ${index + 1}`)) || `Image ${index + 1}`;
    const description = clipLine(String(image.description ?? ""));
    const apparelHeroGuard = isGenesisApparelBlueprint({ analysisRecord, image }) && !isGenesisWhiteBackgroundPlan(image);
    const keyFeatures = rawKeyFeatures.filter((value) =>
      !(apparelHeroGuard && /\b(hanger|white hanger|mannequin)\b|衣架|白色衣架|木质衣架|人台|挂拍/i.test(value))
    );
    const planSections = extractGenesisPlanSections(String(image.design_content ?? ""));
    const sceneRecipe = normalizeGenesisSceneRecipe(image.scene_recipe ?? image.sceneRecipe);
    const visualOnlyCopy = language === "none";

    const subject = sentenceJoin(flattenSectionLines(planSections.product_appearance), " ");
    const composition = sentenceJoin([
      sceneRecipe?.product_ratio ?? "",
      sceneRecipe?.layout_method ?? "",
      sceneRecipe?.subject_angle ?? "",
      sceneRecipe?.text_zone ?? "",
      extractSectionDetail(planSections.composition_plan, "Product Proportion"),
      extractSectionDetail(planSections.composition_plan, "Layout Method"),
      extractSectionDetail(planSections.composition_plan, "Subject Angle"),
      extractSectionDetail(planSections.composition_plan, "Text Area"),
    ].map((value) => sanitizeGenesisApparelSceneDetail(value, apparelHeroGuard)));
    const background = sanitizeGenesisApparelSceneDetail(sentenceJoin([
      sceneRecipe?.background_surface ?? "",
      sceneRecipe?.background_elements ?? "",
      sceneRecipe?.support_elements ?? "",
      sceneRecipe?.decorative_elements ?? "",
      extractSectionDetail(planSections.content_elements, "Background Elements"),
      extractSectionDetail(planSections.content_elements, "Decorative Elements"),
    ]), apparelHeroGuard);
    const lighting = sentenceJoin([
      sceneRecipe?.lighting_setup ?? "",
      sceneRecipe?.lens_hint ?? "",
      extractSectionDetail(planSections.atmosphere_creation, "Light and Shadow Effects"),
      extractSectionDetail(specSections.photography_style, "Lighting"),
    ].map((value) => sanitizeGenesisApparelSceneDetail(value, apparelHeroGuard)));
    const colorScheme = buildGenesisColorSchemeSentence(specSections);
    const materialDetails = sentenceJoin([
      extractSectionDetail(planSections.content_elements, "Key Selling Points"),
      productMaterial,
      keyFeatures.join(", "),
    ]);
    const typographySystem = buildGenesisTypographySystemSentence(specSections);

    const explicitMainTitle = normalizeVisibleCopyValue(extractSectionDetail(planSections.text_content, "Main Title"));
    const explicitSubtitle = normalizeVisibleCopyValue(extractSectionDetail(planSections.text_content, "Subtitle"));
    const explicitDescription = normalizeVisibleCopyValue(extractSectionDetail(planSections.text_content, "Description Text"));
    const explicitTypographyTone = extractSectionDetail(planSections.text_content, "Typography Tone");
    const explicitTypefaceDirection = extractSectionDetail(planSections.text_content, "Typeface Direction");
    const explicitTypographyColorStrategy = extractSectionDetail(planSections.text_content, "Typography Color Strategy");
    const explicitLayoutAggression = extractSectionDetail(planSections.text_content, "Layout Aggression");
    const explicitLayoutArchetype = extractSectionDetail(planSections.text_content, "Layout Archetype");
    const explicitTextTension = extractSectionDetail(planSections.text_content, "Text Tension");
    const explicitCopyDominance = extractSectionDetail(planSections.text_content, "Copy Dominance");
    const copyTextParts: string[] = [];
    if (!visualOnlyCopy) {
      if (explicitMainTitle) copyTextParts.push(`Use "${explicitMainTitle}" as the main title.`);
      else if (copyLines[0]) copyTextParts.push(`Use "${copyLines[0]}" as the main title.`);
      if (explicitSubtitle) copyTextParts.push(`Use "${explicitSubtitle}" as the subtitle.`);
      else if (copyLines[1]) copyTextParts.push(`Use "${copyLines[1]}" as the subtitle.`);
      if (explicitDescription) {
        copyTextParts.push(/[.!?]$/.test(explicitDescription) ? explicitDescription : `${explicitDescription}.`);
      } else if (copyLines.length > 2) {
        const fallbackDescription = copyLines.slice(2).join(" ");
        copyTextParts.push(/[.!?]$/.test(fallbackDescription) ? fallbackDescription : `${fallbackDescription}.`);
      }
    }
    if (visualOnlyCopy && copyTextParts.length === 0) {
      copyTextParts.push("No typography. Keep the composition visual-only with no added visible copy.");
    }
    const heroExpression = index === 0 ? buildGenesisHeroExpressionSentence(commercialIntent) : "";
    const textLayout = sentenceJoin([
      ...copyTextParts,
      !visualOnlyCopy && explicitTypographyTone ? `Keep the typography tone as ${explicitTypographyTone}` : "",
      !visualOnlyCopy && explicitTypefaceDirection ? `Set the typeface direction as ${explicitTypefaceDirection}` : "",
      !visualOnlyCopy && explicitTypographyColorStrategy ? `Typography color should follow this strategy: ${explicitTypographyColorStrategy}` : "",
      !visualOnlyCopy && explicitLayoutAggression ? `The layout aggression should feel ${explicitLayoutAggression}` : "",
      !visualOnlyCopy && explicitLayoutArchetype ? `Use ${explicitLayoutArchetype} as the layout archetype` : "",
      !visualOnlyCopy && explicitTextTension ? `Let the text tension feel ${explicitTextTension}` : "",
      !visualOnlyCopy && explicitCopyDominance
        ? `Treat the copy-product relationship as ${explicitCopyDominance}`
        : "",
      !visualOnlyCopy && heroExpression ? heroExpression : "",
      !visualOnlyCopy && typographySystem ? typographySystem : "",
      sceneRecipe?.text_zone ?? "",
      commercialIntent?.copy_strategy ?? "",
      extractSectionDetail(planSections.composition_plan, "Text Area"),
      extractSectionDetail(planSections.text_content, "Layout Guidance"),
    ].map((value) => sanitizeGenesisApparelSceneDetail(value, apparelHeroGuard)), " ");

    const insetImages = sanitizeGenesisApparelSceneDetail(
      sentenceJoin([
        sceneRecipe?.support_elements ?? "",
        sceneRecipe?.decorative_elements ?? "",
        flattenSectionLines(planSections.in_graphic_elements).join(" "),
      ]),
      apparelHeroGuard,
    );
    const mood = sentenceJoin([
      sceneRecipe?.mood_keywords ?? "",
      commercialIntent?.mood_keywords.join(", ") ?? "",
      extractSectionDetail(planSections.atmosphere_creation, "Mood Keywords"),
    ], " ");
    const designGoal = sentenceJoin([
      commercialIntent?.brief_summary ?? "",
      sceneRecipe?.shot_role ?? "",
      flattenSectionLines(planSections.design_goal)[0] || description,
    ], " ");
    const cameraReference = sentenceJoin([
      sceneRecipe?.lens_hint ?? "",
      extractSectionDetail(planSections.atmosphere_creation, "Camera Parameter Reference"),
    ]);
    const style = buildGenesisStyleSentence(specSections, styleConstraintPrompt, promptProfile);
    const quality = buildGenesisQualitySentence(specSections);
    const identityLock = buildGenesisIdentityLockSentence({
      primaryColor,
      productMaterial,
      keyFeatures,
      promptProfile,
    });

    const openingParagraph = paragraphJoin([
      subject || "Use the uploaded product as the exact hero subject.",
      designGoal ? `Deliver ${designGoal}` : "",
      composition
        ? `Compose the frame so ${composition}`
        : "Compose the frame with a dynamic commercial layout, a clear hero zone, and readable breathing room",
      commercialIntent?.visual_tone ? `Keep the visual tone grounded in ${commercialIntent.visual_tone}` : "",
      apparelHeroGuard
        ? "Stage the garment as a premium editorial still life with layered set surfaces, tactile depth, and purposeful shadow shaping rather than a hanger display, mannequin display, or blank white packshot"
        : "",
      background
        ? `Build a layered commercial set with ${background}`
        : "Build a layered set with a tactile background surface, a readable midground, and restrained foreground accents instead of an empty backdrop",
    ]);

    const lightingParagraph = paragraphJoin([
      lighting
        ? `Light the scene with ${lighting}`
        : "Use purposeful directional lighting with a key light, contour highlight, and soft shadow separation",
      colorScheme ? `Anchor the palette around ${colorScheme}` : "",
      materialDetails ? `Emphasize ${materialDetails}` : "",
    ]);

    const richnessParagraph = paragraphJoin([
      insetImages
        ? `Add scene richness with ${insetImages}`
        : "Introduce subtle foreground and background accents that reinforce the product story without stealing focus from the hero product",
      mood ? `Let the overall mood feel ${clipLine(mood)}` : "",
      textLayout || (visualOnlyCopy
        ? "Keep the composition visual-only with no added visible copy"
        : ""),
    ]);

    const cameraParagraph = paragraphJoin([
      cameraReference ? `Use ${cameraReference}` : "",
      style ? `Shoot it with ${style}` : "",
      quality ? `${quality}` : "",
      identityLock,
    ]);

    return {
      prompt: [
        openingParagraph,
        lightingParagraph,
        richnessParagraph,
        cameraParagraph,
      ].filter(Boolean).join("\n\n"),
      title,
      negative_prompt: buildGenesisNegativePrompt(primaryColor, productMaterial, keyFeatures, promptProfile, apparelHeroGuard),
      marketing_hook: description || clipLine(String(analysisRecord.product_summary ?? "")),
      priority: 0,
    };
  });
}

export async function handleGeneratePromptsRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as {
    analysisJson?: unknown;
    targetLanguage?: string;
    outputLanguage?: string;
    imageCount?: number;
    stream?: boolean;
    design_specs?: unknown;
    clothingMode?: string;
    styleConstraint?: unknown;
    module?: string;
    promptProfile?: string;
    prompt_profile?: string;
  } | null;
  if (!body?.analysisJson) return err("BAD_REQUEST", "analysisJson is required");

  const taProPromptProfileEnabled = await getBooleanSystemConfig(TA_PRO_PROMPT_PROFILE_FLAG, false);
  const promptProfile = resolvePromptProfile({
    requestedProfile: body.promptProfile ?? body.prompt_profile,
    enabled: taProPromptProfileEnabled,
  });
  const language = sanitizeLanguage(body.outputLanguage ?? body.targetLanguage ?? "en");
  const clothingModeVal = typeof body.clothingMode === "string" ? body.clothingMode.trim() : "";
  const module = typeof body.module === "string" ? body.module.trim() : "";
  const isClothing = clothingModeVal.length > 0;
  const isModelTryOn = clothingModeVal === "model_prompt_generation";
  const isGenesisModule = module === "genesis";
  const isEcomDetailModule = module === "ecom-detail";
  const analysisRecord = parseAnalysisRecord(body.analysisJson);
  const normalizedGenesisRecord = isGenesisModule ? normalizeGenesisBlueprintForPrompt(analysisRecord) : null;
  const isGenesisBlueprintMode = Boolean(normalizedGenesisRecord);
  const useDeterministicGenesisPrompts = Boolean(normalizedGenesisRecord);
  const ecomDetailCopyRuleZh = buildVisibleCopyLanguageRule(language, true);
  const ecomDetailCopyRuleEn = buildVisibleCopyLanguageRule(language, false);
  const analysisJson = typeof body.analysisJson === "string"
    ? body.analysisJson
    : JSON.stringify(body.analysisJson, null, 2);
  const designSpecs = body.design_specs
    ? (typeof body.design_specs === "string" ? body.design_specs : JSON.stringify(body.design_specs, null, 2))
    : null;
  const styleConstraintPrompt = normalizeStyleConstraintPrompt(body.styleConstraint);
  const imageCount = Math.max(
    1,
    Math.min(
      15,
      Number(
        body.imageCount
          ?? (typeof body.analysisJson === "object" && body.analysisJson && "_ai_meta" in body.analysisJson
            ? (body.analysisJson as Record<string, unknown>)?._ai_meta &&
              typeof (body.analysisJson as Record<string, unknown>)._ai_meta === "object"
              ? Number(((body.analysisJson as Record<string, unknown>)._ai_meta as Record<string, unknown>).image_count ?? 1)
              : 1
            : 1),
      ),
    ),
  );

  const systemPromptClothingZh = `你是顶级电商视觉提示词工程专家，专注于服装产品商业图。你的任务是根据产品分析蓝图，为每张图片生成高度精确、技术性的图像生成提示词。

针对不同图片类型，严格遵循以下拍摄规则：

白底精修图（White Background / Refined / 正面 / 背面）：
产品主体占画面75%，居中构图。背景为纯白色(#FFFFFF)，无地面反射、无投影痕迹。光线采用高调柔和的平铺布光（soft flatbox lighting），消除所有硬阴影，完美呈现面料哑光质感与真实厚度。

3D幽灵模特图（3D Ghost Mannequin / 3D立体 / Ghost Mannequin）：
服装以3D形态呈现，占画面80%，居中排布。内部领口深度与内侧结构清晰可见。完全移除衣架和人台的一切痕迹。光线由左上方45度角照射，在袖子下方与肩部形成柔和阴影，增强空间感与轮廓立体感。腰部带有细微褶皱以体现面料柔软度。

细节特写图（Detail Close-up / 细节图 / 特写）：
主体占画面90%，聚焦在最有价值的材质/工艺/装饰细节处。采用微距镜头（macro lens）与侧向斜射光，强调面料纹理的物理厚度与立体感。浅景深虚化背景，使焦点超清锐利地集中在车线、纹理或特殊工艺上。

卖点展示图（Selling Point / 卖点图）：
突出一个核心差异化卖点，配合简洁背景，使用强调光（spotlight or rim lighting）引导视觉焦点。

通用要求：
- 必须从分析蓝图中提取精确色值（如 #FFDB58、#3C3C3C），在 prompt 中直接使用十六进制色值。
- 声明面料类型（棉质/涤纶/牛仔布/丝绸等）与视觉特征（哑光/光泽/粗糙纹理等）。
- 完整保留产品的形状、颜色、图案、logo、文字印花和所有关键设计细节。
- 每段 prompt 结尾统一追加：8K分辨率，超清画质，极致锐度，商业摄影级品质，无视觉噪点。
- 严格输出 JSON 数组，每个元素包含 prompt, title, negative_prompt, marketing_hook, priority 字段，不含 Markdown，不含任何解释。`;

  const systemPromptClothingEn = `You are a top-tier e-commerce visual prompt engineer specializing in apparel product photography. Your task is to generate highly precise, technical image generation prompts for each plan in the analysis blueprint.

Follow these shot-type-specific rules strictly:

White Background / Refined (front or back view):
Product occupies 75% of frame, centered. Background pure white (#FFFFFF), no floor reflection, no cast shadows. High-key soft flatbox lighting eliminates all harsh shadows, perfectly rendering matte fabric texture and true thickness.

3D Ghost Mannequin:
Garment rendered in 3D form at 80% of frame, centered. Internal collar depth and lining structure clearly visible. All hanger and mannequin traces completely removed. Light from 45-degree upper-left creates soft shadows under sleeves and at shoulders, enhancing spatial depth and silhouette. Subtle waist folds convey fabric softness.

Detail Close-up (macro):
Subject at 90% of frame, focused on the highest-value material/craft detail. Macro lens with angled side lighting to emphasize physical texture thickness. Shallow depth of field blurs background, keeping stitching, weave, or special trim tack-sharp.

Selling Point Highlight:
Emphasize one core differentiating feature with a spotlight or rim lighting against a clean background to draw visual focus.

Universal requirements:
- Extract exact hex color values from the blueprint (e.g. #FFDB58, #3C3C3C) and use them directly in the prompt.
- State fabric type (cotton, polyester, denim, silk, etc.) and visual properties (matte, glossy, textured, etc.).
- Preserve all product identity: shape, color, pattern, logo, print, and every key design detail.
- End every prompt with: 8K resolution, ultra-clear, maximum sharpness, commercial photography quality, zero visual artifacts.
- Output a strict JSON array only; each element must contain prompt, title, negative_prompt, marketing_hook, priority fields; no Markdown; no explanations.`;

  const systemPromptModelTryOnZh =
    `你是顶级电商主体试穿图提示词工程专家。根据拍摄策略蓝图，为每个镜头生成一段可直接出图的高约束提示词。

核心原则：
- 主体可能是人类、宠物或其他非人主体，绝不能默认解释为真人模特。
- 必须严格保持参考主体的物种/身份感/体态/姿势方向一致。
- 必须严格保持上传服装的颜色、材质、版型、图案、logo、结构与关键工艺细节一致。
- 服装必须真实穿在参考主体身上，不能漂浮、不能挂拍、不能变成人台、不能换款。
- 如果蓝图标题是“人台图”，在主体试穿场景中应解释为“主体标准展示图”，而不是无人台。
- 对非人主体，必须使用物种、毛色、头部特征、四肢比例、体态等锚点；禁止使用肤色、人种、发型、五官相似度等人类专属表达。

每条 prompt 必须明确覆盖：
1. 主体锁定
2. 服装锁定
3. 穿着区域与贴合方式
4. 构图与景别
5. 背景与场景层次
6. 光影与材质表现
7. 颜色体系（含精确 hex 色值）
8. 文字布局（无文字则明确写纯视觉）
9. 风格与氛围
10. 画质要求

negative_prompt 必须显式排除：
- 物种错误
- 动物人化 / 人物动物化
- 衣服漂浮
- 穿着部位错误
- 多余肢体
- 解剖结构扭曲
- 服装改色改款
- 关键细节丢失

输出要求：严格 JSON 数组，每个元素包含 prompt, title, negative_prompt, marketing_hook, priority 字段，不含 Markdown，不含解释。`;
  const systemPromptModelTryOnEn =
    `You are a top-tier prompt engineer for reference-subject try-on imagery. Generate one production-ready prompt per blueprint shot.

Core principles:
- The subject may be a human, a pet, or another non-human subject. Never assume the subject is a human fashion model.
- Preserve the reference subject's species, identity feel, body shape, and pose direction.
- Preserve the uploaded garment's color, material, silhouette, logo, print, construction, and key details.
- The garment must be naturally worn by the reference subject. It must not float, hang separately, become a mannequin-only display, or turn into another design.
- If a blueprint title says "人台图", reinterpret it as a standardized subject showcase within this try-on flow rather than a literal mannequin-only image.
- For non-human subjects, use species, coat/fur color, head traits, limb proportions, and body posture. Do not use human-only descriptors such as skin tone, ethnicity, hairstyle, or facial-feature similarity.

Each prompt must explicitly cover:
1. Subject lock
2. Garment lock
3. Wear region and fit
4. Composition and framing
5. Background and scene depth
6. Lighting and material rendering
7. Color system with exact hex values
8. Text layout rules, or explicit visual-only instruction
9. Style and atmosphere
10. Quality requirements

The negative_prompt must explicitly exclude:
- wrong species
- humanized animal / animalized human
- floating garment
- wrong wear placement
- extra limbs
- distorted anatomy
- recolored or redesigned garment
- missing product details

Return a strict JSON array only. Each item must contain prompt, title, negative_prompt, marketing_hook, priority. No markdown. No explanations.`;

  const genesisCopyRuleZh = language === "none"
    ? "若共享文案为空则不得添加任何新增画面文字；若用户手动提供共享文案，必须按原文使用，不得翻译或改写。"
    : buildVisibleCopyLanguageRule(language, true);
  const genesisCopyRuleEn = language === "none"
    ? "If shared copy is empty, do not add any new visible copy. If the user manually provided shared copy, use that exact original copy without translation or paraphrase."
    : buildVisibleCopyLanguageRule(language, false);
  const genesisBlueprintSystemPromptZh = `你是顶级电商主图提示词工程专家。现在输入的不是紧凑分析摘要，而是一份已经结构化好的主图蓝图。请严格按蓝图逐张生成 prompt。

规则：
- images 数组里的每一项都代表同一商品的一张主图方案，输出顺序必须与 images 数组完全一致。
- 所有 prompt 都必须锁定为同一 SKU、同一商品，不得改色、改材质、改 logo、改五金、改纹理、改轮廓、改比例、改结构。
- 必须把 design_specs 和每张图片自己的 design_content 都吸收进 prompt。
- 若蓝图中存在商品身份锁定信息、主色锚定、材质锚定、关键特征，必须在 prompt 正文中明确写出，而不是只放在 negative_prompt。
- negative_prompt 只用于补充易漂移风险，正向 prompt 本身必须显式声明禁止改款和禁止漂移。
- 若蓝图要求共享文案，则必须写明原文、位置、层级、留白和可读性，且文案不得遮挡商品。
- 每条 prompt 必须写成自然语言英文段落，不要使用 Subject: / Composition: / Background: 这类标签式前缀。
- 每条 prompt 默认至少包含 2 层可读场景深度，除白底精修型方案外禁止空背景或单层纯色背景。
- 光线必须有明确方向性和层次感，至少要交代主光和轮廓光/环境补光关系。
- 构图不能全部正摆正拍，优先吸收蓝图里的微倾斜、对角线、三分法、高低机位等动态信息。
- 装饰元素必须与商品品类和卖点相关，不能为了“高级感”硬塞无关道具。
- 文案语言硬约束：${genesisCopyRuleZh}
- 输出严格 JSON 数组，每项包含 prompt, title, negative_prompt, marketing_hook, priority。`;
  const genesisBlueprintSystemPromptEn = `You are a top-tier e-commerce hero-image prompt engineer. The input is a structured hero-image blueprint, not a compact analysis summary. Generate one prompt per blueprint image in the exact same order.

Rules:
- Every image in the blueprint is the same exact SKU and same product. Never change color, material, logo, hardware, texture, silhouette, proportions, or construction.
- Absorb both design_specs and each image's own design_content into the prompt.
- If the blueprint contains identity-lock details, color anchors, material anchors, or key features, state them explicitly in the positive prompt instead of relying only on negative_prompt.
- negative_prompt is supplemental only. The positive prompt itself must explicitly forbid redesign, recoloring, and feature drift.
- If shared copy is required, include the exact copy, placement, hierarchy, whitespace, and readability instructions, and ensure the text does not cover the product.
- Every prompt must be written as natural English paragraphs, not as labeled sections such as Subject:, Composition:, or Background:.
- Default to at least two readable layers of scene depth. Except for clean packshot / white-background plans, do not use an empty background or a single flat backdrop.
- Lighting must feel directional and layered, explicitly covering the key light plus contour or ambient support.
- Do not make every composition square and static; absorb the blueprint's tilt, diagonal flow, rule-of-thirds placement, or high/low camera variation.
- Decorative elements must fit the product category and selling points instead of acting as generic premium filler.
- Visible-copy language rule: ${genesisCopyRuleEn}
- Return a strict JSON array only. Each item must contain prompt, title, negative_prompt, marketing_hook, priority.`;

  const systemPrompt = isGenesisModule
    ? isGenesisBlueprintMode
      ? language === "zh"
        ? genesisBlueprintSystemPromptZh
        : genesisBlueprintSystemPromptEn
      : language === "zh"
      ? `你是顶级电商主图提示词工程专家。请基于主图分析结果，为同一款商品生成一组可直接出图的主图提示词。

规则：
- 用户需求优先级高于产品图分析摘要。
- 所有提示词必须严格保持上传商品与参考图中的同一款商品，不得改款，不得换商品。
- 上传的产品图是硬参考，必须保留商品原本的颜色、材质、纹理、版型、轮廓、logo、印花、五金、车线和其他关键设计特征。
- 【颜色锚定——最高优先级】分析结果中的 product_visual_identity.primary_color 是产品的真实主色调，每条 prompt 必须在开头明确声明该颜色（含十六进制色值），并在 negative_prompt 中排除其他易混淆颜色（如产品是粉色则排除黑色、深色）。
- 每条 prompt 必须引用 product_visual_identity 中的 material 和 key_features，确保产品视觉身份不丢失。
- 只允许变化场景、机位、构图、景别、光线和背景，不允许改色、改材质、改细节、改结构。
- 如果提供了共享文案，必须把这段共享文案作为画面中的真实文字内容放进每一张图里，不能只表达相近意思，不能省略。
- 有共享文案时，每条 prompt 都必须明确说明文字内容、文字位置、版式层级、留白区域、可读性要求，以及文字不能遮挡商品主体。
- 如果共享文案为空，则生成纯图片版，明确写无文字叠加。
- 如果 outputLanguage 是 none，但用户手动提供了文案，按用户原文使用，不要翻译。
- 所选风格标签是高优先级视觉约束，但不要机械堆砌标签。
- 需要生成 exactly ${imageCount} 条提示词，每条提示词既要统一风格，又要在角度、景别、构图或场景上有合理变化。
- 文案语言硬约束：${genesisCopyRuleZh}
- title、marketing_hook 也必须遵守上述语言约束，不得出现英文单词或英文短语。
- 输出严格 JSON 数组，每项包含 prompt, title, negative_prompt, marketing_hook, priority。`
      : `You are a top-tier e-commerce hero-image prompt engineer. Based on the compact hero-image analysis, generate a set of production-ready prompts for the same product.

Rules:
- User requirements have higher priority than image-derived product analysis.
- All prompts must preserve the exact same product identity from the uploaded reference images.
- Treat the uploaded product images as hard references for the exact SKU. Do not change color, material, texture, silhouette, logo, print, hardware, stitching, proportions, or any signature design detail.
- [COLOR ANCHORING — HIGHEST PRIORITY] The product_visual_identity.primary_color from the analysis is the true dominant color. Every prompt must explicitly state this color (with hex value) at the beginning, and the negative_prompt must exclude confusable colors (e.g. if the product is pink, exclude black, dark tones).
- Every prompt must reference the material and key_features from product_visual_identity to ensure the product's visual identity is preserved.
- Only scene, camera angle, crop, composition, lighting, and background styling may vary.
- If shared copy is provided, render that exact shared copy as visible in-image text in every image. Do not paraphrase it and do not omit it.
- When shared copy exists, every prompt must explicitly define the text content, text placement, hierarchy, safe whitespace, readability, and that the text must not block the product.
- If shared copy is empty, generate pure visual prompts and explicitly state that there is no text overlay.
- If outputLanguage is none but the user manually provided copy, use the user's original copy without translation.
- Selected style tags are high-priority visual constraints, but integrate them naturally.
- Generate exactly ${imageCount} prompts. Keep them stylistically consistent while varying angle, framing, composition, or scene appropriately.
- The prompt field must be natural English paragraphs, not label-style sections such as Subject:, Composition:, or Lighting:.
- Build commercially rich scenes with readable depth, tactile background surfaces, directional lighting, and restrained category-relevant accents rather than a blank centered packshot.
- Visible-copy language rule: ${genesisCopyRuleEn}
- The title and marketing_hook fields must also follow the same language rule.
- Return a strict JSON array only. Each item must contain prompt, title, negative_prompt, marketing_hook, priority.`
    : isEcomDetailModule
    ? language === "zh"
      ? `你是顶级电商详情页提示词工程专家。请基于详情页规划蓝图，为同一商品的每个模块生成一条可直接出图的高质量提示词。

规则：
- 每条提示词必须严格对应一个详情页模块，顺序必须与蓝图中的 images 数组一致。
- 同一批提示词必须保持同一商品身份一致，不能改动产品造型、材质、颜色或结构。
- 必须充分吸收每个模块的标题、描述和 design_content，将模块目标转成明确的构图、光影、场景、材质和文案排版要求。
- 文案语言硬约束：${ecomDetailCopyRuleZh}
- 如果输出语言为 none，则不得生成任何画面文字要求。
- 如果输出语言为简体中文，所有新增可见文案必须直接写简体中文，不能出现英文单词、拼音、双语混排或英文占位词；若蓝图里出现英文样例，也必须保留原意改写成中文后再写入 prompt。
- 如果某个模块本身更适合信息型版式（如规格表、售后保障、使用建议），也必须保持可视化、可落地的电商详情页表达。
- 规格表、售后保障、使用建议、成分说明、前后对比、核心卖点等模块中的表头、字段名、标签、CTA、对比项和注释，同样必须遵守目标语言硬约束。
- 输出严格 JSON 数组，每项包含 prompt, title, negative_prompt, marketing_hook, priority。`
      : `You are a top-tier e-commerce detail-page prompt engineer. Based on the approved blueprint, generate one production-ready prompt for each detail-page module of the same product.

Rules:
- Each prompt must map to exactly one module, in the same order as the blueprint images array.
- Keep the same product identity across the full set without altering shape, color, material, or structure.
- Turn each module title, description, and design_content into a concrete prompt covering composition, scene, lighting, material, and copy layout when needed.
- Visible-copy language rule: ${ecomDetailCopyRuleEn}
- If output language is none, do not introduce any in-image text requirements.
- If outputLanguage is Simplified Chinese, all added visible copy must be written directly in Simplified Chinese only. If the blueprint contains accidental English examples, preserve the meaning but convert them into Simplified Chinese prompt instructions instead of copying them.
- Information-heavy modules such as spec tables, after-sales guarantees, or usage tips must still remain visual, commercially styled, and image-generation friendly.
- The same language rule applies to headlines, subtitles, body copy, spec-table headers, spec values, badges, CTAs, guarantee text, step labels, annotations, and comparison labels.
- Return a strict JSON array only. Each item must contain prompt, title, negative_prompt, marketing_hook, priority.`
    : isModelTryOn
    ? language === "zh"
      ? systemPromptModelTryOnZh
      : systemPromptModelTryOnEn
    : language === "zh"
    ? isClothing
      ? systemPromptClothingZh
      : `你是顶级电商视觉提示词工程专家。根据产品分析蓝图，为每张图片生成一段结构化、高精度的图像生成提示词。

每段提示词必须从以下6个核心维度展开：
1. 主体（Subject）：产品精确描述，保持与参考图完全一致
2. 风格（Style）：摄影风格、焦段、后期调性
3. 场景（Scene）：背景环境、多层景深描述、构图布局
4. 光影（Lighting）：光源类型、方向、补光、阴影氛围
5. 材质（Material）：表面质感、物理特性、色值
6. 角度（Angle）：拍摄视角、倾斜度、产品占比

同时按以下顺序覆盖全部补充维度（自然段落式英文）：
Composition（构图：占比/布局/倾斜角度）→ Color scheme（配色：含精确十六进制色值）→ Text layout（文字排布：位置/内容，若无文字则写"No typography"）→ Inset images（嵌入图：若有则说明位置与尺寸，否则省略此段）→ Atmosphere（氛围：关键词）→ Quality（画质：固定写 "8K resolution, hyper-realistic, commercial photography grade"）。

输出要求：严格 JSON 数组，每个元素包含 prompt, title, negative_prompt, marketing_hook, priority 字段，不含 Markdown，不含解释。`
    : isClothing
      ? systemPromptClothingEn
      : `You are a top-tier e-commerce visual prompt engineer. Based on the product analysis blueprint, generate one structured, high-precision image generation prompt per image plan.

Each prompt must be built around these 6 core dimensions:
1. Subject: Precise product description, must match the reference image exactly
2. Style: Photography style, focal length, post-processing tone
3. Scene: Background environment, multi-layer depth description, composition layout
4. Lighting: Light source type, direction, fill light, shadow atmosphere
5. Material: Surface texture, physical properties, hex color values
6. Angle: Camera angle, tilt, product-to-frame ratio

Additionally, cover these supplementary dimensions (written as natural English paragraphs):
Color scheme (exact hex values from blueprint) → Text layout (position and copy; write "No typography" if no text) → Inset images (position and size if any, otherwise omit) → Atmosphere (mood keywords) → Quality (always end with: "8K resolution, hyper-realistic, commercial photography grade, zero artifacts").

Output a strict JSON array only; each element must contain prompt, title, negative_prompt, marketing_hook, priority fields; no Markdown; no explanations.`;

  const genesisLangRule = language === "zh"
    ? `- 语言硬约束：所有 prompt 中的文案描述、title、marketing_hook 必须使用简体中文，禁止英文单词、英文短语、拼音或双语混排。prompt 字段中描述画面文字内容时也必须使用简体中文。
- ${genesisCopyRuleZh}`
    : language === "none"
    ? `- Language rule: if shared copy is empty, keep the image visual-only with no text overlay. If the user explicitly provided copy, use that exact original copy without translation or paraphrase.`
    : `- Visible-copy language rule: ${genesisCopyRuleEn}
- The title and marketing_hook fields must also use ${outputLanguageLabel(language)}.`;

  const userPrompt = isGenesisModule
    ? isGenesisBlueprintMode
    ? `
Generate exactly ${imageCount} prompt objects.

Output schema (v2):
[{"prompt": "<full detailed prompt text>", "title": "<short purpose title>", "negative_prompt": "<things to avoid, or empty string>", "marketing_hook": "<one-line marketing angle, or empty string>", "priority": <integer 0-10, 0=default>}]

Rules:
- One prompt object per blueprint image, in the same order as the blueprint images array.
- Reuse each blueprint title as the prompt title when reasonable.
- Keep all prompts locked to the exact same product identity across the whole set.
- The positive prompt must explicitly mention the color anchor, material anchor, and key features whenever they are present in the blueprint.
- The positive prompt must explicitly say that color, material, logo, hardware, texture, silhouette, proportions, and structure cannot change.
- If the blueprint requires visible copy, the prompt must include the exact copy instructions, placement, hierarchy, whitespace, readability, and non-occlusion rules.
- Use negative_prompt to list the most likely drift risks, including wrong colors, wrong materials, missing logo, changed hardware, or simplified structure.
- The prompt field must be natural English paragraphs, not label-style sections such as Subject:, Composition:, or Lighting:.
- Make the scene feel commercially staged: include readable depth layers, a tactile background surface, directional light, and category-appropriate accents instead of a flat empty packshot.
${genesisLangRule}
- Return JSON array only. No markdown fences. No explanation text.

Hero blueprint:
${analysisJson}

Design specs override (if provided):
${designSpecs ?? "(none)"}

Style constraints (if provided):
${styleConstraintPrompt || "(none)"}
`
    : `
Generate exactly ${imageCount} prompt objects.

Output schema (v2):
[{"prompt": "<full detailed prompt text>", "title": "<short purpose title>", "negative_prompt": "<things to avoid, or empty string>", "marketing_hook": "<one-line marketing angle, or empty string>", "priority": <integer 0-10, 0=default>}]

Rules:
- One prompt object per output image, in stable order.
- Keep product appearance faithful to the compact analysis summary and the uploaded reference images.
- Prioritize user requirements over inferred product traits when conflicts appear.
- The uploaded product images are hard product references of the same item from different angles. Every prompt must explicitly preserve the exact same product colorway, materials, texture, silhouette, logo, print, trims, and key construction details.
- [COLOR ANCHORING] Read product_visual_identity.primary_color from the analysis. Every prompt MUST begin by explicitly stating this exact color and hex value for the product. The negative_prompt MUST exclude colors that could be confused (e.g. if product is pink (#FFB6C1), negative_prompt must include "black bag, dark colored bag, gray bag").
- Every prompt must reference the material and key_features from product_visual_identity.
- Never redesign, recolor, swap fabric, simplify details, or replace the product with a similar item.
- Only vary scene setup, camera angle, framing, composition, and lighting.
- If shared copy is empty, do not introduce any text overlay.
- If shared copy is non-empty, use that exact copy text in every prompt as visible typography on the image.
- For non-empty shared copy, every prompt must explicitly include:
  1. the exact copy text to render,
  2. where the text sits in the frame,
  3. typography hierarchy and readability requirements,
  4. instruction that the text must not cover or distort the product.
- Use selected style tags as strong visual guidance.
${genesisLangRule}
- Return JSON array only. No markdown fences. No explanation text.

Compact hero-image analysis:
${analysisJson}

Style constraints (if provided):
${styleConstraintPrompt || "(none)"}
`
    : isEcomDetailModule
    ? `
Generate exactly ${imageCount} prompt objects.

Output schema (v2):
[{"prompt": "<full detailed prompt text>", "title": "<module title>", "negative_prompt": "<things to avoid, or empty string>", "marketing_hook": "<one-line marketing angle, or empty string>", "priority": <integer 0-10, 0=default>}]

Rules:
- One prompt object per detail-page module, in the same order as the blueprint.
- Reuse the module title as the prompt title when possible.
- Keep all prompts faithful to the same product and the same selected module intent.
- If design_specs and image plans disagree, follow the image plan first and design_specs second.
- Output language has higher priority than any accidental sample copy inside the blueprint. If the blueprint includes non-target-language sample text, preserve the meaning but rewrite the copy requirements into the target language instead of copying it verbatim.
- ${ecomDetailCopyRuleEn}
- Return JSON array only. No markdown fences. No explanation text.

Detail-page blueprint:
${analysisJson}

Design specs override (if provided):
${designSpecs ?? "(none)"}
`
    : isModelTryOn
    ? language === "zh"
      ? `
Generate exactly ${imageCount} prompt objects.

Output schema (v2):
[{"prompt": "<full detailed prompt text>", "title": "<short purpose title>", "negative_prompt": "<things to avoid, or empty string>", "marketing_hook": "<one-line marketing angle, or empty string>", "priority": <integer 0-10, 0=default>}]

Rules:
- One prompt object per image plan, in the same order as the blueprint images array.
- Read and use subject_profile, garment_profile, tryon_strategy, design_specs, and each image's own design_content together.
- The positive prompt must explicitly lock the reference subject. If subject_profile.subject_type is pet or other, the prompt must explicitly keep the subject non-human.
- The positive prompt must explicitly say the garment is worn by the reference subject, with correct wear region and natural fit.
- If the plan title is “人台图”, reinterpret it as a standardized subject showcase image, not a mannequin-only shot.
- Keep the exact same garment identity across the full set. No recolor, redesign, or simplification.
- title should reuse the image plan title when reasonable.
- negative_prompt must explicitly include species swap, humanized animal, animalized human, floating garment, wrong wear placement, extra limbs, distorted anatomy, missing logo, wrong color, wrong material, and missing details.
- If output language is none, require pure visual composition with no added visible text.
- Return JSON array only. No markdown fences. No explanation text.

Try-on blueprint:
${analysisJson}

Design specs override (if provided):
${designSpecs ?? "(none)"}
`
      : `
Generate exactly ${imageCount} prompt objects.

Output schema (v2):
[{"prompt": "<full detailed prompt text>", "title": "<short purpose title>", "negative_prompt": "<things to avoid, or empty string>", "marketing_hook": "<one-line marketing angle, or empty string>", "priority": <integer 0-10, 0=default>}]

Rules:
- One prompt object per image plan, in the same order as the blueprint images array.
- Read and use subject_profile, garment_profile, tryon_strategy, design_specs, and each image's own design_content together.
- The positive prompt must explicitly lock the reference subject. If subject_profile.subject_type is pet or other, the prompt must explicitly keep the subject non-human.
- The positive prompt must explicitly state that the garment is worn by the reference subject with the correct wear region and natural fit.
- If the plan title is “人台图”, reinterpret it as a standardized subject showcase image rather than a mannequin-only shot.
- Keep the exact same garment identity across the full set. No recolor, redesign, or simplification.
- Reuse the image plan title as the prompt title when reasonable.
- negative_prompt must explicitly include species swap, humanized animal, animalized human, floating garment, wrong wear placement, extra limbs, distorted anatomy, missing logo, wrong color, wrong material, and missing details.
- If output language is none, require pure visual composition with no added visible text.
- Return JSON array only. No markdown fences. No explanation text.

Try-on blueprint:
${analysisJson}

Design specs override (if provided):
${designSpecs ?? "(none)"}
`
    : `
Generate exactly ${imageCount} prompt objects.

For each image plan in the blueprint, identify its shot type (white background, 3D ghost mannequin, detail close-up, selling point, or scene/lifestyle) from the title and design_content, then apply the corresponding shot-type rules from your instructions.

Output schema (v2):
[{"prompt": "<full detailed prompt text>", "title": "<short purpose title>", "negative_prompt": "<things to avoid, or empty string>", "marketing_hook": "<one-line marketing angle, or empty string>", "priority": <integer 0-10, 0=default>}]

All fields required. "prompt" is the main generation text. Other fields may be empty string / 0 if not applicable.

Rules:
- One prompt object per image plan, in the same order as the blueprint.
- Each prompt must be self-contained and immediately usable for image generation.
- Extract and use exact hex color codes from the blueprint's color system and product description.
- If output language is "none", no in-image text of any kind — pure visual composition only.
- Otherwise, keep any in-image text language as: ${language === "none" ? "none (no text)" : language}.
- If style constraints are provided, treat them as highest priority visual requirements.
- Return JSON array only. No markdown fences. No explanation text.

Analysis blueprint:
${analysisJson}

Design specs override (if provided):
${designSpecs ?? "(none)"}

Style constraints (highest priority, if provided):
${styleConstraintPrompt || "(none)"}
`;

  const promptLocale = language === "zh" ? "zh" : "en";
  const promptFlow = isGenesisModule
    ? "genesis"
    : isEcomDetailModule
    ? "ecom-detail"
    : isModelTryOn
    ? "clothing-tryon"
    : isClothing
    ? "clothing-basic"
    : "default";
  const promptRegistryKey = buildPromptRegistryKey({
    flow: promptFlow,
    stage: "generate",
    locale: promptLocale,
    profile: promptProfile,
  });
  const finalSystemPrompt = applyPromptVariant(promptRegistryKey, "system", systemPrompt);
  const finalUserPrompt = applyPromptVariant(promptRegistryKey, "user", userPrompt);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));

        if (useDeterministicGenesisPrompts && normalizedGenesisRecord) {
          const content = JSON.stringify(
            buildGenesisHeroPromptObjects({
              analysisRecord: normalizedGenesisRecord,
              language,
              promptProfile,
              styleConstraintPrompt,
            }),
          );
          const chunkSize = 96;
          for (let i = 0; i < content.length; i += chunkSize) {
            fullText += content.slice(i, i + chunkSize);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          return;
        }

        // Pick a random endpoint from the pool for load distribution
        const config = getQnChatConfig();
        const isAzure = config.endpoint.includes(".openai.azure.com") || config.endpoint.includes(".cognitiveservices.azure.com") || config.endpoint.includes(".services.ai.azure.com");

        const controller2 = new AbortController();
        const timer = setTimeout(() => controller2.abort(), config.timeoutMs * 2);
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (isAzure) {
            headers["api-key"] = config.apiKey;
          } else {
            headers["Authorization"] = `Bearer ${config.apiKey}`;
          }

          const body: Record<string, unknown> = {
            stream: true,
            messages: [
              { role: "system", content: finalSystemPrompt },
              { role: "user", content: finalUserPrompt },
            ],
            max_tokens: Math.min(4096, 256 * imageCount + 512),
          };
          if (!isAzure) {
            body.model = config.model;
          }

          const res = await fetch(config.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller2.signal,
          });
          clearTimeout(timer);

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`QN_CHAT_API_ERROR ${res.status}: ${errorText}`);
          }

          if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed?.choices?.[0]?.delta?.content;
                  if (typeof delta === "string" && delta.length > 0) {
                    fullText += delta;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));
                  }
                } catch {
                  // ignore non-json line
                }
              }
            }
          } else {
            const chatResponse = await res.json().catch(() => ({})) as Record<string, unknown>;
            const content = String(chatResponse?.choices?.[0]?.message?.content ?? "");
            const chunkSize = 80;
            for (let i = 0; i < content.length; i += chunkSize) {
              fullText += content.slice(i, i + chunkSize);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
          }
        } finally {
          clearTimeout(timer);
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText, error: message })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

if (import.meta.main) {
  Deno.serve(handleGeneratePromptsRequest);
}
