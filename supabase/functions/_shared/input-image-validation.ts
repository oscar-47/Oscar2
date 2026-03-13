const DEFAULT_IMAGE_INPUT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

export type ImageInputValidationCode =
  | "IMAGE_INPUT_TOO_LARGE"
  | "IMAGE_INPUT_INVALID_CONTENT_TYPE"
  | "IMAGE_INPUT_SOURCE_TIMEOUT"
  | "BAD_REQUEST"
  | "IMAGE_INPUT_SOURCE_MISSING";

type ProbeResult = {
  contentLength: number | null;
  contentType: string | null;
};

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseContentRangeTotal(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\/(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validateImageUrlShape(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("IMAGE_INPUT_URL_INVALID");
    }
  } catch {
    throw new Error(`IMAGE_INPUT_URL_INVALID: ${url}`);
  }
}

async function probeImageUrl(url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_PROBE_TIMEOUT_MS);

  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    if (headResponse.ok) {
      return {
        contentLength: parseContentLength(headResponse.headers.get("content-length")),
        contentType: headResponse.headers.get("content-type"),
      };
    }

    const rangeResponse = await fetch(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-0",
      },
      signal: controller.signal,
    });

    if (!rangeResponse.ok) {
      throw new Error(`SOURCE_IMAGE_FETCH_FAILED ${rangeResponse.status}: ${url}`);
    }

    return {
      contentLength: parseContentLength(rangeResponse.headers.get("content-length")) ??
        parseContentRangeTotal(rangeResponse.headers.get("content-range")),
      contentType: rangeResponse.headers.get("content-type"),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`SOURCE_IMAGE_FETCH_TIMEOUT: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function validateImageInputUrls(
  urls: string[],
  options?: {
    maxBytes?: number;
  },
): Promise<void> {
  const maxBytes = Number(options?.maxBytes ?? DEFAULT_IMAGE_INPUT_MAX_BYTES);
  const uniqueUrls = urls
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    .map((url) => url.trim())
    .filter((url, index, arr) => arr.indexOf(url) === index);

  for (const url of uniqueUrls) {
    validateImageUrlShape(url);
    const probe = await probeImageUrl(url);
    if (probe.contentType && !probe.contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`IMAGE_INPUT_INVALID_CONTENT_TYPE type=${probe.contentType} url=${url}`);
    }
    if (typeof probe.contentLength === "number" && probe.contentLength > maxBytes) {
      throw new Error(`IMAGE_INPUT_TOO_LARGE bytes=${probe.contentLength} max=${maxBytes} url=${url}`);
    }
  }
}

export function getDefaultImageInputMaxBytes(): number {
  return DEFAULT_IMAGE_INPUT_MAX_BYTES;
}

export function classifyImageValidationError(error: unknown): ImageInputValidationCode {
  const message = String(error ?? "");
  if (message.includes("IMAGE_INPUT_TOO_LARGE")) return "IMAGE_INPUT_TOO_LARGE";
  if (message.includes("IMAGE_INPUT_INVALID_CONTENT_TYPE")) return "IMAGE_INPUT_INVALID_CONTENT_TYPE";
  if (message.includes("SOURCE_IMAGE_FETCH_TIMEOUT")) return "IMAGE_INPUT_SOURCE_TIMEOUT";
  if (message.includes("IMAGE_INPUT_URL_INVALID")) return "BAD_REQUEST";
  return "IMAGE_INPUT_SOURCE_MISSING";
}
