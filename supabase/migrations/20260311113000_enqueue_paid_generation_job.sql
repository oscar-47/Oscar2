create or replace function public.enqueue_paid_generation_job(
  p_user_id uuid,
  p_job_type public.job_type,
  p_payload jsonb,
  p_cost_amount integer,
  p_trace_id text default null,
  p_client_job_id text default null,
  p_fe_attempt integer default 1
)
returns table(
  job_id uuid,
  charged_subscription_credits integer,
  charged_purchased_credits integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_available integer := 0;
  v_sub integer := 0;
  v_pur integer := 0;
  v_sub_deduct integer := 0;
  v_pur_deduct integer := 0;
begin
  if p_job_type not in ('IMAGE_GEN', 'STYLE_REPLICATE') then
    raise exception 'UNSUPPORTED_JOB_TYPE';
  end if;

  if p_cost_amount <= 0 then
    raise exception 'INVALID_COST_AMOUNT';
  end if;

  select
    coalesce(subscription_credits, 0),
    coalesce(purchased_credits, 0)
  into v_sub, v_pur
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  v_available := v_sub + v_pur;
  if v_available < p_cost_amount then
    raise exception 'INSUFFICIENT_CREDITS available=% required=%', v_available, p_cost_amount;
  end if;

  select subscription_deducted, purchased_deducted
  into v_sub_deduct, v_pur_deduct
  from public.deduct_credits(p_user_id, p_cost_amount);

  insert into public.generation_jobs (
    user_id,
    type,
    status,
    payload,
    cost_amount,
    trace_id,
    client_job_id,
    fe_attempt,
    charged_subscription_credits,
    charged_purchased_credits,
    is_refunded,
    refund_reason,
    refunded_at
  )
  values (
    p_user_id,
    p_job_type,
    'processing',
    coalesce(p_payload, '{}'::jsonb),
    p_cost_amount,
    p_trace_id::uuid,
    p_client_job_id,
    greatest(coalesce(p_fe_attempt, 1), 1),
    v_sub_deduct,
    v_pur_deduct,
    false,
    null,
    null
  )
  returning id into v_job_id;

  insert into public.generation_job_tasks (
    job_id,
    task_type,
    status,
    payload
  )
  values (
    v_job_id,
    p_job_type::text,
    'queued',
    coalesce(p_payload, '{}'::jsonb)
  );

  return query
    select v_job_id, v_sub_deduct, v_pur_deduct;
end;
$$;
