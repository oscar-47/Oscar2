export type PaidGenerationJobType = "IMAGE_GEN" | "STYLE_REPLICATE";

type RpcRow = {
  job_id?: string | null;
  charged_subscription_credits?: number | null;
  charged_purchased_credits?: number | null;
};

export function isInsufficientCreditsRpcError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? "");
  return message.includes("INSUFFICIENT_CREDITS");
}

export function getInsufficientCreditsDetails(error: unknown): { available: number | null; required: number | null } {
  const message = String((error as { message?: unknown })?.message ?? error ?? "");
  const availableMatch = message.match(/available=(\d+)/);
  const requiredMatch = message.match(/required=(\d+)/);
  return {
    available: availableMatch ? Number(availableMatch[1]) : null,
    required: requiredMatch ? Number(requiredMatch[1]) : null,
  };
}

export async function enqueuePaidGenerationJob(
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: RpcRow[] | RpcRow | null; error: { message?: string } | null }>;
  },
  params: {
    userId: string;
    jobType: PaidGenerationJobType;
    payload: Record<string, unknown>;
    costAmount: number;
    traceId?: string | null;
    clientJobId?: string | null;
    feAttempt?: number;
  },
): Promise<{ jobId: string; chargedSubscriptionCredits: number; chargedPurchasedCredits: number }> {
  const { data, error } = await supabase.rpc("enqueue_paid_generation_job", {
    p_user_id: params.userId,
    p_job_type: params.jobType,
    p_payload: params.payload,
    p_cost_amount: params.costAmount,
    p_trace_id: params.traceId ?? null,
    p_client_job_id: params.clientJobId ?? null,
    p_fe_attempt: params.feAttempt ?? 1,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.job_id) throw new Error("PAID_JOB_ENQUEUE_FAILED");

  return {
    jobId: row.job_id,
    chargedSubscriptionCredits: Number(row.charged_subscription_credits ?? 0),
    chargedPurchasedCredits: Number(row.charged_purchased_credits ?? 0),
  };
}
