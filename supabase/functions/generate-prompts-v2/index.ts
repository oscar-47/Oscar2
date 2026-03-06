import { corsHeaders } from "../_shared/cors.ts";
import { options, err } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { getQnChatConfig } from "../_shared/qn-image.ts";

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
  } | null;
  if (!body?.analysisJson) return err("BAD_REQUEST", "analysisJson is required");

  const language = sanitizeLanguage(body.outputLanguage ?? body.targetLanguage ?? "en");
  const clothingModeVal = typeof body.clothingMode === "string" ? body.clothingMode.trim() : "";
  const module = typeof body.module === "string" ? body.module.trim() : "";
  const isClothing = clothingModeVal.length > 0;
  const isModelTryOn = clothingModeVal === "model_prompt_generation";
  const isGenesisModule = module === "genesis";
  const isEcomDetailModule = module === "ecom-detail";
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

  const systemPromptModelTryOn =
    `你是顶级电商模特试穿图提示词工程专家。根据拍摄策略蓝图，为每个镜头生成一段极具指导性的图像生成提示词。

每段提示词必须严格按以下11条编号格式输出（中文），最后加强制约束：

1.主体：[模特身份描述（从蓝图模特画像提取，强调必须与参考图保持绝对一致性）+ 姿势/神态，穿着[服装全称，含颜色/材质/关键设计细节]]
2.构图：[景别（七分身/全身/半身），布局方式（黄金分割/居中等），模特占比（如65%-70%），预留空间方向]
3.背景：[场景类型 + 前景/中景/背景三层描述 + 景深效果（浅景深/Bokeh等）]
4.光影：[光源类型 + 方向（如左上方45度侧逆光）+ 补光方案 + 突出效果]
5.配色方案：[主色调（含hex色值）+ 辅助色（含hex色值）+ 文字色值]
6.材质细节：[面料类型 + 视觉特征（哑光/光泽/纹理）+ 需要精准呈现的关键工艺细节]
7.文字布局：[文字位置 + 内容描述，若无文字则写"无文字（纯视觉）"]
8.嵌入图：[若有嵌入产品图说明位置与尺寸，否则写"此部分省略"]
9.氛围：[整体视觉氛围关键词 + 营销定位 + 情绪方向]
10.风格：[摄影风格（如35mm定焦）+ 核心视觉基调]
11.画质：[分辨率标准，固定写"4K分辨率，超清画质，极致锐度，商业摄影级品质"]
强制约束：[模特身份的3个核心不可偏离特征] + [服装的3个核心不可偏离特征]

输出要求：严格 JSON 数组，每个元素包含 prompt, title, negative_prompt, marketing_hook, priority 字段，不含 Markdown，不含解释。`;

  const systemPrompt = isGenesisModule
    ? language === "zh"
      ? `你是顶级电商主图提示词工程专家。请基于主图分析结果，为同一款商品生成一组可直接出图的主图提示词。

规则：
- 用户需求优先级高于产品图分析摘要。
- 所有提示词必须严格保持上传商品与参考图中的同一款商品，不得改款，不得换商品。
- 上传的产品图是硬参考，必须保留商品原本的颜色、材质、纹理、版型、轮廓、logo、印花、五金、车线和其他关键设计特征。
- 只允许变化场景、机位、构图、景别、光线和背景，不允许改色、改材质、改细节、改结构。
- 如果提供了共享文案，必须把这段共享文案作为画面中的真实文字内容放进每一张图里，不能只表达相近意思，不能省略。
- 有共享文案时，每条 prompt 都必须明确说明文字内容、文字位置、版式层级、留白区域、可读性要求，以及文字不能遮挡商品主体。
- 如果共享文案为空，则生成纯图片版，明确写无文字叠加。
- 如果 outputLanguage 是 none，但用户手动提供了文案，按用户原文使用，不要翻译。
- 所选风格标签是高优先级视觉约束，但不要机械堆砌标签。
- 需要生成 exactly ${imageCount} 条提示词，每条提示词既要统一风格，又要在角度、景别、构图或场景上有合理变化。
- 输出严格 JSON 数组，每项包含 prompt, title, negative_prompt, marketing_hook, priority。`
      : `You are a top-tier e-commerce hero-image prompt engineer. Based on the compact hero-image analysis, generate a set of production-ready prompts for the same product.

Rules:
- User requirements have higher priority than image-derived product analysis.
- All prompts must preserve the exact same product identity from the uploaded reference images.
- Treat the uploaded product images as hard references for the exact SKU. Do not change color, material, texture, silhouette, logo, print, hardware, stitching, proportions, or any signature design detail.
- Only scene, camera angle, crop, composition, lighting, and background styling may vary.
- If shared copy is provided, render that exact shared copy as visible in-image text in every image. Do not paraphrase it and do not omit it.
- When shared copy exists, every prompt must explicitly define the text content, text placement, hierarchy, safe whitespace, readability, and that the text must not block the product.
- If shared copy is empty, generate pure visual prompts and explicitly state that there is no text overlay.
- If outputLanguage is none but the user manually provided copy, use the user's original copy without translation.
- Selected style tags are high-priority visual constraints, but integrate them naturally.
- Generate exactly ${imageCount} prompts. Keep them stylistically consistent while varying angle, framing, composition, or scene appropriately.
- Return a strict JSON array only. Each item must contain prompt, title, negative_prompt, marketing_hook, priority.`
    : isEcomDetailModule
    ? language === "zh"
      ? `你是顶级电商详情页提示词工程专家。请基于详情页规划蓝图，为同一商品的每个模块生成一条可直接出图的高质量提示词。

规则：
- 每条提示词必须严格对应一个详情页模块，顺序必须与蓝图中的 images 数组一致。
- 同一批提示词必须保持同一商品身份一致，不能改动产品造型、材质、颜色或结构。
- 必须充分吸收每个模块的标题、描述和 design_content，将模块目标转成明确的构图、光影、场景、材质和文案排版要求。
- 如果输出语言为 none，则不得生成任何画面文字要求。
- 如果某个模块本身更适合信息型版式（如规格表、售后保障、使用建议），也必须保持可视化、可落地的电商详情页表达。
- 输出严格 JSON 数组，每项包含 prompt, title, negative_prompt, marketing_hook, priority。`
      : `You are a top-tier e-commerce detail-page prompt engineer. Based on the approved blueprint, generate one production-ready prompt for each detail-page module of the same product.

Rules:
- Each prompt must map to exactly one module, in the same order as the blueprint images array.
- Keep the same product identity across the full set without altering shape, color, material, or structure.
- Turn each module title, description, and design_content into a concrete prompt covering composition, scene, lighting, material, and copy layout when needed.
- If output language is none, do not introduce any in-image text requirements.
- Information-heavy modules such as spec tables, after-sales guarantees, or usage tips must still remain visual, commercially styled, and image-generation friendly.
- Return a strict JSON array only. Each item must contain prompt, title, negative_prompt, marketing_hook, priority.`
    : isModelTryOn
    ? systemPromptModelTryOn
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

  const userPrompt = isGenesisModule
    ? `
Generate exactly ${imageCount} prompt objects.

Output schema (v2):
[{"prompt": "<full detailed prompt text>", "title": "<short purpose title>", "negative_prompt": "<things to avoid, or empty string>", "marketing_hook": "<one-line marketing angle, or empty string>", "priority": <integer 0-10, 0=default>}]

Rules:
- One prompt object per output image, in stable order.
- Keep product appearance faithful to the compact analysis summary and the uploaded reference images.
- Prioritize user requirements over inferred product traits when conflicts appear.
- The uploaded product images are hard product references of the same item from different angles. Every prompt must explicitly preserve the exact same product colorway, materials, texture, silhouette, logo, print, trims, and key construction details.
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
- Return JSON array only. No markdown fences. No explanation text.

Detail-page blueprint:
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
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
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
