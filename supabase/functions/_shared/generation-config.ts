export type EdgeImageSize = "1K" | "2K" | "4K";
export type EdgeBillingTier = "fast" | "balanced" | "quality";

export const DEFAULT_EDGE_MODEL = "or-gemini-3.1-flash";

export const LEGACY_MODEL_ALIASES: Record<string, string> = {};

export const EDGE_BILLING_TIER_COSTS: Record<EdgeBillingTier, number> = {
  fast: 15,
  balanced: 30,
  quality: 50,
};

export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "or-gemini-2.5-flash": "google/gemini-2.5-flash-image",
  "or-gemini-3.1-flash": "google/gemini-3.1-flash-image-preview",
  "or-gemini-3-pro": "google/gemini-3-pro-image-preview",
};

const MODEL_IMAGE_SIZES: Record<string, { publicSizes: EdgeImageSize[]; internalSizes: EdgeImageSize[]; defaultSize: EdgeImageSize }> = {
  "or-gemini-2.5-flash": {
    publicSizes: ["1K"],
    internalSizes: ["1K"],
    defaultSize: "1K",
  },
  "or-gemini-3.1-flash": {
    publicSizes: ["1K"],
    internalSizes: ["1K"],
    defaultSize: "1K",
  },
  "or-gemini-3-pro": {
    publicSizes: ["1K"],
    internalSizes: ["1K"],
    defaultSize: "1K",
  },
  "ta-gemini-2.5-flash": {
    publicSizes: ["1K"],
    internalSizes: ["1K"],
    defaultSize: "1K",
  },
  "ta-gemini-3.1-flash": {
    publicSizes: ["1K"],
    internalSizes: ["1K"],
    defaultSize: "1K",
  },
  "ta-gemini-3-pro": {
    publicSizes: ["1K"],
    internalSizes: ["1K"],
    defaultSize: "1K",
  },
  "fal-nano-banana-pro": {
    publicSizes: ["1K", "2K", "4K"],
    internalSizes: ["1K", "2K", "4K"],
    defaultSize: "1K",
  },
};

const MODEL_BILLING_TIERS: Record<string, EdgeBillingTier> = {
  "or-gemini-2.5-flash": "fast",
  "or-gemini-3.1-flash": "balanced",
  "or-gemini-3-pro": "quality",
  "ta-gemini-2.5-flash": "fast",
  "ta-gemini-3.1-flash": "balanced",
  "ta-gemini-3-pro": "quality",
  "fal-nano-banana-pro": "quality",
};

const MODEL_CREDIT_COSTS: Record<string, Partial<Record<EdgeImageSize, number>>> = {
  "or-gemini-2.5-flash": { "1K": EDGE_BILLING_TIER_COSTS.fast },
  "or-gemini-3.1-flash": { "1K": EDGE_BILLING_TIER_COSTS.balanced },
  "or-gemini-3-pro": { "1K": EDGE_BILLING_TIER_COSTS.quality },
  "ta-gemini-2.5-flash": { "1K": EDGE_BILLING_TIER_COSTS.fast },
  "ta-gemini-3.1-flash": { "1K": EDGE_BILLING_TIER_COSTS.balanced },
  "ta-gemini-3-pro": { "1K": EDGE_BILLING_TIER_COSTS.quality },
  "fal-nano-banana-pro": { "1K": EDGE_BILLING_TIER_COSTS.quality, "2K": EDGE_BILLING_TIER_COSTS.quality, "4K": 100 },
};

export function normalizeRequestedModel(model: string | null | undefined): string {
  const raw = String(model ?? "").trim();
  if (!raw) return DEFAULT_EDGE_MODEL;
  return LEGACY_MODEL_ALIASES[raw] ?? raw;
}

export function getSupportedImageSizesForModel(
  model: string | null | undefined,
  opts?: { includeInternal?: boolean },
): EdgeImageSize[] {
  const normalizedModel = normalizeRequestedModel(model);
  const capability = MODEL_IMAGE_SIZES[normalizedModel];
  if (!capability) return ["1K"];
  return (opts?.includeInternal ? capability.internalSizes : capability.publicSizes).slice();
}

export function getDefaultImageSizeForModel(model: string | null | undefined): EdgeImageSize {
  const normalizedModel = normalizeRequestedModel(model);
  return MODEL_IMAGE_SIZES[normalizedModel]?.defaultSize ?? "1K";
}

export function getBillingTierForModel(model: string | null | undefined): EdgeBillingTier {
  const normalizedModel = normalizeRequestedModel(model);
  return MODEL_BILLING_TIERS[normalizedModel] ?? MODEL_BILLING_TIERS[DEFAULT_EDGE_MODEL] ?? "balanced";
}

export function isImageSizeSupportedForModel(
  model: string | null | undefined,
  imageSize: string | null | undefined,
  opts?: { includeInternal?: boolean },
): boolean {
  if (!imageSize) return false;
  return getSupportedImageSizesForModel(model, opts).includes(imageSize as EdgeImageSize);
}

export function sanitizeImageSizeForModel(
  model: string | null | undefined,
  imageSize: string | null | undefined,
  opts?: { includeInternal?: boolean },
): EdgeImageSize {
  const candidate = String(imageSize ?? "").trim() as EdgeImageSize;
  return isImageSizeSupportedForModel(model, candidate, opts)
    ? candidate
    : getDefaultImageSizeForModel(model);
}

export function getCreditCostForModel(model: string | null | undefined, imageSize: string | null | undefined): number {
  const normalizedModel = normalizeRequestedModel(model);
  const normalizedSize = sanitizeImageSizeForModel(normalizedModel, imageSize, { includeInternal: true });
  return MODEL_CREDIT_COSTS[normalizedModel]?.[normalizedSize]
    ?? EDGE_BILLING_TIER_COSTS[getBillingTierForModel(normalizedModel)];
}
