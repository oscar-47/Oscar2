import {
  selectImageGenInputPaths,
  shouldUseUrlBackedImageInputs,
} from "./image-gen-inputs.ts";

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

Deno.test("OpenRouter image inputs are capped to the configured limit", () => {
  const selected = selectImageGenInputPaths(
    "openrouter",
    ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"],
    3,
  );

  assertEquals(selected.originalCount, 6, "OpenRouter should see the full original image count");
  assertEquals(selected.usedCount, 3, "OpenRouter should cap inputs to three images");
  assertEquals(selected.truncated, true, "OpenRouter should mark the inputs as truncated");
  assertEquals(selected.imagePaths.join(","), "a.png,b.png,c.png", "OpenRouter should keep the first three images");
});

Deno.test("single-image OpenRouter requests are not truncated", () => {
  const selected = selectImageGenInputPaths("openrouter", ["a.png"], 3);
  assertEquals(selected.usedCount, 1, "single-image requests should remain intact");
  assertEquals(selected.truncated, false, "single-image requests should not be marked truncated");
});

Deno.test("URL-backed input transport is enabled only for OpenRouter and ToAPIs", () => {
  assertEquals(shouldUseUrlBackedImageInputs("openrouter"), true, "OpenRouter should use public URLs");
  assertEquals(shouldUseUrlBackedImageInputs("toapis"), true, "ToAPIs should use public URLs");
  assertEquals(shouldUseUrlBackedImageInputs("openai"), false, "OpenAI edits should keep data URLs");
});
