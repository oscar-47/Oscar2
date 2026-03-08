create index if not exists generation_jobs_user_status_type_idx
  on public.generation_jobs(user_id, status, type);

insert into public.system_config(config_key, config_value)
values
  ('generation_limit_analysis_processing', '4'::jsonb),
  ('generation_limit_image_gen_processing', '8'::jsonb),
  ('generation_limit_style_replicate_processing', '4'::jsonb),
  ('generation_queue_max_running_tasks', '8'::jsonb),
  ('generation_queue_runner_batch_size', '4'::jsonb)
on conflict (config_key) do nothing;

create or replace function public.list_runnable_generation_jobs(p_limit integer default 10)
returns table(job_id uuid)
language sql
security definer
set search_path = public
as $$
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
$$;
