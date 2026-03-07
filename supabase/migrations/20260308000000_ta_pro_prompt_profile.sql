insert into public.system_config (config_key, config_value)
values ('ta_pro_prompt_profile_enabled', 'false'::jsonb)
on conflict (config_key) do nothing;

insert into public.system_config (config_key, config_value)
select 'batch_analysis_prompt_en_ta_pro', config_value
from public.system_config
where config_key = 'batch_analysis_prompt_en'
on conflict (config_key) do nothing;

insert into public.system_config (config_key, config_value)
select 'batch_analysis_prompt_zh_ta_pro', config_value
from public.system_config
where config_key = 'batch_analysis_prompt_zh'
on conflict (config_key) do nothing;

insert into public.system_config (config_key, config_value)
select 'clothing_subject_tryon_strategy_prompt_en_ta_pro', config_value
from public.system_config
where config_key = 'clothing_subject_tryon_strategy_prompt_en'
on conflict (config_key) do nothing;

insert into public.system_config (config_key, config_value)
select 'clothing_subject_tryon_strategy_prompt_zh_ta_pro', config_value
from public.system_config
where config_key = 'clothing_subject_tryon_strategy_prompt_zh'
on conflict (config_key) do nothing;
