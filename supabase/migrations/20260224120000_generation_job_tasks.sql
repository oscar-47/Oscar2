create table if not exists public.generation_job_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.generation_jobs(id) on delete cascade,
  task_type text not null check (task_type in ('ANALYSIS', 'IMAGE_GEN')),
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'failed')),
  attempts integer not null default 0,
  locked_at timestamptz,
  run_after timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_job_tasks_status_run_after_idx
  on public.generation_job_tasks(status, run_after);

create index if not exists generation_job_tasks_locked_at_idx
  on public.generation_job_tasks(locked_at);

drop trigger if exists trg_generation_job_tasks_updated_at on public.generation_job_tasks;
create trigger trg_generation_job_tasks_updated_at
before update on public.generation_job_tasks
for each row execute function public.set_updated_at();

create or replace function public.claim_generation_task(p_job_id uuid)
returns public.generation_job_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.generation_job_tasks;
begin
  update public.generation_job_tasks t
  set
    status = 'running',
    attempts = t.attempts + 1,
    locked_at = now(),
    updated_at = now()
  where t.job_id = p_job_id
    and (
      (t.status = 'queued' and t.run_after <= now())
      or
      (t.status = 'running' and coalesce(t.locked_at, now() - interval '10 minutes') <= now() - interval '90 seconds')
    )
  returning t.* into v_task;

  return v_task;
end;
$$;
