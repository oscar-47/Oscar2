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
    last_error = coalesce(
      nullif(t.last_error, ''),
      case
        when j.status = 'success'
          then 'TERMINAL_PARENT_CLEANUP: parent job already completed successfully'
        when nullif(j.error_code, '') is not null
          then format('TERMINAL_PARENT_CLEANUP: parent job already failed with %s', j.error_code)
        else 'TERMINAL_PARENT_CLEANUP: parent job already ended'
      end
    ),
    updated_at = now()
  from public.generation_jobs j
  where j.id = t.job_id
    and j.status in ('success', 'failed')
    and t.status in ('queued', 'running');

  update public.generation_job_tasks t
  set
    status = 'failed',
    locked_at = null,
    last_error = coalesce(nullif(t.last_error, ''), 'TASK_STALE_NO_HEARTBEAT: worker stopped heartbeating while running'),
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
