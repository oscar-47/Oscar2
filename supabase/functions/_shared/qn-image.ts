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

export type ChatPoolEntry = {
  endpoint: string;
  key: string;
};

function parseApiKeyList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const ch of value) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getOpenRouterKeyPool(params?: {
  apiKeyOverride?: string;
  apiKeyPoolOverride?: string[];
}): string[] {
  const overridePool = Array.isArray(params?.apiKeyPoolOverride)
    ? params.apiKeyPoolOverride
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
    : [];
  if (overridePool.length > 0) {
    return overridePool.filter((value, index, arr) => arr.indexOf(value) === index);
  }

  const envPool = parseApiKeyList(Deno.env.get("OPENROUTER_API_KEYS") ?? "");
  const singleKey = String(params?.apiKeyOverride ?? Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
  const merged = singleKey ? [singleKey, ...envPool] : envPool;
  return merged.filter((value, index, arr) => arr.indexOf(value) === index);
}

export function orderOpenRouterKeysForRouting(
  keys: string[],
  routingKey?: string,
): string[] {
  const uniqueKeys = keys.filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
  if (uniqueKeys.length <= 1) return uniqueKeys;
  if (!routingKey || routingKey.trim().length === 0) return uniqueKeys;

  const offset = stableHash(routingKey.trim()) % uniqueKeys.length;
  return uniqueKeys.slice(offset).concat(uniqueKeys.slice(0, offset));
}

/**
 * Parse the chat endpoint pool from QN_CHAT_API_POOL env var (JSON array).
 * Falls back to single QN_CHAT_API_ENDPOINT + QN_CHAT_API_KEY.
 */
export function getChatEndpointPool(): ChatPoolEntry[] {
  const poolRaw = Deno.env.get("QN_CHAT_API_POOL") ?? "";
  if (poolRaw) {
    try {
      const parsed = JSON.parse(poolRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(
          (e: Record<string, unknown>) => e.endpoint && e.key,
        ) as ChatPoolEntry[];
      }
    } catch {
      console.warn("QN_CHAT_API_POOL parse failed, falling back to single endpoint");
    }
  }
  const apiKey = Deno.env.get("QN_CHAT_API_KEY")
    ?? Deno.env.get("QN_IMAGE_API_KEY")
    ?? "";
  const endpoint = Deno.env.get("QN_CHAT_API_ENDPOINT")
    ?? "https://api.qnaigc.com/v1/chat/completions";
  if (!apiKey) {
    throw new Error("Missing QN_CHAT_API_KEY (or QN_IMAGE_API_KEY fallback)");
  }
  return [{ endpoint, key: apiKey }];
}

/** Get a shuffled copy of the pool for failover iteration */
export function getShuffledChatPool(): ChatPoolEntry[] {
  const pool = [...getChatEndpointPool()];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/** Build a QnChatConfig from a specific pool entry */
export function getQnChatConfigFrom(entry: ChatPoolEntry): QnChatConfig {
  return {
    apiKey: entry.key,
    endpoint: entry.endpoint,
    model: Deno.env.get("QN_CHAT_MODEL") ?? "moonshotai/kimi-k2.5",
    timeoutMs: Number(Deno.env.get("QN_CHAT_REQUEST_TIMEOUT_MS")
      ?? Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS")
      ?? "30000"),
  };
}

export function getQnChatConfig(): QnChatConfig {
  const pool = getChatEndpointPool();
  const entry = pool[Math.floor(Math.random() * pool.length)];
  return getQnChatConfigFrom(entry);
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

/** Detect OpenRouter chat/completions endpoint */
function isOpenRouter(url: string): boolean {
  try {
    return new URL(url).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

/** Detect ToAPIs async image generation endpoint */
function isToAPIs(url: string): boolean {
  try {
    return new URL(url).hostname === "toapis.com";
  } catch {
    return false;
  }
}

/** Detect GoAPI (Midjourney proxy) endpoint */
function isGoAPI(url: string): boolean {
  try {
    return new URL(url).hostname === "api.goapi.ai";
  } catch {
    return false;
  }
}

/** Detect Stability AI endpoint */
function isStabilityAI(url: string): boolean {
  try {
    return new URL(url).hostname === "api.stability.ai";
  } catch {
    return false;
  }
}

/** Detect Ideogram API endpoint */
function isIdeogram(url: string): boolean {
  try {
    return new URL(url).hostname === "api.ideogram.ai";
  } catch {
    return false;
  }
}

/** Detect fal.ai endpoint */
function isFal(url: string): boolean {
  try {
    return new URL(url).hostname === "fal.run";
  } catch {
    return false;
  }
}

/** Detect OpenAI native images/generations endpoint (for DALL-E 4 etc.) */
function isOpenAINativeGenerations(url: string): boolean {
  return url.includes("api.openai.com/v1/images/generations");
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

/** Whether an error is retryable on a different pool endpoint */
function isChatRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const msg = String(err);
  // Retry on timeout, 429 (rate limit), 5xx server errors
  if (msg.includes("AbortError") || msg.includes("TIMEOUT")) return true;
  const statusMatch = msg.match(/QN_CHAT_API_ERROR (\d+)/);
  if (statusMatch) {
    const code = Number(statusMatch[1]);
    return code === 429 || code >= 500;
  }
  return false;
}

function isOpenRouterImageRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const msg = String(err);
  if (msg.includes("AbortError") || msg.includes("TIMEOUT")) return true;
  const statusMatch = msg.match(/OPENROUTER_IMAGE_API_ERROR (\d+)/);
  if (!statusMatch) return false;
  const code = Number(statusMatch[1]);
  return code === 408 || code === 409 || code === 429 || code >= 500;
}

export async function callQnChatAPI(params: {
  messages: Array<Record<string, unknown>>;
  model?: string;
  maxTokens?: number;
  stream?: boolean;
  timeoutMsOverride?: number;
}): Promise<Record<string, unknown>> {
  const pool = getShuffledChatPool();
  const baseConfig = getQnChatConfigFrom(pool[0]);
  const timeoutMs = params.timeoutMsOverride ?? baseConfig.timeoutMs;
  let lastError: unknown;

  for (let i = 0; i < pool.length; i++) {
    const config = getQnChatConfigFrom(pool[i]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    } catch (err) {
      lastError = err;
      if (i < pool.length - 1 && isChatRetryable(err)) {
        console.warn(`CHAT_POOL_FAILOVER endpoint=${config.endpoint.substring(0, 60)}... err=${String(err).substring(0, 100)} trying_next=${i + 2}/${pool.length}`);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
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

export type QnImageAPIParams = {
  imageDataUrl?: string;
  imageDataUrls?: string[];
  imageUrls?: string[];
  prompt: string;
  n?: number;
  model?: string;
  size?: string;
  imageSize?: string;
  aspectRatio?: string;
  endpointOverride?: string;
  apiKeyOverride?: string;
  apiKeyPoolOverride?: string[];
  timeoutMsOverride?: number;
  providerHint?: string;
  routingKey?: string;
};

export function buildToAPIsImageRequestBody(params: QnImageAPIParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: params.aspectRatio || "1:1",
    n: params.n ?? 1,
  };
  const imageUrls = params.imageUrls?.filter(Boolean);
  if (imageUrls && imageUrls.length > 0) {
    body.image_urls = imageUrls;
  }
  return body;
}

export function buildOpenRouterImageRequestBody(params: QnImageAPIParams): Record<string, unknown> {
  const contentParts: Record<string, unknown>[] = [
    { type: "text", text: params.prompt },
  ];
  const images = params.imageUrls && params.imageUrls.length > 0
    ? params.imageUrls
    : params.imageDataUrls && params.imageDataUrls.length > 0
    ? params.imageDataUrls
    : params.imageDataUrl
    ? [params.imageDataUrl]
    : [];
  for (const imageUrl of images) {
    if (!imageUrl) continue;
    contentParts.push({
      type: "image_url",
      image_url: { url: imageUrl },
    });
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: [{ role: "user", content: contentParts }],
    modalities: ["image", "text"],
    provider: {
      require_parameters: true,
    },
  };
  const imageConfig: Record<string, string> = {};
  if (params.aspectRatio) imageConfig.aspect_ratio = params.aspectRatio;
  if (params.imageSize) imageConfig.image_size = params.imageSize;
  if (Object.keys(imageConfig).length > 0) body.image_config = imageConfig;
  return body;
}

export async function callQnImageAPI(params: QnImageAPIParams): Promise<Record<string, unknown>> {
  const envEndpoint = Deno.env.get("QN_IMAGE_API_ENDPOINT") ?? "https://api.qnaigc.com/v1/images/edits";
  const envModel = Deno.env.get("QN_IMAGE_MODEL") ?? "gemini-3.0-pro-image-preview";
  const envApiKey = Deno.env.get("QN_IMAGE_API_KEY") ?? "";
  const envTimeoutMs = Number(Deno.env.get("QN_IMAGE_REQUEST_TIMEOUT_MS") ?? "30000");

  const endpoint = params.endpointOverride ?? envEndpoint;
  const apiKey = params.apiKeyOverride ?? envApiKey;
  const model = params.model ?? envModel;
  const openRouterKeyPool = isOpenRouter(endpoint)
    ? orderOpenRouterKeysForRouting(
      getOpenRouterKeyPool({
        apiKeyOverride: apiKey,
        apiKeyPoolOverride: params.apiKeyPoolOverride,
      }),
      params.routingKey,
    )
    : [];
  if (!apiKey && openRouterKeyPool.length === 0) {
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

    if (isToAPIs(endpoint)) {
      // ToAPIs async task-based image generation
      const taBody = buildToAPIsImageRequestBody({ ...params, model });

      const createRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(taBody),
        signal: controller.signal,
      });

      const createText = await createRes.text();
      let createParsed: Record<string, unknown> = {};
      try {
        createParsed = createText ? JSON.parse(createText) : {};
      } catch {
        createParsed = { raw: createText };
      }

      if (!createRes.ok) {
        throw new Error(`TOAPIS_CREATE_ERROR ${createRes.status}: ${JSON.stringify(createParsed)}`);
      }

      const taskId = String(createParsed.id ?? "");
      if (!taskId) throw new Error("TOAPIS_MISSING_TASK_ID");

      // Poll for completion
      const pollUrl = `${endpoint}/${taskId}`;
      const pollInterval = 3000;
      const maxPolls = Math.ceil(timeoutMs / pollInterval);

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, pollInterval));

        const pollRes = await fetch(pollUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        const pollText = await pollRes.text();
        // deno-lint-ignore no-explicit-any
        let pollData: any = {};
        try {
          pollData = pollText ? JSON.parse(pollText) : {};
        } catch {
          pollData = { raw: pollText };
        }

        const status = String(pollData.status ?? "");
        if (status === "completed") {
          const result = pollData.result;
          const data = result?.data;
          if (Array.isArray(data) && data.length > 0) {
            return { data };
          }
          throw new Error("TOAPIS_COMPLETED_NO_IMAGE");
        }
        if (status === "failed") {
          throw new Error(`TOAPIS_TASK_FAILED: ${JSON.stringify(pollData)}`);
        }
      }

      throw new Error("TOAPIS_POLL_TIMEOUT");
    } else if (isOpenRouter(endpoint)) {
      // OpenRouter Chat Completions with image generation
      const orBody = buildOpenRouterImageRequestBody({ ...params, model });
      const keys = openRouterKeyPool.length > 0 ? openRouterKeyPool : [apiKey];
      let lastError: unknown = null;

      for (let i = 0; i < keys.length; i++) {
        const currentKey = keys[i];
        try {
          res = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${currentKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(orBody),
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
            throw new Error(`OPENROUTER_IMAGE_API_ERROR ${res.status}: ${JSON.stringify(parsed)}`);
          }

          // Normalize to { data: [{ b64_json }] } or { data: [{ url }] }
          // deno-lint-ignore no-explicit-any
          const choices = (parsed as any)?.choices;
          if (Array.isArray(choices) && choices.length > 0) {
            const msg = choices[0]?.message;
            if (Array.isArray(msg?.images) && msg.images.length > 0) {
              const imgUrl = msg.images[0]?.image_url?.url ?? "";
              if (imgUrl.startsWith("data:")) {
                const b64 = imgUrl.split(",")[1] ?? "";
                return { data: [{ b64_json: b64 }] };
              }
              if (imgUrl) return { data: [{ url: imgUrl }] };
            }
            if (Array.isArray(msg?.content)) {
              for (const part of msg.content) {
                if (part?.type === "image_url" && part?.image_url?.url) {
                  const imgUrl = part.image_url.url;
                  if (imgUrl.startsWith("data:")) {
                    const b64 = imgUrl.split(",")[1] ?? "";
                    return { data: [{ b64_json: b64 }] };
                  }
                  return { data: [{ url: imgUrl }] };
                }
              }
            }
          }

          throw new Error(
            "OPENROUTER_IMAGE_INVALID_RESPONSE: no image found: " + JSON.stringify(parsed).substring(0, 500),
          );
        } catch (error) {
          lastError = error;
          if (i < keys.length - 1 && isOpenRouterImageRetryable(error)) {
            console.warn(
              `OPENROUTER_IMAGE_FAILOVER attempt=${i + 1}/${keys.length} routing_key=${params.routingKey ?? "none"} error=${String(error).substring(0, 160)}`,
            );
            continue;
          }
          throw error;
        }
      }

      throw lastError ?? new Error("OPENROUTER_IMAGE_API_ERROR: key pool exhausted");
    } else if (isGoAPI(endpoint) || params.providerHint === "midjourney") {
      // GoAPI (Midjourney proxy): OpenAI-compatible JSON body with images/generations
      const mjBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        n: params.n ?? 1,
        response_format: "url",
      };
      if (size) mjBody.size = size;

      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(mjBody),
        signal: controller.signal,
      });
    } else if (isStabilityAI(endpoint) || params.providerHint === "stability") {
      // Stability AI: multipart form data
      const formData = new FormData();
      formData.append("prompt", params.prompt);
      formData.append("output_format", "png");
      if (params.aspectRatio) {
        formData.append("aspect_ratio", params.aspectRatio);
      }
      // Attach reference image if available (image-to-image mode)
      const images = params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : params.imageDataUrl ? [params.imageDataUrl] : [];
      if (images.length > 0 && images[0]) {
        formData.append("image", dataUrlToBlob(images[0]), "reference.png");
        formData.append("strength", "0.5");
      }

      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json",
        },
        body: formData,
        signal: controller.signal,
      });

      const stabText = await res.text();
      let stabParsed: Record<string, unknown> = {};
      try {
        stabParsed = stabText ? JSON.parse(stabText) : {};
      } catch {
        stabParsed = { raw: stabText };
      }

      if (!res.ok) {
        throw new Error(`STABILITY_API_ERROR ${res.status}: ${JSON.stringify(stabParsed)}`);
      }

      // Stability returns { image: "<base64>" } — normalize to standard format
      const stabB64 = stabParsed.image as string | undefined;
      if (!stabB64) throw new Error("IMAGE_RESULT_MISSING");
      return { data: [{ b64_json: stabB64 }] };
    } else if (isIdeogram(endpoint) || params.providerHint === "ideogram") {
      // Ideogram API: JSON body with image_request wrapper
      const imageRequest: Record<string, unknown> = {
        prompt: params.prompt,
        model,
        magic_prompt_option: "AUTO",
      };
      if (params.aspectRatio) {
        imageRequest.aspect_ratio = `ASPECT_${params.aspectRatio.replace(":", "_")}`;
      }

      const ideoBody: Record<string, unknown> = {
        image_request: imageRequest,
      };

      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": apiKey,
        },
        body: JSON.stringify(ideoBody),
        signal: controller.signal,
      });

      const ideoText = await res.text();
      let ideoParsed: Record<string, unknown> = {};
      try {
        ideoParsed = ideoText ? JSON.parse(ideoText) : {};
      } catch {
        ideoParsed = { raw: ideoText };
      }

      if (!res.ok) {
        throw new Error(`IDEOGRAM_API_ERROR ${res.status}: ${JSON.stringify(ideoParsed)}`);
      }

      // Ideogram returns { data: [{ url: "..." }] } — already in standard format
      // deno-lint-ignore no-explicit-any
      const ideoData = (ideoParsed as any)?.data;
      if (Array.isArray(ideoData) && ideoData.length > 0 && ideoData[0]?.url) {
        return { data: [{ url: ideoData[0].url }] };
      }
      throw new Error("IMAGE_RESULT_MISSING");
    } else if (isFal(endpoint) || params.providerHint === "fal") {
      // fal.ai: JSON body with prompt, aspect_ratio, resolution
      const falBody: Record<string, unknown> = {
        prompt: params.prompt,
        num_images: params.n ?? 1,
        output_format: "png",
        sync_mode: true,
      };
      if (params.aspectRatio) falBody.aspect_ratio = params.aspectRatio;
      if (params.imageSize) falBody.resolution = params.imageSize;

      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Key ${apiKey}`,
        },
        body: JSON.stringify(falBody),
        signal: controller.signal,
      });

      const falText = await res.text();
      let falParsed: Record<string, unknown> = {};
      try {
        falParsed = falText ? JSON.parse(falText) : {};
      } catch {
        falParsed = { raw: falText };
      }

      if (!res.ok) {
        throw new Error(`FAL_API_ERROR ${res.status}: ${JSON.stringify(falParsed)}`);
      }

      // fal.ai returns { images: [{ url, width, height }] } — normalize to standard format
      // deno-lint-ignore no-explicit-any
      const falImages = (falParsed as any)?.images;
      if (Array.isArray(falImages) && falImages.length > 0 && falImages[0]?.url) {
        return { data: [{ url: falImages[0].url }] };
      }
      throw new Error("FAL_IMAGE_RESULT_MISSING");
    } else if (isOpenAINativeGenerations(endpoint) || params.providerHint === "openai-generations") {
      // OpenAI images/generations (DALL-E 4 etc.): JSON body, no image input
      const dalleBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        n: params.n ?? 1,
        size: size,
      };

      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(dalleBody),
        signal: controller.signal,
      });
    } else if (isAzureAIFoundryGenerations(endpoint)) {
      // Azure AI Foundry /images/generations (e.g. FLUX Kontext Pro): JSON body
      const images = (params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : params.imageDataUrl ? [params.imageDataUrl] : []
      ).filter((value): value is string => typeof value === "string" && value.length > 0);
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
      const images = (params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : params.imageDataUrl ? [params.imageDataUrl] : []
      ).filter((value): value is string => typeof value === "string" && value.length > 0);
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
      const images = (params.imageDataUrls && params.imageDataUrls.length > 0
        ? params.imageDataUrls
        : params.imageDataUrl ? [params.imageDataUrl] : []
      ).filter((value): value is string => typeof value === "string" && value.length > 0);

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
