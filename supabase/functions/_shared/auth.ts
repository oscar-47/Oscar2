import { err } from "./http.ts";
import { createServiceClient } from "./supabase.ts";
import { getEnv } from "./env.ts";

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
const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "951454612@qq.com",
  "1027588424@qq.com",
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email);
}

export function isToApisModel(model: string): boolean {
  return model.startsWith("ta-");
}

export function getInternalWorkerSecret(): string {
  const configured = Deno.env.get("GENERATION_INTERNAL_WORKER_SECRET")?.trim();
  return configured && configured.length > 0 ? configured : getEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function isInternalWorkerRequest(req: Request): boolean {
  const provided = req.headers.get("x-worker-secret")?.trim();
  if (!provided) return false;
  return provided === getInternalWorkerSecret();
}

export function requireInternalWorker(req: Request): Response | null {
  return isInternalWorkerRequest(req)
    ? null
    : err("UNAUTHORIZED", "Invalid worker secret", 401);
}

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
