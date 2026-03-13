import {
  buildOpenRouterImageRequestBody,
  buildToAPIsImageRequestBody,
  getOpenRouterKeyPool,
  orderOpenRouterKeysForRouting,
} from "./qn-image.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

Deno.test("OpenRouter image request body prefers public image URLs over data URLs", () => {
  const body = buildOpenRouterImageRequestBody({
    model: "google/gemini-2.5-flash-image-preview",
    prompt: "Generate",
    imageUrls: [
      "https://cdn.shopix.ai/product-a.png",
      "https://cdn.shopix.ai/product-b.png",
    ],
    imageDataUrls: [
      "data:image/png;base64,aaa",
      "data:image/png;base64,bbb",
    ],
    aspectRatio: "1:1",
    imageSize: "1K",
  });

  const messages = body.messages as Array<Record<string, unknown>>;
  const content = messages[0].content as Array<Record<string, unknown>>;
  const imageParts = content.filter((part) => part.type === "image_url");

  assertEquals(imageParts.length, 2, "OpenRouter should keep both public URL inputs");
  assertEquals(
    (imageParts[0].image_url as Record<string, unknown>).url as string,
    "https://cdn.shopix.ai/product-a.png",
    "OpenRouter should prefer the first public URL",
  );
  assertEquals(
    (imageParts[1].image_url as Record<string, unknown>).url as string,
    "https://cdn.shopix.ai/product-b.png",
    "OpenRouter should prefer the second public URL",
  );
});

Deno.test("ToAPIs image request body keeps image_urls field", () => {
  const body = buildToAPIsImageRequestBody({
    model: "gemini-3.1-flash-image-preview",
    prompt: "Generate",
    imageUrls: [
      "https://cdn.shopix.ai/product-a.png",
      "https://cdn.shopix.ai/product-b.png",
    ],
    aspectRatio: "4:5",
    n: 1,
  });

  const imageUrls = body.image_urls as string[] | undefined;
  assert(Array.isArray(imageUrls), "ToAPIs request should include image_urls");
  assertEquals(imageUrls?.length, 2, "ToAPIs request should keep all public URLs");
  assertEquals(body.size as string, "4:5", "ToAPIs request should map aspect ratio into size");
});

Deno.test("OpenRouter key pool merges single key and multi-key env without duplicates", () => {
  Deno.env.set("OPENROUTER_API_KEY", "key-a");
  Deno.env.set("OPENROUTER_API_KEYS", "key-b,key-a\nkey-c");

  const pool = getOpenRouterKeyPool();
  assertEquals(pool.join(","), "key-a,key-b,key-c", "OpenRouter key pool should preserve stable unique order");
});

Deno.test("OpenRouter key ordering is stable per routing key", () => {
  const keys = ["key-a", "key-b", "key-c", "key-d"];
  const orderedA = orderOpenRouterKeysForRouting(keys, "user-1");
  const orderedB = orderOpenRouterKeysForRouting(keys, "user-1");
  const orderedC = orderOpenRouterKeysForRouting(keys, "user-2");

  assertEquals(orderedA.join(","), orderedB.join(","), "same routing key should map to the same order");
  assert(orderedA.join(",") !== orderedC.join(","), "different routing keys should spread across the pool");
  assertEquals(orderedA.length, 4, "ordering should retain all keys");
});
