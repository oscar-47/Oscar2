import {
  EDGE_BILLING_TIER_COSTS,
  getBillingTierForModel,
  getCreditCostForModel,
} from "./generation-config.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

Deno.test("fast tier models cost 15 credits per image", () => {
  assertEquals(getBillingTierForModel("or-gemini-2.5-flash"), "fast", "or fast tier");
  assertEquals(getBillingTierForModel("ta-gemini-2.5-flash"), "fast", "ta fast tier");
  assertEquals(getCreditCostForModel("or-gemini-2.5-flash", "1K"), EDGE_BILLING_TIER_COSTS.fast, "or fast cost");
  assertEquals(getCreditCostForModel("ta-gemini-2.5-flash", "1K"), EDGE_BILLING_TIER_COSTS.fast, "ta fast cost");
});

Deno.test("balanced tier models cost 30 credits per image", () => {
  assertEquals(getBillingTierForModel("or-gemini-3.1-flash"), "balanced", "or balanced tier");
  assertEquals(getBillingTierForModel("ta-gemini-3.1-flash"), "balanced", "ta balanced tier");
  assertEquals(getCreditCostForModel("or-gemini-3.1-flash", "1K"), EDGE_BILLING_TIER_COSTS.balanced, "or balanced cost");
  assertEquals(getCreditCostForModel("ta-gemini-3.1-flash", "1K"), EDGE_BILLING_TIER_COSTS.balanced, "ta balanced cost");
});

Deno.test("quality tier models cost 50 credits per image", () => {
  assertEquals(getBillingTierForModel("or-gemini-3-pro"), "quality", "or quality tier");
  assertEquals(getBillingTierForModel("ta-gemini-3-pro"), "quality", "ta quality tier");
  assertEquals(getCreditCostForModel("or-gemini-3-pro", "1K"), EDGE_BILLING_TIER_COSTS.quality, "or quality cost");
  assertEquals(getCreditCostForModel("ta-gemini-3-pro", "1K"), EDGE_BILLING_TIER_COSTS.quality, "ta quality cost");
});
