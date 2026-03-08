export type RefinementBackgroundMode = "white" | "original";

export const REFINEMENT_ANALYSIS_SYSTEM_PROMPT =
  `你是一名专业的商业产品精修策略师。你的任务不是直接生成图片，而是先根据输入产品图生成一条可用于图像模型的中文精修提示词。

最高优先级规则：
1. 产品身份锁定：产品外观必须与原图完全一致，包括品类、造型、尺寸比例、轮廓、结构、开孔、Logo/文字位置、标签、印花、硬件、纹理、缝线与所有关键设计特征，不得改形、改色、改结构、改 Logo。
2. 精修提示词必须具体，不能泛化，必须准确描述产品主体、材质特征、细节部位、干扰物、修复动作、质感增强方式和商业布光要求。
3. 除非下游明确要求白底主图，否则不要把背景统一写死为纯白。背景处理会在下游流程中追加，你这里专注于产品主体识别、干扰识别、材质修复、细节强化和商业级质感提升。

提示词必须尽量覆盖以下信息：
- 产品主体识别：品类、主色、材质、结构、关键部件、Logo/文字位置
- 非主体干扰识别：手部、支架、背景杂物、污渍、指纹、反射污染、压痕、划痕、褶皱、脏污
- 材质专项处理：皮革、金属、玻璃、布料、塑料、橡胶、木质、纸盒等真实质感还原与强化
- 细节强化：边缘、接缝、标签、品牌字样、局部锐度、镜头框、扣件、螺丝、切边
- 商业布光：高光层次、阴影过渡、立体感、悬浮感、空气感，但不能抢主体

额外强规则：
- 若图中存在遮挡物、手持、道具、支撑件、背景杂物或脏污，必须明确写出“去除”或“清理”动作。
- 金属材质要区分镜面镀铬、拉丝、磨砂、哑光等，不可一概而论。
- Logo、文字、标签、印花若可见，必须要求边缘锐利、位置不变、内容不变。
- 输出必须是单行中文提示词，不要 JSON，不要 Markdown，不要解释，不要分点。`;

export const REFINEMENT_ANALYSIS_WHITE_BG_APPENDIX =
  "白底主图任务补充：成片必须为纯净纯白背景的电商主图，采用正视图、水平视角，禁止俯拍、仰拍和大角度透视；在不改变产品本体的前提下，精准还原产品本色、包装材质与表面质感；重点去除水垢、手指印、使用痕迹及其他非主体瑕疵；输出需达到高清商业产品摄影标准，画面干净、边缘锐利、质感高级，符合电商主图高标准视觉要求。";

const REFINEMENT_ANALYSIS_USER_PROMPT =
  "请分析这张产品图，生成一段专业的商业级精修提示词。请务必识别产品主体、材质、颜色、结构、Logo/文字位置、可见瑕疵、遮挡物或道具，并明确写出对应的去除、修复、锐化、质感增强和商业布光要求。";

const REFINEMENT_ANALYSIS_WHITE_BG_USER_APPENDIX =
  "本次任务是白底电商主图精修，请明确体现纯白背景主图、正视图、水平视角、禁止俯拍/仰拍/大透视、去除水垢/手指印/使用痕迹，以及高清商业产品摄影质感。";

const refinementBasePrompt =
  "作为专业电商图片精修模型,在不改变产品本体的前提下，对单张产品图进行商业级精修。仅做精修优化,允许进行瑕疵清理、边缘优化、光影校正、色彩与清晰度增强。";

const refinementWhiteBackgroundPrompt = "除产品主体外的背景与非主体元素统一为纯白背景干净无杂物。";

const refinementOriginalBackgroundPrompt =
  "保留原图背景结构与场景关系，仅清理杂物、污渍、手部、支架或其他非主体干扰，整体提升为商业级成片质感。";

export const refinementWhiteBackgroundQualityPrompt =
  "白底主图强化要求：成片必须为纯净纯白背景的电商主图，采用正视图、水平视角，禁止俯拍、仰拍和大角度透视；在不改变产品本体的前提下，精准还原产品本色、包装材质与表面质感；重点去除水垢、手指印、使用痕迹及其他非主体瑕疵；输出需达到高清商业产品摄影标准，画面干净、边缘锐利、质感高级，符合电商主图高标准视觉要求。";

function trimOrEmpty(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinSections(parts: Array<string | null | undefined>): string {
  return parts
    .map(trimOrEmpty)
    .filter((part): part is string => part.length > 0)
    .join("\n\n");
}

export function buildRefinementAnalysisSystemPrompt(backgroundMode: RefinementBackgroundMode): string {
  return backgroundMode === "white"
    ? joinSections([REFINEMENT_ANALYSIS_SYSTEM_PROMPT, REFINEMENT_ANALYSIS_WHITE_BG_APPENDIX])
    : REFINEMENT_ANALYSIS_SYSTEM_PROMPT;
}

export function buildRefinementAnalysisUserPrompt(backgroundMode: RefinementBackgroundMode): string {
  return backgroundMode === "white"
    ? joinSections([REFINEMENT_ANALYSIS_USER_PROMPT, REFINEMENT_ANALYSIS_WHITE_BG_USER_APPENDIX])
    : REFINEMENT_ANALYSIS_USER_PROMPT;
}

export function buildRefinementPromptCacheKey(
  productUrl: string,
  backgroundMode: RefinementBackgroundMode,
): string {
  return `${backgroundMode}::${productUrl}`;
}

export function buildRefinementPrompt(params: {
  backgroundMode: RefinementBackgroundMode;
  refinementAnalysisPrompt?: string | null;
  aspectRatio: string;
  requestSize: string;
  userPrompt?: string | null;
  styleConstraintPrompt?: string | null;
}): string {
  const promptParts: string[] = [];
  const analysisPrompt = trimOrEmpty(params.refinementAnalysisPrompt);
  const userPrompt = trimOrEmpty(params.userPrompt);
  const styleConstraintPrompt = trimOrEmpty(params.styleConstraintPrompt);

  promptParts.push(analysisPrompt || refinementBasePrompt);
  if (params.backgroundMode === "white") {
    promptParts.push(refinementWhiteBackgroundPrompt);
    promptParts.push(refinementWhiteBackgroundQualityPrompt);
  } else {
    promptParts.push(refinementOriginalBackgroundPrompt);
  }
  promptParts.push(`输出比例为 ${params.aspectRatio}，参考尺寸为 ${params.requestSize}。`);
  if (userPrompt) promptParts.push(userPrompt);
  if (styleConstraintPrompt) promptParts.push(styleConstraintPrompt);
  return promptParts.join("\n");
}
