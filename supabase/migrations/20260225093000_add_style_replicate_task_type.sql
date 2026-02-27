alter table public.generation_job_tasks
  drop constraint if exists generation_job_tasks_task_type_check;

alter table public.generation_job_tasks
  add constraint generation_job_tasks_task_type_check
  check (task_type in ('ANALYSIS', 'IMAGE_GEN', 'STYLE_REPLICATE'));
