export type ClothingTab = 'model-tryon' | 'basic-photo-set'

export type ClothingPhase = 'input' | 'analyzing' | 'preview' | 'generating' | 'complete'

export interface BasicPhotoTypeState {
  whiteBgRetouched: { front: boolean; back: boolean }
  threeDEffect: { enabled: boolean; whiteBackground: boolean }
  mannequin: { enabled: boolean; whiteBackground: boolean }
  detailCloseup: { count: number }
  sellingPoint: { count: number }
}

export interface AIModelParams {
  gender: string
  ageRange: string
  skinColor: string
  otherRequirements: string
  count: number
  turboEnabled: boolean
}
