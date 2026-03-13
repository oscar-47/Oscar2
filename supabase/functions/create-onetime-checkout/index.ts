import Stripe from "npm:stripe@14.25.0";
import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

type Currency = "usd" | "cny" | "hkd";

function resolvePriceId(
  pkg: { stripe_price_id: string | null; stripe_price_id_cny: string | null; stripe_price_id_hkd: string | null },
  currency: Currency,
): string | null {
  if (currency === "cny") return pkg.stripe_price_id_cny ?? pkg.stripe_price_id;
  if (currency === "hkd") return pkg.stripe_price_id_hkd ?? pkg.stripe_price_id;
  return pkg.stripe_price_id;
}

function paymentMethodsForCurrency(currency: Currency): string[] {
  if (currency === "cny" || currency === "hkd") return ["card", "alipay", "wechat_pay"];
  return ["card", "alipay"];
}

function paymentMethodOptions(currency: Currency): Record<string, unknown> | undefined {
  if (currency === "cny" || currency === "hkd") return { wechat_pay: { client: "web" } };
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return err("INTERNAL_ERROR", "Missing STRIPE_SECRET_KEY", 500);

  const body = await req.json().catch(() => null) as { packageId?: string; returnTo?: string; currency?: string } | null;
  if (!body?.packageId) return err("BAD_REQUEST", "packageId is required");

  const currency: Currency = (["cny", "hkd", "usd"] as const).includes(body.currency as Currency)
    ? (body.currency as Currency)
    : "usd";

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const supabase = createServiceClient();
  const user = authResult.user;

  const { data: pkg, error: pkgError } = await supabase
    .from("packages")
    .select("id,name,type,stripe_price_id,stripe_price_id_cny,stripe_price_id_hkd")
    .eq("id", body.packageId)
    .eq("type", "one_time")
    .eq("active", true)
    .single();

  if (pkgError || !pkg) return err("NOT_FOUND", "One-time package not found", 404);

  const priceId = resolvePriceId(pkg, currency);
  if (!priceId) return err("STRIPE_PACKAGE_MISSING_PRICE", "Package missing stripe price id", 400);

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
  const appUrl = Deno.env.get("APP_URL") ?? "https://shopix.ai";
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/")
    ? body.returnTo
    : "/pricing";
  const successUrl = new URL(returnTo, appUrl);
  successUrl.searchParams.set("success", "true");
  successUrl.searchParams.set("type", "onetime");
  const cancelUrl = new URL(returnTo, appUrl);
  cancelUrl.searchParams.set("canceled", "true");

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: paymentMethodsForCurrency(currency),
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      customer_email: user.email,
      allow_promotion_codes: true,
      ...(paymentMethodOptions(currency) ? { payment_method_options: paymentMethodOptions(currency) } : {}),
      metadata: {
        package_id: pkg.id,
        user_id: user.id,
        purchase_type: "one_time",
        currency,
      },
    });
    return ok({ id: session.id, url: session.url });
  } catch (e) {
    return err("STRIPE_CHECKOUT_CREATE_FAILED", "Failed to create checkout session", 500, String(e));
  }
});
