-- Model generation history table for AI model image generation
create table if not exists public.model_generation_history (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  user_id uuid references auth.users(id),
  gender text not null,
  age_range text not null,
  skin_color text not null,
  other_requirements text,
  created_at timestamptz default now()
);

-- Indexes for efficient querying
create index idx_model_generation_history_job_id on public.model_generation_history(job_id);
create index idx_model_generation_history_user_id on public.model_generation_history(user_id);

-- Enable RLS
alter table public.model_generation_history enable row level security;

-- Users can view their own model generation history
create policy "Users can view their own model generation history"
  on public.model_generation_history for select
  using (auth.uid() = user_id);

-- Users can insert their own model generation history
create policy "Users can insert their own model generation history"
  on public.model_generation_history for insert
  with check (auth.uid() = user_id);
