update public.system_config
set config_value = jsonb_build_object(
  'or-gemini-2.5-flash', 15,
  'or-gemini-3.1-flash', 30,
  'or-gemini-3-pro', 50,
  'ta-gemini-2.5-flash', 15,
  'ta-gemini-3.1-flash', 30,
  'ta-gemini-3-pro', 50,
  'turbo-1k', 15,
  'turbo-2k', 30,
  'turbo-4k', 50,
  'nano-banana', 15,
  'nano-banana-pro', 50
)
where config_key = 'credit_costs';
