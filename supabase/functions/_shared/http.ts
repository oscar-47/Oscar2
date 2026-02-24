import { corsHeaders } from "./cors.ts";

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function err(code: string, message: string, status = 400, details?: unknown): Response {
  return new Response(
    JSON.stringify({ error: { code, message, details } }),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

export function options(): Response {
  return new Response("ok", { headers: corsHeaders });
}
