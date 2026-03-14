/**
 * alipay-notify — Handle Alipay async payment notifications.
 *
 * Alipay POSTs form-urlencoded data. We verify the RSA2 signature,
 * look up our stored order, and fulfill it (add credits, set subscription).
 */
import { createServiceClient } from "../_shared/supabase.ts";
import { getAlipayConfig, verifyNotification } from "../_shared/alipay.ts";
import { corsHeaders } from "../_shared/cors.ts";

/** Calculate subscription period end date */
function calcPeriodEnd(planName: string): string {
  const now = new Date();
  switch (planName) {
    case "monthly":
      now.setDate(now.getDate() + 30);
      break;
    case "quarterly":
      now.setDate(now.getDate() + 90);
      break;
    case "yearly":
      now.setDate(now.getDate() + 365);
      break;
  }
  return now.toISOString();
}

Deno.serve(async (req) => {
  // Alipay notifications are POST with application/x-www-form-urlencoded
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("fail", { status: 405 });
  }

  const formBody = await req.text();
  console.log("Alipay notify received");

  const config = getAlipayConfig();
  const params = await verifyNotification(formBody, config.alipayPublicKey);

  if (!params) {
    console.error("Alipay signature verification failed");
    return new Response("fail", { status: 400 });
  }

  const tradeStatus = params.trade_status;
  const outTradeNo = params.out_trade_no;
  const tradeNo = params.trade_no; // Alipay's transaction ID

  // Only process successful trades
  if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
    console.log(`Alipay notify: ignoring status ${tradeStatus} for ${outTradeNo}`);
    return new Response("success");
  }

  const supabase = createServiceClient();

  // Look up our stored order
  const { data: order, error: orderError } = await supabase
    .from("alipay_orders")
    .select("*")
    .eq("out_trade_no", outTradeNo)
    .single();

  if (orderError || !order) {
    console.error(`Alipay notify: order not found for ${outTradeNo}`, orderError);
    return new Response("fail", { status: 404 });
  }

  // Idempotency: skip if already fulfilled
  if (order.status === "completed") {
    console.log(`Alipay notify: order ${outTradeNo} already completed`);
    return new Response("success");
  }

  const userId = order.user_id;
  const isSubscription = order.package_type === "subscription";

  try {
    // Determine first-purchase/first-subscription bonus
    let bonus = 0;
    if (isSubscription) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("has_first_subscription")
        .eq("id", userId)
        .single();
      bonus = profile?.has_first_subscription ? 0 : (order.first_sub_bonus ?? 0);
    } else {
      const { data: profile } = await supabase
        .from("profiles")
        .select("has_first_purchase")
        .eq("id", userId)
        .single();
      bonus = profile?.has_first_purchase ? 0 : (order.first_sub_bonus ?? 0);
    }

    // Add credits
    const creditType = isSubscription ? "subscription" : "purchased";
    await supabase.rpc("add_credits", {
      p_user_id: userId,
      p_amount: order.credits + bonus,
      p_type: creditType,
    });

    // Update profile
    const profileUpdate: Record<string, unknown> = {};
    if (isSubscription) {
      profileUpdate.has_first_subscription = true;
      profileUpdate.subscription_plan = order.package_name;
      profileUpdate.subscription_status = "active";
      profileUpdate.current_period_end = calcPeriodEnd(order.package_name);
    } else {
      if (bonus > 0) profileUpdate.has_first_purchase = true;
    }
    if (Object.keys(profileUpdate).length > 0) {
      await supabase.from("profiles").update(profileUpdate).eq("id", userId);
    }

    // Record transaction
    await supabase.from("transactions").insert({
      user_id: userId,
      package_id: order.package_id,
      stripe_event_id: null,
      stripe_session_id: null,
      stripe_payment_id: null,
      amount: order.amount_cny,
      currency: "cny",
      payment_method: "alipay",
      credits: order.credits + bonus,
      plan: order.package_name,
      status: "completed",
      metadata: {
        alipay_trade_no: tradeNo,
        out_trade_no: outTradeNo,
        trade_status: tradeStatus,
        bonus,
      },
    });

    // Mark order as completed
    await supabase
      .from("alipay_orders")
      .update({
        status: "completed",
        alipay_trade_no: tradeNo,
        paid_at: new Date().toISOString(),
      })
      .eq("out_trade_no", outTradeNo);

    console.log(`Alipay notify: fulfilled order ${outTradeNo}, credits=${order.credits}+${bonus}`);

    // Alipay expects "success" as response body
    return new Response("success");
  } catch (e) {
    console.error(`Alipay notify: fulfillment error for ${outTradeNo}`, e);
    return new Response("fail", { status: 500 });
  }
});
