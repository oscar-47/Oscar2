export type EdgeImageSize = "1K" | "2K" | "4K";

export const DEFAULT_EDGE_MODEL = "or-gemini-3.1-flash";

export const LEGACY_MODEL_ALIASES: Record<string, string> = {};

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
    publicSizes: ["1K", "2K"],
    internalSizes: ["1K", "2K", "4K"],
    defaultSize: "2K",
  },
  "or-gemini-3-pro": {
    publicSizes: ["1K"],
    internalSizes: ["1K"],
    defaultSize: "1K",
  },
};

const MODEL_CREDIT_COSTS: Record<string, Partial<Record<EdgeImageSize, number>>> = {
  "or-gemini-2.5-flash": { "1K": 3, "2K": 5 },
  "or-gemini-3.1-flash": { "1K": 5, "2K": 8, "4K": 15 },
  "or-gemini-3-pro": { "1K": 10 },
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
  if (!capability) return ["1K", "2K"];
  return (opts?.includeInternal ? capability.internalSizes : capability.publicSizes).slice();
}

export function getDefaultImageSizeForModel(model: string | null | undefined): EdgeImageSize {
  const normalizedModel = normalizeRequestedModel(model);
  return MODEL_IMAGE_SIZES[normalizedModel]?.defaultSize ?? "2K";
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
  return MODEL_CREDIT_COSTS[normalizedModel]?.[normalizedSize] ?? 5;
}
