import { options, ok, err } from "../_shared/http.ts";
import { requireInternalWorker, getInternalWorkerSecret } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getQueueMaxRunningTasks, getQueueRunnerBatchSize } from "../_shared/generation-queue.ts";

type RunnableJobRow = {
  job_id: string;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function getRunningTaskCount(supabase: ReturnType<typeof createServiceClient>): Promise<number> {
  const freshThreshold = new Date(Date.now() - 3 * 60_000).toISOString();
  const { count, error } = await supabase
    .from("generation_job_tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", "running")
    .gt("locked_at", freshThreshold);

  if (error) {
    throw new Error(`RUNNING_TASK_COUNT_FAILED: ${error.message}`);
  }

  return Number(count ?? 0);
}

async function invokeWorker(jobId: string): Promise<Record<string, unknown>> {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    throw new Error("QUEUE_RUNNER_ENV_MISSING");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/process-generation-job`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      "x-worker-secret": getInternalWorkerSecret(),
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(`QUEUE_WORKER_INVOKE_FAILED status=${response.status} body=${JSON.stringify(body)}`);
  }

  return body ?? {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const internalAuthError = requireInternalWorker(req);
  if (internalAuthError) return internalAuthError;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const configuredMaxRunning = await getQueueMaxRunningTasks();
  const configuredBatchSize = await getQueueRunnerBatchSize();
  const maxRunning = clampInt(body?.max_running, 1, 100, configuredMaxRunning);
  const batchSize = clampInt(body?.batch_size, 1, 50, configuredBatchSize);

  const supabase = createServiceClient();
  const runningTasks = await getRunningTaskCount(supabase);
  const availableSlots = Math.max(0, maxRunning - runningTasks);
  if (availableSlots < 1) {
    return ok({
      ok: true,
      status: "at_capacity",
      running_tasks: runningTasks,
      max_running: maxRunning,
      invoked: 0,
    });
  }

  const fetchLimit = Math.min(availableSlots, batchSize);
  const { data, error } = await supabase.rpc("list_runnable_generation_jobs", {
    p_limit: fetchLimit,
  });
  if (error) return err("QUEUE_LIST_FAILED", "Failed to list runnable generation jobs", 500, error);

  const jobs = ((data ?? []) as RunnableJobRow[]).map((row) => row.job_id).filter(Boolean);
  if (jobs.length === 0) {
    return ok({
      ok: true,
      status: "idle",
      running_tasks: runningTasks,
      max_running: maxRunning,
      invoked: 0,
    });
  }

  const results = await Promise.allSettled(jobs.map((jobId) => invokeWorker(jobId)));
  const summary = results.map((result, index) => {
    const jobId = jobs[index];
    if (result.status === "fulfilled") {
      return { job_id: jobId, ok: true, result: result.value };
    }
    return { job_id: jobId, ok: false, error: String(result.reason ?? "unknown error") };
  });

  return ok({
    ok: true,
    status: "invoked",
    running_tasks: runningTasks,
    max_running: maxRunning,
    requested: fetchLimit,
    invoked: jobs.length,
    success_count: summary.filter((item) => item.ok).length,
    failure_count: summary.filter((item) => !item.ok).length,
    jobs: summary,
  });
});
