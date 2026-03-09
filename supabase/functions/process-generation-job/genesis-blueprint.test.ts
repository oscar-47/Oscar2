import { normalizeGenesisBlueprintTemplate } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert(haystack.includes(needle), `${message}\nMissing: ${needle}\nIn: ${haystack}`);
}

function assertNotIncludes(haystack: string, needle: string, message: string) {
  assert(!haystack.includes(needle), `${message}\nUnexpected: ${needle}\nIn: ${haystack}`);
}

const fixture = JSON.parse(
  Deno.readTextFileSync(
    new URL("../../../e2e/fixtures/picset-genesis-har.fixture.json", import.meta.url),
  ),
) as {
  blueprint: Record<string, unknown>;
};

Deno.test("genesis blueprint normalization preserves the public hero-blueprint contract", () => {
  const normalized = normalizeGenesisBlueprintTemplate(
    fixture.blueprint as any,
    "en",
    "en",
    "",
  );

  assert(typeof normalized.product_summary === "string" && normalized.product_summary.length > 0, "product_summary should stay present");
  assert(normalized.product_visual_identity?.primary_color === "Iridescent Pearl (#D9D3F8)", "primary color should remain locked");
  assert(Array.isArray(normalized.images) && normalized.images.length === 1, "fixture should keep one image plan");

  const designSpecs = normalized.design_specs;
  assertIncludes(designSpecs, "# Overall Design Specifications", "design_specs should keep the standard hero-blueprint heading");
  assertIncludes(designSpecs, "## Color System", "design_specs should contain color section");
  assertIncludes(designSpecs, "## Font System", "design_specs should contain font section");
  assertIncludes(designSpecs, "## Visual Language", "design_specs should contain visual section");
  assertIncludes(designSpecs, "## Photography Style", "design_specs should contain photography section");
  assertIncludes(designSpecs, "## Quality Requirements", "design_specs should contain quality section");
  assertNotIncludes(designSpecs, "shared master copy", "design_specs should not mention shared master copy");

  const plan = normalized.images[0]?.design_content ?? "";
  assertIncludes(plan, "**Design Goal**:", "image plan should use Design Goal section");
  assertIncludes(plan, "**Product Appearance**:", "image plan should use Product Appearance section");
  assertIncludes(plan, "**In-Graphic Elements**:", "image plan should use In-Graphic Elements section");
  assertIncludes(plan, "**Composition Plan**:", "image plan should use Composition Plan section");
  assertIncludes(plan, "**Content Elements**:", "image plan should use Content Elements section");
  assertIncludes(plan, "**Text Content**", "image plan should use Text Content section");
  assertIncludes(plan, "**Atmosphere Creation**:", "image plan should use Atmosphere Creation section");
  assertIncludes(plan, "- Layout Guidance:", "image plan should keep per-image text guidance");
  assertNotIncludes(plan, "shared master copy", "image plan should not mention shared master copy");
  assert(normalized.copy_analysis?.shared_copy === "", "copy_analysis.shared_copy should be blank for genesis2");
});
