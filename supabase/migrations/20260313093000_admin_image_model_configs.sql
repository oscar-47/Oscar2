insert into public.system_config (config_key, config_value)
values ('admin_image_model_configs_v1', '[]'::jsonb)
on conflict (config_key) do nothing;
