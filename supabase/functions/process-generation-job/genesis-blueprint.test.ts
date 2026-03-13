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

Deno.test("genesis blueprint normalization expands compact intermediate plans into the full public contract", () => {
  const compactBlueprint = JSON.parse(JSON.stringify(fixture.blueprint)) as any;
  compactBlueprint.product_summary = "黑色皮革纹理手机壳，突出高级质感与精准保护";
  compactBlueprint.images = [
    {
      title: "皮纹护壳",
      description: "以材质高级感做首屏主视觉。",
      type: "hero",
      scene_recipe: {
        shot_role: "premium material hero visual",
        hero_focus: "皮革纹理、金属镜头环和边框细节",
        product_ratio: "主体约占画面 48%-58%",
        layout_method: "采用偏轴编辑感构图与压缩标题组",
        subject_angle: "使用前侧 3/4 角度并带轻微低机位",
        support_elements: "使用低矮石面和烟熏亚克力承托主体，不使用手持",
        background_surface: "背景使用暖灰纸面与拉丝金属",
        background_elements: "保留前景柔焦、中景主体和材质背景层",
        decorative_elements: "仅允许缝线回声和一处克制金属强调",
        lighting_setup: "侧上方定向主光配柔和轮廓高光",
        lens_hint: "85mm 商业镜头，f/5.6-f/8",
        text_zone: "右侧大留白安全区用于压缩标题组",
        mood_keywords: "高级、克制、材质感",
      },
      design_content: `**文字内容**（使用 Simplified Chinese）：
- 主标题：皮纹护壳
- 副标题：质感与保护并重
- 描述文案：金属镜头环更显利落
- 字体气质：高对比编辑感展示无衬线，形成材质高级首屏张力
- 字体风格：压缩式展示字，字面挺拔，适合右侧纵向标题组
- 文字颜色策略：以炭黑字为主，辅以一处克制金属灰强调
- 版式激进度：中强
- 版式类型：大留白中的压缩标题组
- 文字张力：文字与商品共同形成第一眼节奏
- 主次关系：文字与商品形成双主角
- 排版说明：标题组放在右侧安全留白区，避开镜头模组和边框细节`,
    },
  ];
  compactBlueprint.commercial_intent = {
    hero_expression: "premium-material",
    copy_dominance: "co-hero",
    human_interaction_mode: "none",
    hero_layout_archetype: "大留白中的压缩标题组",
    text_tension: "文字与商品共同形成第一眼节奏",
  };

  const normalized = normalizeGenesisBlueprintTemplate(
    compactBlueprint,
    "zh",
    "zh",
    "黑色皮革手机壳，突出质感与保护",
  );

  const plan = normalized.images[0]?.design_content ?? "";
  assertIncludes(plan, "**设计目标**：", "compact intermediate plan should still expand to full Design Goal section");
  assertIncludes(plan, "**画内元素**：", "compact intermediate plan should still expand to full In-Graphic Elements section");
  assertIncludes(plan, "**构图规划**：", "compact intermediate plan should still expand to full Composition Plan section");
  assertIncludes(plan, "- 字体风格：压缩式展示字，字面挺拔，适合右侧纵向标题组", "compact typography direction should survive expansion");
  assertIncludes(plan, "- 文字颜色策略：以炭黑字为主，辅以一处克制金属灰强调", "compact typography color strategy should survive expansion");
  assertIncludes(plan, "- 版式类型：大留白中的压缩标题组", "compact layout archetype should survive expansion");
  assertIncludes(plan, "- 排版说明：标题组放在右侧安全留白区，避开镜头模组和边框细节", "compact layout guidance should survive expansion");
  assert(normalized.images[0]?.scene_recipe?.support_elements.includes("不使用手持"), "scene_recipe override should survive normalization");
});
