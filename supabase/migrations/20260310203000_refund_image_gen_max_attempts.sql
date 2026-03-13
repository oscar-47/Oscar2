create or replace function public.fail_generation_job_for_max_attempts(
  p_job_id uuid,
  p_error_message text default 'Task exceeded maximum retry attempts'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_message text := coalesce(nullif(btrim(p_error_message), ''), 'Task exceeded maximum retry attempts');
begin
  update public.generation_jobs
  set
    status = 'failed',
    error_code = 'MAX_ATTEMPTS_EXCEEDED',
    error_message = v_message
  where id = p_job_id
    and status = 'processing'
  returning * into v_job;

  if not found then
    return;
  end if;

  if v_job.type = 'IMAGE_GEN' then
    perform public.refund_generation_job(v_job.id, 'MAX_ATTEMPTS_EXCEEDED');
  end if;
end;
$$;

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
  v_last_error text;
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

  if exists (
    select 1
    from public.generation_job_tasks t
    where t.job_id = p_job_id
      and t.status = 'failed'
      and t.attempts >= 5
  ) then
    select nullif(left(t.last_error, 500), '')
    into v_last_error
    from public.generation_job_tasks t
    where t.job_id = p_job_id
      and t.status = 'failed'
      and t.attempts >= 5
    order by t.updated_at desc
    limit 1;

    perform public.fail_generation_job_for_max_attempts(
      p_job_id,
      case
        when v_last_error is not null
          then format('Task exceeded maximum retry attempts. Last error: %s', v_last_error)
        else 'Task exceeded maximum retry attempts'
      end
    );
  end if;

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
declare
  v_failed_job record;
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

  for v_failed_job in
    select
      j.id as job_id,
      (
        select nullif(left(t.last_error, 500), '')
        from public.generation_job_tasks t
        where t.job_id = j.id
          and nullif(t.last_error, '') is not null
        order by t.updated_at desc
        limit 1
      ) as last_error
    from public.generation_jobs j
    where j.status = 'processing'
      and not exists (
        select 1 from public.generation_job_tasks t
        where t.job_id = j.id and t.status not in ('failed', 'success')
      )
      and exists (
        select 1 from public.generation_job_tasks t
        where t.job_id = j.id and t.status = 'failed'
      )
  loop
    perform public.fail_generation_job_for_max_attempts(
      v_failed_job.job_id,
      case
        when v_failed_job.last_error is not null
          then format('All tasks exceeded maximum retry attempts. Last error: %s', v_failed_job.last_error)
        else 'All tasks exceeded maximum retry attempts'
      end
    );
  end loop;

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
