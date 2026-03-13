import { options, ok, err } from "../_shared/http.ts";
import { requireInternalWorker, getInternalWorkerSecret } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  getQueueInvokeBackoffMs,
  getQueueMaxRunningTasks,
  getQueueRunnerBatchSize,
} from "../_shared/generation-queue.ts";
import {
  classifyWorkerInvokeFailure,
  getWorkerFunctionName,
  type GenerationTaskType,
} from "../_shared/generation-worker-routing.ts";

type RunnableTaskRow = {
  job_id: string;
  task_type: GenerationTaskType;
};

type WorkerInvokeError = Error & {
  status?: number;
  code: "QUEUE_WORKER_LIMIT" | "QUEUE_WORKER_INVOKE_FAILED";
  shouldBackoff: boolean;
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

function normalizeWorkerInvokeError(
  error: unknown,
  fallbackStatus?: number,
): WorkerInvokeError {
  if (error instanceof Error && "code" in error && "shouldBackoff" in error) {
    return error as WorkerInvokeError;
  }

  const status = typeof fallbackStatus === "number"
    ? fallbackStatus
    : (error instanceof Error && "status" in error && typeof error.status === "number")
    ? error.status
    : undefined;
  const classification = classifyWorkerInvokeFailure(status);
  const wrapped = new Error(String(error ?? "unknown error")) as WorkerInvokeError;
  wrapped.status = status;
  wrapped.code = classification.code;
  wrapped.shouldBackoff = classification.shouldBackoff;
  return wrapped;
}

async function invokeWorker(
  jobId: string,
  taskType: GenerationTaskType,
): Promise<Record<string, unknown>> {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    throw new Error("QUEUE_RUNNER_ENV_MISSING");
  }

  const workerName = getWorkerFunctionName(taskType);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${workerName}`, {
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
      const classification = classifyWorkerInvokeFailure(response.status);
      const invokeError = new Error(
        `${classification.code} status=${response.status} body=${JSON.stringify(body)}`,
      ) as WorkerInvokeError;
      invokeError.status = response.status;
      invokeError.code = classification.code;
      invokeError.shouldBackoff = classification.shouldBackoff;
      throw invokeError;
    }

    return body ?? {};
  } catch (error) {
    throw normalizeWorkerInvokeError(error);
  }
}

async function backoffQueuedTask(
  supabase: ReturnType<typeof createServiceClient>,
  jobId: string,
  errorMessage: string,
  runAfter: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("generation_job_tasks")
    .update({
      run_after: runAfter,
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`QUEUE_BACKOFF_UPDATE_FAILED: ${error.message}`);
  }

  return Boolean(data?.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const internalAuthError = requireInternalWorker(req);
  if (internalAuthError) return internalAuthError;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const configuredMaxRunning = await getQueueMaxRunningTasks();
  const configuredBatchSize = await getQueueRunnerBatchSize();
  const invokeBackoffMs = await getQueueInvokeBackoffMs();
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
  const { data, error } = await supabase.rpc("list_runnable_generation_tasks", {
    p_limit: fetchLimit,
  });
  if (error) return err("QUEUE_LIST_FAILED", "Failed to list runnable generation tasks", 500, error);

  const tasks = ((data ?? []) as RunnableTaskRow[]).filter((row) => row.job_id && row.task_type);
  if (tasks.length === 0) {
    return ok({
      ok: true,
      status: "idle",
      running_tasks: runningTasks,
      max_running: maxRunning,
      invoked: 0,
    });
  }

  const summary = await Promise.all(tasks.map(async ({ job_id: jobId, task_type: taskType }) => {
    const workerName = getWorkerFunctionName(taskType);
    console.log(JSON.stringify({
      event: "QUEUE_WORKER_INVOKE_START",
      job_id: jobId,
      task_type: taskType,
      worker: workerName,
    }));

    try {
      const result = await invokeWorker(jobId, taskType);
      return { job_id: jobId, task_type: taskType, worker: workerName, ok: true, result };
    } catch (cause) {
      const invokeError = normalizeWorkerInvokeError(cause);
      console.warn(JSON.stringify({
        event: "QUEUE_WORKER_INVOKE_FAIL",
        job_id: jobId,
        task_type: taskType,
        worker: workerName,
        code: invokeError.code,
        status: invokeError.status ?? null,
        error: String(invokeError),
      }));

      let backedOff = false;
      let runAfter: string | null = null;
      if (invokeError.shouldBackoff) {
        runAfter = new Date(Date.now() + invokeBackoffMs).toISOString();
        backedOff = await backoffQueuedTask(supabase, jobId, String(invokeError), runAfter);
        console.warn(JSON.stringify({
          event: "QUEUE_WORKER_INVOKE_BACKOFF",
          job_id: jobId,
          task_type: taskType,
          worker: workerName,
          code: invokeError.code,
          run_after: runAfter,
          queued_task_updated: backedOff,
        }));
      }

      return {
        job_id: jobId,
        task_type: taskType,
        worker: workerName,
        ok: false,
        error: String(invokeError),
        error_code: invokeError.code,
        backed_off: backedOff,
        run_after: runAfter,
      };
    }
  }));

  return ok({
    ok: true,
    status: "invoked",
    running_tasks: runningTasks,
    max_running: maxRunning,
    requested: fetchLimit,
    invoked: tasks.length,
    success_count: summary.filter((item) => item.ok).length,
    failure_count: summary.filter((item) => !item.ok).length,
    jobs: summary,
  });
});
