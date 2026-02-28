export type QnImageConfig = {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
};

export type QnChatConfig = {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
};

export function getQnImageConfig(): QnImageConfig {
  const apiKey = Deno.env.get("QN_IMAGE_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("Missing QN_IMAGE_API_KEY");
  }

  return {
    apiKey,
    // Default endpoint — overridden by env vars for Azure FLUX or other providers.
    endpoint: Deno.env.get("QN_IMAGE_API_ENDPOINT") ?? "https://api.qnaigc.com/v1/images/edits",
    model: Deno.env.get("QN_IMAGE_MODEL") ?? "gemini-3.0-pro-image-preview",
    timeoutMs: Number(Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS") ?? "30000"),
  };
}

export function getQnChatConfig(): QnChatConfig {
  const apiKey = Deno.env.get("QN_CHAT_API_KEY")
    ?? Deno.env.get("QN_IMAGE_API_KEY")
    ?? "";
  if (!apiKey) {
    throw new Error("Missing QN_CHAT_API_KEY (or QN_IMAGE_API_KEY fallback)");
  }

  return {
    apiKey,
    endpoint: Deno.env.get("QN_CHAT_API_ENDPOINT") ?? "https://api.qnaigc.com/v1/chat/completions",
    model: Deno.env.get("QN_CHAT_MODEL") ?? "moonshotai/kimi-k2.5",
    timeoutMs: Number(Deno.env.get("QN_CHAT_REQUEST_TIMEOUT_MS")
      ?? Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS")
      ?? "30000"),
  };
}

/** Detect Azure OpenAI endpoints (.openai.azure.com or .cognitiveservices.azure.com) */
function isAzureOpenAI(url: string): boolean {
  return url.includes(".openai.azure.com") || url.includes(".cognitiveservices.azure.com");
}

/** Detect Azure AI Foundry endpoints (.services.ai.azure.com) */
function isAzureAIFoundry(url: string): boolean {
  return url.includes(".services.ai.azure.com");
}

/** Detect Volcengine Ark image generation endpoint */
function isVolcArk(url: string): boolean {
  return url.includes("ark.cn-beijing.volces.com/api/v3/images/generations");
}

/** Detect OpenAI native images edits endpoint */
function isOpenAINativeEdits(url: string): boolean {
  return url.includes("api.openai.com/v1/images/edits");
}

function normalizeArkSize(size: string | undefined): string {
  if (!size) return "2048x2048";
  // Pass through pixel dimensions (e.g. "2048x3072")
  if (/^\d+x\d+$/i.test(size)) return size;
  // Named sizes
  if (size === "2K") return "2048x2048";
  if (size === "4K") return "4096x4096";
  return "2048x2048";
}

/** Any Azure endpoint */
function isAzureEndpoint(url: string): boolean {
  return isAzureOpenAI(url) || isAzureAIFoundry(url);
}

export async function callQnChatAPI(params: {
  messages: Array<Record<string, unknown>>;
  model?: string;
  maxTokens?: number;
  stream?: boolean;
}): Promise<Record<string, unknown>> {
  const config = getQnChatConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const azure = isAzureEndpoint(config.endpoint);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (azure) {
      headers["api-key"] = config.apiKey;
    } else {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    // Azure endpoints include model in URL path, so omit from body
    const body: Record<string, unknown> = {
      stream: params.stream ?? false,
      messages: params.messages,
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    };
    if (!azure) {
      body.model = params.model ?? config.model;
    }

    const res = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      throw new Error(`QN_CHAT_API_ERROR ${res.status}: ${JSON.stringify(parsed)}`);
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** Convert a data:image/...;base64,... URL to a Blob */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(",", 2);
  const mime = header?.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bytes = Uint8Array.from(atob(b64 ?? ""), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

/** Detect Azure AI Foundry /images/generations (e.g. FLUX Kontext Pro) — uses JSON body */
function isAzureAIFoundryGenerations(url: string): boolean {
  return isAzureAIFoundry(url) && url.includes("/images/generations");
}

/** Map aspect ratio string to pixel dimensions supported by Doubao Seedream */
export function aspectRatioToSize(ratio: string): string {
  switch (ratio) {
    case "2:3":
      return "2048x3072";
    case "3:2":
      return "3072x2048";
    case "3:4":
      return "1920x2560";
    case "4:3":
      return "2560x1920";
    case "9:16":
      return "1440x2560";
    case "16:9":
      return "2560x1440";
    case "4:5":
      return "2048x2560";
    case "5:4":
      return "2560x2048";
    case "1:2":
      return "1440x2880";
    case "2:1":
      return "2880x1440";
    case "21:9":
      return "3360x1440";
    default:
      return "2048x2048"; // square (1:1 or unknown)
  }
}

export async function callQnImageAPI(params: {
  imageDataUrl: string;
  imageDataUrls?: string[];
  prompt: string;
  n?: number;
  model?: string;
  size?: string;
  endpointOverride?: string;
  apiKeyOverride?: string;
  timeoutMsOverride?: number;
}): Promise<Record<string, unknown>> {
  const envEndpoint = Deno.env.get("QN_IMAGE_API_ENDPOINT") ?? "https://api.qnaigc.com/v1/images/edits";
  const envModel = Deno.env.get("QN_IMAGE_MODEL") ?? "gemini-3.0-pro-image-preview";
  const envApiKey = Deno.env.get("QN_IMAGE_API_KEY") ?? "";
  const envTimeoutMs = Number(Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS") ?? "30000");

  const endpoint = params.endpointOverride ?? envEndpoint;
  const apiKey = params.apiKeyOverride ?? envApiKey;
  const model = params.model ?? envModel;
  if (!apiKey) {
    throw new Error("Missing image API key");
  }

  const timeoutMs = Number.isFinite(params.timeoutMsOverride)
    ? Number(params.timeoutMsOverride)
    : envTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const azure = isAzureEndpoint(endpoint);
  const size = params.size ?? "1024x1024";

  try {
    let res: Response;

    if (isAzureAIFoundryGenerations(endpoint)) {
      // Azure AI Foundry /images/generations (e.g. FLUX Kontext Pro): JSON body
      const images = params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : [params.imageDataUrl];
      const jsonBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        n: params.n ?? 1,
        size: size,
        image: images.length === 1 ? images[0] : images,
      };
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(jsonBody),
        signal: controller.signal,
      });
    } else if (azure || isOpenAINativeEdits(endpoint)) {
      // Azure OpenAI or AI Foundry /images/edits: multipart FormData
      const form = new FormData();
      const images = params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : [params.imageDataUrl];
      if (images.length === 1) {
        form.append("image", dataUrlToBlob(images[0]), "image-0.png");
      } else {
        for (let i = 0; i < images.length; i++) {
          form.append("image[]", dataUrlToBlob(images[i]), `image-${i}.png`);
        }
      }
      form.append("prompt", params.prompt);
      form.append("n", String(params.n ?? 1));
      form.append("size", size);
      if (isAzureAIFoundry(endpoint) || isOpenAINativeEdits(endpoint)) {
        form.append("model", model);
      }
      if (isAzureAIFoundry(endpoint)) {
        form.append("output_format", "png");
      }

      const headers: Record<string, string> = {};
      if (isAzureAIFoundry(endpoint)) {
        headers["Api-Key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
    } else if (isVolcArk(endpoint)) {
      // Volcengine Ark (Doubao Seedream): JSON body with image array (data URLs)
      const images = (params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : params.imageDataUrl ? [params.imageDataUrl] : []
      ).filter(Boolean);
      const arkBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        sequential_image_generation: "disabled",
        response_format: "url",
        watermark: false,
      };
      if (images.length > 0) {
        arkBody.image = images;
      }
      arkBody.size = normalizeArkSize(params.size);
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(arkBody),
        signal: controller.signal,
      });
    } else {
      const images = params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : [params.imageDataUrl];

      // OpenAI-compatible edits: always use multipart FormData so the proxy
      // receives proper binary image data (JSON string was silently ignored).
      const form = new FormData();
      if (images.length === 1) {
        form.append("image", dataUrlToBlob(images[0]), "image-0.png");
      } else {
        for (let i = 0; i < images.length; i++) {
          form.append("image[]", dataUrlToBlob(images[i]), `image-${i}.png`);
        }
      }
      form.append("model", model);
      form.append("prompt", params.prompt);
      form.append("n", String(params.n ?? 1));
      form.append("size", size);

      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      throw new Error(`QN_IMAGE_API_ERROR ${res.status}: ${JSON.stringify(parsed)}`);
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

// ── Gemini native image generation ──────────────────────────────────

export type GeminiImageConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export function getGeminiImageConfig(): GeminiImageConfig {
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  return {
    apiKey,
    model: Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-2.0-flash-preview-image-generation",
    timeoutMs: Number(Deno.env.get("GEMINI_IMAGE_TIMEOUT_MS") ?? "60000"),
  };
}

/** Strip data:image/...;base64, prefix and return raw base64 + mimeType */
function parseDataUrl(dataUrl: string): { base64: string; mimeType: string } {
  if (dataUrl.startsWith("data:")) {
    const [header, b64] = dataUrl.split(",", 2);
    const mimeType = header?.match(/data:(.*?);/)?.[1] ?? "image/png";
    return { base64: b64 ?? "", mimeType };
  }
  // Already raw base64
  return { base64: dataUrl, mimeType: "image/png" };
}

/**
 * Call Google Gemini generateContent endpoint for image generation / editing.
 *
 * - Text-to-image: pass only prompt (no images)
 * - Image editing: pass prompt + one or more imageDataUrls
 *
 * Returns the raw Gemini API response.
 */
export async function callGeminiImageAPI(params: {
  prompt: string;
  imageDataUrls?: string[];
  aspectRatio?: string;
  model?: string;
  timeoutMsOverride?: number;
}): Promise<Record<string, unknown>> {
  const config = getGeminiImageConfig();
  const model = params.model ?? config.model;
  const timeoutMs = Number.isFinite(params.timeoutMsOverride)
    ? Number(params.timeoutMsOverride)
    : config.timeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build content parts: text first, then images
    const parts: Record<string, unknown>[] = [{ text: params.prompt }];

    if (params.imageDataUrls && params.imageDataUrls.length > 0) {
      for (const dataUrl of params.imageDataUrls) {
        const { base64, mimeType } = parseDataUrl(dataUrl);
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64,
          },
        });
      }
    }

    const body: Record<string, unknown> = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(params.aspectRatio
          ? { imageConfig: { aspectRatio: params.aspectRatio } }
          : {}),
      },
    };

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      throw new Error(`GEMINI_IMAGE_API_ERROR ${res.status}: ${JSON.stringify(parsed)}`);
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the generated image from a Gemini generateContent response.
 * Returns { b64, mimeType } matching the shape expected by the worker.
 */
