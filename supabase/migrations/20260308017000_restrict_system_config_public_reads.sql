drop policy if exists "system_config_read_all_auth" on public.system_config;

create policy "system_config_read_safe_auth" on public.system_config
  for select
  using (
    auth.role() = 'authenticated'
    and config_key not ilike '%secret%'
  );
