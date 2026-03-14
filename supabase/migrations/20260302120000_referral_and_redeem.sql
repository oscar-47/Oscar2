alter table public.profiles
  add column if not exists invite_code text,
  add column if not exists invited_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists invite_bound_at timestamptz;

create unique index if not exists profiles_invite_code_unique_idx
  on public.profiles(invite_code)
  where invite_code is not null;

create or replace function public.generate_invite_code(p_len integer default 8)
returns text
language plpgsql
volatile
as $$
declare
  v_chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_code text := '';
  v_i integer;
begin
  if p_len <= 0 then
    return '';
  end if;

  for v_i in 1..p_len loop
    v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::integer, 1);
  end loop;

  return v_code;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signup_bonus integer := public.config_int('signup_bonus_credits', 50);
  v_invite_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_invite_code := public.generate_invite_code(8);

    begin
      insert into public.profiles (id, email, purchased_credits, invite_code)
      values (new.id, new.email, v_signup_bonus, v_invite_code)
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

do $$
declare
  v_user_id uuid;
  v_code text;
begin
  for v_user_id in
    select id from public.profiles where invite_code is null
  loop
    loop
      v_code := public.generate_invite_code(8);
      exit when not exists (
        select 1 from public.profiles p where p.invite_code = v_code
      );
    end loop;

    update public.profiles
    set invite_code = v_code
    where id = v_user_id;
  end loop;
end;
$$;

create table if not exists public.referral_bindings (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.profiles(id) on delete cascade,
  invitee_user_id uuid not null references public.profiles(id) on delete cascade,
  invite_code_snapshot text not null,
  rewarded_at timestamptz,
  reward_credits integer not null default 0,
  reward_txn_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (invitee_user_id)
);

create index if not exists referral_bindings_inviter_user_id_idx
  on public.referral_bindings(inviter_user_id);

create table if not exists public.redeem_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  credit_amount integer not null check (credit_amount > 0),
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists redeem_codes_code_idx
  on public.redeem_codes(code);

create table if not exists public.redeem_code_claims (
  id uuid primary key default gen_random_uuid(),
  redeem_code_id uuid not null references public.redeem_codes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_snapshot text not null,
  credited_amount integer not null check (credited_amount > 0),
  created_at timestamptz not null default now(),
  unique (redeem_code_id, user_id)
);

create index if not exists redeem_code_claims_user_id_idx
  on public.redeem_code_claims(user_id, created_at desc);

insert into public.system_config (config_key, config_value)
values ('invite_reward_rate', '0.1'::jsonb)
on conflict (config_key) do nothing;

drop trigger if exists trg_redeem_codes_updated_at on public.redeem_codes;
create trigger trg_redeem_codes_updated_at
before update on public.redeem_codes
for each row execute function public.set_updated_at();

create or replace function public.bind_invite_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_current_invited_by uuid;
  v_inviter_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'message', 'Unauthorized');
  end if;

  if v_code = '' then
    return jsonb_build_object('success', false, 'code', 'INVALID_CODE', 'message', 'Invite code is required');
  end if;

  select invited_by_user_id
  into v_current_invited_by
  from public.profiles
  where id = v_uid
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'PROFILE_NOT_FOUND', 'message', 'Profile not found');
  end if;

  if v_current_invited_by is not null then
    return jsonb_build_object('success', false, 'code', 'ALREADY_BOUND', 'message', 'Invite code already bound');
  end if;

  if exists (
    select 1
    from public.transactions t
    where t.user_id = v_uid
      and t.status = 'completed'
      and coalesce(t.amount, 0) > 0
      and t.package_id is not null
  ) then
    return jsonb_build_object('success', false, 'code', 'PAID_USER_NOT_ALLOWED', 'message', 'Paid users cannot bind invite codes');
  end if;

  select id
  into v_inviter_id
  from public.profiles
  where invite_code = v_code
  limit 1;

  if v_inviter_id is null then
    return jsonb_build_object('success', false, 'code', 'CODE_NOT_FOUND', 'message', 'Invite code not found');
  end if;

  if v_inviter_id = v_uid then
    return jsonb_build_object('success', false, 'code', 'SELF_BIND_NOT_ALLOWED', 'message', 'Cannot bind your own invite code');
  end if;

  update public.profiles
  set invited_by_user_id = v_inviter_id,
      invite_bound_at = now()
  where id = v_uid
    and invited_by_user_id is null;

  if not found then
    return jsonb_build_object('success', false, 'code', 'ALREADY_BOUND', 'message', 'Invite code already bound');
  end if;

  insert into public.referral_bindings (inviter_user_id, invitee_user_id, invite_code_snapshot)
  values (v_inviter_id, v_uid, v_code)
  on conflict (invitee_user_id) do nothing;

  return jsonb_build_object('success', true, 'inviter_user_id', v_inviter_id);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'code', 'ALREADY_BOUND', 'message', 'Invite code already bound');
  when others then
    return jsonb_build_object('success', false, 'code', 'INTERNAL_ERROR', 'message', SQLERRM);
