insert into public.system_config(config_key, config_value)
values
  ('generation_limit_analysis_processing', '10'::jsonb),
  ('generation_limit_image_gen_processing', '8'::jsonb),
  ('generation_limit_style_replicate_processing', '4'::jsonb),
  ('generation_queue_max_running_tasks', '8'::jsonb),
  ('generation_queue_runner_batch_size', '4'::jsonb),
  ('generation_queue_invoke_backoff_ms', '60000'::jsonb),
  ('generation_openrouter_max_input_images', '3'::jsonb)
on conflict (config_key) do update
set config_value = excluded.config_value;

create or replace function public.claim_generation_task(p_job_id uuid)
returns public.generation_job_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.generation_job_tasks;
  v_active_running integer;
  v_max_running integer := public.config_int('generation_queue_max_running_tasks', 8);
begin
  select count(*)
  into v_active_running
  from public.generation_job_tasks t
  where t.status = 'running'
    and coalesce(t.locked_at, now() - interval '10 minutes') > now() - interval '3 minutes';

  if coalesce(v_active_running, 0) >= greatest(v_max_running, 1) then
    return null;
  end if;

  update public.generation_job_tasks t
  set
    status = 'failed',
    locked_at = null,
    last_error = coalesce(nullif(t.last_error, ''), 'MAX_ATTEMPTS_EXCEEDED: task retried too many times'),
    updated_at = now()
  where t.job_id = p_job_id
    and t.attempts >= 5
    and t.status in ('queued', 'running');

  update public.generation_jobs j
  set
    status = 'failed',
    error_code = 'MAX_ATTEMPTS_EXCEEDED',
    error_message = 'Task exceeded maximum retry attempts'
  where j.id = p_job_id
    and j.status = 'processing'
    and exists (
      select 1 from public.generation_job_tasks t
      where t.job_id = j.id and t.status = 'failed' and t.attempts >= 5
    );

  update public.generation_job_tasks t
  set
    status = 'running',
    attempts = t.attempts + 1,
    locked_at = now(),
    updated_at = now()
  where t.job_id = p_job_id
    and t.attempts < 5
    and (
      (t.status = 'queued' and t.run_after <= now())
      or
      (t.status = 'running' and coalesce(t.locked_at, now() - interval '10 minutes') <= now() - interval '3 minutes')
    )
  returning t.* into v_task;

  return v_task;
end;
$$;

create or replace function public.list_runnable_generation_tasks(p_limit integer default 10)
returns table(job_id uuid, task_type text)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.generation_job_tasks t
  set
    status = 'failed',
    locked_at = null,
    last_error = coalesce(nullif(t.last_error, ''), 'MAX_ATTEMPTS_EXCEEDED: task retried too many times'),
    updated_at = now()
  where t.status = 'running'
    and t.attempts >= 5
    and coalesce(t.locked_at, now() - interval '10 minutes') <= now() - interval '3 minutes';

  update public.generation_jobs j
  set
    status = 'failed',
    error_code = 'MAX_ATTEMPTS_EXCEEDED',
    error_message = 'All tasks exceeded maximum retry attempts'
  where j.status = 'processing'
    and not exists (
      select 1 from public.generation_job_tasks t
      where t.job_id = j.id and t.status not in ('failed', 'success')
    )
    and exists (
      select 1 from public.generation_job_tasks t
      where t.job_id = j.id and t.status = 'failed'
    );

  return query
  with candidates as (
    select
      t.job_id,
      t.task_type,
      min(
        case
          when t.status = 'queued' then t.run_after
          else coalesce(t.locked_at, now() - interval '10 minutes')
        end
      ) as ready_at
    from public.generation_job_tasks t
    join public.generation_jobs j on j.id = t.job_id
    where j.status = 'processing'
      and t.attempts < 5
      and (
        (t.status = 'queued' and t.run_after <= now())
        or
        (t.status = 'running' and coalesce(t.locked_at, now() - interval '10 minutes') <= now() - interval '3 minutes')
      )
    group by t.job_id, t.task_type
    order by ready_at asc
    limit greatest(coalesce(p_limit, 0), 0)
  )
  select c.job_id, c.task_type
  from candidates c;
end;
$$;

create or replace function public.list_runnable_generation_jobs(p_limit integer default 10)
returns table(job_id uuid)
language sql
security definer
set search_path = public
as $$
  select t.job_id
  from public.list_runnable_generation_tasks(p_limit) t;
$$;
