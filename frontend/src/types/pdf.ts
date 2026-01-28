export interface PDFDocument {
  id: string
  name: string
  file: File | null
  arrayBuffer: ArrayBuffer | null
  numPages: number
  currentPage: number
  scale: number
  rotation: number
  snapshots?: ArrayBuffer[] // History of PDF states for undo
  pageOrder?: number[] // Custom page order for reordering pages
}

export interface EditAction {
  type: 'text' | 'image' | 'draw' | 'delete'
  page: number
  data: any
  timestamp: number
}

export interface TextAnnotation {
  text: string
  x: number
  y: number
  size: number
  color: string
  fontFamily: string
}

export interface ImageAnnotation {
  imageData: string
  x: number
  y: number
  width: number
  height: number
}

export interface TextItem {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface SearchMatch {
  pageIndex: number
  textIndex: number
  text: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}