end;
$$;

create or replace function public.claim_redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_redeem public.redeem_codes%rowtype;
  v_claim_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'message', 'Unauthorized');
  end if;

  if v_code = '' then
    return jsonb_build_object('success', false, 'code', 'INVALID_CODE', 'message', 'Redeem code is required');
  end if;

  select *
  into v_redeem
  from public.redeem_codes
  where code = v_code
  for update;

  if v_redeem.id is null then
    return jsonb_build_object('success', false, 'code', 'CODE_NOT_FOUND', 'message', 'Redeem code not found');
  end if;

  if not v_redeem.active then
    return jsonb_build_object('success', false, 'code', 'CODE_INACTIVE', 'message', 'Redeem code is inactive');
  end if;

  if v_redeem.expires_at is not null and v_redeem.expires_at <= now() then
    return jsonb_build_object('success', false, 'code', 'CODE_EXPIRED', 'message', 'Redeem code expired');
  end if;

  if v_redeem.used_count >= v_redeem.max_uses then
    return jsonb_build_object('success', false, 'code', 'CODE_EXHAUSTED', 'message', 'Redeem code usage exhausted');
  end if;

  if exists (
    select 1
    from public.redeem_code_claims c
    where c.redeem_code_id = v_redeem.id
      and c.user_id = v_uid
  ) then
    return jsonb_build_object('success', false, 'code', 'ALREADY_CLAIMED', 'message', 'You have already claimed this code');
  end if;

  perform public.add_credits(v_uid, v_redeem.credit_amount, 'purchased');

  insert into public.redeem_code_claims (redeem_code_id, user_id, code_snapshot, credited_amount)
  values (v_redeem.id, v_uid, v_redeem.code, v_redeem.credit_amount)
  returning id into v_claim_id;

  update public.redeem_codes
  set used_count = used_count + 1
  where id = v_redeem.id;

  return jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'credits', v_redeem.credit_amount
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'code', 'ALREADY_CLAIMED', 'message', 'You have already claimed this code');
  when others then
    return jsonb_build_object('success', false, 'code', 'INTERNAL_ERROR', 'message', SQLERRM);
end;
$$;

grant execute on function public.bind_invite_code(text) to authenticated;
grant execute on function public.claim_redeem_code(text) to authenticated;

alter table public.referral_bindings enable row level security;
alter table public.redeem_codes enable row level security;
alter table public.redeem_code_claims enable row level security;

drop policy if exists referral_bindings_select_participants on public.referral_bindings;
create policy referral_bindings_select_participants
  on public.referral_bindings
  for select
  using (auth.uid() = inviter_user_id or auth.uid() = invitee_user_id);

drop policy if exists redeem_code_claims_select_own on public.redeem_code_claims;
create policy redeem_code_claims_select_own
  on public.redeem_code_claims
  for select
  using (auth.uid() = user_id);
