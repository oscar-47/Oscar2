import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { callQnImageAPI, extractGeneratedImageBase64 } from "../_shared/qn-image.ts";
import { requireUser } from "../_shared/auth.ts";

// ── image helpers (same as generate-image) ───────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function guessMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  return "image/png";
}

function toPublicUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  const base = Deno.env.get("SOURCE_IMAGE_BASE_URL")
    ?? Deno.env.get("UPLOAD_PUBLIC_HOST")
    ?? "";
  return `${base.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`;
}

async function toDataUrl(pathOrUrl: string): Promise<string> {
  if (pathOrUrl.startsWith("data:image/")) return pathOrUrl;
  const url = toPublicUrl(pathOrUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SOURCE_IMAGE_FETCH_FAILED ${res.status}: ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || guessMime(url);
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function computeCost(model: string, turboEnabled: boolean, imageSize: string): number {
  if (!turboEnabled) return model === "nano-banana" ? 3 : 5;
  if (imageSize === "1K") return 8;
  if (imageSize === "2K") return 12;
  return 17;
}

// ── main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.referenceImage !== "string" || !Array.isArray(body.productImages)) {
    return err("BAD_REQUEST", "referenceImage and productImages are required");
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const supabase = createServiceClient();
  const user = authResult.user;

  const modelName = String(body.model ?? "nano-banana-pro");
  const imageSize = String(body.imageSize ?? "2K");
  const turboEnabled = Boolean(body.turboEnabled ?? false);
  const cost = computeCost(modelName, turboEnabled, imageSize);
  const startedAt = Date.now();

  // 1. Create job record
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: user.id,
      type: "STYLE_REPLICATE",
      status: "processing",
      payload: body,
      cost_amount: cost,
      trace_id: body.trace_id ?? null,
      client_job_id: body.client_job_id ?? null,
      fe_attempt: Number(body.fe_attempt ?? 1),
    })
    .select("id")
    .single();

  if (error || !data) return err("ANALYSIS_CREATE_FAILED", "failed to create style replicate job", 500, error);

  const jobId = data.id;
  let creditDeducted = false;

  try {
    // 2. Deduct credits
    const { error: deductError } = await supabase.rpc("deduct_credits", { p_user_id: user.id, p_amount: cost });
    if (deductError) {
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error_code: "INSUFFICIENT_CREDITS",
          error_message: "Not enough credits",
          duration_ms: Date.now() - startedAt,
        })
        .eq("id", jobId);
      return err("INSUFFICIENT_CREDITS", "Not enough credits", 402);
    }
    creditDeducted = true;

    // 3. Fetch both images
    const referenceDataUrl = await toDataUrl(String(body.referenceImage));
    const productImageUrl = body.productImages[0];
    if (!productImageUrl || typeof productImageUrl !== "string") {
      throw new Error("productImages[0] is required");
    }
    const productDataUrl = await toDataUrl(productImageUrl);

    // 4. Build the style replication prompt
    const userPrompt = typeof body.userPrompt === "string" && body.userPrompt
      ? body.userPrompt
      : "";
    const prompt = `Replicate the exact visual style, lighting, color grading, background, and composition from the reference image. Apply this style to the product shown in the second image. Maintain the product's identity and details while matching the reference aesthetic perfectly. ${userPrompt}`.trim();

    // 5. Call QN Image API with the product image + style prompt
    // The reference image style description is embedded in the prompt
    const apiResponse = await callQnImageAPI({
      imageDataUrl: productDataUrl,
      prompt,
      n: 1,
    });

    const generatedBase64 = extractGeneratedImageBase64(apiResponse);
    const imageBytes = base64ToBytes(generatedBase64);

    // 6. Upload result to storage
    const outputBucket = Deno.env.get("GENERATIONS_BUCKET") ?? "generations";
    const objectPath = `${user.id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;

    let resultUrl: string | null = null;
    const { error: uploadError } = await supabase.storage
      .from(outputBucket)
      .upload(objectPath, imageBytes, { contentType: "image/png", upsert: false });

    if (!uploadError) {
      const { data: publicData } = supabase.storage.from(outputBucket).getPublicUrl(objectPath);
      resultUrl = publicData.publicUrl;
    }

    // 7. Update job as success
    await supabase
      .from("generation_jobs")
      .update({
        status: "success",
        result_url: resultUrl,
        result_data: {
          provider: "qnaigc",
          model: modelName,
          image_size: imageSize,
          mime_type: "image/png",
          object_path: resultUrl ? `${outputBucket}/${objectPath}` : null,
          b64_json: generatedBase64,
        },
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", jobId);

  } catch (e) {
    // Refund credits on failure
    if (creditDeducted) {
      await supabase.rpc("add_credits", { p_user_id: user.id, p_amount: cost, p_type: "purchased" });
    }
    console.error("[analyze-single] failed:", String(e));
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        error_code: "UPSTREAM_ERROR",
        error_message: String(e),
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", jobId);
  }

  return ok({ job_id: jobId, status: "processing" });
});
