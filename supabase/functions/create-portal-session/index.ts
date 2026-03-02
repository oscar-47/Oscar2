import Stripe from "npm:stripe@14.25.0";
import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return err("INTERNAL_ERROR", "Missing STRIPE_SECRET_KEY", 500);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", authResult.user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return err("NO_SUBSCRIPTION", "No billing account found", 404);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
  const appUrl = Deno.env.get("APP_URL") ?? "https://shopix-ai.company";

  const body = await req.json().catch(() => ({})) as { returnTo?: string };
  // Validate returnTo is an internal path (security: prevent open redirect)
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/")
    ? body.returnTo : "/profile";
  const returnUrl = `${appUrl}${returnTo}`;

  try {
    const portalConfigId = Deno.env.get("STRIPE_BILLING_PORTAL_CONFIG_ID");
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl,
      ...(portalConfigId ? { configuration: portalConfigId } : {}),
    });
    return ok({ url: session.url });
  } catch (e) {
    console.error("Portal session error:", e);
    return err("PORTAL_CREATE_FAILED", "Failed to create billing portal session", 500);
  }
});
