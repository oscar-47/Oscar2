import { options, ok, err } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { callQnChatAPI, getQnChatConfig } from "../_shared/qn-image.ts";

type StyleDimensionKey = "sceneStyle" | "lighting" | "composition" | "colorTone" | "material";
type Selections = Partial<Record<StyleDimensionKey, string>>;

const ALLOWED_OPTIONS: Record<StyleDimensionKey, string[]> = {
  sceneStyle: ["minimal", "natural", "urban", "luxury", "industrial"],
  lighting: ["natural", "warm", "cool", "dramatic", "soft"],
  composition: ["front", "overhead45", "topDown", "closeUp", "wide"],
  colorTone: ["original", "warmTone", "coolTone", "monochrome", "vibrant"],
  material: ["default", "matte", "glossy", "wood", "marble"],
};

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj?.[0]) candidates.push(obj[0].trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore and continue
    }
  }
  return null;
}

function sanitizeSelections(raw: unknown): Selections {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Selections = {};

  for (const key of Object.keys(ALLOWED_OPTIONS) as StyleDimensionKey[]) {
    const value = obj[key];
    if (typeof value !== "string") continue;
    if (ALLOWED_OPTIONS[key].includes(value)) {
      out[key] = value;
    }
  }
  return out;
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0, Math.min(1, n));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as {
    contextText?: unknown;
    analysisJson?: unknown;
    module?: unknown;
    uiLanguage?: unknown;
  } | null;

  if (!body) return err("BAD_REQUEST", "invalid request body");

  const contextText = typeof body.contextText === "string" ? body.contextText.trim() : "";
  const analysisJson = body.analysisJson
    ? (typeof body.analysisJson === "string" ? body.analysisJson : JSON.stringify(body.analysisJson, null, 2))
    : "";
  const module = typeof body.module === "string" ? body.module.trim() : "unknown";
  const uiLanguage = typeof body.uiLanguage === "string" ? body.uiLanguage.toLowerCase() : "en";

  if (!contextText && !analysisJson) {
    return ok({ selections: {}, confidence: 0, source: "ai" });
  }

  const isZh = uiLanguage.startsWith("zh");

  const systemPrompt = isZh
    ? "你是电商视觉风格顾问。请基于输入内容，从固定的五个维度中各选一个最合适的值。只输出 JSON。"
    : "You are an e-commerce visual style assistant. Choose one best value for each of 5 fixed dimensions. Return JSON only.";

  const userPrompt = isZh
    ? `请从以下固定枚举中做推荐，严格返回 JSON 对象，格式：\n{"selections":{"sceneStyle":"...","lighting":"...","composition":"...","colorTone":"...","material":"..."},"confidence":0.0-1.0}\n\n枚举：\nsceneStyle: minimal|natural|urban|luxury|industrial\nlighting: natural|warm|cool|dramatic|soft\ncomposition: front|overhead45|topDown|closeUp|wide\ncolorTone: original|warmTone|coolTone|monochrome|vibrant\nmaterial: default|matte|glossy|wood|marble\n\n模块：${module}\n\n文本上下文：\n${contextText || "(无)"}\n\n分析蓝图：\n${analysisJson || "(无)"}`
    : `Return a strict JSON object in this schema:\n{"selections":{"sceneStyle":"...","lighting":"...","composition":"...","colorTone":"...","material":"..."},"confidence":0.0-1.0}\n\nAllowed enums:\nsceneStyle: minimal|natural|urban|luxury|industrial\nlighting: natural|warm|cool|dramatic|soft\ncomposition: front|overhead45|topDown|closeUp|wide\ncolorTone: original|warmTone|coolTone|monochrome|vibrant\nmaterial: default|matte|glossy|wood|marble\n\nModule: ${module}\n\nContext text:\n${contextText || "(none)"}\n\nAnalysis blueprint:\n${analysisJson || "(none)"}`;

  try {
    const chatConfig = getQnChatConfig();
    const chatResponse = await callQnChatAPI({
      model: chatConfig.model,
      maxTokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const messageContent = (() => {
      try {
        const choices = (chatResponse as Record<string, unknown>).choices as Array<Record<string, unknown>>;
        const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
        return typeof msg?.content === "string" ? msg.content : "";
      } catch {
        return "";
      }
    })();

    const parsed = extractJsonObject(messageContent);
    const selections = sanitizeSelections(parsed?.selections);
    const confidence = clampConfidence(parsed?.confidence);

    return ok({
      selections,
      confidence,
      source: "ai",
      model: chatConfig.model,
    });
  } catch {
    return ok({
      selections: {},
      confidence: 0,
      source: "ai",
    });
  }
});
