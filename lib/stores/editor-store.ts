import { create } from 'zustand'
import type {
  AspectRatio,
  GenerationModel,
  ImageSize,
  ResultAsset,
  ResultAssetOrigin,
  ResultAssetSection,
} from '@/types'
import { DEFAULT_MODEL } from '@/types'

export interface CanvasObject {
  id: string
  url: string
  originalUrl: string
  label?: string
  section: ResultAssetSection
  sourceAssetId?: string
  createdAt: number
  originModule: ResultAssetOrigin
  x: number
  y: number
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
  zIndex: number
}

export type EditorTool = 'select' | 'pan'

export interface CropState {
  active: boolean
  objectId: string | null
  sessionId: string | null
  x: number
  y: number
  width: number
  height: number
  aspectRatioLock: string | null
}

export interface QuickEditState {
  open: boolean
  objectId: string | null
  prompt: string
  referenceImage: string | null
  referencePreview: string | null
  model: GenerationModel
  aspectRatio: AspectRatio
  imageSize: ImageSize
  isProcessing: boolean
  jobId: string | null
}

export interface TextDetectionState {
  objectId: string | null
  loading: boolean
  detected: boolean
  texts: Array<{ content: string; position: string }>
}

export interface TextEditItem {
  id: string
  original: string
  edited: string
  position: string
}

export interface TextEditState {
  open: boolean
  objectId: string | null
  requestId: string | null
  items: TextEditItem[]
  isProcessing: boolean
  isDetecting: boolean
  ocrJobId: string | null
  jobId: string | null
}

export interface ComparisonState {
  visible: boolean
  fromId: string | null
  toId: string | null
}

interface EditorState {
  objects: CanvasObject[]
  selectedId: string | null
  zoom: number
  panX: number
  panY: number
  activeTool: EditorTool
  crop: CropState
  quickEdit: QuickEditState
  textDetection: TextDetectionState
  textEdit: TextEditState
  comparison: ComparisonState

  initFromAssets: (assets: ResultAsset[]) => void
  addImage: (url: string, naturalWidth?: number, naturalHeight?: number) => void
  removeObject: (id: string) => void
  selectObject: (id: string | null) => void
  moveObject: (id: string, deltaX: number, deltaY: number) => void
  replaceObjectUrl: (id: string, newUrl: string) => void
  updateObjectDimensions: (id: string, naturalWidth: number, naturalHeight: number) => void
  setZoom: (zoom: number) => void
  setPan: (x: number, y: number) => void
  setTool: (tool: EditorTool) => void

  startCrop: (objectId: string) => void
  updateCropRegion: (patch: Partial<Pick<CropState, 'x' | 'y' | 'width' | 'height' | 'aspectRatioLock'>>) => void
  applyCrop: (croppedUrl: string, snapshot: { objectId: string; cropW: number; cropH: number; sessionId: string }) => void
  cancelCrop: () => void

  openQuickEdit: (objectId: string) => void
  closeQuickEdit: () => void
  setQuickEditField: <K extends keyof QuickEditState>(key: K, value: QuickEditState[K]) => void

  setTextDetection: (patch: Partial<TextDetectionState>) => void

  openTextEdit: (objectId: string) => void
  closeTextEdit: () => void
  setTextEditItems: (items: TextEditItem[], requestId: string) => void
  setEditedText: (id: string, value: string) => void
  setTextEditField: <K extends keyof TextEditState>(key: K, value: TextEditState[K]) => void

  setComparison: (patch: Partial<ComparisonState>) => void
  applyTextEditResult: (objectId: string, resultUrl: string) => void
  exportAssets: () => ResultAsset[]
}

const DEFAULT_DISPLAY_WIDTH = 300
const VERTICAL_GAP = 24

const defaultCrop: CropState = {
  active: false,
  objectId: null,
  sessionId: null,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  aspectRatioLock: null,
}

const defaultQuickEdit: QuickEditState = {
  open: false,
  objectId: null,
  prompt: '',
  referenceImage: null,
  referencePreview: null,
  model: DEFAULT_MODEL,
  aspectRatio: '1:1',
  imageSize: '2K',
  isProcessing: false,
  jobId: null,
}

const defaultTextDetection: TextDetectionState = {
  objectId: null,
  loading: false,
  detected: false,
  texts: [],
}

