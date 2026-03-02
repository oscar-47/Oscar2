import { options, ok, err } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { callQnChatAPI } from "../_shared/qn-image.ts";

// Simple in-memory rate limiter (per worker instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function guessMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  return "image/png";
}

function isTrustedUrl(url: string): boolean {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const cdnHost = Deno.env.get("SOURCE_IMAGE_BASE_URL")
    ?? Deno.env.get("QINIU_CDN_HOST")
    ?? Deno.env.get("UPLOAD_PUBLIC_HOST")
    ?? "";
  const allowed = [supabaseUrl, cdnHost, "https://cdn.shopix.ai"].filter(Boolean);
  try {
    const origin = new URL(url).origin;
    return allowed.some((h) => {
      try { return new URL(h).origin === origin; } catch { return false; }
    });
  } catch {
    return false;
  }
}

function toPublicUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  const base = Deno.env.get("SOURCE_IMAGE_BASE_URL")
    ?? Deno.env.get("QINIU_CDN_HOST")
    ?? Deno.env.get("UPLOAD_PUBLIC_HOST")
    ?? "https://cdn.shopix.ai";
  return `${base.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  if (!checkRateLimit(authResult.user.id)) {
    return err("RATE_LIMITED", "Rate limit exceeded. Max 20 requests per hour.", 429);
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.image !== "string") {
    return err("BAD_REQUEST", "image field is required");
  }

  const imageUrl = toPublicUrl(body.image as string);

  // SSRF protection: only allow trusted storage/CDN hosts
  if ((imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) && !isTrustedUrl(imageUrl)) {
    return err("BAD_REQUEST", "Image URL must be from trusted storage domains");
  }

  try {
    // Fetch image with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let imageRes: Response;
    try {
      imageRes = await fetch(imageUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!imageRes.ok) {
      return err("IMAGE_FETCH_FAILED", `Failed to fetch image: ${imageRes.status}`);
    }

    const imageBytes = new Uint8Array(await imageRes.arrayBuffer());
    if (imageBytes.length > MAX_IMAGE_SIZE) {
      return err("IMAGE_TOO_LARGE", "Image exceeds 5MB limit");
    }

    const mime = imageRes.headers.get("content-type") || guessMime(imageUrl);
    const b64 = bytesToBase64(imageBytes);
    const dataUrl = `data:${mime};base64,${b64}`;

    // Call vision API for text detection
    const chatResult = await callQnChatAPI({
      messages: [
        {
          role: "system",
          content: "You are a text detection assistant. Analyze the image and extract any visible text. Return valid JSON only, no markdown: { \"hasText\": boolean, \"texts\": [{ \"content\": string, \"position\": string }] }. If no text found, return { \"hasText\": false, \"texts\": [] }.",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: "Detect all visible text in this image. Return the result as JSON." },
          ],
        },
      ],
      maxTokens: 1024,
    });

    // Parse chat response
    const choices = chatResult.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content ?? "";
    let parsed: { hasText: boolean; texts: Array<{ content: string; position: string }> };

    try {
      // Try to parse JSON from content (may be wrapped in markdown code block)
      const jsonStr = content.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
      const raw = JSON.parse(jsonStr);
      // Normalize: ensure shape matches expected contract
      const hasText = typeof raw.hasText === "boolean" ? raw.hasText : false;
      const texts = Array.isArray(raw.texts)
        ? raw.texts
            .filter((t: unknown) => typeof t === "object" && t !== null && typeof (t as Record<string, unknown>).content === "string")
            .map((t: Record<string, unknown>) => ({
              content: String(t.content),
              position: typeof t.position === "string" ? t.position : "unknown",
            }))
        : [];
      parsed = { hasText: hasText && texts.length > 0, texts };
    } catch {
      // If parsing fails, return no text detected
      parsed = { hasText: false, texts: [] };
    }

    return ok(parsed);
  } catch (e) {
    const message = String(e);
    if (message.includes("AbortError")) {
      return err("DETECTION_TIMEOUT", "Text detection timed out", 504);
    }
    return err("DETECTION_FAILED", `Text detection failed: ${message.slice(0, 200)}`, 500);
  }
});
