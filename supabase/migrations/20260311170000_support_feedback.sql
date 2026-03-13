create type public.support_feedback_status as enum ('open', 'replied');

create table if not exists public.support_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(btrim(message)) > 0 and char_length(message) <= 2000),
  attachments jsonb not null default '[]'::jsonb,
  status public.support_feedback_status not null default 'open',
  admin_reply text,
  admin_replied_at timestamptz,
  admin_replied_by text,
  user_seen_reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_feedback_attachments_array check (jsonb_typeof(attachments) = 'array'),
  constraint support_feedback_reply_consistency check (
    (
      status = 'open'
      and admin_reply is null
      and admin_replied_at is null
      and admin_replied_by is null
    )
    or
    (
      status = 'replied'
      and admin_reply is not null
      and admin_replied_at is not null
      and admin_replied_by is not null
      and char_length(admin_reply) <= 2000
    )
  )
);

create index if not exists support_feedback_user_id_idx
  on public.support_feedback(user_id, created_at desc);

create index if not exists support_feedback_status_idx
  on public.support_feedback(status, created_at desc);

create trigger trg_support_feedback_updated_at
before update on public.support_feedback
for each row execute function public.set_updated_at();

alter table public.support_feedback enable row level security;

create policy "support_feedback_select_own"
  on public.support_feedback
  for select
  using (auth.uid() = user_id);

create policy "support_feedback_insert_own"
  on public.support_feedback
  for insert
  with check (auth.uid() = user_id);
