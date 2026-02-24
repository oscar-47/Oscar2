create extension if not exists pgcrypto;

create type public.job_type as enum ('ANALYSIS', 'IMAGE_GEN', 'STYLE_REPLICATE');
create type public.job_status as enum ('processing', 'success', 'failed');
create type public.package_type as enum ('subscription', 'one_time');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  subscription_credits integer not null default 0,
  purchased_credits integer not null default 0,
  has_first_subscription boolean not null default false,
  locale text not null default 'en',
  total_generations integer not null default 0,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_plan text,
  subscription_status text,
  current_period_end timestamptz,
  last_check_in date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.job_type not null,
  status public.job_status not null default 'processing',
  payload jsonb not null default '{}'::jsonb,
  result_data jsonb,
  result_url text,
  error_message text,
  is_refunded boolean not null default false,
  cost_amount integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trace_id uuid,
  client_job_id text,
  fe_attempt integer not null default 1,
  be_retry integer not null default 0,
  duration_ms integer,
  error_code text
);

create index if not exists generation_jobs_user_id_idx on public.generation_jobs(user_id);
create index if not exists generation_jobs_status_idx on public.generation_jobs(status);
create index if not exists generation_jobs_created_at_idx on public.generation_jobs(created_at desc);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.package_type not null,
  price_usd numeric(10,2) not null check (price_usd > 0),
  credits integer not null check (credits > 0),
  first_sub_bonus integer not null default 0,
  stripe_price_id text,
  stripe_product_id text,
  is_popular boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  package_id uuid references public.packages(id),
  stripe_event_id text,
  stripe_payment_id text,
  stripe_session_id text,
  amount numeric(10,2) not null default 0,
  currency text not null default 'usd',
  payment_method text,
  credits integer not null default 0,
  plan text,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_event_id)
);

create index if not exists transactions_user_id_idx on public.transactions(user_id);

create table if not exists public.system_config (
  config_key text primary key,
  config_value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.system_config(config_key, config_value)
values
  ('signup_bonus_credits', '20'::jsonb),
  ('daily_check_in_credits', '0'::jsonb),
  ('batch_concurrency', '8'::jsonb),
  ('credit_costs', '{"nano-banana":3,"nano-banana-pro":5,"turbo-1k":8,"turbo-2k":12,"turbo-4k":17}'::jsonb)
on conflict (config_key) do nothing;

insert into public.packages(name, type, price_usd, credits, first_sub_bonus, is_popular, sort_order)
values
  ('Starter', 'subscription', 5.00, 250, 25, false, 1),
  ('Professional', 'subscription', 20.00, 1200, 120, true, 2),
  ('Enterprise', 'subscription', 100.00, 7000, 700, false, 3),
  ('250 Credits', 'one_time', 5.00, 250, 0, false, 4),
  ('1200 Credits', 'one_time', 20.00, 1200, 0, true, 5),
  ('7000 Credits', 'one_time', 100.00, 7000, 0, false, 6)
on conflict do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create trigger trg_generation_jobs_updated_at before update on public.generation_jobs
for each row execute function public.set_updated_at();

create trigger trg_transactions_updated_at before update on public.transactions
for each row execute function public.set_updated_at();

create trigger trg_packages_updated_at before update on public.packages
for each row execute function public.set_updated_at();

create or replace function public.config_int(p_key text, p_default integer)
returns integer
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  select config_value into v from public.system_config where config_key = p_key;
  if v is null then
    return p_default;
  end if;
  return coalesce((v #>> '{}')::integer, p_default);
exception when others then
  return p_default;
end;
$$;

create or replace function public.add_credits(p_user_id uuid, p_amount integer, p_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount <= 0 then
    raise exception 'p_amount must be positive';
  end if;

  if p_type = 'subscription' then
    update public.profiles
      set subscription_credits = subscription_credits + p_amount
      where id = p_user_id;
  elsif p_type = 'purchased' then
    update public.profiles
      set purchased_credits = purchased_credits + p_amount
      where id = p_user_id;
  else
    raise exception 'invalid credit type';
  end if;
end;
$$;

create or replace function public.deduct_credits(p_user_id uuid, p_amount integer)
returns table(subscription_deducted integer, purchased_deducted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub integer;
  v_pur integer;
  v_need integer;
  v_sub_deduct integer := 0;
  v_pur_deduct integer := 0;
begin
  if p_amount <= 0 then
    raise exception 'p_amount must be positive';
  end if;

  select subscription_credits, purchased_credits
  into v_sub, v_pur
  from public.profiles
  where id = p_user_id
  for update;

  if coalesce(v_sub, 0) + coalesce(v_pur, 0) < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_need := p_amount;

  if v_sub > 0 then
    v_sub_deduct := least(v_sub, v_need);
    v_need := v_need - v_sub_deduct;
  end if;

  if v_need > 0 then
    v_pur_deduct := least(v_pur, v_need);
  end if;

  update public.profiles
  set
    subscription_credits = subscription_credits - v_sub_deduct,
    purchased_credits = purchased_credits - v_pur_deduct
  where id = p_user_id;

  return query select v_sub_deduct, v_pur_deduct;
end;
$$;

create or replace function public.check_in_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
  v_bonus integer := public.config_int('daily_check_in_credits', 0);
begin
  select last_check_in into v_last from public.profiles where id = p_user_id for update;

  if v_last = current_date then
    return jsonb_build_object('success', true, 'credits_earned', 0);
  end if;

  if v_bonus > 0 then
    perform public.add_credits(p_user_id, v_bonus, 'purchased');
  end if;

  update public.profiles set last_check_in = current_date where id = p_user_id;

  return jsonb_build_object('success', true, 'credits_earned', v_bonus);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signup_bonus integer := public.config_int('signup_bonus_credits', 20);
begin
  insert into public.profiles (id, email, purchased_credits)
  values (new.id, new.email, v_signup_bonus)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.transactions enable row level security;
alter table public.packages enable row level security;
alter table public.system_config enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "generation_jobs_select_own" on public.generation_jobs
  for select using (auth.uid() = user_id);

create policy "generation_jobs_insert_own" on public.generation_jobs
  for insert with check (auth.uid() = user_id);

create policy "generation_jobs_update_own" on public.generation_jobs
  for update using (auth.uid() = user_id);

create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);

create policy "packages_read_all_auth" on public.packages
  for select using (auth.role() = 'authenticated');

create policy "system_config_read_all_auth" on public.system_config
  for select using (auth.role() = 'authenticated');
