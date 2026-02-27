alter table public.model_generation_history
  add column if not exists status text not null default 'processing',
  add column if not exists result_url text,
  add column if not exists error_message text,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_model_generation_history_user_created_at
  on public.model_generation_history(user_id, created_at desc);

create index if not exists idx_model_generation_history_job_id
  on public.model_generation_history(job_id);
