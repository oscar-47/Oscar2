import {
  classifyWorkerInvokeFailure,
  getWorkerFunctionName,
} from "./generation-worker-routing.ts";

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

Deno.test("worker routing resolves function names by task type", () => {
  assertEquals(getWorkerFunctionName("ANALYSIS"), "process-analysis-job", "analysis should route to analysis worker");
  assertEquals(getWorkerFunctionName("IMAGE_GEN"), "process-image-gen-job", "image generation should route to image worker");
  assertEquals(getWorkerFunctionName("STYLE_REPLICATE"), "process-style-replicate-job", "style replication should route to style worker");
});

Deno.test("worker invoke failures classify 546 and 5xx as backoffable", () => {
  const workerLimit = classifyWorkerInvokeFailure(546);
  assertEquals(workerLimit.code, "QUEUE_WORKER_LIMIT", "546 should be recorded as worker limit");
  assertEquals(workerLimit.shouldBackoff, true, "546 should trigger queue backoff");

  const upstreamFailure = classifyWorkerInvokeFailure(503);
  assertEquals(upstreamFailure.code, "QUEUE_WORKER_INVOKE_FAILED", "5xx should use generic invoke failure code");
  assertEquals(upstreamFailure.shouldBackoff, true, "5xx should trigger queue backoff");

  const clientFailure = classifyWorkerInvokeFailure(400);
  assertEquals(clientFailure.shouldBackoff, false, "4xx should not trigger queue backoff");
});
