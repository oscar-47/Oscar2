-- Fix: enable RLS on generation_job_tasks (Supabase security alert)
-- This table is only accessed by edge functions via service_role key,
-- which bypasses RLS. No user-facing policies needed.
alter table public.generation_job_tasks enable row level security;
