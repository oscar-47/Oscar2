export const ADMIN_IMAGE_MODEL_CONFIG_KEY = "admin_image_model_configs_v1";

export type DynamicAdminGenerationModel = `admin-${string}`;
export type AdminModelTier = "high" | "balanced" | "fast";
export type AdminBillingTier = "quality" | "balanced" | "fast";
export type AdminImageSize = "1K" | "2K" | "4K";
export type AdminProviderHint =
  | "auto"
  | "midjourney"
  | "stability"
  | "ideogram"
  | "openai-generations";

export interface AdminImageModelConfig {
  key: DynamicAdminGenerationModel;
  label: string;
  labelZh?: string;
  tier: AdminModelTier;
  billingTier: AdminBillingTier;
  endpoint: string;
  providerModel: string;
  apiKeyEnvVar: string;
  supportedSizes: AdminImageSize[];
  defaultSize: AdminImageSize;
  providerHint: AdminProviderHint;
  enabled: boolean;
  notes?: string;
}

type PartialAdminImageModelConfig = Partial<AdminImageModelConfig> & {
  key?: string;
  supportedSizes?: unknown;
};

const IMAGE_SIZES: AdminImageSize[] = ["1K", "2K", "4K"];
const MODEL_TIERS: AdminModelTier[] = ["high", "balanced", "fast"];
const BILLING_TIERS: AdminBillingTier[] = ["quality", "balanced", "fast"];
const PROVIDER_HINTS: AdminProviderHint[] = [
  "auto",
  "midjourney",
  "stability",
  "ideogram",
  "openai-generations",
];

const TIER_LABELS: Record<AdminModelTier, { en: string; zh: string }> = {
  high: { en: "High Quality", zh: "高质" },
  balanced: { en: "Balanced", zh: "均衡" },
  fast: { en: "Fast", zh: "极速" },
};

let registeredAdminModels: AdminImageModelConfig[] = [];
let registeredAdminModelMap = new Map<string, AdminImageModelConfig>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeTier(value: unknown): AdminModelTier {
  const candidate = normalizeString(value).toLowerCase() as AdminModelTier;
  return MODEL_TIERS.includes(candidate) ? candidate : "balanced";
}

function normalizeBillingTier(value: unknown): AdminBillingTier {
  const candidate = normalizeString(value).toLowerCase() as AdminBillingTier;
  return BILLING_TIERS.includes(candidate) ? candidate : "balanced";
}

function normalizeProviderHint(value: unknown): AdminProviderHint {
  const candidate = normalizeString(value).toLowerCase() as AdminProviderHint;
  return PROVIDER_HINTS.includes(candidate) ? candidate : "auto";
}

function normalizeSupportedSizes(value: unknown): AdminImageSize[] {
  const input = Array.isArray(value) ? value : [value];
  const sizes = input
    .map((item) => normalizeString(item) as AdminImageSize)
    .filter((item): item is AdminImageSize => IMAGE_SIZES.includes(item));

  return sizes.length > 0 ? Array.from(new Set(sizes)) : ["1K"];
}

export function normalizeAdminModelKey(value: unknown): DynamicAdminGenerationModel | null {
  const raw = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!raw) return null;
  const withPrefix = raw.startsWith("admin-") ? raw : `admin-${raw}`;
  return /^admin-[a-z0-9-]+$/.test(withPrefix)
    ? (withPrefix as DynamicAdminGenerationModel)
    : null;
}

export function isDynamicAdminModelKey(value: string | null | undefined): value is DynamicAdminGenerationModel {
  return typeof value === "string" && /^admin-[a-z0-9-]+$/.test(value.trim());
}

export function normalizeAdminImageModelConfig(
  value: unknown,
): AdminImageModelConfig | null {
  if (!isRecord(value)) return null;

  const input = value as PartialAdminImageModelConfig;
  const key = normalizeAdminModelKey(input.key);
  const label = normalizeString(input.label);
  const endpoint = normalizeString(input.endpoint);
  const providerModel = normalizeString(input.providerModel);
  const apiKeyEnvVar = normalizeString(input.apiKeyEnvVar).toUpperCase();

  if (!key || !label || !endpoint || !providerModel || !/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnvVar)) {
    return null;
  }

  const supportedSizes = normalizeSupportedSizes(input.supportedSizes);
  const requestedDefaultSize = normalizeString(input.defaultSize) as AdminImageSize;
  const defaultSize = supportedSizes.includes(requestedDefaultSize)
    ? requestedDefaultSize
    : supportedSizes[0];

  return {
    key,
    label,
    labelZh: normalizeString(input.labelZh) || undefined,
    tier: normalizeTier(input.tier),
    billingTier: normalizeBillingTier(input.billingTier),
    endpoint,
    providerModel,
    apiKeyEnvVar,
    supportedSizes,
    defaultSize,
    providerHint: normalizeProviderHint(input.providerHint),
    enabled: normalizeBoolean(input.enabled, true),
    notes: normalizeString(input.notes) || undefined,
  };
}

export function sanitizeAdminImageModelConfigs(value: unknown): AdminImageModelConfig[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const configs: AdminImageModelConfig[] = [];

  for (const item of input) {
    const normalized = normalizeAdminImageModelConfig(item);
    if (!normalized) continue;
    if (seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    configs.push(normalized);
  }

  return configs;
}

export function buildAvailableModelsFromAdminConfigs(configs: AdminImageModelConfig[]) {
  return configs
    .filter((config) => config.enabled)
    .map((config) => ({
      value: config.key,
      label: config.label,
      tier: config.tier,
      tierLabel: {
        en: `${TIER_LABELS[config.tier].en} (${config.label} · Admin)`,
        zh: `${TIER_LABELS[config.tier].zh} (${config.labelZh ?? config.label} · 管理员)`,
      },
    }));
}

export function registerAdminImageModels(value: unknown): AdminImageModelConfig[] {
  registeredAdminModels = sanitizeAdminImageModelConfigs(value).filter((config) => config.enabled);
  registeredAdminModelMap = new Map(
    registeredAdminModels.map((config) => [config.key, config]),
  );
  return registeredAdminModels.slice();
}

export function clearRegisteredAdminImageModels() {
  registeredAdminModels = [];
  registeredAdminModelMap = new Map();
}

export function getRegisteredAdminImageModels(): AdminImageModelConfig[] {
  return registeredAdminModels.slice();
}

export function getRegisteredAdminImageModel(
  key: string | null | undefined,
): AdminImageModelConfig | null {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) return null;
  return registeredAdminModelMap.get(normalizedKey) ?? null;
}
