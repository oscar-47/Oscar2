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
  gender: 'female' | 'male'
  ageRange: '18-25' | '26-35' | '36-45' | '46-60' | '60+'
  ethnicity: 'asian' | 'white' | 'black' | 'latino'
  otherRequirements?: string
  count: 1 | 2 | 3 | 4
  turboEnabled: boolean
}

export interface AIModelHistoryItem {
  id: string
  jobId: string
  gender: 'female' | 'male'
  ageRange: '18-25' | '26-35' | '36-45' | '46-60' | '60+'
  ethnicity: 'asian' | 'white' | 'black' | 'latino'
  resultUrl: string | null
  status: 'processing' | 'success' | 'failed'
  errorMessage: string | null
  createdAt: string
}
