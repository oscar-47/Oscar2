-- Security measure #2: Delay signup bonus until email is confirmed.
-- Security measure #3: ANALYSIS daily limit (configurable via system_config).
-- Security measure #4: Per-user rate limiting support.

-- ============================================================
-- #2: Delayed signup bonus
-- ============================================================

-- Replace handle_new_user() to give 0 credits at signup.
-- The bonus will be granted when the user confirms their email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_invite_code := public.generate_invite_code(8);

    begin
      insert into public.profiles (id, email, purchased_credits, invite_code)
      values (new.id, new.email, 0, v_invite_code)
      on conflict (id) do nothing;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise;
      end if;
    end;
  end loop;

  return new;
end;
$$;

-- Grant signup bonus when email_confirmed_at transitions from NULL to non-NULL.
create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signup_bonus integer := public.config_int('signup_bonus_credits', 30);
begin
  -- Only fire when email_confirmed_at changes from NULL to a value.
  -- Idempotency is guaranteed by the trigger WHEN clause (old IS NULL, new IS NOT NULL)
  -- — email_confirmed_at cannot revert to NULL once set.
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.profiles
    set purchased_credits = purchased_credits + v_signup_bonus
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_email_confirmed on auth.users;
create trigger on_auth_email_confirmed
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.handle_email_confirmed();

-- ============================================================
-- #3: ANALYSIS daily limit config
-- ============================================================

insert into public.system_config (config_key, config_value)
values ('analysis_daily_limit_per_user', '50'::jsonb)
on conflict (config_key) do nothing;

-- ============================================================
-- #4: Per-user job rate limit config (jobs per minute)
-- ============================================================

insert into public.system_config (config_key, config_value)
values ('rate_limit_jobs_per_minute', '10'::jsonb)
on conflict (config_key) do nothing;
