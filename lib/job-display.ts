import type { JobType, ResultAssetOrigin } from '../types/index'

export type BusinessModule =
  | 'studio-genesis'
  | 'ecom-studio'
  | 'aesthetic-mirror'
  | 'refinement-studio'
  | 'clothing-studio'
  | 'unknown'

export type JobDisplayDetailMode =
  | 'blueprint-analysis'
  | 'hero-image-generation'
  | 'detail-plan-analysis'
  | 'detail-module-generation'
  | 'single-reference'
  | 'batch-reference'
  | 'style-replication'
  | 'refinement'
  | 'basic-photo-set'
  | 'model-try-on'
  | 'unknown'

export interface JobDisplaySemantics {
  businessModule: BusinessModule
  businessModuleLabelKey: string
  detailMode: JobDisplayDetailMode
  detailLabelKey: string | null
  detailLabelText: string | null
  detailTitle: string | null
  technicalType: JobType
}

type JobDisplayInput = {
  type: JobType
  payload?: unknown
  resultData?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readMetadata(
  payload: Record<string, unknown> | null,
  resultData: unknown,
): Record<string, unknown> | null {
  if (isRecord(payload?.metadata)) return payload.metadata
  if (isRecord(resultData) && isRecord(resultData.metadata)) return resultData.metadata
  return null
}

function technicalTypeLabelKey(type: JobType) {
  return `type.${type}`
}

function buildSemantics(
  businessModule: BusinessModule,
  detailMode: JobDisplayDetailMode,
  technicalType: JobType,
  options?: {
    detailLabelKey?: string | null
    detailLabelText?: string | null
    detailTitle?: string | null
  },
): JobDisplaySemantics {
  return {
    businessModule,
    businessModuleLabelKey: `businessModule.${businessModule}`,
    detailMode,
    detailLabelKey: options?.detailLabelKey ?? `detail.${detailMode}`,
    detailLabelText: options?.detailLabelText ?? null,
    detailTitle: options?.detailTitle ?? null,
    technicalType,
  }
}

export function getJobDisplaySemantics(input: JobDisplayInput): JobDisplaySemantics {
  const payload = isRecord(input.payload) ? input.payload : null
  const metadata = readMetadata(payload, input.resultData)
  const mode = readString(payload?.mode)
  const studioType = readString(payload?.studioType)
  const workflowMode = readString(payload?.workflowMode)
  const clothingMode = readString(payload?.clothingMode)
  const moduleName = readString(metadata?.module_name)
  const heroPlanTitle = readString(metadata?.hero_plan_title)

  if (input.type === 'STYLE_REPLICATE') {
    if (mode === 'refinement') {
      return buildSemantics('refinement-studio', 'refinement', input.type)
    }
    if (mode === 'single') {
      return buildSemantics('aesthetic-mirror', 'single-reference', input.type)
    }
    if (mode === 'batch') {
      return buildSemantics('aesthetic-mirror', 'batch-reference', input.type)
    }
    return buildSemantics('unknown', 'unknown', input.type, {
      detailLabelKey: technicalTypeLabelKey(input.type),
    })
  }

  if (studioType === 'genesis') {
    return buildSemantics(
      'studio-genesis',
      input.type === 'ANALYSIS' ? 'blueprint-analysis' : 'hero-image-generation',
      input.type,
      {
        detailTitle: input.type === 'IMAGE_GEN' ? heroPlanTitle : null,
      },
    )
  }

  if (studioType === 'ecom-detail' || moduleName) {
    if (input.type === 'ANALYSIS') {
      return buildSemantics('ecom-studio', 'detail-plan-analysis', input.type)
    }
    return buildSemantics('ecom-studio', 'detail-module-generation', input.type, {
      detailLabelKey: moduleName ? null : 'detail.detail-module-generation',
      detailLabelText: moduleName,
    })
  }

  if (
    clothingMode === 'product_analysis'
    || clothingMode === 'prompt_generation'
    || workflowMode === 'product'
  ) {
    return buildSemantics('clothing-studio', 'basic-photo-set', input.type)
  }

  if (
    clothingMode === 'model_strategy'
    || clothingMode === 'model_prompt_generation'
    || workflowMode === 'model'
  ) {
    return buildSemantics('clothing-studio', 'model-try-on', input.type)
  }

  return buildSemantics('unknown', 'unknown', input.type, {
    detailLabelKey: technicalTypeLabelKey(input.type),
  })
}

export function getResultAssetDisplaySemantics(originModule: ResultAssetOrigin): JobDisplaySemantics {
  switch (originModule) {
    case 'studio-genesis':
    case 'studio-genesis-2':
      return buildSemantics('studio-genesis', 'hero-image-generation', 'IMAGE_GEN')
    case 'ecom-studio':
      return buildSemantics('ecom-studio', 'detail-module-generation', 'IMAGE_GEN')
    case 'clothing-basic-photo':
      return buildSemantics('clothing-studio', 'basic-photo-set', 'IMAGE_GEN')
    case 'clothing-model-tryon':
      return buildSemantics('clothing-studio', 'model-try-on', 'IMAGE_GEN')
    case 'aesthetic-mirror':
      return buildSemantics('aesthetic-mirror', 'style-replication', 'STYLE_REPLICATE')
    case 'refinement-studio':
      return buildSemantics('refinement-studio', 'refinement', 'STYLE_REPLICATE')
    default:
      return buildSemantics('unknown', 'unknown', 'IMAGE_GEN', {
        detailLabelKey: technicalTypeLabelKey('IMAGE_GEN'),
      })
  }
}

export function formatJobDisplaySemantics(
  semantics: JobDisplaySemantics,
  translate: (key: string) => string,
): {
  businessModuleLabel: string
  detailLabel: string
  technicalTypeLabel: string
} {
  const businessModuleLabel = translate(semantics.businessModuleLabelKey)
  const detailLabel = semantics.detailLabelText
    ?? (semantics.detailLabelKey ? translate(semantics.detailLabelKey) : translate(technicalTypeLabelKey(semantics.technicalType)))
  const technicalTypeLabel = translate(technicalTypeLabelKey(semantics.technicalType))

  return {
    businessModuleLabel,
    detailLabel,
    technicalTypeLabel,
  }
}