const defaultTextEdit: TextEditState = {
  open: false,
  objectId: null,
  requestId: null,
  items: [],
  isProcessing: false,
  isDetecting: false,
  ocrJobId: null,
  jobId: null,
}

const defaultComparison: ComparisonState = {
  visible: false,
  fromId: null,
  toId: null,
}

function buildCanvasObject(asset: ResultAsset, y: number, zIndex: number): CanvasObject {
  return {
    id: asset.id,
    url: asset.url,
    originalUrl: asset.url,
    label: asset.label,
    section: asset.section,
    sourceAssetId: asset.sourceAssetId,
    createdAt: asset.createdAt,
    originModule: asset.originModule,
    x: 40,
    y,
    width: DEFAULT_DISPLAY_WIDTH,
    height: DEFAULT_DISPLAY_WIDTH,
    naturalWidth: 0,
    naturalHeight: 0,
    zIndex,
  }
}

function nextDerivedObject(source: CanvasObject, input: {
  url: string
  naturalWidth: number
  naturalHeight: number
  displayHeight: number
  zIndex: number
}): CanvasObject {
  return {
    id: crypto.randomUUID(),
    url: input.url,
    originalUrl: input.url,
    label: source.label,
    section: 'edited',
    sourceAssetId: source.id,
    createdAt: Date.now(),
    originModule: source.originModule,
    x: source.x + source.width + 40,
    y: source.y,
    width: source.width,
    height: input.displayHeight,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.naturalHeight,
    zIndex: input.zIndex,
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  objects: [],
  selectedId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  activeTool: 'select',
  crop: defaultCrop,
  quickEdit: defaultQuickEdit,
  textDetection: defaultTextDetection,
  textEdit: defaultTextEdit,
  comparison: defaultComparison,

  initFromAssets: (assets) => {
    let currentY = 40
    const objects = assets.map((asset, index) => {
      const next = buildCanvasObject(asset, currentY, index + 1)
      currentY += DEFAULT_DISPLAY_WIDTH + VERTICAL_GAP
      return next
    })

    set({
      objects,
      selectedId: null,
      crop: defaultCrop,
      quickEdit: defaultQuickEdit,
      textDetection: defaultTextDetection,
      textEdit: defaultTextEdit,
      comparison: defaultComparison,
    })
  },

  addImage: (url, naturalWidth, naturalHeight) => {
    const state = get()
    const maxZ = state.objects.reduce((max, object) => Math.max(max, object.zIndex), 0)
    const lastObject = state.objects[state.objects.length - 1]
    const y = lastObject ? lastObject.y + lastObject.height + VERTICAL_GAP : 40
    const width = naturalWidth ?? DEFAULT_DISPLAY_WIDTH
    const height = naturalHeight ?? DEFAULT_DISPLAY_WIDTH
    const displayHeight = width > 0 ? (height / width) * DEFAULT_DISPLAY_WIDTH : DEFAULT_DISPLAY_WIDTH

    set({
      objects: [
        ...state.objects,
        {
          id: crypto.randomUUID(),
          url,
          originalUrl: url,
          label: undefined,
          section: 'original',
          sourceAssetId: undefined,
          createdAt: Date.now(),
          originModule: 'image-editor',
          x: 40,
          y,
          width: DEFAULT_DISPLAY_WIDTH,
          height: displayHeight,
          naturalWidth: width,
          naturalHeight: height,
          zIndex: maxZ + 1,
        },
      ],
    })
  },

  removeObject: (id) => {
    const state = get()
    set({
      objects: state.objects.filter((object) => object.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })
  },

  selectObject: (id) => set({ selectedId: id }),

  moveObject: (id, deltaX, deltaY) => {
    set({
      objects: get().objects.map((object) => (
        object.id === id
          ? { ...object, x: object.x + deltaX, y: object.y + deltaY }
          : object
      )),
    })
  },

  replaceObjectUrl: (id, newUrl) => {
    set({
      objects: get().objects.map((object) => (
        object.id === id ? { ...object, url: newUrl } : object
      )),
    })
  },

  updateObjectDimensions: (id, naturalWidth, naturalHeight) => {
    set({
      objects: get().objects.map((object) => {
        if (object.id !== id) return object
        const displayHeight = naturalWidth > 0
          ? (naturalHeight / naturalWidth) * object.width
          : object.height
        return { ...object, naturalWidth, naturalHeight, height: displayHeight }
      }),
    })
  },

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),

  setPan: (x, y) => set({ panX: x, panY: y }),

  setTool: (tool) => set({ activeTool: tool }),

  startCrop: (objectId) => {
    const object = get().objects.find((item) => item.id === objectId)
    if (!object) return
    set({
      crop: {
        active: true,
        objectId,
        sessionId: crypto.randomUUID(),
        x: 0,
        y: 0,
        width: object.naturalWidth || object.width,
        height: object.naturalHeight || object.height,
        aspectRatioLock: null,
      },
      selectedId: objectId,
    })
  },

  updateCropRegion: (patch) => {
    set({ crop: { ...get().crop, ...patch } })
  },

  applyCrop: (croppedUrl, snapshot) => {
    const { objectId, cropW, cropH, sessionId } = snapshot
    if (!objectId || cropW <= 0 || cropH <= 0) return
    if (get().crop.sessionId !== sessionId) return

    const object = get().objects.find((item) => item.id === objectId)
    if (!object) {
      set({ crop: defaultCrop })
      return
    }

    const newObject = nextDerivedObject(object, {
      url: croppedUrl,
      naturalWidth: cropW,
      naturalHeight: cropH,
      displayHeight: (cropH / cropW) * object.width,
      zIndex: Math.max(...get().objects.map((item) => item.zIndex), 0) + 1,
    })

    set({
      objects: [...get().objects, newObject],
      comparison: { visible: true, fromId: objectId, toId: newObject.id },
      selectedId: newObject.id,
      crop: defaultCrop,
    })
  },

  cancelCrop: () => set({ crop: defaultCrop }),

  openQuickEdit: (objectId) => {
    const object = get().objects.find((item) => item.id === objectId)
    if (!object) return
    set({
      quickEdit: {
        ...defaultQuickEdit,
        open: true,
        objectId,
      },
      selectedId: objectId,
    })
  },

  closeQuickEdit: () => set({ quickEdit: defaultQuickEdit }),

  setQuickEditField: (key, value) => {
    set({ quickEdit: { ...get().quickEdit, [key]: value } })
  },

  setTextDetection: (patch) => {
    set({ textDetection: { ...get().textDetection, ...patch } })
  },

  openTextEdit: (objectId) => {
    const object = get().objects.find((item) => item.id === objectId)
    if (!object) return
    set({
      textEdit: {
        ...defaultTextEdit,
        open: true,
        objectId,
        isDetecting: true,
        requestId: crypto.randomUUID(),
      },
      selectedId: objectId,
    })
  },

  closeTextEdit: () => set({ textEdit: defaultTextEdit }),

  setTextEditItems: (items, requestId) => {
    const state = get()
    if (state.textEdit.requestId !== requestId) return
    set({ textEdit: { ...state.textEdit, items, isDetecting: false } })
  },

  setEditedText: (id, value) => {
    set({
      textEdit: {
        ...get().textEdit,
        items: get().textEdit.items.map((item) => (
          item.id === id ? { ...item, edited: value } : item
        )),
      },
    })
  },

  setTextEditField: (key, value) => {
    set({ textEdit: { ...get().textEdit, [key]: value } })
  },

  setComparison: (patch) => {
    set({ comparison: { ...get().comparison, ...patch } })
  },

  applyTextEditResult: (objectId, resultUrl) => {
    const object = get().objects.find((item) => item.id === objectId)
    if (!object) return

    const newObject = nextDerivedObject(object, {
      url: resultUrl,
      naturalWidth: object.naturalWidth,
      naturalHeight: object.naturalHeight,
      displayHeight: object.height,
      zIndex: Math.max(...get().objects.map((item) => item.zIndex), 0) + 1,
    })

    set({
      objects: [...get().objects, newObject],
      comparison: { visible: true, fromId: objectId, toId: newObject.id },
      selectedId: newObject.id,
    })
  },

  exportAssets: () => (
    get().objects.map((object) => ({
      id: object.id,
      url: object.url,
      label: object.label,
      section: object.section,
      sourceAssetId: object.sourceAssetId,
      createdAt: object.createdAt,
      originModule: object.originModule,
    }))
  ),
}))
