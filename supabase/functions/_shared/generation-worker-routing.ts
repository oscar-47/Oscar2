export type GenerationTaskType = "ANALYSIS" | "IMAGE_GEN" | "STYLE_REPLICATE";

const WORKER_FUNCTION_BY_TASK_TYPE: Record<GenerationTaskType, string> = {
  ANALYSIS: "process-analysis-job",
  IMAGE_GEN: "process-image-gen-job",
  STYLE_REPLICATE: "process-style-replicate-job",
};

export type WorkerInvokeFailure = {
  code: "QUEUE_WORKER_LIMIT" | "QUEUE_WORKER_INVOKE_FAILED";
  shouldBackoff: boolean;
};

export function getWorkerFunctionName(taskType: GenerationTaskType): string {
  return WORKER_FUNCTION_BY_TASK_TYPE[taskType];
}

export function classifyWorkerInvokeFailure(status?: number | null): WorkerInvokeFailure {
  if (status === 546) {
    return { code: "QUEUE_WORKER_LIMIT", shouldBackoff: true };
  }

  if (typeof status === "number") {
    return {
      code: "QUEUE_WORKER_INVOKE_FAILED",
      shouldBackoff: status >= 500,
    };
  }

  return {
    code: "QUEUE_WORKER_INVOKE_FAILED",
    shouldBackoff: true,
  };
}
