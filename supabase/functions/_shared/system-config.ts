import { createServiceClient } from "./supabase.ts";

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
}

export async function getSystemConfigValue(
  key: string,
): Promise<unknown | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("system_config")
    .select("config_value")
    .eq("config_key", key)
    .maybeSingle();

  return data?.config_value ?? null;
}

export async function getBooleanSystemConfig(
  key: string,
  fallback = false,
): Promise<boolean> {
  const value = await getSystemConfigValue(key);
  return coerceBoolean(value, fallback);
}
