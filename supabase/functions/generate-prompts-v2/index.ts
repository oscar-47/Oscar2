import { corsHeaders } from "../_shared/cors.ts";
import { options, err } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { getQnChatConfig } from "../_shared/qn-image.ts";
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

function sanitizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function detectPlanType(value: unknown): string {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const explicit = sanitizeString(record.type, "").toLowerCase();
  if (["refined", "3d", "mannequin", "detail", "selling_point"].includes(explicit)) return explicit;

  const text = `${sanitizeString(record.title)} ${sanitizeString(record.description)} ${sanitizeString(record.design_content)}`.toLowerCase();
  if (/3d|ghost/.test(text)) return "3d";
  if (/人台|mannequin/.test(text)) return "mannequin";
  if (/细节|特写|macro|detail/.test(text)) return "detail";
  if (/卖点|selling point/.test(text)) return "selling_point";
  return "refined";
}

function parseClothingCopyAnalysis(value: unknown, fallbackLanguage: string): Record<string, unknown> | null {
  const analysis = parseAnalysisRecord(value);
  const raw = analysis?.copy_analysis && typeof analysis.copy_analysis === "object" && !Array.isArray(analysis.copy_analysis)
    ? analysis.copy_analysis as Record<string, unknown>
    : analysis?.copyAnalysis && typeof analysis.copyAnalysis === "object" && !Array.isArray(analysis.copyAnalysis)
    ? analysis.copyAnalysis as Record<string, unknown>
    : null;
  if (!raw) return null;

  const images = Array.isArray(analysis?.images) ? analysis?.images : [];
  const rawPlansValue = raw.per_plan_adaptations ?? raw.perPlanAdaptations;
  const rawPlans = Array.isArray(rawPlansValue)
    ? rawPlansValue as unknown[]
    : [];

  return {
    mode: sanitizeString(raw.mode, fallbackLanguage === "none" ? "visual-only" : "product-inferred"),
    resolved_output_language: sanitizeLanguage(raw.resolved_output_language ?? raw.resolvedOutputLanguage ?? fallbackLanguage),
    shared_copy: sanitizeString(raw.shared_copy ?? raw.sharedCopy, ""),
    per_plan_adaptations: images.map((image, index) => {
      const rawPlan = rawPlans[index] && typeof rawPlans[index] === "object" && !Array.isArray(rawPlans[index])
        ? rawPlans[index] as Record<string, unknown>
        : {};
      return {
        plan_index: Number.isFinite(Number(rawPlan.plan_index ?? rawPlan.planIndex))
          ? Math.max(0, Math.round(Number(rawPlan.plan_index ?? rawPlan.planIndex)))
          : index,
        plan_type: sanitizeString(rawPlan.plan_type ?? rawPlan.planType, detectPlanType(image)),
        copy_role: sanitizeString(rawPlan.copy_role ?? rawPlan.copyRole, "none"),
        adaptation_summary: sanitizeString(rawPlan.adaptation_summary ?? rawPlan.adaptationSummary, ""),
      };
    }),
  };
}

Deno.serve(async (req) => {
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
  const clothingCopyAnalysis = isClothing ? parseClothingCopyAnalysis(body.analysisJson, language) : null;
  const sharedClothingCopy = sanitizeString(clothingCopyAnalysis?.shared_copy, "");
  const clothingVisualOnly = isClothing && (language === "none" || sharedClothingCopy.length === 0);
  const isGenesisBlueprintMode = isGenesisModule && Array.isArray(analysisRecord?.images);
  const ecomDetailCopyRuleZh = buildVisibleCopyLanguageRule(language, true);
  const ecomDetailCopyRuleEn = buildVisibleCopyLanguageRule(language, false);
  const clothingCopyRuleZh = clothingVisualOnly
    ? "运行时共享主文案为空，所有图片必须保持纯视觉构图，禁止任何新增画面文字。"
    : buildVisibleCopyLanguageRule(language, true);
  const clothingCopyRuleEn = clothingVisualOnly
    ? "The runtime shared master copy is empty, so every image must stay visual-only with no added visible text."
    : buildVisibleCopyLanguageRule(language, false);
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
- 运行时以 analysisJson.copy_analysis.shared_copy 为最终文案裁决：若为空则所有图片必须纯视觉；若非空则整批共用同一份主文案，只允许按每张图的适配策略改变位置、层级和角色。
- 文案语言硬约束：${clothingCopyRuleZh}
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
- Treat analysisJson.copy_analysis.shared_copy as the final runtime copy authority: if it is empty, every image must remain visual-only; if it is present, the whole batch shares that same master copy and only placement, hierarchy, and role may change per image adaptation.
- Visible-copy language rule: ${clothingCopyRuleEn}
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
- 文案语言硬约束：${genesisCopyRuleZh}
- 输出严格 JSON 数组，每项包含 prompt, title, negative_prompt, marketing_hook, priority。`;
  const genesisBlueprintSystemPromptEn = `You are a top-tier e-commerce hero-image prompt engineer. The input is a structured hero-image blueprint, not a compact analysis summary. Generate one prompt per blueprint image in the exact same order.

Rules:
- Every image in the blueprint is the same exact SKU and same product. Never change color, material, logo, hardware, texture, silhouette, proportions, or construction.
- Absorb both design_specs and each image's own design_content into the prompt.
- If the blueprint contains identity-lock details, color anchors, material anchors, or key features, state them explicitly in the positive prompt instead of relying only on negative_prompt.
- negative_prompt is supplemental only. The positive prompt itself must explicitly forbid redesign, recoloring, and feature drift.
- If shared copy is required, include the exact copy, placement, hierarchy, whitespace, and readability instructions, and ensure the text does not cover the product.
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
- Read analysisJson.copy_analysis first. It is the final runtime source of truth for copy mode, shared_copy, and per-plan adaptations.
- If analysisJson.copy_analysis.shared_copy is empty, every prompt must explicitly require no added text overlay and pure visual composition only.
- If analysisJson.copy_analysis.shared_copy is non-empty:
  - Use that exact shared master copy across the full batch instead of inventing a new copy block.
  - Use per_plan_adaptations[i] to decide the copy role, placement, hierarchy, whitespace, and non-occlusion requirement for image i.
  - Do not paraphrase the shared copy into a different marketing message; only adapt how it is presented in each image.
- Runtime visible-copy language rule: ${clothingCopyRuleEn}
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

  const config = getQnChatConfig();
  const isAzure = config.endpoint.includes(".openai.azure.com") || config.endpoint.includes(".cognitiveservices.azure.com") || config.endpoint.includes(".services.ai.azure.com");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));

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
});
