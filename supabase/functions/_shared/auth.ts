import { err } from "./http.ts";
import { createServiceClient } from "./supabase.ts";

export type AuthedUser = {
  id: string;
  email?: string | null;
};

export type AuthOk = {
  ok: true;
  user: AuthedUser;
  token: string;
};

export type AuthFail = {
  ok: false;
  response: Response;
};

export type AuthResult = AuthOk | AuthFail;

/**
 * Unified auth guard for verify_jwt=false mode.
 * Every business function should call this at entry.
 */
export async function requireUser(req: Request): Promise<AuthResult> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, response: err("UNAUTHORIZED", "Missing bearer token", 401) };
  }

  const token = auth.replace("Bearer ", "").trim();
  if (!token) return { ok: false, response: err("UNAUTHORIZED", "Invalid token", 401) };

  const supabase = createServiceClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { ok: false, response: err("UNAUTHORIZED", "Invalid token", 401) };
  }

  return {
    ok: true,
    token,
    user: { id: user.id, email: user.email },
  };
}
