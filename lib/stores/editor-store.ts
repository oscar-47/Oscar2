import { create } from 'zustand'
import type { GenerationModel, AspectRatio, ImageSize } from '@/types'

export interface CanvasObject {
  id: string
  url: string
  originalUrl: string
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
  x: number
  y: number
  width: number
  height: number
  aspectRatioLock: string | null // e.g. '1:1', '16:9', null = free
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
  turboEnabled: boolean
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
  turboEnabled: boolean
  isProcessing: boolean
  isDetecting: boolean
  ocrJobId: string | null  // job_id from detect-image-text
  jobId: string | null     // job_id from generate-image (apply)
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

  // Actions
  initFromUrls: (urls: string[]) => void
  addImage: (url: string, naturalWidth?: number, naturalHeight?: number) => void
  removeObject: (id: string) => void
  selectObject: (id: string | null) => void
  moveObject: (id: string, deltaX: number, deltaY: number) => void
  replaceObjectUrl: (id: string, newUrl: string) => void
  updateObjectDimensions: (id: string, naturalWidth: number, naturalHeight: number) => void
  setZoom: (zoom: number) => void
  setPan: (x: number, y: number) => void
  setTool: (tool: EditorTool) => void

  // Crop
  startCrop: (objectId: string) => void
  updateCropRegion: (patch: Partial<Pick<CropState, 'x' | 'y' | 'width' | 'height' | 'aspectRatioLock'>>) => void
  applyCrop: (croppedUrl: string) => void
  cancelCrop: () => void

  // Quick Edit
  openQuickEdit: (objectId: string) => void
  closeQuickEdit: () => void
  setQuickEditField: <K extends keyof QuickEditState>(key: K, value: QuickEditState[K]) => void

  // Text Detection
  setTextDetection: (patch: Partial<TextDetectionState>) => void

  // Text Edit
  openTextEdit: (objectId: string) => void
  closeTextEdit: () => void
  setTextEditItems: (items: TextEditItem[], requestId: string) => void
  setEditedText: (id: string, value: string) => void
  setTextEditField: <K extends keyof TextEditState>(key: K, value: TextEditState[K]) => void

  // Comparison
  setComparison: (patch: Partial<ComparisonState>) => void

  // Text edit result
  applyTextEditResult: (objectId: string, resultUrl: string) => void
}

const DEFAULT_DISPLAY_WIDTH = 300
const VERTICAL_GAP = 24

