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
    // Keep legacy/default QN behavior; doubao is injected per-request via override params.
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

/** Detect Azure OpenAI endpoints (.openai.azure.com) */
function isAzureOpenAI(url: string): boolean {
  return url.includes(".openai.azure.com");
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

function normalizeArkSize(size: string | undefined): "1K" | "2K" | "4K" {
  if (size === "1K" || size === "2K" || size === "4K") return size;
  return "2K";
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

/** Map aspect ratio string to pixel size for gpt-image-1.5 (only 3 sizes supported) */
export function aspectRatioToSize(ratio: string): string {
  switch (ratio) {
    case "2:3":
    case "3:4":
    case "9:16":
    case "4:5":
    case "1:2":
      return "1024x1536"; // portrait
    case "3:2":
    case "4:3":
    case "16:9":
    case "5:4":
    case "2:1":
      return "1536x1024"; // landscape
    default:
      return "1024x1024"; // square (1:1 or unknown)
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

    if (azure || isOpenAINativeEdits(endpoint)) {
      // Azure (OpenAI or AI Foundry): multipart FormData for image edits
      const form = new FormData();
      const images = params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : [params.imageDataUrl];
      if (images.length === 1) {
        form.append("image", dataUrlToBlob(images[0]), "image-0.png");
      } else {
        // Multi-image edits: use array syntax expected by OpenAI-compatible endpoints.
        for (let i = 0; i < images.length; i++) {
          form.append("image[]", dataUrlToBlob(images[i]), `image-${i}.png`);
        }
      }
      form.append("prompt", params.prompt);
      form.append("n", String(params.n ?? 1));
      form.append("size", size);
      // AI Foundry and OpenAI native endpoints require model in body.
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
      // Volcengine Ark image generation: JSON body with image array URLs/data URLs
      const images = params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : [params.imageDataUrl];
      const arkBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        image: images,
        sequential_image_generation: "disabled",
        watermark: false,
      };
      if (params.size) {
        arkBody.size = normalizeArkSize(params.size);
      }
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

      if (images.length > 1) {
        // OpenAI-compatible multi-image edits: use multipart files instead of JSON string image.
        const form = new FormData();
        for (let i = 0; i < images.length; i++) {
          form.append("image[]", dataUrlToBlob(images[i]), `image-${i}.png`);
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
      } else {
        // qnaigc / OpenAI-compatible single-image path
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            image: params.imageDataUrl,
            prompt: params.prompt,
            n: params.n ?? 1,
          }),
          signal: controller.signal,
        });
      }
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
