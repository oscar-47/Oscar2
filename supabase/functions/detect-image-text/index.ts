import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

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

  const image = body.image as string;

  const supabase = createServiceClient();

  // Create ANALYSIS job with task: "ocr"
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: authResult.user.id,
      type: "ANALYSIS",
      status: "processing",
      payload: { task: "ocr", image },
      cost_amount: 0, // OCR is free
      fe_attempt: 1,
    })
    .select("id")
    .single();

  if (error || !data) {
    return err("OCR_JOB_CREATE_FAILED", "Failed to create OCR job", 500, error);
  }

  // Create task for the worker
  const { error: taskError } = await supabase
    .from("generation_job_tasks")
    .insert({
      job_id: data.id,
      task_type: "ANALYSIS",
      status: "queued",
      payload: { task: "ocr", image },
    });

  if (taskError) {
    await supabase.from("generation_jobs").update({
      status: "failed",
      error_code: "OCR_JOB_CREATE_FAILED",
      error_message: `Failed to enqueue OCR task: ${taskError.message}`,
    }).eq("id", data.id);
    return err("OCR_JOB_CREATE_FAILED", "Failed to enqueue OCR task", 500, taskError);
  }

  return ok({ status: "success", job_id: data.id });
});
