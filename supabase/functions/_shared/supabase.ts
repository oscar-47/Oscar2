import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnv } from "./env.ts";

export function createServiceClient() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(jwt: string) {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_ANON_KEY");
  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
