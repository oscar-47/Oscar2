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

function coerceInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
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

export async function getIntegerSystemConfig(
  key: string,
  fallback = 0,
): Promise<number> {
  const value = await getSystemConfigValue(key);
  return coerceInteger(value, fallback);
}
