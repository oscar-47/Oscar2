import type { PromptProfile } from "./prompt-profile.ts";

type PromptVariant = {
  systemPrefix?: string;
  userPrefix?: string;
  promptPrefix?: string;
};

type PromptVariantTarget = "system" | "user" | "prompt";

function joinSections(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n\n");
}

export function buildPromptRegistryKey(params: {
  flow: string;
  stage: string;
  locale: "en" | "zh";
  profile: PromptProfile;
}): string {
  return `${params.flow}.${params.stage}.${params.locale}.${params.profile}`;
}

const TA_PRO_RULES_ZH = [
  "TA Pro 硬约束：先确保基础功能正确可落地，再确保主体/商品特征绝不漂移，最后确保文案逐字对齐；任何风格化表达都不能覆盖这三条。",
];

const TA_PRO_RULES_EN = [
  "TA Pro hard rules: first ensure the requested base function is executed correctly, then keep subject and product identity locked with zero drift, and finally keep visible copy exactly aligned word-for-word. No style preference may override these three rules.",
];

const PROMPT_REGISTRY: Record<string, PromptVariant> = {
  "genesis.analysis.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "补充要求：同一 SKU、同一主色、同一材质、同一 logo/五金/结构是非协商项；若用户提供共享文案，必须按原文逐字吸收，不得意译、省略或新增。",
    ]),
    userPrefix: "生成主图分析时，优先提取能锁定同一商品身份的颜色、材质、结构与关键特征，并把共享文案视为逐字渲染源文本。",
  },
  "genesis.analysis.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Additional rule: same SKU, same dominant color, same material, and same logo/hardware/structure are non-negotiable. If the user provides shared copy, treat it as exact source text with no paraphrase, omission, or additions.",
    ]),
    userPrefix: "For hero-image analysis, prioritize extracting identity-locking color, material, structure, and key features, and treat shared copy as exact render text.",
  },
  "genesis.generate.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "生成主图 prompt 时，必须把同一 SKU、同一主色、同一材质、同一 logo/五金/结构写成显式正向约束；若有文案，必须要求逐字渲染，不得改写或增删。",
    ]),
  },
  "genesis.generate.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "When generating hero prompts, explicitly lock the same SKU, same dominant color, same material, and same logo/hardware/structure in the positive prompt. If copy exists, require literal rendering with no paraphrase or extra words.",
    ]),
  },
  "ecom-detail.analysis.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "详情模块规划必须默认同一商品身份锁定。若模块需要新增文字，必须把它视为逐字渲染内容，不得意译、省略或补写。",
    ]),
  },
  "ecom-detail.analysis.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Detail-page planning must keep the same product identity locked by default. Any added copy must be treated as literal render text with no paraphrase, omission, or additions.",
    ]),
  },
  "ecom-detail.generate.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "详情图 prompt 必须把同一商品身份、同一主色、同一材质、同一 logo/结构写成正向锁定条件；所有模块文案都按原文逐字渲染。",
    ]),
  },
  "ecom-detail.generate.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Detail-page prompts must positively lock the same product identity, dominant color, material, and logo/structure. All module copy must be rendered literally from the approved text.",
    ]),
  },
  "clothing-basic.analysis.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "服装基础图分析时，按白底精修、3D、人台/标准展示、细节、卖点五类分别锁定。服装颜色、材质、版型、logo、车线、结构不可改变。",
    ]),
  },
  "clothing-basic.analysis.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "For clothing-basic analysis, lock white-background, 3D, mannequin/standard display, detail, and selling-point shots separately. Garment color, material, silhouette, logo, stitching, and construction must not change.",
    ]),
  },
  "clothing-basic.generate.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "服装基础图 prompt 必须先声明拍摄类型，再锁定服装颜色、材质、版型、logo、车线和结构不可漂移。",
    ]),
  },
  "clothing-basic.generate.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Clothing-basic prompts must declare shot type first, then explicitly lock garment color, material, silhouette, logo, stitching, and construction against drift.",
    ]),
  },
  "clothing-tryon.analysis.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "主体试穿分析时先判断 subject_type。主体身份/物种锁定优先级高于风格；若主体非人类，禁止使用任何人类模特描述。",
    ]),
  },
  "clothing-tryon.analysis.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "For try-on analysis, identify subject_type first. Subject identity/species lock has higher priority than style. If the subject is non-human, do not use human-model language at all.",
    ]),
  },
  "clothing-tryon.generate.zh.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "主体试穿 prompt 必须先锁定主体身份/物种，再锁定服装。明确要求衣服穿在原主体身上，禁止换模特、变人台、漂浮或改款。",
    ]),
  },
  "clothing-tryon.generate.en.ta-pro": {
    systemPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Try-on prompts must lock subject identity/species first and garment second. Explicitly require the garment to be worn by the original subject. Do not swap models, turn the subject into a mannequin, float the garment, or redesign it.",
    ]),
  },
  "aesthetic-single.transfer.zh.ta-pro": {
    promptPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "风格复刻单图规则：参考图只借风格，不借主体、物体、文案、版式或道具；结果图只能保留商品图主体本身。",
    ]),
  },
  "aesthetic-single.transfer.en.ta-pro": {
    promptPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Aesthetic single-image rule: borrow only style from the reference. Do not copy subjects, objects, text, layout, or props from the reference. The output must keep only the product subject from the product image.",
    ]),
  },
  "aesthetic-batch.transfer.zh.ta-pro": {
    promptPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "风格复刻批量规则：每张参考图只提供风格信号，不得把参考图中的人物、商品、道具、文字或版式带入结果。",
    ]),
  },
  "aesthetic-batch.transfer.en.ta-pro": {
    promptPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Aesthetic batch rule: each reference image provides style signals only. Never import people, products, props, text, or layout from the reference into the output.",
    ]),
  },
  "refinement.transfer.zh.ta-pro": {
    promptPrefix: joinSections([
      ...TA_PRO_RULES_ZH,
      "精修规则：只允许去瑕疵、清杂物、修光影、提清晰度、统一背景，不允许重绘产品本体，不允许改颜色、材质、logo、文字、配件或结构。",
    ]),
  },
  "refinement.transfer.en.ta-pro": {
    promptPrefix: joinSections([
      ...TA_PRO_RULES_EN,
      "Refinement rule: only remove defects, clean clutter, correct lighting, improve clarity, and normalize the background. Do not repaint the product itself. Do not change color, material, logo, text, accessories, or structure.",
    ]),
  },
};

export function applyPromptVariant(
  key: string,
  target: PromptVariantTarget,
  baseText: string,
): string {
  const variant = PROMPT_REGISTRY[key];
  if (!variant) return baseText;

  if (target === "system") {
    return joinSections([variant.systemPrefix, baseText]);
  }
  if (target === "user") {
    return joinSections([variant.userPrefix, baseText]);
  }
  return joinSections([variant.promptPrefix, baseText]);
}
