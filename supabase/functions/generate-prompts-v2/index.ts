import { corsHeaders } from "../_shared/cors.ts";
import { options, err } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { getQnChatConfig } from "../_shared/qn-image.ts";

function sanitizeLanguage(value: unknown): string {
  const v = String(value ?? "en").toLowerCase();
  if (["none", "en", "zh", "ja", "ko", "es", "fr", "de", "pt", "ar", "ru"].includes(v)) return v;
  return "en";
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
  } | null;
  if (!body?.analysisJson) return err("BAD_REQUEST", "analysisJson is required");

  const language = sanitizeLanguage(body.outputLanguage ?? body.targetLanguage ?? "en");
  const clothingModeVal = typeof body.clothingMode === "string" ? body.clothingMode.trim() : "";
  const isClothing = clothingModeVal.length > 0;
  const isModelTryOn = clothingModeVal === "model_prompt_generation";
  const analysisJson = typeof body.analysisJson === "string"
    ? body.analysisJson
    : JSON.stringify(body.analysisJson, null, 2);
  const designSpecs = body.design_specs
    ? (typeof body.design_specs === "string" ? body.design_specs : JSON.stringify(body.design_specs, null, 2))
    : null;
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
- 严格输出 JSON 数组，每个元素仅含 prompt 字段，不含 Markdown，不含任何解释。`;

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
- Output a strict JSON array only; each element has only a prompt field; no Markdown; no explanations.`;

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

输出要求：严格 JSON 数组，每个元素仅含 prompt 字段，不含 Markdown，不含解释。`;

  const systemPrompt = isModelTryOn
    ? systemPromptModelTryOn
    : language === "zh"
    ? isClothing
      ? systemPromptClothingZh
      : `你是顶级电商视觉提示词工程专家。根据产品分析蓝图，为每张图片生成一段结构化、高精度的图像生成提示词。

每段提示词必须按以下顺序覆盖全部维度（自然段落式英文）：
Subject（主体：产品描述，必须与参考图完全一致）→ Composition（构图：占比/布局/倾斜角度）→ Background（背景：多层景深描述）→ Lighting（光影：光源类型/方向/补光/氛围效果）→ Color scheme（配色：含精确十六进制色值）→ Material details（材质：面料/表面质感/物理特性）→ Text layout（文字排布：位置/内容，若无文字则写"No typography"）→ Inset images（嵌入图：若有则说明位置与尺寸，否则省略此段）→ Atmosphere（氛围：关键词）→ Style（风格：摄影风格/焦段）→ Quality（画质：固定写 "8K resolution, hyper-realistic, commercial photography grade"）。

输出要求：严格 JSON 数组，每个元素仅含 prompt 字段，不含 Markdown，不含解释。`
    : isClothing
      ? systemPromptClothingEn
      : `You are a top-tier e-commerce visual prompt engineer. Based on the product analysis blueprint, generate one structured, high-precision image generation prompt per image plan.

Each prompt must cover all of the following dimensions in order (written as natural English paragraphs):
Subject (product description matching reference image exactly) → Composition (framing %, layout, tilt angle) → Background (multi-layer depth description) → Lighting (source type, direction, fill light, shadow atmosphere) → Color scheme (exact hex values from blueprint) → Material details (surface texture, physical properties, finish) → Text layout (position and copy; write "No typography" if no text) → Inset images (position and size if any, otherwise omit) → Atmosphere (mood keywords) → Style (photography style, focal length) → Quality (always end with: "8K resolution, hyper-realistic, commercial photography grade, zero artifacts").

Output a strict JSON array only; each element has only a prompt field; no Markdown; no explanations.`;

  const userPrompt = `
Generate exactly ${imageCount} prompt objects.

For each image plan in the blueprint, identify its shot type (white background, 3D ghost mannequin, detail close-up, selling point, or scene/lifestyle) from the title and design_content, then apply the corresponding shot-type rules from your instructions.

Output schema:
[{"prompt": "<full detailed prompt text>"}]

Rules:
- One prompt object per image plan, in the same order as the blueprint.
- Each prompt must be self-contained and immediately usable for image generation.
- Extract and use exact hex color codes from the blueprint's color system and product description.
- If output language is "none", no in-image text of any kind — pure visual composition only.
- Otherwise, keep any in-image text language as: ${language === "none" ? "none (no text)" : language}.
- Return JSON array only. No markdown fences. No explanation text.

Analysis blueprint:
${analysisJson}

Design specs override (if provided):
${designSpecs ?? "(none)"}
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
            max_tokens: 2048,
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
