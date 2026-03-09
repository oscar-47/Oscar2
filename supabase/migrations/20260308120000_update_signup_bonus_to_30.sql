update public.system_config
set config_value = '30'::jsonb,
    updated_at = now()
where config_key = 'signup_bonus_credits'
  and config_value <> '30'::jsonb;
