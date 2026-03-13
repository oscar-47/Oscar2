import { createServiceClient } from "./supabase.ts";
import { getIntegerSystemConfig } from "./system-config.ts";

type JobType = "ANALYSIS" | "IMAGE_GEN" | "STYLE_REPLICATE";

const USER_LIMIT_CONFIG_KEYS: Record<JobType, string> = {
  ANALYSIS: "generation_limit_analysis_processing",
  IMAGE_GEN: "generation_limit_image_gen_processing",
  STYLE_REPLICATE: "generation_limit_style_replicate_processing",
};

const USER_LIMIT_DEFAULTS: Record<JobType, number> = {
  ANALYSIS: 4,
  IMAGE_GEN: 8,
  STYLE_REPLICATE: 4,
};

const QUEUE_MAX_RUNNING_TASKS_KEY = "generation_queue_max_running_tasks";
const QUEUE_RUNNER_BATCH_SIZE_KEY = "generation_queue_runner_batch_size";
const QUEUE_INVOKE_BACKOFF_MS_KEY = "generation_queue_invoke_backoff_ms";
const DEFAULT_QUEUE_MAX_RUNNING_TASKS = 8;
const DEFAULT_QUEUE_RUNNER_BATCH_SIZE = 4;
const DEFAULT_QUEUE_INVOKE_BACKOFF_MS = 60_000;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function getUserProcessingLimit(jobType: JobType): Promise<number> {
  const configured = await getIntegerSystemConfig(USER_LIMIT_CONFIG_KEYS[jobType], USER_LIMIT_DEFAULTS[jobType]);
  return clampInt(configured, 1, 100, USER_LIMIT_DEFAULTS[jobType]);
}

export async function getQueueMaxRunningTasks(): Promise<number> {
  const configured = await getIntegerSystemConfig(QUEUE_MAX_RUNNING_TASKS_KEY, DEFAULT_QUEUE_MAX_RUNNING_TASKS);
  return clampInt(configured, 1, 100, DEFAULT_QUEUE_MAX_RUNNING_TASKS);
}

export async function getQueueRunnerBatchSize(): Promise<number> {
  const configured = await getIntegerSystemConfig(QUEUE_RUNNER_BATCH_SIZE_KEY, DEFAULT_QUEUE_RUNNER_BATCH_SIZE);
  return clampInt(configured, 1, 50, DEFAULT_QUEUE_RUNNER_BATCH_SIZE);
}

export async function getQueueInvokeBackoffMs(): Promise<number> {
  const configured = await getIntegerSystemConfig(QUEUE_INVOKE_BACKOFF_MS_KEY, DEFAULT_QUEUE_INVOKE_BACKOFF_MS);
  return clampInt(configured, 5_000, 300_000, DEFAULT_QUEUE_INVOKE_BACKOFF_MS);
}

export async function getActiveProcessingJobCount(
  userId: string,
  jobType: JobType,
): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", jobType)
    .eq("status", "processing");

  if (error) {
    throw new Error(`ACTIVE_JOB_COUNT_FAILED: ${error.message}`);
  }

  return Number(count ?? 0);
}

export async function assertUserCanQueueJob(userId: string, jobType: JobType): Promise<{
  ok: true;
} | {
  ok: false;
  activeCount: number;
  limit: number;
}> {
  const [activeCount, limit] = await Promise.all([
    getActiveProcessingJobCount(userId, jobType),
    getUserProcessingLimit(jobType),
  ]);

  if (activeCount >= limit) {
    return { ok: false, activeCount, limit };
  }

  return { ok: true };
}
