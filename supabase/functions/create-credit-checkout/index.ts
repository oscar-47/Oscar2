import Stripe from "npm:stripe@14.25.0";
import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return err("INTERNAL_ERROR", "Missing STRIPE_SECRET_KEY", 500);

  const body = await req.json().catch(() => null) as { packageId?: string; returnTo?: string } | null;
  if (!body?.packageId) return err("BAD_REQUEST", "packageId is required");

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const supabase = createServiceClient();
  const user = authResult.user;

  const { data: pkg, error: pkgError } = await supabase
    .from("packages")
    .select("id,name,type,stripe_price_id")
    .eq("id", body.packageId)
    .eq("type", "subscription")
    .eq("active", true)
    .single();

  if (pkgError || !pkg) return err("NOT_FOUND", "Subscription package not found", 404);
  if (!pkg.stripe_price_id) return err("STRIPE_PACKAGE_MISSING_PRICE", "Package missing stripe price id", 400);

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
  const appUrl = Deno.env.get("APP_URL") ?? "https://shopix.ai";
  const returnTo = body.returnTo ?? "/pricing";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
      success_url: `${appUrl}/pricing?success=true&return_to=${encodeURIComponent(returnTo)}`,
      cancel_url: `${appUrl}/pricing?canceled=true&return_to=${encodeURIComponent(returnTo)}`,
      customer_email: user.email,
      allow_promotion_codes: true,
      metadata: {
        package_id: pkg.id,
        user_id: user.id,
        purchase_type: "subscription",
      },
    });
    return ok({ id: session.id, url: session.url });
  } catch (e) {
    return err("STRIPE_CHECKOUT_CREATE_FAILED", "Failed to create checkout session", 500, String(e));
  }
});
