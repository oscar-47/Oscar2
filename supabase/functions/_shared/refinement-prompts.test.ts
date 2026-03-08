import {
  buildRefinementAnalysisSystemPrompt,
  buildRefinementAnalysisUserPrompt,
  buildRefinementPrompt,
  refinementWhiteBackgroundQualityPrompt,
} from "./refinement-prompts.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert(haystack.includes(needle), `${message}\nMissing: ${needle}\nIn: ${haystack}`);
}

function assertNotIncludes(haystack: string, needle: string, message: string) {
  assert(!haystack.includes(needle), `${message}\nUnexpected: ${needle}\nIn: ${haystack}`);
}

Deno.test("white background analysis prompts include hero-shot guidance", () => {
  const systemPrompt = buildRefinementAnalysisSystemPrompt("white");
  const userPrompt = buildRefinementAnalysisUserPrompt("white");

  assertIncludes(systemPrompt, "纯净纯白背景的电商主图", "white system prompt should include white-background hero guidance");
  assertIncludes(systemPrompt, "禁止俯拍、仰拍和大角度透视", "white system prompt should lock camera angle guidance");
  assertIncludes(userPrompt, "去除水垢/手指印/使用痕迹", "white user prompt should call out cleanup targets");
  assertIncludes(userPrompt, "高清商业产品摄影质感", "white user prompt should call out photography quality target");
});

Deno.test("white background final prompt inserts quality rule before user instructions", () => {
  const prompt = buildRefinementPrompt({
    backgroundMode: "white",
    refinementAnalysisPrompt: "分析产出的精修提示词",
    aspectRatio: "1:1",
    requestSize: "1024x1024",
    userPrompt: "用户补充词",
    styleConstraintPrompt: "风格约束",
  });

  assertIncludes(prompt, "除产品主体外的背景与非主体元素统一为纯白背景干净无杂物。", "white prompt should include white background cleanup rule");
  assertIncludes(prompt, refinementWhiteBackgroundQualityPrompt, "white prompt should include white-background quality rule");
  assert(prompt.indexOf(refinementWhiteBackgroundQualityPrompt) > prompt.indexOf("除产品主体外的背景与非主体元素统一为纯白背景干净无杂物。"), "quality rule should be appended after white background rule");
  assert(prompt.indexOf("用户补充词") > prompt.indexOf(refinementWhiteBackgroundQualityPrompt), "user prompt should stay after built-in quality rule");
});

Deno.test("original background prompts stay free of white-background hero wording", () => {
  const analysisSystemPrompt = buildRefinementAnalysisSystemPrompt("original");
  const analysisUserPrompt = buildRefinementAnalysisUserPrompt("original");
  const finalPrompt = buildRefinementPrompt({
    backgroundMode: "original",
    refinementAnalysisPrompt: null,
    aspectRatio: "4:5",
    requestSize: "1024x1280",
    userPrompt: "用户补充词",
    styleConstraintPrompt: "",
  });

  assertNotIncludes(analysisSystemPrompt, "纯净纯白背景的电商主图", "original system prompt should not include white-background hero wording");
  assertNotIncludes(analysisUserPrompt, "正视图、水平视角", "original user prompt should not include white-background angle wording");
  assertNotIncludes(finalPrompt, refinementWhiteBackgroundQualityPrompt, "original final prompt should not include white-background quality rule");
  assertIncludes(finalPrompt, "保留原图背景结构与场景关系", "original final prompt should preserve original-background refinement rule");
});
