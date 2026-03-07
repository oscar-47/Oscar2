import { normalizeRequestedModel } from "./generation-config.ts";

export type PromptProfile = "default" | "ta-pro";

export const DEFAULT_PROMPT_PROFILE: PromptProfile = "default";
export const TA_PRO_PROMPT_MODEL = "ta-gemini-3-pro";
export const TA_PRO_PROMPT_PROFILE_FLAG = "ta_pro_prompt_profile_enabled";

export function sanitizePromptProfile(value: unknown): PromptProfile {
  return value === "ta-pro" ? "ta-pro" : DEFAULT_PROMPT_PROFILE;
}

export function isTaProPromptModel(model: string | null | undefined): boolean {
  return normalizeRequestedModel(model) === TA_PRO_PROMPT_MODEL;
}

export function resolvePromptProfile(params: {
  requestedProfile?: unknown;
  model?: string | null;
  enabled?: boolean;
}): PromptProfile {
  const requested = sanitizePromptProfile(params.requestedProfile);
  if (
    requested === "ta-pro" &&
    params.enabled === true &&
    (params.model == null || isTaProPromptModel(params.model))
  ) {
    return "ta-pro";
  }
  return DEFAULT_PROMPT_PROFILE;
}

export function withPromptProfileConfigKeySuffix(
  configKey: string,
  promptProfile: PromptProfile,
): string {
  return promptProfile === "ta-pro" ? `${configKey}_ta_pro` : configKey;
}
