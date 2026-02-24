import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

type ConfigMap = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST" && req.method !== "GET") {
    return err("BAD_REQUEST", "Method not allowed", 405);
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("system_config")
    .select("config_key,config_value");

  if (error) return err("INTERNAL_ERROR", "Failed to fetch system config", 500, error);

  const out: ConfigMap = {};
  for (const row of data ?? []) {
    out[row.config_key] = row.config_value;
  }

  return ok(out);
});
