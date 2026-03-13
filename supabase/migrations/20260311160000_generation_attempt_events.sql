create table if not exists public.generation_attempt_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trace_id text,
  studio_type text not null,
  stage text not null check (stage in ('prepare_inputs', 'prompt_generate', 'image_queue', 'batch_complete')),
  status text not null check (status in ('started', 'success', 'failed', 'partial')),
  error_code text,
  error_message text,
  http_status integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists generation_attempt_events_user_created_idx
  on public.generation_attempt_events(user_id, created_at desc);

create index if not exists generation_attempt_events_trace_created_idx
  on public.generation_attempt_events(trace_id, created_at desc);

create index if not exists generation_attempt_events_studio_stage_created_idx
  on public.generation_attempt_events(studio_type, stage, created_at desc);

alter table public.generation_attempt_events enable row level security;

create policy "generation_attempt_events_select_own"
  on public.generation_attempt_events
  for select
  using (auth.uid() = user_id);

create policy "generation_attempt_events_insert_own"
  on public.generation_attempt_events
  for insert
  with check (auth.uid() = user_id);
