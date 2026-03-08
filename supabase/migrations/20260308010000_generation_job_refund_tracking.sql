alter table public.generation_jobs
  add column if not exists charged_subscription_credits integer not null default 0;

alter table public.generation_jobs
  add column if not exists charged_purchased_credits integer not null default 0;

alter table public.generation_jobs
  add column if not exists refund_reason text;

alter table public.generation_jobs
  add column if not exists refunded_at timestamptz;

create or replace function public.charge_generation_job(
  p_job_id uuid,
  p_user_id uuid,
  p_amount integer
)
returns table(subscription_charged integer, purchased_charged integer, already_charged boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_sub_deduct integer := 0;
  v_pur_deduct integer := 0;
begin
  if p_amount <= 0 then
    return query select 0, 0, true;
    return;
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  if coalesce(v_job.charged_subscription_credits, 0) > 0 or coalesce(v_job.charged_purchased_credits, 0) > 0 then
    return query
      select
        coalesce(v_job.charged_subscription_credits, 0),
        coalesce(v_job.charged_purchased_credits, 0),
        true;
    return;
  end if;

  select subscription_deducted, purchased_deducted
  into v_sub_deduct, v_pur_deduct
  from public.deduct_credits(p_user_id, p_amount);

  update public.generation_jobs
  set
    charged_subscription_credits = v_sub_deduct,
    charged_purchased_credits = v_pur_deduct,
    is_refunded = false,
    refund_reason = null,
    refunded_at = null
  where id = p_job_id;

  return query select v_sub_deduct, v_pur_deduct, false;
end;
$$;

create or replace function public.refund_generation_job(
  p_job_id uuid,
  p_reason text default null
)
returns table(subscription_refunded integer, purchased_refunded integer, already_refunded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_sub integer := 0;
  v_pur integer := 0;
begin
  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  v_sub := coalesce(v_job.charged_subscription_credits, 0);
  v_pur := coalesce(v_job.charged_purchased_credits, 0);

  if v_job.is_refunded then
    return query select v_sub, v_pur, true;
    return;
  end if;

  if v_sub <= 0 and v_pur <= 0 then
    return query select 0, 0, false;
    return;
  end if;

  update public.profiles
  set
    subscription_credits = subscription_credits + v_sub,
    purchased_credits = purchased_credits + v_pur
  where id = v_job.user_id;

  update public.generation_jobs
  set
    is_refunded = true,
    refund_reason = p_reason,
    refunded_at = now()
  where id = p_job_id;

  return query select v_sub, v_pur, false;
end;
$$;
