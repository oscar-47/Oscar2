import Stripe from "npm:stripe@14.25.0";
import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

async function alreadyProcessed(supabase: ReturnType<typeof createServiceClient>, stripeEventId: string) {
  const { data } = await supabase
    .from("transactions")
    .select("id")
    .eq("stripe_event_id", stripeEventId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) return err("INTERNAL_ERROR", "Stripe env is missing", 500);

  const signature = req.headers.get("x-stripe-signature");
  if (!signature) return err("STRIPE_SIGNATURE_INVALID", "Missing Stripe signature", 400);

  const payload = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch {
    return err("STRIPE_SIGNATURE_INVALID", "Invalid Stripe signature", 400);
  }

  const supabase = createServiceClient();
  if (await alreadyProcessed(supabase, event.id)) {
    return ok({ ok: true });
  }

  const obj = event.data.object as Record<string, unknown>;

  try {
    if (event.type === "checkout.session.completed") {
      const mode = String(obj.mode ?? "");
      const metadata = (obj.metadata as Record<string, string> | undefined) ?? {};
      const userId = metadata.user_id;
      const packageId = metadata.package_id;
      if (userId && packageId) {
        const { data: pkg } = await supabase
          .from("packages")
          .select("id,type,credits,first_sub_bonus,name")
          .eq("id", packageId)
          .single();

        if (pkg) {
          if (mode === "subscription" || pkg.type === "subscription") {
            const { data: profile } = await supabase
              .from("profiles")
              .select("has_first_subscription")
              .eq("id", userId)
              .single();

            const bonus = profile?.has_first_subscription ? 0 : (pkg.first_sub_bonus ?? 0);
            await supabase.rpc("add_credits", { p_user_id: userId, p_amount: pkg.credits + bonus, p_type: "subscription" });
            await supabase
              .from("profiles")
              .update({ has_first_subscription: true, subscription_plan: pkg.name?.toLowerCase(), subscription_status: "active" })
              .eq("id", userId);
          } else {
            await supabase.rpc("add_credits", { p_user_id: userId, p_amount: pkg.credits, p_type: "purchased" });
          }

          await supabase.from("transactions").insert({
            user_id: userId,
            package_id: pkg.id,
            stripe_event_id: event.id,
            stripe_session_id: String(obj.id ?? ""),
            stripe_payment_id: String(obj.payment_intent ?? ""),
            amount: Number(obj.amount_total ?? 0) / 100,
            currency: String(obj.currency ?? "usd"),
            payment_method: "stripe",
            credits: pkg.credits,
            plan: pkg.name,
            status: "completed",
            metadata: obj,
          });
        }
      }
    }

    if (event.type === "invoice.paid") {
      const customerId = String(obj.customer ?? "");
      if (customerId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profile?.id) {
          await supabase.from("transactions").insert({
            user_id: profile.id,
            stripe_event_id: event.id,
            stripe_payment_id: String(obj.payment_intent ?? ""),
            amount: Number(obj.amount_paid ?? 0) / 100,
            currency: String(obj.currency ?? "usd"),
            payment_method: "stripe",
            status: "completed",
            metadata: obj,
          });
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const customerId = String(obj.customer ?? "");
      if (customerId) {
        await supabase
          .from("profiles")
          .update({ subscription_status: "canceled" })
          .eq("stripe_customer_id", customerId);
      }
      const customerId = String(obj.customer ?? "");
      if (customerId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profile?.id) {
          await supabase.from("transactions").insert({
            user_id: profile.id,
            stripe_event_id: event.id,
            status: "completed",
            metadata: obj,
          });
        }
      }
    }

    if (event.type === "charge.refunded") {
      const customerId = String(obj.customer ?? "");
      if (customerId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profile?.id) {
          await supabase.from("transactions").insert({
            user_id: profile.id,
            stripe_event_id: event.id,
            status: "refunded",
            metadata: obj,
          });
        }
      }
    }
  } catch (e) {
    return err("INTERNAL_ERROR", "Webhook handler failed", 500, String(e));
  }

  return ok({ ok: true });
});
