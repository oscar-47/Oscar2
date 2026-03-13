export const DEFAULT_OPENROUTER_MAX_INPUT_IMAGES = 3;

export function shouldUseUrlBackedImageInputs(provider: string): boolean {
  return provider === "openrouter" || provider === "toapis";
}

export function selectImageGenInputPaths(
  provider: string,
  imagePaths: string[],
  maxOpenRouterImages = DEFAULT_OPENROUTER_MAX_INPUT_IMAGES,
): {
  imagePaths: string[];
  originalCount: number;
  usedCount: number;
  truncated: boolean;
} {
  const cleaned = imagePaths.filter((path) => typeof path === "string" && path.trim().length > 0);
  const originalCount = cleaned.length;

  if (provider !== "openrouter") {
    return {
      imagePaths: cleaned,
      originalCount,
      usedCount: cleaned.length,
      truncated: false,
    };
  }

  const safeLimit = Math.max(1, Math.min(12, Math.floor(Number(maxOpenRouterImages) || DEFAULT_OPENROUTER_MAX_INPUT_IMAGES)));
  const limited = cleaned.slice(0, safeLimit);
  return {
    imagePaths: limited,
    originalCount,
    usedCount: limited.length,
    truncated: limited.length < originalCount,
  };
}
