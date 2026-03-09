-- Upgrade list_runnable_generation_jobs to auto-cleanup zombie tasks:
-- tasks with attempts >= 5 that are still 'running' (the stale reclaim loop
-- won't pick them up because attempts < 5 filter excludes them).
-- Also fail their parent jobs if all tasks are done.

create or replace function public.list_runnable_generation_jobs(p_limit integer default 10)
returns table(job_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Step 1: Auto-fail zombie tasks (running + attempts >= 5)
  update public.generation_job_tasks t
  set status = 'failed', locked_at = null, last_error = 'MAX_ATTEMPTS_EXCEEDED'
  where t.status = 'running'
    and t.attempts >= 5
    and coalesce(t.locked_at, now() - interval '10 minutes') <= now() - interval '3 minutes';

  -- Step 2: Auto-fail parent jobs whose only tasks are all failed
  update public.generation_jobs j
  set status = 'failed',
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

  -- Step 3: Return runnable jobs (original logic)
  return query
  with candidates as (
    select
      t.job_id,
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
    group by t.job_id
    order by ready_at asc
    limit greatest(coalesce(p_limit, 0), 0)
  )
  select c.job_id
  from candidates c;
end;
$$;
