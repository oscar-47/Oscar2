import type {
  AnalysisBlueprint,
  BlueprintImagePlan,
  EcomDetailModuleDefinition,
  EcomDetailModuleId,
  OutputLanguage,
} from '@/types'

export const ECOM_DETAIL_MODULES: ReadonlyArray<EcomDetailModuleDefinition> = [
  {
    id: 'hero-visual',
    sortOrder: 1,
    title: { zh: '首屏主视觉', en: 'Hero Visual' },
    subtitle: { zh: '传递核心价值', en: 'Lead with the core value' },
    defaultPromptSeed: {
      zh: '以详情页首屏 KV 的方式建立第一眼吸引力，突出产品核心价值、主卖点与品牌调性，画面有强识别度与完整视觉中心。',
      en: 'Build a hero detail-page key visual that delivers the product value, leading selling point, and brand tone with a strong focal point.',
    },
  },
  {
    id: 'core-selling-point',
    sortOrder: 2,
    title: { zh: '核心卖点图', en: 'Core Selling Point' },
    subtitle: { zh: '突出差异化优势', en: 'Highlight the differentiator' },
    defaultPromptSeed: {
      zh: '围绕最重要的 1 个差异化卖点设计单张画面，通过结构拆解、重点标注或局部强化，突出与竞品不同的价值。',
      en: 'Create a module focused on one differentiating selling point with a clear comparison angle and strong emphasis on the advantage.',
    },
  },
  {
    id: 'usage-scene',
    sortOrder: 3,
    title: { zh: '使用场景图', en: 'Usage Scene' },
    subtitle: { zh: '呈现真实使用场景', en: 'Show real-life usage' },
    defaultPromptSeed: {
      zh: '将产品放入真实使用场景，强调人与产品、空间与功能之间的关系，突出实际使用状态与价值感。',
      en: 'Place the product inside a believable real-life usage environment and show how it is naturally used.',
    },
  },
  {
    id: 'multi-angle',
    sortOrder: 4,
    title: { zh: '多角度图', en: 'Multi-angle View' },
    subtitle: { zh: '多角度呈现外观', en: 'Show appearance from multiple angles' },
    defaultPromptSeed: {
      zh: '通过正面、侧面、背面或局部转角等多视角展示产品外观结构，帮助用户完整理解造型与轮廓。',
      en: 'Present the product from multiple useful angles so the buyer can fully understand the form and structure.',
    },
  },
  {
    id: 'scene-atmosphere',
    sortOrder: 5,
    title: { zh: '场景氛围图', en: 'Atmosphere Scene' },
    subtitle: { zh: '展示使用场景', en: 'Build scene mood' },
    defaultPromptSeed: {
      zh: '强化情绪氛围、光影和环境质感，用高氛围感场景表达生活方式、品牌气质和购买想象。',
      en: 'Use lighting, mood, and environmental styling to communicate lifestyle imagination and premium brand feeling.',
    },
  },
  {
    id: 'product-detail',
    sortOrder: 6,
    title: { zh: '商品细节图', en: 'Product Detail' },
    subtitle: { zh: '放大材质与工艺', en: 'Zoom into craft and material' },
    defaultPromptSeed: {
      zh: '聚焦材质纹理、缝线、接口、表面工艺等局部细节，突出品质感、做工和真实触感。',
      en: 'Zoom into textures, finishing, stitching, joints, and premium details to prove craftsmanship and quality.',
    },
  },
  {
    id: 'brand-story',
    sortOrder: 7,
    title: { zh: '品牌故事图', en: 'Brand Story' },
    subtitle: { zh: '传达品牌理念', en: 'Tell the brand story' },
    defaultPromptSeed: {
      zh: '围绕品牌理念、品牌态度或创作灵感构建一张故事感画面，使详情页不仅讲产品，也讲品牌价值。',
      en: 'Create a brand-story module that communicates brand philosophy, inspiration, or positioning beyond product specs.',
    },
  },
  {
    id: 'size-capacity-spec',
    sortOrder: 8,
    title: { zh: '尺寸/容量/尺码图', en: 'Size / Capacity / Fit' },
    subtitle: { zh: '展示规格信息', en: 'Explain measurable specs' },
    defaultPromptSeed: {
      zh: '用清晰直观的排版方式呈现尺寸、容量、尺码或关键规格，强调易读性和购买决策效率。',
      en: 'Show size, capacity, fit, or measurable specs in a clean and readable way that helps decision-making.',
    },
  },
  {
    id: 'before-after',
    sortOrder: 9,
    title: { zh: '效果对比图', en: 'Before / After' },
    subtitle: { zh: '使用前后效果对比', en: 'Compare the effect clearly' },
    defaultPromptSeed: {
      zh: '如果产品适合做前后对比，则以视觉对照方式展示使用前后差异，突出功能改善或体验升级。',
      en: 'If the product supports comparison, show a strong before-vs-after contrast that makes the improvement immediately obvious.',
    },
  },
  {
    id: 'spec-table',
    sortOrder: 10,
    title: { zh: '详细规格/参数表', en: 'Specification Table' },
    subtitle: { zh: '展示详细商品数据', en: 'List detailed product data' },
    defaultPromptSeed: {
      zh: '用结构化参数表的形式呈现产品详细规格、型号、材质、性能或包装信息，强调清晰、专业、可信。',
      en: 'Show detailed product data in a structured specification-table style that feels clear, professional, and trustworthy.',
    },
  },
  {
    id: 'craft-process',
    sortOrder: 11,
    title: { zh: '工艺制作图', en: 'Craft Process' },
    subtitle: { zh: '展示工艺制作过程', en: 'Show how it is made' },
    defaultPromptSeed: {
      zh: '围绕制作工艺、生产流程、检验环节或关键制程，构建体现专业度和工艺价值的模块内容。',
      en: 'Build a craft-process module that reveals manufacturing process, craftsmanship, or quality-control credibility.',
    },
  },
  {
    id: 'accessories-gifts',
    sortOrder: 12,
    title: { zh: '配件/赠品图', en: 'Accessories / Gifts' },
    subtitle: { zh: '明确收货的所有物品', en: 'Clarify what is included' },
    defaultPromptSeed: {
      zh: '清晰展示包装内含物、配件、赠品和组合关系，让用户明确收到的全部内容。',
      en: 'Clearly show all included items, accessories, gifts, and package contents in one understandable module.',
    },
  },
  {
    id: 'series-display',
    sortOrder: 13,
    title: { zh: '系列展示图', en: 'Series Display' },
    subtitle: { zh: '多色或多 SKU 展示', en: 'Show variants or SKUs' },
    defaultPromptSeed: {
      zh: '当产品有多色、多款或多 SKU 时，用系列化展示方式表现组合关系、选择空间和搭配逻辑。',
      en: 'If the product has multiple variants or SKUs, present them as a cohesive series with clear differentiation.',
    },
  },
  {
    id: 'ingredients',
    sortOrder: 14,
    title: { zh: '商品成分图', en: 'Ingredient / Material' },
    subtitle: { zh: '展示配方/材质/成分', en: 'Explain formula or material' },
    defaultPromptSeed: {
      zh: '围绕配方、原料、材质组成或核心成分，构建兼顾专业表达与易理解性的说明模块。',
      en: 'Explain the formula, ingredients, material composition, or key substances in a way that feels both expert and accessible.',
    },
  },
  {
    id: 'after-sales',
    sortOrder: 15,
    title: { zh: '售后保障图', en: 'After-sales Guarantee' },
    subtitle: { zh: '说明质保退换政策', en: 'Explain support and warranty' },
    defaultPromptSeed: {
      zh: '突出退换货、质保、发货、客服支持等售后权益，降低购买顾虑并增强信任感。',
      en: 'Present warranty, returns, support, and fulfillment guarantees to reduce purchase hesitation and build trust.',
    },
  },
  {
    id: 'usage-tips',
    sortOrder: 16,
    title: { zh: '使用建议图', en: 'Usage Tips' },
    subtitle: { zh: '商品使用的注意事项', en: 'Provide care or usage notes' },
    defaultPromptSeed: {
      zh: '整理使用方法、注意事项、保存建议或适用提醒，让用户在购买前就能理解正确使用方式。',
      en: 'Summarize usage guidance, precautions, care instructions, or suitability notes before purchase.',
    },
  },
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fallbackDesignSpecs(isZh: boolean, outputLanguage: OutputLanguage): string {
  return isZh
    ? `所有模块需保持同一商品的一致性，统一视觉语气、光影逻辑与版式节奏。输出语言为 ${outputLanguage === 'none' ? '纯视觉无文字' : outputLanguage === 'zh' ? '简体中文' : outputLanguage}。如涉及新增设计文案，必须围绕用户提供的组图要求展开，并且严格使用目标语言；若输出语言为简体中文，则不得出现英文单词、拼音、双语混排或英文占位词。产品自身已有的 logo、包装原文、型号、成分表、技术单位不属于新增设计文案。`
    : `All modules must keep the same product identity, visual rhythm, lighting logic, and layout language. Output language is ${outputLanguage === 'none' ? 'visual only with no copy' : outputLanguage === 'zh' ? 'Simplified Chinese' : outputLanguage}. Any added design copy must align with the user's brief and use the target language only. If the target language is Simplified Chinese, do not use English words, pinyin, bilingual mixing, or English placeholders. Existing product text such as logos, original packaging text, model numbers, ingredient tables, and technical units is not added design copy.`
}

function parseBlueprintRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input === 'string') {
    try {
      return asRecord(JSON.parse(input))
    } catch {
      return null
    }
  }
  return asRecord(input)
}