const defaultCrop: CropState = {
  active: false,
  objectId: null,
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
  model: 'azure-flux',
  aspectRatio: '1:1',
  imageSize: '2K',
  turboEnabled: false,
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
  turboEnabled: false,
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

export const useEditorStore = create<EditorState>((set, get) => ({
  objects: [],
  selectedId: null,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  activeTool: 'select',
  crop: defaultCrop,
  quickEdit: defaultQuickEdit,
  textDetection: defaultTextDetection,
  textEdit: defaultTextEdit,
  comparison: defaultComparison,

  initFromUrls: (urls) => {
    let currentY = 40
    const objects: CanvasObject[] = urls.map((url, i) => {
      const obj: CanvasObject = {
        id: crypto.randomUUID(),
        url,
        originalUrl: url,
        x: 40,
        y: currentY,
        width: DEFAULT_DISPLAY_WIDTH,
        height: DEFAULT_DISPLAY_WIDTH, // placeholder, updated after image load
        naturalWidth: 0,
        naturalHeight: 0,
        zIndex: i + 1,
      }
      currentY += DEFAULT_DISPLAY_WIDTH + VERTICAL_GAP
      return obj
    })
    set({ objects, selectedId: null })
  },

  addImage: (url, naturalWidth, naturalHeight) => {
    const state = get()
    const maxZ = state.objects.reduce((max, o) => Math.max(max, o.zIndex), 0)
    const lastObj = state.objects[state.objects.length - 1]
    const y = lastObj ? lastObj.y + lastObj.height + VERTICAL_GAP : 40

    const w = naturalWidth ?? DEFAULT_DISPLAY_WIDTH
    const h = naturalHeight ?? DEFAULT_DISPLAY_WIDTH
    const displayWidth = DEFAULT_DISPLAY_WIDTH
    const displayHeight = w > 0 ? (h / w) * displayWidth : displayWidth

    set({
      objects: [
        ...state.objects,
        {
          id: crypto.randomUUID(),
          url,
          originalUrl: url,
          x: 40,
          y,
          width: displayWidth,
          height: displayHeight,
          naturalWidth: w,
          naturalHeight: h,
          zIndex: maxZ + 1,
        },
      ],
    })
  },

  removeObject: (id) => {
    const state = get()
    set({
      objects: state.objects.filter((o) => o.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })
  },

  selectObject: (id) => set({ selectedId: id }),

  moveObject: (id, deltaX, deltaY) => {
    set({
      objects: get().objects.map((o) =>
        o.id === id ? { ...o, x: o.x + deltaX, y: o.y + deltaY } : o
      ),
    })
  },

  replaceObjectUrl: (id, newUrl) => {
    set({
      objects: get().objects.map((o) =>
        o.id === id ? { ...o, url: newUrl } : o
      ),
    })
  },

  updateObjectDimensions: (id, naturalWidth, naturalHeight) => {
    set({
      objects: get().objects.map((o) => {
        if (o.id !== id) return o
        const displayHeight = naturalWidth > 0
          ? (naturalHeight / naturalWidth) * o.width
          : o.height
        return { ...o, naturalWidth, naturalHeight, height: displayHeight }
      }),
    })
  },

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5.0, zoom)) }),

  setPan: (x, y) => set({ panX: x, panY: y }),

  setTool: (tool) => set({ activeTool: tool }),

  // Crop
  startCrop: (objectId) => {
    const obj = get().objects.find((o) => o.id === objectId)
    if (!obj) return
    set({
      crop: {
        active: true,
        objectId,
        x: 0,
        y: 0,
        width: obj.naturalWidth || obj.width,
        height: obj.naturalHeight || obj.height,
        aspectRatioLock: null,
      },
      selectedId: objectId,
    })
  },

  updateCropRegion: (patch) => {
    set({ crop: { ...get().crop, ...patch } })
  },

  applyCrop: (croppedUrl) => {
    const { crop } = get()
    if (!crop.objectId) return
    const cropW = Math.round(crop.width)
    const cropH = Math.round(crop.height)
    set({
      objects: get().objects.map((o) => {
        if (o.id !== crop.objectId) return o
        const displayHeight = cropW > 0 ? (cropH / cropW) * o.width : o.height
        return {
          ...o,
          url: croppedUrl,
          naturalWidth: cropW,
          naturalHeight: cropH,
          height: displayHeight,
        }
      }),
      crop: defaultCrop,
    })
  },

  cancelCrop: () => set({ crop: defaultCrop }),

  // Quick Edit
  openQuickEdit: (objectId) => {
    const obj = get().objects.find((o) => o.id === objectId)
    if (!obj) return
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

  // Text Detection
  setTextDetection: (patch) => {
    set({ textDetection: { ...get().textDetection, ...patch } })
  },

  // Text Edit
  openTextEdit: (objectId) => {
    const obj = get().objects.find((o) => o.id === objectId)
    if (!obj) return
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
        items: get().textEdit.items.map((item) =>
          item.id === id ? { ...item, edited: value } : item
        ),
      },
    })
  },

  setTextEditField: (key, value) => {
    set({ textEdit: { ...get().textEdit, [key]: value } })
  },

  // Comparison
  setComparison: (patch) => {
    set({ comparison: { ...get().comparison, ...patch } })
  },

  // Text edit result — add edited image next to original and show comparison arrow
  applyTextEditResult: (objectId, resultUrl) => {
    const obj = get().objects.find((o) => o.id === objectId)
    if (!obj) return
    const newId = crypto.randomUUID()
    const newObj: CanvasObject = {
      id: newId,
      url: resultUrl,
      originalUrl: resultUrl,
      x: obj.x + obj.width + 40,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      naturalWidth: obj.naturalWidth,
      naturalHeight: obj.naturalHeight,
      zIndex: Math.max(...get().objects.map((o) => o.zIndex), 0) + 1,
    }
    set({
      objects: [...get().objects, newObj],
      comparison: { visible: true, fromId: objectId, toId: newId },
      selectedId: newId,
    })
  },
}))
