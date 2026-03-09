import { buildGenesisHeroPromptObjects } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert(haystack.includes(needle), `${message}\nMissing: ${needle}\nIn: ${haystack}`);
}

const fixture = JSON.parse(
  Deno.readTextFileSync(
    new URL("../../../e2e/fixtures/picset-genesis-har.fixture.json", import.meta.url),
  ),
) as {
  blueprint: Record<string, unknown>;
  expected_prompt_object: {
    negative_prompt_contains: string[];
  };
};

Deno.test("deterministic genesis prompt builder compiles the blueprint into narrative commercial direction", () => {
  const prompts = buildGenesisHeroPromptObjects({
    analysisRecord: fixture.blueprint,
    language: "en",
    promptProfile: "default",
    styleConstraintPrompt: "",
  });

  assert(prompts.length === 1, "fixture should generate one prompt");
  const first = prompts[0];

  const promptMarkers = [
    "Compose the frame so product occupies roughly 65% of the frame",
    "Build a layered commercial set with pure white studio floor",
    "Light the scene with soft top-down key light with lavender and soft cyan rim light",
    "Add scene richness with Decorative elements: floating glass-like spheres",
    "Shoot it with shallow (f/2.8) to isolate the product texture",
    "Keep the exact same SKU and product identity locked to the uploaded reference",
  ];
  for (const marker of promptMarkers) {
    assertIncludes(first.prompt, marker, "prompt should compile the blueprint into narrative commercial direction");
  }

  assert(!first.prompt.includes("Subject:"), "prompt should no longer use label-style Subject sections");
  assert(!first.prompt.includes("Composition:"), "prompt should no longer use label-style Composition sections");

  for (const marker of fixture.expected_prompt_object.negative_prompt_contains) {
    assertIncludes(first.negative_prompt, marker, "negative_prompt should keep the commercial risk exclusions");
  }

  assert(first.priority === 0, "priority should default to zero");
  assert(first.title === "The Future of Fluid Protection", "title should reuse the blueprint title");
});

Deno.test("ta-pro genesis prompt builder adds stronger identity lock wording", () => {
  const prompts = buildGenesisHeroPromptObjects({
    analysisRecord: fixture.blueprint,
    language: "en",
    promptProfile: "ta-pro",
    styleConstraintPrompt: "Keep the holographic finish crisp.",
  });

  assert(prompts.length === 1, "fixture should generate one prompt");
  assertIncludes(prompts[0].prompt, "zero drift", "ta-pro prompt should add the stronger drift lock wording");
  assertIncludes(prompts[0].prompt, "Keep the holographic finish crisp.", "style constraint should be merged into Style");
  assertIncludes(prompts[0].negative_prompt, "identity drift", "ta-pro negative prompt should add identity drift");
});
