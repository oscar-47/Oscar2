/**
 * create-alipay-checkout — Generate an Alipay payment page URL.
 *
 * Supports both one-time and subscription packages.
 * Subscriptions are treated as single payments; we manage the period ourselves.
 */
import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";
import { getAlipayConfig, buildCheckoutUrl, type AlipayCheckoutSurface } from "../_shared/alipay.ts";

const STALE_PENDING_MINUTES = 30;

function detectCheckoutSurface(userAgent: string | null): AlipayCheckoutSurface {
  if (!userAgent) return "page";
  return /android|iphone|ipad|ipod|mobile|blackberry|iemobile|opera mini|webos/i.test(userAgent)
    ? "wap"
    : "page";
}

async function expireStalePendingOrders(supabase: ReturnType<typeof createServiceClient>) {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("alipay_orders")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("created_at", cutoff);

  if (error) {
    console.error("Failed to expire stale alipay orders:", error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const body = await req.json().catch(() => null) as {
    packageId?: string;
    returnTo?: string;
  } | null;
  if (!body?.packageId) return err("BAD_REQUEST", "packageId is required");

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const supabase = createServiceClient();
  const user = authResult.user;
  await expireStalePendingOrders(supabase);

  // Fetch the package (accept both one_time and subscription)
  const { data: pkg, error: pkgError } = await supabase
    .from("packages")
    .select("id,name,type,price_usd,credits,first_sub_bonus")
    .eq("id", body.packageId)
    .eq("active", true)
    .single();

  if (pkgError || !pkg) return err("NOT_FOUND", "Package not found", 404);

  // CNY price mapping (same as frontend)
  const CNY_PRICES: Record<string, number> = {
    topup_5: 36, topup_15: 108, topup_30: 218,
    monthly: 72, quarterly: 202, yearly: 718,
  };
  const priceCny = CNY_PRICES[pkg.name];
  if (!priceCny) return err("BAD_REQUEST", "Package not supported for Alipay", 400);

  const planLabels: Record<string, string> = {
    topup_5: "Shopix 基础充值包",
    topup_15: "Shopix 标准充值包",
    topup_30: "Shopix 专业充值包",
    monthly: "Shopix 月度订阅",
    quarterly: "Shopix 季度订阅",
    yearly: "Shopix 年度订阅",
  };

  try {
    const config = getAlipayConfig();
    const appUrl = Deno.env.get("APP_URL") ?? "https://shopix-ai.company";
    const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/")
      ? body.returnTo
      : "/pricing";
    const surface = detectCheckoutSurface(req.headers.get("user-agent"));
    const successUrl = new URL(returnTo, appUrl);
    successUrl.searchParams.set("success", "true");
    successUrl.searchParams.set("type", pkg.type === "subscription" ? "subscription" : "onetime");

    // Generate the Alipay trade URL first so we do not create pending rows for failed URL generation.
    const outTradeNo = `shopix_${user.id.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = await buildCheckoutUrl(config, {
      outTradeNo,
      totalAmount: priceCny.toFixed(2),
      subject: planLabels[pkg.name] ?? `Shopix ${pkg.name}`,
      returnUrl: successUrl.toString(),
      passbackParams: encodeURIComponent(JSON.stringify({
        user_id: user.id,
        package_id: pkg.id,
      })),
    }, surface);

    const { error: orderError } = await supabase.from("alipay_orders").insert({
      out_trade_no: outTradeNo,
      user_id: user.id,
      package_id: pkg.id,
      package_name: pkg.name,
      package_type: pkg.type,
      amount_cny: priceCny,
      credits: pkg.credits,
      first_sub_bonus: pkg.first_sub_bonus ?? 0,
      status: "pending",
    });

    if (orderError) {
      console.error("Failed to create alipay order:", orderError);
      return err("INTERNAL_ERROR", "Failed to create order", 500);
    }

    return ok({ url, surface });
  } catch (e) {
    console.error("Alipay checkout error:", e);
    return err("ALIPAY_CHECKOUT_FAILED", "Failed to create Alipay checkout", 500, String(e));
  }
});
