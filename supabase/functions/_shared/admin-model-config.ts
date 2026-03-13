import {
  ADMIN_IMAGE_MODEL_CONFIG_KEY,
  sanitizeAdminImageModelConfigs,
  type AdminImageModelConfig,
} from "../../../lib/admin-models.ts";
import {
  getBillingTierForModel,
  getCreditCostForModel,
  getDefaultImageSizeForModel,
  isImageSizeSupportedForModel,
  normalizeRequestedModel,
} from "./generation-config.ts";
import { createServiceClient } from "./supabase.ts";

export async function getAdminImageModelConfigs(): Promise<AdminImageModelConfig[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("system_config")
    .select("config_value")
    .eq("config_key", ADMIN_IMAGE_MODEL_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    console.warn(`ADMIN_MODEL_CONFIG_LOAD_FAILED ${error.message}`);
    return [];
  }

  return sanitizeAdminImageModelConfigs(data?.config_value ?? []);
}

export function getAdminImageModelConfig(
  configs: AdminImageModelConfig[],
  model: string | null | undefined,
): AdminImageModelConfig | null {
  const normalizedModel = normalizeRequestedModel(model);
  return configs.find((config) => config.enabled && config.key === normalizedModel) ?? null;
}

export function isAdminOnlyDynamicModel(
  configs: AdminImageModelConfig[],
  model: string | null | undefined,
): boolean {
  return getAdminImageModelConfig(configs, model) !== null;
}

export function getEffectiveDefaultImageSizeForModel(
  configs: AdminImageModelConfig[],
  model: string | null | undefined,
): string {
  const adminModel = getAdminImageModelConfig(configs, model);
  if (adminModel) return adminModel.defaultSize;
  return getDefaultImageSizeForModel(model);
}

export function isEffectiveImageSizeSupportedForModel(
  configs: AdminImageModelConfig[],
  model: string | null | undefined,
  imageSize: string | null | undefined,
  opts?: { includeInternal?: boolean },
): boolean {
  const adminModel = getAdminImageModelConfig(configs, model);
  if (adminModel) {
    if (!imageSize) return false;
    return adminModel.supportedSizes.includes(imageSize as typeof adminModel.supportedSizes[number]);
  }
  return isImageSizeSupportedForModel(model, imageSize, opts);
}

export function getEffectiveBillingTierForModel(
  configs: AdminImageModelConfig[],
  model: string | null | undefined,
): "fast" | "balanced" | "quality" {
  const adminModel = getAdminImageModelConfig(configs, model);
  if (adminModel) return adminModel.billingTier;
  return getBillingTierForModel(model);
}

export function getEffectiveCreditCostForModel(
  configs: AdminImageModelConfig[],
  model: string | null | undefined,
  imageSize: string | null | undefined,
): number {
  const adminModel = getAdminImageModelConfig(configs, model);
  if (adminModel) {
    const billingTier = getEffectiveBillingTierForModel(configs, model);
    if (billingTier === "fast") return 3;
    if (billingTier === "quality") return 10;
    return 5;
  }
  return getCreditCostForModel(model, imageSize);
}
