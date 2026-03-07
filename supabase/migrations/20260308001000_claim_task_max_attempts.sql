-- Prevent zombie tasks from retrying infinitely and exhausting compute.
-- Add max attempts guard: tasks with attempts >= 5 are never re-claimed.
-- Also auto-fail the parent job when a task exceeds max attempts.

create or replace function public.claim_generation_task(p_job_id uuid)
returns public.generation_job_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.generation_job_tasks;
begin
  -- First: auto-fail any task that has exceeded max attempts (prevents zombie loops)
  update public.generation_job_tasks t
  set
    status = 'failed',
    locked_at = null,
    last_error = 'MAX_ATTEMPTS_EXCEEDED: task retried too many times',
    updated_at = now()
  where t.job_id = p_job_id
    and t.attempts >= 5
    and t.status in ('queued', 'running');

  -- Also fail the parent job if the task is now failed
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

  -- Now try to claim an available task (only if attempts < 5)
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
