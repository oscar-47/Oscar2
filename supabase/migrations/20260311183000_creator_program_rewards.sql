alter table public.support_feedback
  add column if not exists category text not null default 'general',
  add column if not exists creator_content_url text,
  add column if not exists creator_platform text,
  add column if not exists creator_published_at timestamptz;

alter table public.support_feedback
  drop constraint if exists support_feedback_category_check;

alter table public.support_feedback
  add constraint support_feedback_category_check
  check (category in ('general', 'creator_program'));

create table if not exists public.creator_program_rewards (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.support_feedback(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage text not null check (stage in ('3d', '7d')),
  metric_type text not null check (metric_type in ('like', 'favorite')),
  metric_value integer not null check (metric_value >= 0),
  reward_credits integer not null check (reward_credits > 0),
  transaction_id uuid references public.transactions(id) on delete set null,
  admin_note text,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  unique (feedback_id, stage)
);

create index if not exists creator_program_rewards_feedback_id_idx
  on public.creator_program_rewards(feedback_id, created_at desc);

create index if not exists creator_program_rewards_user_id_idx
  on public.creator_program_rewards(user_id, created_at desc);

alter table public.creator_program_rewards enable row level security;

drop policy if exists creator_program_rewards_select_own on public.creator_program_rewards;
create policy creator_program_rewards_select_own
  on public.creator_program_rewards
  for select
  using (auth.uid() = user_id);
