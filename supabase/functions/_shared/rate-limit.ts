import { createServiceClient } from "./supabase.ts";
import { getIntegerSystemConfig } from "./system-config.ts";

const DEFAULT_JOBS_PER_MINUTE = 10;
const DEFAULT_ANALYSIS_DAILY_LIMIT = 50;

/**
 * Check if the user has exceeded the per-minute job creation rate limit.
 * Counts all jobs created by this user in the last 60 seconds.
 */
export async function checkRateLimit(userId: string): Promise<{
  ok: true;
} | {
  ok: false;
  count: number;
  limit: number;
}> {
  const limit = await getIntegerSystemConfig("rate_limit_jobs_per_minute", DEFAULT_JOBS_PER_MINUTE);
  if (limit <= 0) return { ok: true }; // disabled

  const supabase = createServiceClient();
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();

  const { count, error } = await supabase
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneMinuteAgo);

  if (error) {
    // Fail open — don't block users if the rate limit check itself fails
    console.error("RATE_LIMIT_CHECK_FAILED:", error.message);
    return { ok: true };
  }

  const current = Number(count ?? 0);
  if (current >= limit) {
    return { ok: false, count: current, limit };
  }

  return { ok: true };
}

/**
 * Check if the user has exceeded the daily ANALYSIS job limit.
 * Counts ANALYSIS jobs created by this user since midnight UTC today.
 */
export async function checkAnalysisDailyLimit(userId: string): Promise<{
  ok: true;
} | {
  ok: false;
  count: number;
  limit: number;
}> {
  const limit = await getIntegerSystemConfig("analysis_daily_limit_per_user", DEFAULT_ANALYSIS_DAILY_LIMIT);
  if (limit <= 0) return { ok: true }; // disabled

  const supabase = createServiceClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "ANALYSIS")
    .gte("created_at", todayStart.toISOString());

  if (error) {
    console.error("ANALYSIS_DAILY_LIMIT_CHECK_FAILED:", error.message);
    return { ok: true };
  }

  const current = Number(count ?? 0);
  if (current >= limit) {
    return { ok: false, count: current, limit };
  }

  return { ok: true };
}
