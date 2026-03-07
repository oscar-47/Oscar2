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

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function getInviteRewardRate(supabase: ReturnType<typeof createServiceClient>): Promise<number> {
  const { data } = await supabase
    .from("system_config")
    .select("config_value")
    .eq("config_key", "invite_reward_rate")
    .maybeSingle();

  const raw = data?.config_value;
  const rate = asNumber(raw, 0.1);
  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return rate;
}

async function applyInviteReward(
  supabase: ReturnType<typeof createServiceClient>,
  payload: {
    inviteeUserId: string;
    packageId: string;
    packageCredits: number;
    stripeEventId: string;
  },
) {
  const { data: binding } = await supabase
    .from("referral_bindings")
    .select("id,inviter_user_id,rewarded_at")
    .eq("invitee_user_id", payload.inviteeUserId)
    .maybeSingle();

  if (!binding?.id || binding.rewarded_at) return;

  const rewardRate = await getInviteRewardRate(supabase);
  const rewardCredits = Math.max(Math.floor(payload.packageCredits * rewardRate), 0);

  let rewardTxnId: string | null = null;
  if (rewardCredits > 0) {
    await supabase.rpc("add_credits", {
      p_user_id: binding.inviter_user_id,
      p_amount: rewardCredits,
      p_type: "purchased",
    });

    const { data: rewardTxn, error: rewardTxnError } = await supabase
      .from("transactions")
      .insert({
        user_id: binding.inviter_user_id,
        package_id: null,
        stripe_event_id: null,
        stripe_payment_id: null,
        amount: 0,
        currency: "usd",
        payment_method: "invite",
        credits: rewardCredits,
        plan: "invite_reward",
        status: "completed",
        metadata: {
          source: "invite_reward",
          stripe_event_id: payload.stripeEventId,
          invitee_user_id: payload.inviteeUserId,
          inviter_user_id: binding.inviter_user_id,
          package_id: payload.packageId,
          reward_rate: rewardRate,
        },
      })
      .select("id")
      .single();

    if (rewardTxnError) throw rewardTxnError;
    rewardTxnId = rewardTxn?.id ?? null;
  }

  await supabase
    .from("referral_bindings")
    .update({
      rewarded_at: new Date().toISOString(),
      reward_credits: rewardCredits,
      reward_txn_id: rewardTxnId,
    })
    .eq("id", binding.id)
    .is("rewarded_at", null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) return err("INTERNAL_ERROR", "Stripe env is missing", 500);

  const signature =
    req.headers.get("stripe-signature") ??
    req.headers.get("x-stripe-signature");
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
      const stripeCustomerId = String(obj.customer ?? "");

      if (userId && packageId) {
        const { data: pkg } = await supabase
          .from("packages")
          .select("id,type,credits,first_sub_bonus,name")
          .eq("id", packageId)
          .single();

        if (pkg) {
          // Save stripe_customer_id and stripe_subscription_id on the user profile
          const profileUpdate: Record<string, unknown> = {};
          if (stripeCustomerId) profileUpdate.stripe_customer_id = stripeCustomerId;
          if (mode === "subscription" && obj.subscription) {
            profileUpdate.stripe_subscription_id = String(obj.subscription);
            // Fetch subscription to get current_period_end
            try {
              const sub = await stripe.subscriptions.retrieve(String(obj.subscription));
              profileUpdate.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
            } catch { /* non-fatal */ }
          }

          if (mode === "subscription" || pkg.type === "subscription") {
            const { data: profile } = await supabase
              .from("profiles")
              .select("has_first_subscription")
              .eq("id", userId)
              .single();

            const bonus = profile?.has_first_subscription ? 0 : (pkg.first_sub_bonus ?? 0);
            await supabase.rpc("add_credits", { p_user_id: userId, p_amount: pkg.credits + bonus, p_type: "subscription" });

            profileUpdate.has_first_subscription = true;
            profileUpdate.subscription_plan = pkg.name;
            profileUpdate.subscription_status = "active";
          } else {
            await supabase.rpc("add_credits", { p_user_id: userId, p_amount: pkg.credits, p_type: "purchased" });
          }

          if (Object.keys(profileUpdate).length > 0) {
            await supabase.from("profiles").update(profileUpdate).eq("id", userId);
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

          try {
            await applyInviteReward(supabase, {
              inviteeUserId: userId,
              packageId: pkg.id,
              packageCredits: pkg.credits,
              stripeEventId: event.id,
            });
          } catch (rewardError) {
            console.error("invite reward failed", rewardError);
          }
        }
      }
    }

    if (event.type === "invoice.paid") {
      const customerId = String(obj.customer ?? "");
      // Skip the first invoice (already handled by checkout.session.completed)
      const billingReason = String(obj.billing_reason ?? "");
      if (customerId && billingReason !== "subscription_create") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id,subscription_plan")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profile?.id) {
          // Look up the subscription package to add renewal credits
          const planName = profile.subscription_plan;
          if (planName) {
            const { data: pkg } = await supabase
              .from("packages")
              .select("id,credits,name")
              .eq("type", "subscription")
              .eq("name", planName)
              .single();

            if (pkg) {
              await supabase.rpc("add_credits", { p_user_id: profile.id, p_amount: pkg.credits, p_type: "subscription" });
            }
          }

          await supabase.from("transactions").insert({
            user_id: profile.id,
            stripe_event_id: event.id,
            stripe_payment_id: String(obj.payment_intent ?? ""),
            amount: Number(obj.amount_paid ?? 0) / 100,
            currency: String(obj.currency ?? "usd"),
            payment_method: "stripe",
            credits: 0,
            plan: planName ?? null,
            status: "completed",
            metadata: obj,
          });
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const customerId = String(obj.customer ?? "");
      if (customerId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profile?.id) {
          await supabase
            .from("profiles")
            .update({ subscription_status: "canceled" })
            .eq("id", profile.id);

          await supabase.from("transactions").insert({
            user_id: profile.id,
            stripe_event_id: event.id,
            status: "canceled",
            metadata: obj,
          });
        }
      }
    }

    if (event.type === "customer.subscription.updated") {
      const customerId = String(obj.customer ?? "");
      if (customerId) {
        // Map Stripe status to our SubscriptionStatus union
        const rawStatus = String(obj.status ?? "");
        const statusMap: Record<string, "active" | "canceled" | "past_due"> = {
          active: "active", past_due: "past_due", canceled: "canceled",
          unpaid: "past_due", incomplete: "past_due", incomplete_expired: "canceled",
          trialing: "active", paused: "canceled",
        };
        const mappedStatus = statusMap[rawStatus] ?? "active";

        const update: Record<string, unknown> = { subscription_status: mappedStatus };
        if (obj.current_period_end) {
          update.current_period_end = new Date(Number(obj.current_period_end) * 1000).toISOString();
        }
        await supabase.from("profiles").update(update).eq("stripe_customer_id", customerId);

        // Insert transaction record for dedup
        const { data: profile } = await supabase.from("profiles").select("id").eq("stripe_customer_id", customerId).single();
        if (profile?.id) {
          await supabase.from("transactions").insert({
            user_id: profile.id, stripe_event_id: event.id,
            status: "completed", metadata: obj,
          });
        }
      }
    }

    if (event.type === "invoice.payment_failed") {
      const customerId = String(obj.customer ?? "");
      if (customerId) {
        await supabase.from("profiles")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", customerId);

        const { data: profile } = await supabase.from("profiles").select("id").eq("stripe_customer_id", customerId).single();
        if (profile?.id) {
          await supabase.from("transactions").insert({
            user_id: profile.id, stripe_event_id: event.id,
            status: "failed", metadata: obj,
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
