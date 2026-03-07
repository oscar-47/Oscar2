begin;

update public.packages
set
  active = false,
  is_popular = false,
  updated_at = now()
where active = true;

update public.packages
set
  price_usd = 5.00,
  credits = 1250,
  first_sub_bonus = 0,
  is_popular = false,
  sort_order = 1,
  active = true,
  updated_at = now()
where name = 'topup_5' and type = 'one_time';

insert into public.packages (name, type, price_usd, credits, first_sub_bonus, is_popular, sort_order, active)
select 'topup_5', 'one_time', 5.00, 1250, 0, false, 1, true
where not exists (
  select 1 from public.packages where name = 'topup_5' and type = 'one_time'
);

update public.packages
set
  price_usd = 15.00,
  credits = 3750,
  first_sub_bonus = 0,
  is_popular = false,
  sort_order = 2,
  active = true,
  updated_at = now()
where name = 'topup_15' and type = 'one_time';

insert into public.packages (name, type, price_usd, credits, first_sub_bonus, is_popular, sort_order, active)
select 'topup_15', 'one_time', 15.00, 3750, 0, false, 2, true
where not exists (
  select 1 from public.packages where name = 'topup_15' and type = 'one_time'
);

update public.packages
set
  price_usd = 30.00,
  credits = 7500,
  first_sub_bonus = 0,
  is_popular = false,
  sort_order = 3,
  active = true,
  updated_at = now()
where name = 'topup_30' and type = 'one_time';

insert into public.packages (name, type, price_usd, credits, first_sub_bonus, is_popular, sort_order, active)
select 'topup_30', 'one_time', 30.00, 7500, 0, false, 3, true
where not exists (
  select 1 from public.packages where name = 'topup_30' and type = 'one_time'
);

update public.packages
set
  price_usd = 9.90,
  credits = 2600,
  first_sub_bonus = 0,
  is_popular = false,
  sort_order = 4,
  active = true,
  updated_at = now()
where name = 'monthly' and type = 'subscription';

insert into public.packages (name, type, price_usd, credits, first_sub_bonus, is_popular, sort_order, active)
select 'monthly', 'subscription', 9.90, 2600, 0, false, 4, true
where not exists (
  select 1 from public.packages where name = 'monthly' and type = 'subscription'
);

update public.packages
set
  price_usd = 27.90,
  credits = 7700,
  first_sub_bonus = 0,
  is_popular = false,
  sort_order = 5,
  active = true,
  updated_at = now()
where name = 'quarterly' and type = 'subscription';

insert into public.packages (name, type, price_usd, credits, first_sub_bonus, is_popular, sort_order, active)
select 'quarterly', 'subscription', 27.90, 7700, 0, false, 5, true
where not exists (
  select 1 from public.packages where name = 'quarterly' and type = 'subscription'
);

update public.packages
set
  price_usd = 99.00,
  credits = 29100,
  first_sub_bonus = 0,
  is_popular = true,
  sort_order = 6,
  active = true,
  updated_at = now()
where name = 'yearly' and type = 'subscription';

insert into public.packages (name, type, price_usd, credits, first_sub_bonus, is_popular, sort_order, active)
select 'yearly', 'subscription', 99.00, 29100, 0, true, 6, true
where not exists (
  select 1 from public.packages where name = 'yearly' and type = 'subscription'
);

commit;
