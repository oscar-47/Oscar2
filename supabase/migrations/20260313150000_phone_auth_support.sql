-- Phone authentication support: add phone column, update triggers.

-- 1. Add phone column to profiles
alter table public.profiles add column if not exists phone text;

-- 2. Update handle_new_user to store phone
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
      insert into public.profiles (id, email, phone, purchased_credits, invite_code)
      values (new.id, new.email, new.phone, 0, v_invite_code)
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

-- 3. Grant signup bonus when phone_confirmed_at transitions NULL → non-NULL
create or replace function public.handle_phone_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signup_bonus integer := public.config_int('signup_bonus_credits', 30);
begin
  if old.phone_confirmed_at is null and new.phone_confirmed_at is not null then
    update public.profiles
    set purchased_credits = purchased_credits + v_signup_bonus
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_phone_confirmed on auth.users;
create trigger on_auth_phone_confirmed
after update of phone_confirmed_at on auth.users
for each row
when (old.phone_confirmed_at is null and new.phone_confirmed_at is not null)
execute function public.handle_phone_confirmed();