export function extractGeminiImageResult(
  response: Record<string, unknown>,
): { b64: string; mimeType: string } {
  // deno-lint-ignore no-explicit-any
  const candidates = (response as any)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("GEMINI_IMAGE_INVALID_RESPONSE: no candidates");
  }

  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new Error("GEMINI_IMAGE_INVALID_RESPONSE: no parts in candidate");
  }

  for (const part of parts) {
    if (part?.inlineData?.data || part?.inline_data?.data) {
      const inlineData = part.inlineData ?? part.inline_data;
      return {
        b64: inlineData.data as string,
        mimeType: (inlineData.mimeType ?? inlineData.mime_type ?? "image/png") as string,
      };
    }
  }

  throw new Error("GEMINI_IMAGE_INVALID_RESPONSE: no image payload found in parts");
}

// ── Legacy QN image result extractors ───────────────────────────────

export function extractGeneratedImageResult(response: Record<string, unknown>): { url?: string; b64?: string } {
  const data = response.data;
  if (!Array.isArray(data)) {
    throw new Error("QN_IMAGE_INVALID_RESPONSE: data is not array");
  }

  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;

    const url = typeof obj.url === "string" ? obj.url : "";
    if (url) return { url };

    if ("b64_json" in obj) {
      let base64Data = String(obj.b64_json ?? "");
      if (!base64Data) continue;
      const marker = "base64,";
      if (base64Data.includes(marker)) {
        base64Data = base64Data.split(marker)[1] ?? "";
      }
      if (base64Data) return { b64: base64Data };
    }
  }

  throw new Error("QN_IMAGE_INVALID_RESPONSE: no image payload found");
}

export function extractGeneratedImageBase64(response: Record<string, unknown>): string {
  const parsed = extractGeneratedImageResult(response);
  if (!parsed.b64) {
    throw new Error("QN_IMAGE_INVALID_RESPONSE: b64_json missing");
  }
  return parsed.b64;
}