export function getEcomDetailModuleById(id: EcomDetailModuleId): EcomDetailModuleDefinition | undefined {
  return ECOM_DETAIL_MODULES.find((module) => module.id === id)
}

export function resolveEcomDetailModules(selectedIds: EcomDetailModuleId[]): EcomDetailModuleDefinition[] {
  const selectedSet = new Set(selectedIds)
  return ECOM_DETAIL_MODULES
    .filter((module) => selectedSet.has(module.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function localizeEcomDetailModule(
  module: EcomDetailModuleDefinition,
  isZh: boolean,
): { title: string; subtitle: string; defaultPromptSeed: string } {
  return {
    title: isZh ? module.title.zh : module.title.en,
    subtitle: isZh ? module.subtitle.zh : module.subtitle.en,
    defaultPromptSeed: isZh ? module.defaultPromptSeed.zh : module.defaultPromptSeed.en,
  }
}

export function buildEcomDetailAnalysisRequirements(params: {
  requirements: string
  selectedModuleIds: EcomDetailModuleId[]
  isZh: boolean
}): string {
  const modules = resolveEcomDetailModules(params.selectedModuleIds)
  const header = params.isZh
    ? '你正在为同一个产品规划详情页模块。所有图片必须围绕同一商品，允许使用多张参考图补充角度和细节，但不能变成多个商品。'
    : 'You are planning a detail-page image set for one product only. Multiple uploaded images are references for the same product, not different products.'
  const userBriefLabel = params.isZh ? '用户组图要求' : 'User brief'
  const moduleLabel = params.isZh ? '必须生成以下模块，并保持固定顺序' : 'Generate these modules in this exact order'
  const moduleLines = modules.map((module, index) => {
    const localized = localizeEcomDetailModule(module, params.isZh)
    return params.isZh
      ? `${index + 1}. ${localized.title}｜${localized.subtitle}｜内部重点：${localized.defaultPromptSeed}`
      : `${index + 1}. ${localized.title} | ${localized.subtitle} | Internal focus: ${localized.defaultPromptSeed}`
  })
  const fallbackBrief = params.isZh
    ? '（用户未补充更多要求，请根据产品图与所选模块自动规划。）'
    : '(No extra brief provided. Infer the plan from the product images and selected modules.)'

  return [
    header,
    `${userBriefLabel}:`,
    params.requirements.trim() || fallbackBrief,
    '',
    `${moduleLabel}:`,
    ...moduleLines,
  ].join('\n')
}

export function normalizeEcomDetailBlueprint(
  input: unknown,
  selectedModuleIds: EcomDetailModuleId[],
  isZh: boolean,
  outputLanguage: OutputLanguage,
): AnalysisBlueprint {
  const parsed = parseBlueprintRecord(input)
  const modules = resolveEcomDetailModules(selectedModuleIds)
  const rawImages = parsed && Array.isArray(parsed.images)
    ? parsed.images
    : parsed && Array.isArray(parsed.image_plans)
      ? parsed.image_plans
      : parsed && Array.isArray(parsed.plans)
        ? parsed.plans
        : []

  const images: BlueprintImagePlan[] = modules.map((module, index) => {
    const localized = localizeEcomDetailModule(module, isZh)
    const raw = asRecord(rawImages[index])
    const description = asTrimmedString(raw?.description)
      || asTrimmedString(raw?.desc)
      || localized.subtitle
    const designContent = asTrimmedString(raw?.design_content)
      || asTrimmedString(raw?.designContent)
      || asTrimmedString(raw?.prompt)
      || asTrimmedString(raw?.content)
      || localized.defaultPromptSeed
    const normalizedContent = designContent.includes(localized.title)
      ? designContent
      : `${localized.title}\n${designContent}`

    return {
      id: module.id,
      title: localized.title,
      description,
      design_content: normalizedContent,
    }
  })

  const metaRecord = parsed?._ai_meta && typeof parsed._ai_meta === 'object'
    ? parsed._ai_meta as Record<string, unknown>
    : {}

  return {
    images,
    design_specs: asTrimmedString(parsed?.design_specs)
      || asTrimmedString(parsed?.designSpecs)
      || fallbackDesignSpecs(isZh, outputLanguage),
    _ai_meta: {
      model: asTrimmedString(metaRecord.model) || 'unknown',
      usage: metaRecord.usage && typeof metaRecord.usage === 'object'
        ? metaRecord.usage as Record<string, unknown>
        : {},
      provider: asTrimmedString(metaRecord.provider) || 'fallback',
      image_count: Number.isFinite(Number(metaRecord.image_count))
        ? Math.max(1, Math.round(Number(metaRecord.image_count)))
        : Math.max(images.length, 1),
      target_language: asTrimmedString(metaRecord.target_language) || outputLanguage,
    },
  }
}
